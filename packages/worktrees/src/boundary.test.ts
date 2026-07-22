import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

describe("worktree package boundary", () => {
  it("uses no shell, command runner, force, recursive deletion, or later-ticket surface", async () => {
    const sources = await Promise.all(
      ["repository-bindings.ts", "worktree-manager.ts"].map((file) =>
        readFile(join(sourceRoot, file), "utf8"),
      ),
    );
    const source = sources.join("\n");
    expect(source).not.toMatch(
      /child_process|spawn\(|exec(?:File|Sync)?\(|shell\s*:|danger-full-access/i,
    );
    expect(source).not.toMatch(/\brm\(|force\s*:/i);
    expect(source).not.toMatch(
      /\.reset\(|\.clean\(|\.commit\(|\.merge\(|\.push\(|applyPatch|intent|ledger|queue|codex/i,
    );
  });

  it("derives paths and refs only from validated ownership UUIDs", async () => {
    const source = await readFile(
      join(sourceRoot, "worktree-manager.ts"),
      "utf8",
    );
    expect(source).toContain("UUID_PATTERN");
    expect(source).toContain(
      "repositoryId,\n      runId,\n      ticketId,\n      assignmentId",
    );
    expect(source).toContain(
      "blackbox/worktree/${runId}/${ticketId}/${assignmentId}",
    );
    expect(source).not.toMatch(/external_key|title|agent_id/i);
  });
});
