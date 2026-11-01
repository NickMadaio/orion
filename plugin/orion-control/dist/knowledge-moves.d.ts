import { type TrashMove } from "./trash-move.js";
export type Candidate = {
    id: string;
    text: string;
};
export type KnowledgeHeld = {
    kind: "forget-pick";
    candidates: Candidate[];
    topic: string;
} | {
    kind: "forget-undo";
    ids: string[];
    texts: string[];
} | {
    kind: "trash-confirm";
    path: string;
    name: string;
    shown: string;
    folder?: boolean;
} | {
    kind: "profile-more";
};
export type KnowledgeMove = {
    kind: "forget";
    targets: string[];
    all: boolean;
} | {
    kind: "forget-pick";
    held: Extract<KnowledgeHeld, {
        kind: "forget-pick";
    }>;
    picked: Candidate[];
} | {
    kind: "forget-undo";
    held: Extract<KnowledgeHeld, {
        kind: "forget-undo";
    }>;
    yes: boolean;
} | {
    kind: "trash-confirm";
    held: Extract<KnowledgeHeld, {
        kind: "trash-confirm";
    }>;
    yes: boolean;
} | {
    kind: "links";
    subject: string;
} | {
    kind: "profile";
    brief?: true;
} | TrashMove;
/** What this chat's last knowledge reply is waiting on. It lives exactly one turn: taking it clears it. */
export declare class KnowledgePending {
    private readonly held;
    set(key: string, value: KnowledgeHeld, nowMs: number): void;
    take(key: string, nowMs: number): KnowledgeHeld | undefined;
}
/** What this message asks of his knowledge, if anything. Room speech only ever reads (links, profile), never forgets or trashes. */
export declare function readKnowledgeMove(message: string, opts?: {
    held?: KnowledgeHeld;
    spoken?: boolean;
}): KnowledgeMove | undefined;
