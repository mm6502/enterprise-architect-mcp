/**
 * Text handling for EA model content: entity decoding, case folding, markup type, link extraction.
 */
/**
 * Decode HTML numeric and named character entities, preserving structural escapes.
 * &#NNN; and &#xHH; → character. Named entities (e.g. &aacute;) → character.
 * &lt; &gt; &amp; are preserved — they are structural escapes, not encoded text.
 */
export declare function decodeEntities(html: string | null): string | null;
/**
 * Fold text for case- and diacritic-insensitive matching.
 * Lowercase → NFD decomposition → strip combining marks → map non-decomposing letters.
 *
 * Lowercasing first is what lets `İ` reduce to `i`: its lowercase form carries a
 * combining dot that the mark strip then removes.
 */
export declare function foldText(s: string): string;
/**
 * Locale used to order names for display. `EA_LOCALE` overrides; otherwise the
 * host default applies, since the model's language is not knowable from the export.
 */
export declare const orderingLocale: string | undefined;
/** Order two model names, tolerating nulls. Accented initials sort in place, not after `Z`. */
export declare function compareNames(a: string | null | undefined, b: string | null | undefined): number;
/** The content type declared for all EA model text fields. */
export declare const EA_TEXT_CONTENT_TYPE = "text/html; ea-dialect";
export interface ExtractedLink {
    href: string;
    scheme: string | null;
    resolvable: boolean;
}
/**
 * Extract <a href="..."> targets from EA HTML text.
 * Model-internal schemes ($element://, $diagram://, $feature://, $package://) are resolvable.
 * Everything else is external.
 */
export declare function extractLinks(html: string | null): ExtractedLink[];
