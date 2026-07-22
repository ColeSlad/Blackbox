import { describe, expect, it } from "vitest";

import { readWorktreeConfiguration } from "./index.js";

const binding = {
  repository_id: "00000000-0000-4000-8000-000000000001",
  working_tree_root: "/tmp/repository",
  common_git_directory: "/tmp/repository/.git",
  default_branch: "main",
};

describe("worktree configuration", () => {
  it("reads strict server-owned repository bindings", () => {
    expect(
      readWorktreeConfiguration({
        BLACKBOX_WORKTREE_ROOT: "/tmp/worktrees",
        BLACKBOX_REPOSITORY_BINDINGS: JSON.stringify([binding]),
      }),
    ).toEqual({ managed_root: "/tmp/worktrees", repositories: [binding] });
  });

  it.each([
    {},
    { BLACKBOX_WORKTREE_ROOT: "/tmp/worktrees" },
    {
      BLACKBOX_WORKTREE_ROOT: "/tmp/worktrees",
      BLACKBOX_REPOSITORY_BINDINGS: "[]",
    },
    {
      BLACKBOX_WORKTREE_ROOT: "/tmp/worktrees",
      BLACKBOX_REPOSITORY_BINDINGS: JSON.stringify([
        binding,
        { ...binding, working_tree_root: "/tmp/other" },
      ]),
    },
  ])("refuses missing, empty, or duplicate configuration", (environment) => {
    expect(() => readWorktreeConfiguration(environment)).toThrow();
  });

  it("refuses uppercase and case-duplicate repository identifiers", () => {
    const lowercase = "aaaaaaaa-0000-4000-8000-000000000001";
    const uppercase = "AAAAAAAA-0000-4000-8000-000000000001";
    for (const repositories of [
      [{ ...binding, repository_id: uppercase }],
      [
        { ...binding, repository_id: lowercase },
        {
          ...binding,
          repository_id: uppercase,
          working_tree_root: "/tmp/other",
          common_git_directory: "/tmp/other/.git",
        },
      ],
    ]) {
      expect(() =>
        readWorktreeConfiguration({
          BLACKBOX_WORKTREE_ROOT: "/tmp/worktrees",
          BLACKBOX_REPOSITORY_BINDINGS: JSON.stringify(repositories),
        }),
      ).toThrow("canonical lowercase UUID");
    }
  });
});
