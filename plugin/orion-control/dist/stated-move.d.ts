export type StatedMove = {
    kind: "stated";
    name: string;
    at: string;
    day: "today" | "tomorrow";
    reason?: string;
};
export declare function readStatedMove(message: string): StatedMove | null;
