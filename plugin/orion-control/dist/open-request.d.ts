export type OpenRequest = {
    kind: "app";
    name: string;
} | {
    kind: "url";
    url: string;
    browser?: string;
} | {
    kind: "folder";
    folder: string;
};
/** What he asked to open, or null when it is anything else. */
export declare function openRequest(message: string): OpenRequest | null;
