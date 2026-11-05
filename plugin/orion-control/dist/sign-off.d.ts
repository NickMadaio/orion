/** A message that is only a goodbye. `pending`: ORION has a question open, so a bare thanks / cheers may be the answer to it and is not a sign-off. */
export declare function isSignOff(message: string, opts?: {
    pending?: boolean;
}): boolean;
