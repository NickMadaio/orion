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
};
export declare function readAppsTurn(message: string): AppsTurn | null;
