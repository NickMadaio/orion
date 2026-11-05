import { type MouseTurn } from "./mouse-read.js";
export declare function splitLeadMouse(message: string): {
    turn: MouseTurn;
    rest: string;
} | null;
