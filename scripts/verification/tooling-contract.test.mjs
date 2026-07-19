import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../", import.meta.url);

async function readRepositoryFile(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), { encoding: "utf8" });
}

describe("verification tooling contract", () => {
  it("delegates the aggregate command only to the tested helper", async () => {
    const packageMetadata = JSON.parse(
      await readRepositoryFile("package.json"),
    );

    expect(packageMetadata.scripts.verify).toBe(
      "node scripts/verification/run-verification.mjs",
    );
    expect(packageMetadata.packageManager).toBe("pnpm@10.31.0");
    expect(packageMetadata.scripts.test).toBe("pnpm run test:unit");
    expect(packageMetadata.scripts["test:unit"]).toBe(
      "vitest run --exclude '**/*.database.test.ts'",
    );
    expect(packageMetadata.scripts["test:integration"]).toBe(
      "pnpm test:database && node --test scripts/verification/integration-smoke.mjs",
    );
  });

  it("uses the same exact Node version locally, in CI, and in tests", async () => {
    const nodeVersion = (await readRepositoryFile(".node-version")).trim();
    const workflow = await readRepositoryFile(".github/workflows/verify.yml");

    expect(nodeVersion).toBe("24.18.0");
    expect(process.versions.node).toBe(nodeVersion);
    expect(workflow).toContain("node-version-file: .node-version");
    expect(workflow).not.toMatch(/node-version:\s/);
  });

  it("keeps CI immutable, least-privilege, and locally equivalent", async () => {
    const workflow = await readRepositoryFile(".github/workflows/verify.yml");
    const actionReferences = [...workflow.matchAll(/^\s*- uses: (\S+)(.*)$/gm)];

    expect(
      actionReferences.map((reference) => [reference[1], reference[2].trim()]),
    ).toEqual([
      ["actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd", "# v6.0.2"],
      [
        "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
        "# v6.4.0",
      ],
    ]);
    expect(workflow).toMatch(/^on:\n[ ]{2}pull_request:$/m);
    expect(workflow).toMatch(/^[ ]{2}push:\n[ ]{4}branches:\n[ ]{6}- main$/m);
    expect(workflow).toMatch(/^[ ]{2}workflow_dispatch:$/m);
    expect(workflow).toMatch(/^permissions:\n[ ]{2}contents: read$/m);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("run: corepack enable");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow.match(/pnpm verify/g)).toHaveLength(1);
    expect(workflow).toContain("services:\n      postgres:");
    expect(workflow).toContain("postgres:17.10-alpine3.24@sha256:");
    expect(workflow).not.toMatch(/continue-on-error|secrets\.|codex/i);
  });
});
