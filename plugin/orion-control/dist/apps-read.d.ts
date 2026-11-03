export type AppsTurn = {
    kind: "list";
} | {
    kind: "unused";
    also: string[];
} | {
    kind: "except";
    keep: string[];
} | {
    kind: "quit";
    names: string[];
} | {
    kind: "hide";
    name: string;
} | {
    kind: "gameMode";
    on: boolean;
} | {
    kind: "gameKeep";
    op: "add" | "remove";
    names: string[];
} | {
    kind: "gameLast";
};
export declare function readAppsTurn(message: string): AppsTurn | null;
