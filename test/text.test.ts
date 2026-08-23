import { decodeEntities, foldText, extractLinks } from "../src/text";

describe("decodeEntities", () => {
  it("decodes numeric entities", () => {
    expect(decodeEntities("Pr&#225;vnick&#225;")).toBe("Právnická");
  });

  it("decodes hex entities", () => {
    expect(decodeEntities("&#xe1;")).toBe("á");
  });

  it("decodes named entities", () => {
    expect(decodeEntities("&aacute;")).toBe("á");
  });

  it("preserves &lt;", () => {
    expect(decodeEntities("&lt;")).toBe("&lt;");
  });

  it("preserves &gt;", () => {
    expect(decodeEntities("&gt;")).toBe("&gt;");
  });

  it("preserves &amp;", () => {
    expect(decodeEntities("&amp;")).toBe("&amp;");
  });

  it("preserves stereotype notation", () => {
    expect(decodeEntities("&lt;&lt;modul&gt;&gt;")).toBe("&lt;&lt;modul&gt;&gt;");
  });

  it("returns null for null input", () => {
    expect(decodeEntities(null)).toBeNull();
  });

  it("decodes uppercase X hex entity", () => {
    expect(decodeEntities("&#XE1;")).toBe("á");
  });

  it("leaves out-of-range numeric entity unchanged", () => {
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
  });

  it("handles mixed content", () => {
    expect(decodeEntities("Pr&#225;vnick&#225; osoba &lt;&gt; null")).toBe(
      "Právnická osoba &lt;&gt; null"
    );
  });
});

describe("foldText", () => {
  it("folds uppercase Slovak diacritics", () => {
    expect(foldText("PRÁVNICKÁ")).toBe("pravnicka");
  });

  it("folds Č", () => {
    expect(foldText("Čas")).toBe("cas");
  });

  it("folds Ľ", () => {
    expect(foldText("Ľudia")).toBe("ludia");
  });

  it("folds ä", () => {
    expect(foldText("Väzba")).toBe("vazba");
  });

  it("combined decode + fold", () => {
    expect(foldText(decodeEntities("Pr&#225;vnick&#225;")!)).toBe("pravnicka");
  });
});

describe("extractLinks", () => {
  it("extracts model-internal $element link", () => {
    const links = extractLinks('<a href="$element://{GUID}">text</a>');
    expect(links).toHaveLength(1);
    expect(links[0].scheme).toBe("$element");
    expect(links[0].resolvable).toBe(true);
  });

  it("extracts external $inet link", () => {
    const links = extractLinks('<a href="$inet://slov-lex.sk/123">law</a>');
    expect(links).toHaveLength(1);
    expect(links[0].scheme).toBe("$inet");
    expect(links[0].resolvable).toBe(false);
  });

  it("extracts external https link", () => {
    const links = extractLinks('<a href="https://example.com">link</a>');
    expect(links).toHaveLength(1);
    expect(links[0].scheme).toBe("https");
    expect(links[0].resolvable).toBe(false);
  });

  it("returns empty for no links", () => {
    expect(extractLinks("plain text")).toEqual([]);
  });

  it("returns null scheme for unknown formats", () => {
    expect(extractLinks(null)).toEqual([]);
  });

  it("classifies unknown scheme as external", () => {
    const links = extractLinks('<a href="$matrix://something">m</a>');
    expect(links[0].scheme).toBe("$matrix");
    expect(links[0].resolvable).toBe(false);
  });

  it("classifies $diagram as resolvable", () => {
    const links = extractLinks('<a href="$diagram://{D-001}">d</a>');
    expect(links[0].resolvable).toBe(true);
  });
});
