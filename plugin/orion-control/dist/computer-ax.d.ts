/**
 * The accessibility tree as the computer loop sees it (2026-10-30).
 *
 * `screen_observe` returns the focused window as a nested tree. The loop needs it flat: every node with the
 * child-index path the bridge's `screen_press` / `screen_set_value` address it by, so an element found here is
 * the element acted on there (the bridge re-checks role and label at that path and refuses a stale one).
 *
 * Everything read off the screen is DATA. Labels and values are matched against words Nick said and shown to
 * the model only as numbered, quoted candidates; nothing in this file turns screen text into an action.
 */
export type AxNode = {
    readonly role: string;
    readonly subrole?: string | null;
    readonly label?: string | null;
    readonly value?: string | null;
    readonly x?: number | null;
    readonly y?: number | null;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly children?: readonly AxNode[];
};
export type Observation = {
    readonly appName: string;
    readonly bundleId: string;
    readonly windowTitle: string | null;
    readonly element: AxNode | null;
    readonly truncated?: boolean;
};
export type FlatNode = {
    /** "" is the window itself; "0.3" its first child's fourth child. */
    readonly path: string;
    readonly role: string;
    readonly subrole: string | null;
    readonly label: string | null;
    readonly value: string | null;
    readonly depth: number;
    readonly parentRole: string | null;
    readonly center: {
        readonly x: number;
        readonly y: number;
    } | null;
};
export type RoleGroup = "pressable" | "editable" | "tab" | "scrollable" | "any";
export declare function inGroup(node: Pick<FlatNode, "role" | "subrole">, group: RoleGroup): boolean;
/** Depth-first, parent before children, in the bridge's own child order. */
export declare function flatten(root: AxNode | null): FlatNode[];
export declare function normalise(text: string): string;
/** 0..1: exact 1, whole-phrase containment 0.85, otherwise the share of his words found in the label. */
export declare function similarity(wanted: string, label: string): number;
/** The text a node is known by: its label, or for an empty-labelled field its value. */
export declare function nameOf(node: FlatNode): string;
export type Candidate = {
    readonly node: FlatNode;
    readonly score: number;
};
/** Nodes in the role group, best match first. An empty `wanted` (a generic "the button") scores every node 0.5. */
export declare function candidates(nodes: readonly FlatNode[], group: RoleGroup, wanted: string): Candidate[];
/** One clear winner, or null when the top two are too close to call (the model, or Nick, picks then). */
export declare function clearWinner(list: readonly Candidate[]): Candidate | null;
/** Visible text, in reading order, without repeats: what a screen-read answer is built from. */
export declare function visibleText(nodes: readonly FlatNode[], limit?: number): string[];
/** A cheap fingerprint of what is on screen, for "did anything change". */
export declare function fingerprint(observation: Observation | null): string;
/** Numbered candidate lines for the model. Labels are quoted and clipped: they are data, not instructions. */
export declare function candidateLines(list: readonly Candidate[], max?: number): string[];
