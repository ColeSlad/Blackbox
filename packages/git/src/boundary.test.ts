import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Git package boundary", () => {
  it("has no npm runtime or development dependencies", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });

  it("uses argument-array spawning without shell execution", async () => {
    const source = await readFile(
      join(packageRoot, "src", "native-git-repository.ts"),
      "utf8",
    );
    expect(source).toContain('import { spawn } from "node:child_process"');
    expect(source).toContain('spawn("git", arguments_');
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");
    expect(source).not.toMatch(/\bexec(?:File|FileSync|Sync)?\s*\(/u);
  });

  it("exposes no mutation or command APIs beyond the accepted worktree primitives", async () => {
    const contract = await readFile(
      join(packageRoot, "src", "contracts.ts"),
      "utf8",
    );
    for (const method of [
      "checkout",
      "switch",
      "apply",
      "commit",
      "merge",
      "rebase",
      "reset",
      "clean",
      "clone",
      "fetch",
      "pull",
      "push",
      "runCommand",
    ]) {
      expect(contract).not.toContain(method + "(");
    }
  });

  it("contains no prohibited Git subcommand or forced worktree invocation", async () => {
    const source = await readFile(
      join(packageRoot, "src", "native-git-repository.ts"),
      "utf8",
    );
    for (const command of [
      "checkout",
      "switch",
      "apply",
      "commit",
      "merge",
      "rebase",
      "reset",
      "clean",
      "clone",
      "fetch",
      "pull",
      "push",
    ]) {
      expect(source).not.toMatch(
        new RegExp("\\[\\s*[\"']" + command + "[\"']", "u"),
      );
    }
    expect(source).not.toMatch(
      /worktree["'],\s*["']remove["'],\s*["'](?:--force|-f)/u,
    );
    expect(source).not.toContain('"reset"');
    expect(source).not.toContain('"clean"');
  });
});
