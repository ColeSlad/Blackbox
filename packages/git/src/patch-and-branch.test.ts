import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { delimiter, isAbsolute, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GIT_ERROR_CODES, registerGitRepository } from "./index.js";
import {
  createTestRepository,
  gitText,
  nativeGitExecutable,
  removeTestRepository,
  runGit,
  seedPatchFixture,
  type TestRepository,
} from "./test-support.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

describe("patch generation", () => {
  it("creates deterministic full-index binary patches without mutating repository state", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const snapshot = await seedPatchFixture(fixture);
    expect((await lstat(join(fixture.root, "link"))).isSymbolicLink()).toBe(
      true,
    );
    expect(
      (await lstat(join(fixture.root, "executable.sh"))).mode & 0o111,
    ).not.toBe(0);
    const baseCommitSha = gitText(fixture.root, ["rev-parse", "HEAD"]);
    const headBefore = gitText(fixture.root, ["rev-parse", "HEAD"]);
    const branchBefore = gitText(fixture.root, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);
    const objectsBefore = gitText(fixture.root, ["count-objects", "-v"]);
    const repository = await registerGitRepository(fixture.root, "main");

    const first = await repository.createPatch(baseCommitSha);
    const second = await repository.createPatch(baseCommitSha);
    const diff = await repository.getDiff(baseCommitSha);

    expect(first.baseCommitSha).toBe(baseCommitSha);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.bytes).toEqual(diff);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe(
      `sha256:${createHash("sha256").update(first.bytes).digest("hex")}`,
    );
    const patchText = Buffer.from(first.bytes).toString("utf8");
    expect(patchText).toContain("index ");
    expect(patchText).toContain("GIT binary patch");
    expect(patchText).toContain("deleted file mode 100644");
    expect(patchText).toContain("new file mode 100644");
    expect(patchText).toContain("old mode 100644");
    expect(patchText).toContain("new mode 100755");
    expect(patchText).toContain("rename from rename-old.txt");
    expect(patchText).toContain("rename to rename-new.txt");
    expect(patchText).toContain("diff --git a/link b/link");
    expect(patchText).toContain("diff --git a/untracked.txt b/untracked.txt");

    expect(await readFile(join(fixture.root, ".git", "index"))).toEqual(
      snapshot.indexBefore,
    );
    expect(runGit(fixture.root, ["status", "--porcelain=v2", "-z"])).toEqual(
      snapshot.statusBefore,
    );
    expect(gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitText(fixture.root, ["symbolic-ref", "--short", "HEAD"])).toBe(
      branchBefore,
    );
    expect(gitText(fixture.root, ["rev-parse", "main"])).toBe(headBefore);
    expect(gitText(fixture.root, ["count-objects", "-v"])).toBe(objectsBefore);

    const applicationRoot = join(fixture.parent, "patch application target");
    runGit(fixture.parent, [
      "clone",
      "--quiet",
      "--no-local",
      fixture.root,
      applicationRoot,
    ]);
    const patchPath = join(fixture.parent, "result.patch");
    await writeFile(patchPath, first.bytes);
    expect(() =>
      runGit(applicationRoot, ["apply", "--check", patchPath]),
    ).not.toThrow();
  });

  it("requires an exact lowercase available commit SHA", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");

    for (const invalid of [
      "HEAD",
      "main",
      `${fixture.initialCommit}~1`,
      fixture.initialCommit.toUpperCase(),
      fixture.initialCommit.slice(1),
    ]) {
      await expect(repository.createPatch(invalid)).rejects.toMatchObject({
        code: GIT_ERROR_CODES.shaInvalid,
      });
    }
    await expect(
      repository.createPatch("f".repeat(fixture.initialCommit.length)),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.shaUnavailable });
  });

  it("ignores hostile temp variables and keeps scratch outside repository identity", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    await writeFile(join(fixture.root, "tracked.txt"), "changed\n");
    const hostileTemporaryRoot = join(fixture.root, "caller controlled tmp");
    const wrapperDirectory = join(fixture.parent, "git wrapper");
    const wrapper = join(wrapperDirectory, "git");
    const environmentLog = join(fixture.parent, "git-tmp.log");
    const nativeGit = nativeGitExecutable();
    await mkdir(hostileTemporaryRoot);
    await mkdir(wrapperDirectory);
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$TMPDIR\" >> " + JSON.stringify(environmentLog),
        "exec " + JSON.stringify(nativeGit) + ' "$@"',
        "",
      ].join("\n"),
    );
    await chmod(wrapper, 0o755);

    const inherited = {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
    };
    Object.assign(process.env, {
      PATH: wrapperDirectory + delimiter + (process.env.PATH ?? ""),
      TMPDIR: hostileTemporaryRoot,
      TMP: hostileTemporaryRoot,
      TEMP: hostileTemporaryRoot,
    });
    try {
      const repository = await registerGitRepository(fixture.root, "main");
      const first = await repository.createPatch(fixture.initialCommit);
      const second = await repository.createPatch(fixture.initialCommit);
      expect(first.bytes).toEqual(second.bytes);
      expect(first.sha256).toBe(second.sha256);
      expect(Buffer.from(first.bytes).toString("utf8")).not.toContain(
        "caller controlled tmp",
      );

      const protectedPaths = [
        repository.registration.identity.workingTreeRoot,
        repository.registration.identity.commonGitDirectory,
      ];
      const observedTemporaryRoots = (await readFile(environmentLog, "utf8"))
        .trim()
        .split("\n");
      expect(observedTemporaryRoots.length).toBeGreaterThan(0);
      for (const temporaryRoot of observedTemporaryRoots) {
        expect(isAbsolute(temporaryRoot)).toBe(true);
        for (const protectedPath of protectedPaths) {
          const pathFromProtectedRoot = relative(protectedPath, temporaryRoot);
          expect(
            pathFromProtectedRoot === "" ||
              (!pathFromProtectedRoot.startsWith("..") &&
                !isAbsolute(pathFromProtectedRoot)),
          ).toBe(false);
        }
      }
    } finally {
      for (const [key, value] of Object.entries(inherited)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
    expect(await readdir(hostileTemporaryRoot)).toEqual([]);
  });
});

describe("branch creation", () => {
  it("atomically creates only the requested ref at an exact commit", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    await writeFile(join(fixture.root, "second.txt"), "second\n");
    runGit(fixture.root, ["add", "--", "second.txt"]);
    runGit(fixture.root, ["commit", "--quiet", "-m", "second"]);
    const headBefore = gitText(fixture.root, ["rev-parse", "HEAD"]);
    const branchBefore = gitText(fixture.root, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);
    const indexBefore = await readFile(join(fixture.root, ".git", "index"));
    const statusBefore = runGit(fixture.root, [
      "status",
      "--porcelain=v2",
      "-z",
    ]);
    const refsBefore = gitText(fixture.root, [
      "for-each-ref",
      "--format=%(refname)",
    ]);
    const repository = await registerGitRepository(fixture.root, "main");

    await expect(
      repository.createBranch("feature/exact", fixture.initialCommit),
    ).resolves.toEqual({
      name: "feature/exact",
      commitSha: fixture.initialCommit,
    });

    expect(
      gitText(fixture.root, ["rev-parse", "refs/heads/feature/exact"]),
    ).toBe(fixture.initialCommit);
    expect(gitText(fixture.root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitText(fixture.root, ["symbolic-ref", "--short", "HEAD"])).toBe(
      branchBefore,
    );
    expect(gitText(fixture.root, ["rev-parse", "main"])).toBe(headBefore);
    expect(await readFile(join(fixture.root, ".git", "index"))).toEqual(
      indexBefore,
    );
    expect(runGit(fixture.root, ["status", "--porcelain=v2", "-z"])).toEqual(
      statusBefore,
    );
    const refsAfter = gitText(fixture.root, [
      "for-each-ref",
      "--format=%(refname)",
    ]);
    expect(refsAfter.split("\n")).toEqual(
      [...refsBefore.split("\n"), "refs/heads/feature/exact"].sort(),
    );
  });

  it("refuses invalid names, revision inputs, unavailable SHAs, and collisions", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");

    for (const invalid of ["", "-branch", "main~1", "a..b", "@{-1}"]) {
      await expect(
        repository.createBranch(invalid, fixture.initialCommit),
      ).rejects.toMatchObject({ code: GIT_ERROR_CODES.branchInvalid });
    }
    for (const invalid of [
      "HEAD",
      "main",
      fixture.initialCommit.toUpperCase(),
    ]) {
      await expect(
        repository.createBranch("valid-name", invalid),
      ).rejects.toMatchObject({ code: GIT_ERROR_CODES.shaInvalid });
    }
    await expect(
      repository.createBranch(
        "valid-name",
        "f".repeat(fixture.initialCommit.length),
      ),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.shaUnavailable });
    await expect(
      repository.createBranch("main", fixture.initialCommit),
    ).rejects.toMatchObject({ code: GIT_ERROR_CODES.branchExists });
  });
});
