import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GIT_ERROR_CODES,
  GitError,
  registerGitRepository,
  safeGitError,
} from "./index.js";
import {
  createTestRepository,
  removeTestRepository,
  runGit,
  type TestRepository,
} from "./test-support.js";

const secret = "blackbox-hostile-git-secret";
const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(removeTestRepository));
});

async function hostileHelper(
  fixture: TestRepository,
): Promise<{ readonly command: string; readonly marker: string }> {
  const directory = join(fixture.parent, "hostile helpers");
  const helper = join(directory, "helper.mjs");
  const marker = join(directory, "executed-marker");
  await mkdir(directory);
  await writeFile(
    helper,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync } from "node:fs";',
      "appendFileSync(" + JSON.stringify(marker) + ', "executed\\n");',
      "console.log(" + JSON.stringify(secret) + ");",
      "console.error(" + JSON.stringify(secret) + ");",
      "process.exitCode = 1;",
      "",
    ].join("\n"),
  );
  await chmod(helper, 0o755);
  return Object.freeze({ command: helper, marker });
}

describe.sequential("subprocess and error safety", () => {
  it("neutralizes malicious repository and inherited Git helpers", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const { command, marker } = await hostileHelper(fixture);
    const hooks = join(fixture.parent, "hooks");
    await mkdir(hooks);
    for (const name of [
      "reference-transaction",
      "post-checkout",
      "pre-commit",
    ]) {
      const hook = join(hooks, name);
      await writeFile(
        hook,
        [
          "#!/bin/sh",
          "printf executed >> " + JSON.stringify(marker),
          "printf '%s\\n' " + JSON.stringify(secret) + " >&2",
          "exit 1",
          "",
        ].join("\n"),
      );
      await chmod(hook, 0o755);
    }

    runGit(fixture.root, ["config", "diff.external", command]);
    runGit(fixture.root, ["config", "diff.hostile.command", command]);
    runGit(fixture.root, ["config", "diff.hostile.textconv", command]);
    runGit(fixture.root, ["config", "core.fsmonitor", command]);
    runGit(fixture.root, ["config", "core.hooksPath", hooks]);
    runGit(fixture.root, ["config", "core.pager", command]);
    runGit(fixture.root, ["config", "pager.status", command]);
    runGit(fixture.root, ["config", "pager.diff", command]);
    runGit(fixture.root, ["config", "credential.helper", "!" + command]);
    await writeFile(
      join(fixture.root, ".gitattributes"),
      "*.txt diff=hostile\n",
    );
    await writeFile(join(fixture.root, "tracked.txt"), "changed\n");
    await writeFile(join(fixture.root, "untracked.txt"), "untracked\n");

    const globalConfig = join(fixture.parent, "hostile-global.gitconfig");
    await writeFile(
      globalConfig,
      [
        "[diff]",
        "\texternal = " + command,
        "[core]",
        "\tfsmonitor = " + command,
        "[pager]",
        "\tstatus = " + command,
        "",
      ].join("\n"),
    );
    const inherited = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_EXTERNAL_DIFF: process.env.GIT_EXTERNAL_DIFF,
      GIT_PAGER: process.env.GIT_PAGER,
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    };
    Object.assign(process.env, {
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_EXTERNAL_DIFF: command,
      GIT_PAGER: command,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "diff.external",
      GIT_CONFIG_VALUE_0: command,
    });
    try {
      const repository = await registerGitRepository(fixture.root, "main");
      await repository.getStatus();
      const patchResult = await repository.createPatch(fixture.initialCommit);
      await repository.createBranch("safe-branch", fixture.initialCommit);
      expect(Buffer.from(patchResult.bytes).toString("utf8")).not.toContain(
        secret,
      );
    } finally {
      for (const [key, value] of Object.entries(inherited)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }

    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a required clean filter instead of executing it", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const { command, marker } = await hostileHelper(fixture);
    runGit(fixture.root, ["config", "filter.hostile.clean", command]);
    runGit(fixture.root, ["config", "filter.hostile.required", "true"]);
    await writeFile(
      join(fixture.root, ".gitattributes"),
      "*.txt filter=hostile\n",
    );

    const operation = registerGitRepository(fixture.root, "main");
    await expect(operation).rejects.toMatchObject({
      code: GIT_ERROR_CODES.unsupportedRepository,
      message: "Repository configuration or state is unsupported.",
    });
    await expect(operation).rejects.not.toThrow(secret);
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails every operation closed when filters appear after registration", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const { command, marker } = await hostileHelper(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    runGit(fixture.root, ["config", "filter.hostile.clean", command]);
    runGit(fixture.root, ["config", "filter.hostile.process", command]);
    runGit(fixture.root, ["config", "filter.hostile.required", "false"]);
    await writeFile(
      join(fixture.root, ".gitattributes"),
      "*.txt filter=hostile\n",
    );
    await writeFile(
      join(fixture.root, "tracked.txt"),
      "changed after registration\n",
    );

    for (const startOperation of [
      () => repository.getHead(),
      () => repository.getStatus(),
      () => repository.createPatch(fixture.initialCommit),
      () => repository.createBranch("must-not-exist", fixture.initialCommit),
    ]) {
      const operation = startOperation();
      await expect(operation).rejects.toMatchObject({
        code: GIT_ERROR_CODES.unsupportedRepository,
        message: "Repository configuration or state is unsupported.",
      });
      await expect(operation).rejects.not.toThrow(secret);
    }
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(() =>
      runGit(fixture.root, [
        "show-ref",
        "--verify",
        "refs/heads/must-not-exist",
      ]),
    ).toThrow();
  });

  it("sanitizes native Git failures that contain repository-controlled text", async () => {
    const fixture = await createTestRepository();
    repositories.push(fixture);
    const repository = await registerGitRepository(fixture.root, "main");
    await writeFile(
      join(fixture.root, ".git", "HEAD"),
      "ref: refs/heads/" + secret + "\n",
    );

    const operation = repository.getHead();
    await expect(operation).rejects.toMatchObject({
      code: GIT_ERROR_CODES.unbornRepository,
      message: "Unborn Git repositories are unsupported.",
    });
    await expect(operation).rejects.not.toThrow(secret);
  });

  it("does not trust attacker-created GitError instances", () => {
    const forged = new GitError(GIT_ERROR_CODES.operationFailed, secret);
    expect(safeGitError(forged)).toBeUndefined();
    expect(forged.message).toBe(secret);
  });
});
