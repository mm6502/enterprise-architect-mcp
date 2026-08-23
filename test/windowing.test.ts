import {
  BREAKDOWN_LIMIT_FACTOR,
  breakdownApplies,
  buildAxis,
  buildContinuation,
  countBy,
  isTruncated,
  limitParam,
  offsetParam,
} from "../src/tools/windowing";

describe("offsetParam", () => {
  it("defaults to 0 and coerces numeric strings", () => {
    expect(offsetParam.parse(undefined)).toBe(0);
    expect(offsetParam.parse("40")).toBe(40);
  });

  it("rejects negative and fractional offsets", () => {
    expect(() => offsetParam.parse(-1)).toThrow();
    expect(() => offsetParam.parse(1.5)).toThrow();
  });
});

describe("limitParam", () => {
  it("defaults and coerces like the rest of the surface", () => {
    expect(limitParam(25).parse(undefined)).toBe(25);
    expect(limitParam(50).parse("10")).toBe(10);
  });

  // A zero or negative window cannot advance, so a continuation built from one would
  // name the identical call forever.
  it.each([0, -1, -50])("rejects a window of %s that could never advance", (value) => {
    expect(() => limitParam(25).parse(value)).toThrow();
  });
});

describe("isTruncated", () => {
  it("is false once the window reaches the end of the set", () => {
    expect(isTruncated(0, 10, 10)).toBe(false);
    expect(isTruncated(8, 2, 10)).toBe(false);
  });

  it("is true while rows remain", () => {
    expect(isTruncated(0, 10, 11)).toBe(true);
  });
});

describe("buildContinuation", () => {
  it("returns undefined when the window covers the rest of the set", () => {
    expect(buildContinuation("ea_search", { limit: 10 }, 0, 10, 10)).toBeUndefined();
  });

  it("advances offset by returned while preserving limit and filters", () => {
    const next = buildContinuation("ea_list_elements", { packageId: 3, objectType: "Class", limit: 5 }, 10, 5, 40);
    expect(next).toEqual({
      tool: "ea_list_elements",
      arguments: { packageId: 3, objectType: "Class", limit: 5, offset: 15 },
    });
  });

  it.each([
    ["a multiple of the window", 40, 5],
    ["not a multiple of the window", 43, 5],
    ["smaller than one window", 3, 5],
  ])("walks %s exactly once and terminates", (_label, totalMatched, limit) => {
    // Sliced from a real array rather than re-deriving the window arithmetic, so the
    // test cannot agree with the helper by sharing its mistake.
    const rows = [...Array(totalMatched).keys()];
    const seen: number[] = [];
    let offset = 0;

    for (let guard = 0; guard < 1000; guard++) {
      const page = rows.slice(offset, offset + limit);
      seen.push(...page);

      const next = buildContinuation("ea_search", { limit }, offset, page.length, rows.length);
      if (!next) break;
      offset = next.arguments.offset;
    }

    expect(seen).toEqual(rows);
  });

  it("does not offer a continuation past the end of the set", () => {
    expect(buildContinuation("ea_search", { limit: 5 }, 99, 0, 10)).toBeUndefined();
    expect(isTruncated(99, 0, 10)).toBe(false);
  });
});

describe("breakdownApplies", () => {
  it("fires strictly above the factor, not at it", () => {
    const limit = 25;
    expect(breakdownApplies(BREAKDOWN_LIMIT_FACTOR * limit, limit)).toBe(false);
    expect(breakdownApplies(BREAKDOWN_LIMIT_FACTOR * limit + 1, limit)).toBe(true);
  });

  it("scales with the caller's own window", () => {
    expect(breakdownApplies(300, 25)).toBe(true);
    expect(breakdownApplies(300, 100)).toBe(false);
  });
});

describe("buildAxis", () => {
  it("returns undefined when there is nothing to choose between", () => {
    expect(buildAxis(new Map())).toBeUndefined();
    expect(buildAxis(new Map([["Class", 12]]))).toBeUndefined();
  });

  it("orders by count descending, then value ascending", () => {
    const axis = buildAxis(new Map([["UseCase", 5], ["Class", 9], ["Screen", 5]]))!;
    expect(axis.values).toEqual([
      { value: "Class", count: 9 },
      { value: "Screen", count: 5 },
      { value: "UseCase", count: 5 },
    ]);
    expect(axis).toMatchObject({ totalMatched: 3, returned: 3, truncated: false });
  });

  it("caps the value list and reports that it did", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 30; i++) counts.set(`Type${String(i).padStart(2, "0")}`, 100 - i);

    const axis = buildAxis(counts)!;
    expect(axis.returned).toBe(20);
    expect(axis.values).toHaveLength(20);
    expect(axis).toMatchObject({ totalMatched: 30, truncated: true });
    expect(axis.values[0]).toEqual({ value: "Type00", count: 100 });
  });
});

describe("countBy", () => {
  it("tallies a column and skips blanks", () => {
    const rows = [{ t: "Class" }, { t: "Class" }, { t: null }, { t: "" }, { t: "Screen" }];
    expect(countBy(rows, (r) => r.t)).toEqual(new Map([["Class", 2], ["Screen", 1]]));
  });
});
