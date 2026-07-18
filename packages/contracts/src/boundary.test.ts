import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] as string);
}

describe("package boundaries", () => {
  it("keeps domain dependency-free and limited to relative source imports", async () => {
    const packageMetadata = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "packages/domain/package.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(packageMetadata.dependencies).toBeUndefined();
    expect(packageMetadata.peerDependencies).toBeUndefined();
    expect(packageMetadata.optionalDependencies).toBeUndefined();

    const files = await sourceFiles(
      path.join(repositoryRoot, "packages/domain/src"),
    );
    for (const file of files.filter(
      (candidate) => !candidate.endsWith(".test.ts"),
    )) {
      const imports = importSpecifiers(await readFile(file, "utf8"));
      expect(imports.every((specifier) => specifier.startsWith("."))).toBe(
        true,
      );
    }
  });

  it("confines TypeBox imports to contracts", async () => {
    const files = await sourceFiles(repositoryRoot);
    for (const file of files) {
      const imports = importSpecifiers(await readFile(file, "utf8"));
      const typeboxImports = imports.filter(
        (specifier) =>
          specifier === "typebox" || specifier.startsWith("typebox/"),
      );
      if (typeboxImports.length > 0) {
        expect(
          file.startsWith(path.join(repositoryRoot, "packages/contracts/")),
        ).toBe(true);
      }
    }
  });

  it("pins the only new dependency and records no TypeBox transitive packages", async () => {
    const packageMetadata = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "packages/contracts/package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };
    expect(packageMetadata.dependencies).toEqual({
      "@blackbox/domain": "workspace:*",
      typebox: "1.3.6",
    });

    const lockfile = await readFile(
      path.join(repositoryRoot, "pnpm-lock.yaml"),
      "utf8",
    );
    expect(lockfile).toMatch(
      /typebox:\n\s+specifier: 1\.3\.6\n\s+version: 1\.3\.6/,
    );
    expect(lockfile.match(/^\s{2}typebox@1\.3\.6:/gm)).toHaveLength(2);
    expect(lockfile).toMatch(/typebox@1\.3\.6:\n\s+resolution:/);
    expect(lockfile).toMatch(/typebox@1\.3\.6: \{\}/);
  });
});
