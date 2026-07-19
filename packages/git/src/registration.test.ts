import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { realpath } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { GIT_ERROR_CODES, registerGitRepository } from "./index.js";
import { nativeGitInternals } from "./native-git-repository.js";
import {
  createTestRepository,
  gitText,
  nativeGitExecutable,
  removeTestRepository,
  runGit,
  type TestRepository,
} from "./test-support.js";

const repositories: TestRepository[] = [];

async function repository(
  name?: string,
  objectFormat?: "sha1" | "sha256",
): Promise<TestRepository> {
  const created = await createTestRepository(name, objectFormat);
  repositories.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

describe.sequential("repository registration", () => {
  it.each(["sha1", "sha256"] as const)(
    "registers a clean %s repository with immutable canonical metadata",
    async (objectFormat) => {
      const fixture = await repository(undefined, objectFormat);
      const nested = join(fixture.root, "nested", "directory");
      await mkdir(nested, { recursive: true });

      const gitRepository = await registerGitRepository(nested, "main");

      expect(gitRepository.registration).toEqual({
        identity: {
          workingTreeRoot: await realpath(fixture.root),
          commonGitDirectory: await realpath(join(fixture.root, ".git")),
        },
        objectFormat,
        defaultBranch: "main",
        defaultBranchCommitSha: fixture.initialCommit,
        head: {
          commitSha: fixture.initialCommit,
          attached: true,
          currentBranch: "main",
        },
        status: { clean: true, changedPaths: [] },
      });
      expect(Object.isFrozen(gitRepository.registration)).toBe(true);
      expect(Object.isFrozen(gitRepository.registration.identity)).toBe(true);
      expect(Object.isFrozen(gitRepository.registration.head)).toBe(true);
      expect(Object.isFrozen(gitRepository.registration.status)).toBe(true);
      expect(
        Object.isFrozen(gitRepository.registration.status.changedPaths),
      ).toBe(true);
    },
  );

  it("canonicalizes a symlinked nested input and accepts spaces", async () => {
    const fixture = await repository("source repository with spaces");
    const nested = join(fixture.root, "nested path");
    const link = join(fixture.parent, "repository link");
    await mkdir(nested);
    await symlink(nested, link);

    const gitRepository = await registerGitRepository(link, "main");

    expect(gitRepository.registration.identity.workingTreeRoot).toBe(
      await realpath(fixture.root),
    );
    expect(gitRepository.registration.identity.workingTreeRoot).not.toBe(link);
  });

  it("records detached HEAD without changing the default branch", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.root, "second.txt"), "second\n");
    runGit(fixture.root, ["add", "--", "second.txt"]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "second"]);
    const defaultCommit = gitText(fixture.root, ["rev-parse", "main"]);
    runGit(fixture.root, [
      "switch",
      "--quiet",
      "--detach",
      fixture.initialCommit,
    ]);

    const gitRepository = await registerGitRepository(fixture.root, "main");

    expect(gitRepository.registration.defaultBranchCommitSha).toBe(
      defaultCommit,
    );
    expect(gitRepository.registration.head).toEqual({
      commitSha: fixture.initialCommit,
      attached: false,
      currentBranch: null,
    });
    expect(gitText(fixture.root, ["rev-parse", "main"])).toBe(defaultCommit);
  });

  it("refuses a non-commit detached HEAD after registration", async () => {
    const fixture = await repository();
    const gitRepository = await registerGitRepository(fixture.root, "main");
    const blobSha = runGit(
      fixture.root,
      ["hash-object", "-w", "--stdin"],
      Buffer.from("not a commit\n"),
    )
      .toString("utf8")
      .trim();
    await writeFile(join(fixture.root, ".git", "HEAD"), blobSha + "\n");

    await expect(gitRepository.getHead()).rejects.toMatchObject({
      code: GIT_ERROR_CODES.unsupportedRepository,
      message: "Repository configuration or state is unsupported.",
    });
  });

  it("refuses a default branch ref that does not identify a commit", async () => {
    const fixture = await repository();
    runGit(fixture.root, ["switch", "--quiet", "-c", "current"]);
    const blobSha = runGit(
      fixture.root,
      ["hash-object", "-w", "--stdin"],
      Buffer.from("not a default commit\n"),
    )
      .toString("utf8")
      .trim();
    await writeFile(
      join(fixture.root, ".git", "refs", "heads", "main"),
      blobSha + "\n",
    );

    await expect(
      registerGitRepository(fixture.root, "main"),
    ).rejects.toMatchObject({
      code: GIT_ERROR_CODES.unsupportedRepository,
      message: "Repository configuration or state is unsupported.",
    });
  });

  it("rejects missing paths, files, and non-repositories", async () => {
    const fixture = await repository();
    const file = join(fixture.parent, "plain-file");
    const directory = join(fixture.parent, "plain-directory");
    await writeFile(file, "plain\n");
    await mkdir(directory);

    await expect(
      registerGitRepository(join(fixture.parent, "missing"), "main"),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.pathInvalid });
    await expect(registerGitRepository(file, "main")).rejects.toMatchObject({
      code: GIT_ERROR_CODES.pathInvalid,
    });
    await expect(
      registerGitRepository(directory, "main"),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.notRepository });
  });

  it("rejects bare and unborn repositories", async () => {
    const fixture = await repository();
    const bare = join(fixture.parent, "bare.git");
    const unborn = join(fixture.parent, "unborn");
    runGit(fixture.parent, ["init", "--quiet", "--bare", bare]);
    runGit(fixture.parent, [
      "init",
      "--quiet",
      "--initial-branch=main",
      unborn,
    ]);

    await expect(registerGitRepository(bare, "main")).rejects.toMatchObject({
      code: GIT_ERROR_CODES.bareRepository,
      message: "Bare Git repositories are unsupported.",
    });
    await expect(registerGitRepository(unborn, "main")).rejects.toMatchObject({
      code: GIT_ERROR_CODES.unbornRepository,
      message: "Unborn Git repositories are unsupported.",
    });
  });

  it("rejects revision-like and missing default branches", async () => {
    const fixture = await repository();

    for (const invalid of ["", "-main", "main~1", "main..other", "@{-1}"]) {
      await expect(
        registerGitRepository(fixture.root, invalid),
      ).rejects.toMatchObject({ code: GIT_ERROR_CODES.defaultBranchInvalid });
    }
    await expect(
      registerGitRepository(fixture.root, "missing"),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.defaultBranchMissing });
  });

  it("returns explicit output-limit and missing-Git errors", async () => {
    const fixture = await repository();
    await expect(
      registerGitRepository(fixture.root, "main", { maxOutputBytes: 1 }),
    ).rejects.toMatchObject({
      code: GIT_ERROR_CODES.outputLimit,
      message: "Git output exceeded the configured limit.",
    });

    const originalPath = process.env.PATH;
    process.env.PATH = fixture.parent;
    try {
      await expect(
        registerGitRepository(fixture.root, "main"),
      ).rejects.toMatchObject({
        code: GIT_ERROR_CODES.executableMissing,
        message: "Native Git executable is unavailable.",
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("classifies missing absolute-path discovery as unsupported Git", async () => {
    const fixture = await repository();
    const wrapperDirectory = join(fixture.parent, "limited git");
    const wrapper = join(wrapperDirectory, "git");
    const nativeGit = nativeGitExecutable();
    await mkdir(wrapperDirectory);
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        'for argument in "$@"; do',
        '  if [ "$argument" = "--path-format=absolute" ]; then',
        "    exit 129",
        "  fi",
        "done",
        "exec " + JSON.stringify(nativeGit) + ' "$@"',
        "",
      ].join("\n"),
    );
    await chmod(wrapper, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = wrapperDirectory + delimiter + (originalPath ?? "");
    try {
      await expect(
        registerGitRepository(fixture.root, "main"),
      ).rejects.toMatchObject({
        code: GIT_ERROR_CODES.unsupportedGit,
        message: "Installed Git lacks a required capability.",
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("refuses unsupported platforms and invalid UTF-8 Git path records", async () => {
    expect(() => nativeGitInternals.assertSupportedPlatform("win32")).toThrow(
      expect.objectContaining({ code: GIT_ERROR_CODES.unsupportedGit }),
    );

    const fixture = await repository();
    const invalidStatus = Buffer.from([0x3f, 0x20, 0xff, 0x00]);
    expect(() =>
      nativeGitInternals.parseStatus(fixture.root, invalidStatus),
    ).toThrow(
      expect.objectContaining({ code: GIT_ERROR_CODES.unsupportedPath }),
    );
  });
});
