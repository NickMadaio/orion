type Options = {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
};
export declare function pickRequest(want: string, lines: readonly string[], model?: string): {
    model: string;
    stream: boolean;
    think: boolean;
    keep_alive: string;
    format: {
        type: string;
        properties: {
            choice: {
                type: string;
            };
        };
        required: string[];
    };
    options: {
        temperature: number;
    };
    messages: {
        role: string;
        content: string;
    }[];
};
export declare function parsePick(content: string, count: number): number | null;
export declare function createComputerWorker(options?: Options): {
    pick: (want: string, lines: string[]) => Promise<number | null>;
    summarize: (prompt: string) => Promise<string>;
};
export {};
