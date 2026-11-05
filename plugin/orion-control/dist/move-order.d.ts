export type Mover = {
    current: readonly [number, number];
    next: readonly [number, number];
};
/** Where two destinations land on each other: the pair and the minutes they share, or undefined. */
export declare function collision(movers: readonly Mover[]): {
    a: number;
    b: number;
    minutes: number;
    from: number;
    to: number;
} | undefined;
/** The order to write them in: a move goes after the blocks that sit where it is going have gone. Said order breaks every tie. */
export declare function writeOrder(movers: readonly Mover[]): number[];
