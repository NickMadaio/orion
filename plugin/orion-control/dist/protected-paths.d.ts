export declare function protectedPaths(home?: string): string[];
/** The protected path `target` is inside, or would carry away if moved; else null. */
export declare function protectedConflict(target: string, paths?: string[]): string | null;
