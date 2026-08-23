/**
 * Text handling for EA model content: entity decoding, case folding, markup type, link extraction.
 */
/**
 * Named HTML character entities appearing in EA notes.
 *
 * Covers Latin-1 Supplement and Latin Extended-A in full — every accented letter
 * used by a European Latin-script language — rather than one language's subset,
 * so an export in any of them decodes the same way. Numeric entities dominate in
 * practice; named ones arrive with text pasted from Word and other HTML sources.
 */
const NAMED_ENTITIES = {
    // Latin-1 Supplement, uppercase
    Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ",
    Ccedil: "Ç", Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
    Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
    ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
    Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", THORN: "Þ",
    // Latin-1 Supplement, lowercase
    szlig: "ß",
    agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
    ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
    igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
    eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
    ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", thorn: "þ", yuml: "ÿ",
    // Latin Extended-A
    Amacr: "Ā", amacr: "ā", Abreve: "Ă", abreve: "ă", Aogon: "Ą", aogon: "ą",
    Cacute: "Ć", cacute: "ć", Ccirc: "Ĉ", ccirc: "ĉ", Cdot: "Ċ", cdot: "ċ", Ccaron: "Č", ccaron: "č",
    Dcaron: "Ď", dcaron: "ď", Dstrok: "Đ", dstrok: "đ",
    Emacr: "Ē", emacr: "ē", Ebreve: "Ĕ", ebreve: "ĕ", Edot: "Ė", edot: "ė",
    Eogon: "Ę", eogon: "ę", Ecaron: "Ě", ecaron: "ě",
    Gcirc: "Ĝ", gcirc: "ĝ", Gbreve: "Ğ", gbreve: "ğ", Gdot: "Ġ", gdot: "ġ", Gcedil: "Ģ", gcedil: "ģ",
    Hcirc: "Ĥ", hcirc: "ĥ", Hstrok: "Ħ", hstrok: "ħ",
    Itilde: "Ĩ", itilde: "ĩ", Imacr: "Ī", imacr: "ī", Ibreve: "Ĭ", ibreve: "ĭ",
    Iogon: "Į", iogon: "į", Idot: "İ", imath: "ı", IJlig: "Ĳ", ijlig: "ĳ",
    Jcirc: "Ĵ", jcirc: "ĵ",
    Kcedil: "Ķ", kcedil: "ķ", kgreen: "ĸ",
    Lacute: "Ĺ", lacute: "ĺ", Lcedil: "Ļ", lcedil: "ļ", Lcaron: "Ľ", lcaron: "ľ",
    Lmidot: "Ŀ", lmidot: "ŀ", Lstrok: "Ł", lstrok: "ł",
    Nacute: "Ń", nacute: "ń", Ncedil: "Ņ", ncedil: "ņ", Ncaron: "Ň", ncaron: "ň",
    napos: "ŉ", ENG: "Ŋ", eng: "ŋ",
    Omacr: "Ō", omacr: "ō", Obreve: "Ŏ", obreve: "ŏ", Odblac: "Ő", odblac: "ő",
    OElig: "Œ", oelig: "œ",
    Racute: "Ŕ", racute: "ŕ", Rcedil: "Ŗ", rcedil: "ŗ", Rcaron: "Ř", rcaron: "ř",
    Sacute: "Ś", sacute: "ś", Scirc: "Ŝ", scirc: "ŝ", Scedil: "Ş", scedil: "ş",
    Scaron: "Š", scaron: "š",
    Tcedil: "Ţ", tcedil: "ţ", Tcaron: "Ť", tcaron: "ť", Tstrok: "Ŧ", tstrok: "ŧ",
    Utilde: "Ũ", utilde: "ũ", Umacr: "Ū", umacr: "ū", Ubreve: "Ŭ", ubreve: "ŭ",
    Uring: "Ů", uring: "ů", Udblac: "Ű", udblac: "ű", Uogon: "Ų", uogon: "ų",
    Wcirc: "Ŵ", wcirc: "ŵ", Ycirc: "Ŷ", ycirc: "ŷ", Yuml: "Ÿ",
    Zacute: "Ź", zacute: "ź", Zdot: "Ż", zdot: "ż", Zcaron: "Ž", zcaron: "ž",
    // Punctuation and symbols common in analyst prose
    nbsp: "\u00A0", quot: '"', apos: "'", shy: "\u00AD",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚",
    ldquo: "“", rdquo: "”", bdquo: "„", lsaquo: "‹", rsaquo: "›",
    laquo: "«", raquo: "»", hellip: "…", bull: "•",
    dagger: "†", Dagger: "‡", permil: "‰",
    euro: "€", cent: "¢", pound: "£", yen: "¥", curren: "¤",
    copy: "©", reg: "®", trade: "™", sect: "§", para: "¶", middot: "·",
    deg: "°", plusmn: "±", times: "×", divide: "÷", micro: "µ", not: "¬",
    iexcl: "¡", iquest: "¿", brvbar: "¦", uml: "¨", macr: "¯", acute: "´", cedil: "¸",
    ordf: "ª", ordm: "º", sup1: "¹", sup2: "²", sup3: "³",
    frac14: "¼", frac12: "½", frac34: "¾",
};
/**
 * Decode HTML numeric and named character entities, preserving structural escapes.
 * &#NNN; and &#xHH; → character. Named entities (e.g. &aacute;) → character.
 * &lt; &gt; &amp; are preserved — they are structural escapes, not encoded text.
 */
export function decodeEntities(html) {
    if (html == null)
        return null;
    // Named entities may carry digits (frac12, sup2), so the name branch is alphanumeric.
    return html.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
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
 * Latin letters that carry no canonical decomposition, so NFD leaves them intact.
 * The stroke, ligature and sharp-s forms are the ones a mark-stripping fold misses:
 * "Łódź" folds to "lodz" only if `ł` is mapped explicitly.
 */
const NON_DECOMPOSING_FOLDS = {
    "ß": "ss", "æ": "ae", "œ": "oe", "ĳ": "ij",
    "ø": "o", "ł": "l", "ŀ": "l", "đ": "d", "ð": "d", "þ": "th",
    "ħ": "h", "ŧ": "t", "ŋ": "n", "ı": "i", "ĸ": "k", "ŉ": "n",
};
const NON_DECOMPOSING_RE = new RegExp(`[${Object.keys(NON_DECOMPOSING_FOLDS).join("")}]`, "g");
/**
 * Fold text for case- and diacritic-insensitive matching.
 * Lowercase → NFD decomposition → strip combining marks → map non-decomposing letters.
 *
 * Lowercasing first is what lets `İ` reduce to `i`: its lowercase form carries a
 * combining dot that the mark strip then removes.
 */
export function foldText(s) {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(NON_DECOMPOSING_RE, (c) => NON_DECOMPOSING_FOLDS[c]);
}
/**
 * Locale used to order names for display. `EA_LOCALE` overrides; otherwise the
 * host default applies, since the model's language is not knowable from the export.
 */
export const orderingLocale = process.env.EA_LOCALE || undefined;
const nameCollator = new Intl.Collator(orderingLocale);
/** Order two model names, tolerating nulls. Accented initials sort in place, not after `Z`. */
export function compareNames(a, b) {
    return nameCollator.compare(a || "", b || "");
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
