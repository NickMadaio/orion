export type MusicTurn = {
    kind: "music";
    action: "play" | "pause" | "skip" | "previous";
    query?: string;
    player?: "spotify" | "music";
};
export declare function readMusicTurn(m: string): MusicTurn | null;
