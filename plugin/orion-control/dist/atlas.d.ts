export type AtlasOperation = "health" | "collections.list" | "notes.search" | "notes.read" | "notes.create" | "notes.update";
export interface AtlasArguments {
    collectionID?: string;
    noteID?: string;
    query?: string;
    title?: string;
    summary?: string;
    category?: string;
    markdown?: string;
    expectedUpdatedAt?: string;
    limit?: number;
}
export interface AtlasCollection {
    id: string;
    title: string;
    summary: string;
    icon: string;
    accent: string;
    sortOrder: number;
}
export interface AtlasNote {
    id: string;
    collectionID: string;
    title: string;
    summary: string;
    category: string;
    updatedAt: string;
    accent: string;
    bodyMarkdown: string;
    isFavorite: boolean;
}
export interface AtlasPayload {
    message?: string;
    collections?: AtlasCollection[];
    notes?: AtlasNote[];
    note?: AtlasNote;
    noteID?: string;
}
export declare class AtlasBridgeError extends Error {
    readonly retryable: boolean;
    constructor(message: string, retryable?: boolean);
}
export declare function requestAtlas(operation: AtlasOperation, arguments_: AtlasArguments, idempotencyKey: string): Promise<AtlasPayload>;
export declare function atlasBridgeCandidatesForTests(): readonly string[];
