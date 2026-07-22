import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GIT_ERROR_CODES, registerGitRepository } from "./index.js";
import {
  createTestRepository,
  gitText,
  removeTestRepository,
  type TestRepository,
} from "./test-support.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

describe("native worktree primitives", () => {
  it("creates, lists, and non-forcibly removes an exact branch worktree", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    const path = join(
      await realpath(fixture.parent),
      "managed path with spaces",
    );
    const canonicalHead = gitText(fixture.root, ["rev-parse", "HEAD"]);

    await repository.assertCommitExists(fixture.initialCommit);
    await repository.createBranch(
      "blackbox/worktree/exact",
      fixture.initialCommit,
    );
    expect(await repository.getBranchCommit("blackbox/worktree/exact")).toBe(
      fixture.initialCommit,
    );
    await expect(
      repository.addWorktree(path, "blackbox/worktree/exact"),
    ).resolves.toMatchObject({
      path,
      branch: "blackbox/worktree/exact",
      headCommitSha: fixture.initialCommit,
    });
    expect(
      (await repository.listWorktrees()).find(
        (worktree) => worktree.path === path,
      ),
    ).toMatchObject({ branch: "blackbox/worktree/exact" });
    expect(gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(canonicalHead);

    await expect(
      repository.deleteBranch("blackbox/worktree/exact", fixture.initialCommit),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.worktreeCollision });

    await repository.removeWorktree(
      path,
      "blackbox/worktree/exact",
      fixture.initialCommit,
    );
    await repository.deleteBranch(
      "blackbox/worktree/exact",
      fixture.initialCommit,
    );
    expect(
      await repository.getBranchCommit("blackbox/worktree/exact"),
    ).toBeNull();
    expect(gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(canonicalHead);
  });

  it("refuses dirty removal and compare-and-delete mismatches without force", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    const path = join(await realpath(fixture.parent), "managed");
    await repository.createBranch(
      "blackbox/worktree/dirty",
      fixture.initialCommit,
    );
    await repository.addWorktree(path, "blackbox/worktree/dirty");
    await writeFile(join(path, "tracked.txt"), "dirty\n");

    await expect(
      repository.removeWorktree(
        path,
        "blackbox/worktree/dirty",
        fixture.initialCommit,
      ),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.operationFailed });
    await expect(
      repository.deleteBranch("blackbox/worktree/dirty", "f".repeat(40)),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.shaUnavailable });
    expect(await repository.getBranchCommit("blackbox/worktree/dirty")).toBe(
      fixture.initialCommit,
    );
  });

  it("refuses occupied paths and missing branches", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    const path = join(fixture.parent, "occupied");
    await mkdir(path);
    await expect(repository.addWorktree(path, "missing")).rejects.toMatchObject(
      {
        code: GIT_ERROR_CODES.branchMissing,
      },
    );
  });

  it("detects ignored and otherwise unknown worktree content read-only", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    await writeFile(
      join(fixture.root, ".git", "info", "exclude"),
      "ignored.txt\n",
    );
    const repository = await registerGitRepository(fixture.root, "main");

    await expect(repository.hasUnknownContent()).resolves.toBe(false);
    await writeFile(join(fixture.root, "untracked.txt"), "untracked\n");
    await expect(repository.hasUnknownContent()).resolves.toBe(true);
    gitText(fixture.root, ["add", "--", "untracked.txt"]);
    await writeFile(join(fixture.root, "ignored.txt"), "ignored\n");
    await expect(repository.hasUnknownContent()).resolves.toBe(true);
    expect(gitText(fixture.root, ["status", "--porcelain"])).toBe(
      "A  untracked.txt",
    );
  });

  it("refuses a clean path substitution immediately before removal", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    const path = join(await realpath(fixture.parent), "substituted managed");
    const originalPath = `${path}-original`;
    const branchName = "blackbox/worktree/substituted";
    await repository.createBranch(branchName, fixture.initialCommit);
    await repository.addWorktree(path, branchName);
    await rename(path, originalPath);
    await mkdir(path);
    gitText(path, ["init", "--quiet", "--initial-branch=main"]);
    gitText(path, ["config", "user.name", "Blackbox Test"]);
    gitText(path, ["config", "user.email", "blackbox@example.invalid"]);
    await writeFile(join(path, "substitute.txt"), "substitute\n");
    gitText(path, ["add", "--", "substitute.txt"]);
    gitText(path, ["commit", "--quiet", "-m", "substitute"]);
    const substituteHead = gitText(path, ["rev-parse", "HEAD"]);

    await expect(
      repository.removeWorktree(path, branchName, fixture.initialCommit),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.worktreeCollision });
    expect(gitText(path, ["rev-parse", "HEAD"])).toBe(substituteHead);
    expect(gitText(originalPath, ["rev-parse", "HEAD"])).toBe(
      fixture.initialCommit,
    );
    expect(await repository.getBranchCommit(branchName)).toBe(
      fixture.initialCommit,
    );
  });
});
