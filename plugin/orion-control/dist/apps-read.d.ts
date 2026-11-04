import { type MusicTurn } from "./music-read.js";
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
    kind: "gameReady";
    game?: string;
} | {
    kind: "gameKeep";
    op: "add" | "remove";
    names: string[];
} | {
    kind: "keepList";
} | MusicTurn | {
    kind: "gameLast";
};
export declare function readAppsTurn(message: string): AppsTurn | null;
