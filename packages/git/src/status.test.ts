import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registerGitRepository } from "./index.js";
import {
  createTestRepository,
  removeTestRepository,
  runGit,
  type TestRepository,
} from "./test-support.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

describe("status inspection", () => {
  it("reports staged, unstaged, deleted, renamed, and untracked paths deterministically", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    for (const path of [
      "staged.txt",
      "unstaged.txt",
      "deleted.txt",
      "rename-old.txt",
    ]) {
      await writeFile(join(fixture.root, path), `${path}\n`);
    }
    runGit(fixture.root, ["add", "--", "."]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "status base"]);

    await writeFile(join(fixture.root, "staged.txt"), "staged after\n");
    runGit(fixture.root, ["add", "--", "staged.txt"]);
    await writeFile(join(fixture.root, "unstaged.txt"), "unstaged after\n");
    await rm(join(fixture.root, "deleted.txt"));
    await rm(join(fixture.root, "rename-old.txt"));
    await writeFile(join(fixture.root, "rename-new.txt"), "rename-old.txt\n");
    runGit(fixture.root, [
      "add",
      "-A",
      "--",
      "rename-old.txt",
      "rename-new.txt",
    ]);
    await writeFile(join(fixture.root, "untracked space.txt"), "untracked\n");
    await writeFile(join(fixture.root, "ignored.txt"), "ignored\n");
    await writeFile(join(fixture.root, ".gitignore"), "ignored.txt\n");

    const repository = await registerGitRepository(fixture.root, "main");
    const first = await repository.getStatus();
    const second = await repository.getStatus();

    expect(first).toEqual(second);
    expect(first.clean).toBe(false);
    expect(first.changedPaths.map(({ path }) => path)).toEqual([
      ".gitignore",
      "deleted.txt",
      "rename-new.txt",
      "staged.txt",
      "unstaged.txt",
      "untracked space.txt",
    ]);
    expect(first.changedPaths).not.toContainEqual(
      expect.objectContaining({ path: "ignored.txt" }),
    );
    expect(first.changedPaths).toContainEqual(
      expect.objectContaining({
        path: "staged.txt",
        staged: true,
        unstaged: false,
        stagedChange: "modified",
      }),
    );
    expect(first.changedPaths).toContainEqual(
      expect.objectContaining({
        path: "unstaged.txt",
        staged: false,
        unstaged: true,
        unstagedChange: "modified",
      }),
    );
    expect(first.changedPaths).toContainEqual(
      expect.objectContaining({
        path: "deleted.txt",
        deleted: true,
        unstagedChange: "deleted",
      }),
    );
    expect(first.changedPaths).toContainEqual(
      expect.objectContaining({
        path: "rename-new.txt",
        renamed: true,
        renamedFrom: "rename-old.txt",
        stagedChange: "renamed",
      }),
    );
    expect(first.changedPaths).toContainEqual(
      expect.objectContaining({
        path: "untracked space.txt",
        untracked: true,
        unstagedChange: "added",
      }),
    );
    expect(Object.isFrozen(first.changedPaths)).toBe(true);
    expect(first.changedPaths.every(Object.isFrozen)).toBe(true);
  });

  it("reports intent-to-add as an unstaged non-untracked addition", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    await writeFile(join(fixture.root, "intent.txt"), "intent content\n");
    runGit(fixture.root, ["add", "-N", "--", "intent.txt"]);

    const repository = await registerGitRepository(fixture.root, "main");
    const status = await repository.getStatus();

    expect(status.changedPaths).toEqual([
      expect.objectContaining({
        path: "intent.txt",
        staged: false,
        unstaged: true,
        stagedChange: null,
        unstagedChange: "added",
        untracked: false,
      }),
    ]);
  });

  it("marks an unstaged rename destination as untracked", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    await writeFile(
      join(fixture.root, "rename-source.txt"),
      "rename content\n",
    );
    runGit(fixture.root, ["add", "--", "rename-source.txt"]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "rename base"]);
    await rename(
      join(fixture.root, "rename-source.txt"),
      join(fixture.root, "rename-destination.txt"),
    );

    const repository = await registerGitRepository(fixture.root, "main");
    const status = await repository.getStatus();

    expect(status.changedPaths).toEqual([
      expect.objectContaining({
        path: "rename-destination.txt",
        staged: false,
        unstaged: true,
        unstagedChange: "renamed",
        renamed: true,
        renamedFrom: "rename-source.txt",
        untracked: true,
      }),
    ]);
  });
});
