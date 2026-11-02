import { type Reply } from "./pending-reply-read.js";
export type StoryReply = Extract<Reply, {
    kind: "changed" | "accept" | "unclear" | "counter";
}>;
/** What his answer to "is X still happening, or did plans change?" says; undefined when it is not an answer to it. */
export declare function readPlanCheckStory(message: string): StoryReply | undefined;
export type PersonMention = {
    name: string;
    fact: string;
    echo: string;
};
/** A durable fact about a person he names (who they are to him, a trip they shared); undefined when there is none. */
export declare function readPersonMention(message: string): PersonMention | undefined;
