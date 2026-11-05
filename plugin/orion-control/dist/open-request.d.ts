export type OpenRequest = {
    kind: "app";
    name: string;
} | {
    kind: "url";
    url: string;
    browser?: string;
}
/** A page he calls by his own name ("my CS group"): ORION does not know its address, so it is looked up or asked, never searched. */
 | {
    kind: "personal";
    name: string;
    browser?: string;
} | {
    kind: "folder";
    folder: string;
};
/** "my CS group" / "our uni portal": a page named by his own words. Null for a known site, or (without a browser named) anything that is not page-like. */
export declare function personalPage(target: string, browserNamed: boolean): string | null;
/** What he asked to open, or null when it is anything else. */
export declare function openRequest(message: string): OpenRequest | null;
