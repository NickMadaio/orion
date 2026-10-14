/** One context size for every call and the warm-up: a different num_ctx makes Ollama reload the model. */
export declare const FRONT_DESK_CTX = 16384;
export declare const MOVES: readonly ["answer", "tool", "escalate", "ask", "ignore"];
export type Move = (typeof MOVES)[number];
export declare const MENU_TOOLS: readonly ["weather", "lights", "alarm", "wake", "session", "phone_time", "agenda", "tasks", "reschedule", "show", "app_open", "browser", "media", "log_intake", "supplements", "brain", "repair_note"];
export type Decision = {
    move: Move;
    tool?: string;
    args?: Record<string, unknown>;
    tier?: "quick" | "standard" | "deep";
    say?: string;
    answer?: string;
    fallback?: string;
    ms?: number;
};
type Turn = {
    role: "user" | "assistant";
    content: string;
};
export type FrontDeskInput = {
    message: string;
    clock: string;
    history?: Turn[];
};
/** The Ollama /api/chat body, identical in shape to the evaluation's front-desk call. */
export declare function frontDeskRequest({ message, clock, history }: FrontDeskInput, model?: string): {
    model: string;
    stream: boolean;
    think: boolean;
    format: {
        type: string;
        properties: {
            move: {
                type: string;
                enum: ("ignore" | "answer" | "tool" | "escalate" | "ask")[];
            };
            tool: {
                type: string;
            };
            args: {
                type: string;
            };
            tier: {
                type: string;
                enum: string[];
            };
            think: {
                type: string;
                enum: string[];
            };
            say: {
                type: string;
            };
            answer: {
                type: string;
            };
        };
        required: string[];
    };
    options: {
        temperature: number;
        num_ctx: number;
    };
    keep_alive: string;
    messages: {
        role: string;
        content: string;
    }[];
};
/** Ask the front desk for a move. Never throws; anything unexpected escalates to the worker. */
export declare function decide(input: FrontDeskInput, { fetchImpl, baseUrl, timeoutMs, model }?: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
    model?: string;
}): Promise<Decision>;
/**
 * Keep the local models in memory at the context size each is called with (2026-10-14). Only
 * what is missing — or loaded at another num_ctx, which Ollama would reload on the next call —
 * is loaded. Returns the models it loaded. Never throws.
 */
export declare function keepWarm(models: Array<{
    model: string;
    numCtx: number;
}>, { fetchImpl, baseUrl }?: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
}): Promise<string[]>;
export {};
