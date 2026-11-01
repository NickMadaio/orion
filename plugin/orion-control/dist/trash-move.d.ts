export type TrashMove = {
    kind: "trash";
    name: string;
    folder: boolean;
    root?: "desktop" | "documents" | "downloads";
    within?: string;
};
/** The named item, its kind, and where he said it is; undefined when no item is named. */
export declare function readTrash(message: string): TrashMove | undefined;
