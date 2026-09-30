import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTaskGraph } from "./controller.js";
import { canonicalActionHash } from "./validator.js";
import { approvalPaths, chatGrantCovers, grantForChat, mintTicket, CHAT_GRANT_TTL_MS } from "./approvals.js";
import type { TaskGraph } from "./types.js";

// The terminal runs inside macOS sandbox-exec under zsh; a Linux CI runner has neither.
const onMac = process.platform === "darwin";

// Phase 52: raw terminal, confirmed in the app -- once, or for this chat.
const terminal = (command: string, cwd: string): TaskGraph => ({
  version: "1", goal: "run a command", workingContext: cwd,
  inputs: [{ id: "u", kind: "instruction", trust: "trusted_user", content: `run ${command}` }],
  assumptions: [], retryBudget: 0,
  steps: [{ id: "t", action: "terminal_run", arguments: { command, cwd }, dependsOn: [], risk: "critical",
    expectedEffect: "command ran", verify: "command_exited", sourceRefs: ["u"], reversible: false }],
});

async function run(command: string, onStart?: (ledger: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orion-terminal-"));
  const graph = terminal(command, directory);
  const hash = canonicalActionHash(graph.steps[0]!, graph.workingContext);
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const started = Date.now();
  const pending = runTaskGraph(graph, { ledgerPath, enabledTiers: new Set(["simulation", "raw_terminal"]), approvalGrants: (h) => h === hash });
  if (onStart) await onStart(ledgerPath);
  return { result: await pending, seconds: (Date.now() - started) / 1000, directory };
}

describe("terminal_run", () => {
  it("never runs without a person's approval", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "orion-terminal-"));
    const result = await runTaskGraph(terminal("touch ran", directory), {
      ledgerPath: path.join(directory, "ledger.jsonl"), enabledTiers: new Set(["simulation", "raw_terminal"]) });
    expect(result.status).toBe("needs_approval");
    expect(await readdir(directory)).not.toContain("ran");
  });

  it.skipIf(!onMac)("runs an approved command in its folder and reports the output and exit code", async () => {
    const { result, directory } = await run("echo hello from orion; pwd; exit 3");
    expect(result.status).toBe("succeeded");
    const output = result.steps[0]?.execution.output as { exitCode: number; output: string };
    expect(output.exitCode).toBe(3);
    expect(output.output).toContain("hello from orion");
    expect(output.output).toContain(await import("node:fs/promises").then((fs) => fs.realpath(directory)));
  });

  it.skipIf(!onMac)("is killed when Nick presses Stop, not left to run out", async () => {
    const { result, seconds } = await run("sleep 30", async (ledgerPath) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const actions = path.join(path.dirname(ledgerPath), "actions");
      const [running] = await readdir(path.join(actions, "running"));
      await mkdir(path.join(actions, "cancel"), { recursive: true });
      await writeFile(path.join(actions, "cancel", running!.replace(/\.json$/, "")), "");
    });
    expect(seconds).toBeLessThan(5);
    const output = result.steps[0]?.execution.output as { stopped?: string; exitCode: number | null };
    expect(output.stopped).toBe("stopped by Nick");
    expect(output.exitCode).toBeNull();
    expect(result.status).toBe("failed");
  });
});

describe("allow for this chat", () => {
  async function gate() {
    return approvalPaths(await mkdtemp(path.join(os.tmpdir(), "orion-chat-grant-")));
  }

  it("covers terminal_run in the chat that asked, and nothing else", async () => {
    const paths = await gate();
    const ticket = await mintTicket(paths, { canonicalHash: "a".repeat(64), action: "terminal_run", summary: "run ls", context: "list", sessionKey: "chat-1" });
    expect((await grantForChat(paths, ticket.id, "nick@app")).ok).toBe(true);
    expect(chatGrantCovers(paths, "chat-1", "terminal_run")).toBe(true);
    expect(chatGrantCovers(paths, "chat-2", "terminal_run")).toBe(false);
    expect(chatGrantCovers(paths, "chat-1", "messages_send")).toBe(false);
    expect(chatGrantCovers(paths, "chat-1", "terminal_run", new Date(Date.now() + CHAT_GRANT_TTL_MS + 1000))).toBe(false);
  });

  it("cannot be given for a message, by the local process, or to a request with no chat", async () => {
    const paths = await gate();
    const message = await mintTicket(paths, { canonicalHash: "b".repeat(64), action: "messages_send", summary: "text Mum", context: "x", sessionKey: "chat-1" });
    expect((await grantForChat(paths, message.id, "nick@app")).ok).toBe(false);
    const noChat = await mintTicket(paths, { canonicalHash: "c".repeat(64), action: "terminal_run", summary: "ls", context: "x" });
    expect((await grantForChat(paths, noChat.id, "nick@app")).ok).toBe(false);
    const fromOrion = await mintTicket(paths, { canonicalHash: "d".repeat(64), action: "terminal_run", summary: "ls", context: "x", sessionKey: "chat-9" });
    expect((await grantForChat(paths, fromOrion.id, "local")).ok).toBe(false);
    expect(chatGrantCovers(paths, "chat-9", "terminal_run")).toBe(false);
  });
});
