/** A name he could mean: a block on his day, or a deadline (title only). */
export type KnownName = {
    title: string;
    start?: string;
    end?: string;
    kind?: string;
    fixed?: boolean;
};
/** The task his words name as started now, before asking whether it is work. Pure; undefined when the shape is not there. */
export declare function casualStartTask(message: string): string | undefined;
/** The task when his words say he is starting work on it now ("econ", "the essay"), else undefined. Work means a work noun in it, or a
 *  name that resolves (blocksNamedBy) to a block on his day or a deadline in `known`. Pure. */
export declare function workStartTask(message: string, known?: readonly KnownName[]): string | undefined;
