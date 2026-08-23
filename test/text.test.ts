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

  it("decodes German sharp s", () => {
    expect(decodeEntities("Stra&szlig;e")).toBe("Straße");
  });

  it("decodes Polish stroked l and acute forms", () => {
    expect(decodeEntities("&Lstrok;&oacute;d&zacute;")).toBe("Łódź");
  });

  it("decodes Polish ogonek", () => {
    expect(decodeEntities("Gda&nacute;sk &eogon;")).toBe("Gdańsk ę");
  });

  it("decodes Nordic slashed o and ring", () => {
    expect(decodeEntities("N&oslash;rrebro &Aring;")).toBe("Nørrebro Å");
  });

  it("decodes Hungarian double acute", () => {
    expect(decodeEntities("Gy&odblac;r &Udblac;")).toBe("Győr Ű");
  });

  it("decodes Spanish tilde and French cedilla", () => {
    expect(decodeEntities("Espa&ntilde;ol Fran&ccedil;ais")).toBe("Español Français");
  });

  it("decodes ligatures", () => {
    expect(decodeEntities("&AElig;ther c&oelig;ur")).toBe("Æther cœur");
  });

  it("decodes punctuation used in analyst prose", () => {
    expect(decodeEntities("a &ndash; b &hellip; &bdquo;c&ldquo;")).toBe("a – b … „c“");
  });

  it("decodes named entities containing digits", () => {
    expect(decodeEntities("&frac12; &sup2; &frac34;")).toBe("½ ² ¾");
  });

  it("leaves an unknown named entity unchanged", () => {
    expect(decodeEntities("&nosuchentity;")).toBe("&nosuchentity;");
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
  it("folds uppercase diacritics", () => {
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

  it("decodes then folds an entity-encoded Polish name", () => {
    expect(foldText(decodeEntities("&Lstrok;&oacute;d&zacute;")!)).toBe("lodz");
  });

  // Letters below carry no canonical decomposition, so a mark-stripping fold alone misses them.
  it("folds Polish ł and combining accents together", () => {
    expect(foldText("Łódź")).toBe("lodz");
  });

  it("folds Polish ogonek and acute forms", () => {
    expect(foldText("Gdańsk Zażółć Ę")).toBe("gdansk zazolc e");
  });

  it("expands German ß to ss", () => {
    expect(foldText("Straße")).toBe("strasse");
  });

  it("expands capital ẞ to ss", () => {
    expect(foldText("STRAẞE")).toBe("strasse");
  });

  it("folds Danish ø and Nordic å", () => {
    expect(foldText("Nørrebro Ångström")).toBe("norrebro angstrom");
  });

  it("expands æ and œ ligatures", () => {
    expect(foldText("Æther cœur")).toBe("aether coeur");
  });

  it("folds Croatian đ", () => {
    expect(foldText("Đakovo")).toBe("dakovo");
  });

  it("folds Icelandic þ and ð", () => {
    expect(foldText("Þórð")).toBe("thord");
  });

  it("folds Hungarian double acute", () => {
    expect(foldText("Győr Ő")).toBe("gyor o");
  });

  it("folds French cedilla and grave", () => {
    expect(foldText("Français où")).toBe("francais ou");
  });

  it("folds Spanish ñ", () => {
    expect(foldText("Español")).toBe("espanol");
  });

  it("folds Turkish dotted capital İ", () => {
    expect(foldText("İstanbul")).toBe("istanbul");
  });

  it("folds Romanian comma-below forms", () => {
    expect(foldText("București")).toBe("bucuresti");
  });

  it("leaves unaccented ASCII untouched", () => {
    expect(foldText("Contract 42")).toBe("contract 42");
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
