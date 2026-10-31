export type AskKind = "sleep" | "people" | "secrets" | "connectors" | "draft";
export type HealthDay = {
    sleepHours?: number | null;
    recovery?: number | null;
    sleepPerformance?: number | null;
};
export type HealthLog = {
    days?: Record<string, HealthDay>;
};
export type ConnectorRow = {
    name: string;
    title: string;
    needsKey: boolean;
    keySet: boolean;
};
export type Graph = {
    nodes?: Array<{
        id?: string;
        type?: string;
        label?: string;
        facts?: Array<{
            text?: string;
        }>;
    }>;
};
/** Which of these questions a message is, or null. A statement about sleep ("slept badly, fix my day") is the lighten flow's. */
export declare function askKind(message: string): AskKind | null;
export declare const askedName: (message: string) => string | undefined;
/** Last night's sleep and recovery from the health log, what they mean for today, and the recent average. */
export declare function sleepReply(log: HealthLog | undefined, now: Date): string | undefined;
/** A person from the knowledge graph and his notes. Nothing found is said plainly, with no offer to search. */
export declare function peopleReply(name: string, brainOutput: string, graph?: Graph): string;
/** Connector names and whether a key is set. Only name, title and two booleans are ever read from a row. */
export declare function connectorReply(rows: readonly ConnectorRow[] | undefined): string;
export declare function secretsReply(rows: readonly ConnectorRow[] | undefined): string;
/** The text of a draft, shown and never sent. */
export declare function draftReply(message: string): string | undefined;
export declare const readHealthFile: (dir: string) => HealthLog | undefined;
export declare const readGraphFile: (dir: string) => Graph | undefined;
/** `orion-connect status`: name, title, needs a key, key set. Keeps only those four fields; undefined when the script fails.
    REV3 11: the script is found by the plugin's scripts-dir resolver, never a hardcoded home path. */
export declare const liveConnectorStatus: (bin?: string) => Promise<ConnectorRow[] | undefined>;
export type OwnDeps = {
    now: Date;
    readHealth?: () => Promise<HealthLog | undefined>;
    brainSearch?: (query: string) => Promise<string>;
    readGraph?: () => Graph | undefined;
    connectorStatus?: () => Promise<ConnectorRow[] | undefined>;
};
/** The reply for one of these questions, or undefined when the data source is not wired (the turn then goes the old way). */
export declare function ownAnswer(kind: AskKind, message: string, deps: OwnDeps): Promise<string | undefined>;
