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
 * NFD decomposition → strip combining marks → lowercase.
 */
export declare function foldText(s: string): string;
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
