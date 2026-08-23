/**
 * Text handling for EA model content: entity decoding, case folding, markup type, link extraction.
 */
// Named HTML entities commonly used in EA notes
const NAMED_ENTITIES = {
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
    auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
    Auml: "Ä", Ouml: "Ö", Uuml: "Ü",
    ccaron: "č", Ccaron: "Č", dcaron: "ď", Dcaron: "Ď",
    lcaron: "ľ", Lcaron: "Ľ", ncaron: "ň", Ncaron: "Ň",
    rcaron: "ř", Rcaron: "Ř", scaron: "š", Scaron: "Š",
    tcaron: "ť", Tcaron: "Ť", zcaron: "ž", Zcaron: "Ž",
    yacute: "ý", Yacute: "Ý",
    nbsp: "\u00A0", quot: '"', apos: "'",
};
/**
 * Decode HTML numeric and named character entities, preserving structural escapes.
 * &#NNN; and &#xHH; → character. Named entities (e.g. &aacute;) → character.
 * &lt; &gt; &amp; are preserved — they are structural escapes, not encoded text.
 */
export function decodeEntities(html) {
    if (html == null)
        return null;
    return html.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
        // Preserve structural escapes
        if (entity === "lt" || entity === "gt" || entity === "amp")
            return match;
        // Numeric: &#NNN; or &#xHH; (case-insensitive x)
        if (entity.startsWith("#")) {
            const isHex = entity[1] === "x" || entity[1] === "X";
            const code = isHex
                ? parseInt(entity.slice(2), 16)
                : parseInt(entity.slice(1), 10);
            if (isNaN(code) || code < 0 || code > 0x10FFFF)
                return match;
            return String.fromCodePoint(code);
        }
        // Named entity
        return NAMED_ENTITIES[entity] ?? match;
    });
}
/**
 * Fold text for case- and diacritic-insensitive matching.
 * NFD decomposition → strip combining marks → lowercase.
 */
export function foldText(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
/** The content type declared for all EA model text fields. */
export const EA_TEXT_CONTENT_TYPE = "text/html; ea-dialect";
const MODEL_INTERNAL_SCHEMES = new Set(["$element", "$diagram", "$feature", "$package"]);
/**
 * Extract <a href="..."> targets from EA HTML text.
 * Model-internal schemes ($element://, $diagram://, $feature://, $package://) are resolvable.
 * Everything else is external.
 */
export function extractLinks(html) {
    if (html == null)
        return [];
    const links = [];
    const re = /href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const href = m[1];
        const schemeMatch = href.match(/^(\$?[a-zA-Z][a-zA-Z0-9+.-]*):/);
        const scheme = schemeMatch ? schemeMatch[1] : null;
        links.push({
            href,
            scheme,
            resolvable: scheme != null && MODEL_INTERNAL_SCHEMES.has(scheme),
        });
    }
    return links;
}
