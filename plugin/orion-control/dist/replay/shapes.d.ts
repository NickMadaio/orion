export type Shape = {
    id: string;
    test: RegExp;
    why: string;
};
export declare const BANNED_SHAPES: readonly Shape[];
export declare const shapesIn: (reply: string, extra?: readonly string[]) => string[];
