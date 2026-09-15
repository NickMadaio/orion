import { chmod, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import type { TaskRunRecord } from "./types.js";

export class TaskLedger {
  constructor(private readonly filePath: string) {}

  async append(record: TaskRunRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const handle = await open(this.filePath, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(this.filePath, 0o600);
  }

  /**
   * Append without letting an audit failure destroy the caller's result. The
   * outcome is returned so a failed audit write is surfaced to the caller
   * instead of being swallowed or replacing the run result with an exception.
   */
  async appendReporting(
    record: TaskRunRecord,
  ): Promise<{ appended: boolean; error?: string }> {
    try {
      await this.append(record);
      return { appended: true };
    } catch (error) {
      return {
        appended: false,
        error:
          error instanceof Error
            ? `Ledger append failed: ${error.message}`
            : "Ledger append failed.",
      };
    }
  }

  async find(taskId: string): Promise<TaskRunRecord | undefined> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const lines = content.split("\n");
    // Scan newest-first and skip unparseable lines: one torn or truncated
    // append must not make every later status lookup throw.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      let parsed: TaskRunRecord | undefined;
      try {
        parsed = JSON.parse(line) as TaskRunRecord;
      } catch {
        continue;
      }
      if (parsed?.taskId === taskId) return parsed;
    }
    return undefined;
  }
}
