export declare const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export declare function sandboxProfile(paths?: string[]): string;
export declare function terminalEnvironment(source?: NodeJS.ProcessEnv): Record<string, string>;
export declare function redactOutput(text: string): string;
