import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCreateRunInput } from "./lifecycle-service.js";

const sourceDirectory = path.dirname(new URL(import.meta.url).pathname);
const repositoryRoot = path.resolve(sourceDirectory, "../../..");

describe("application boundaries", () => {
  it("remains framework and database neutral", async () => {
    const files = (await readdir(sourceDirectory)).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    const sources = await Promise.all(
      files.map((file) => readFile(path.join(sourceDirectory, file), "utf8")),
    );
    expect(sources.join("\n")).not.toMatch(/fastify|from ["']postgres["']/i);
  });

  it("does not add deferred execution-plane or later-domain behavior", async () => {
    const service = await readFile(
      path.join(sourceDirectory, "lifecycle-service.ts"),
      "utf8",
    );
    expect(service.replaceAll("worktree_id", "")).not.toMatch(
      /child_process|worktree|from ["'][^"']*git|intent_contract|ledger_event|queue_job/i,
    );
    expect(service).not.toMatch(
      /startTicket|completeTicket|activateAssignment|completeRun/,
    );
    expect(service).not.toContain('status: "active"');
  });

  it("keeps lifecycle API and outbox fixtures inspectable", async () => {
    const createFixture = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "fixtures/lifecycle/create-run-v1.json"),
        "utf8",
      ),
    ) as unknown;
    expect(parseCreateRunInput(createFixture).tickets).toHaveLength(2);

    const outboxFixture = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "fixtures/lifecycle/outbox-created-v1.json"),
        "utf8",
      ),
    ) as Record<string, unknown>[];
    expect(outboxFixture.map((event) => event.event_name)).toEqual([
      "run.created",
      "ticket.status_changed",
    ]);
    expect(outboxFixture.every((event) => event.schema_version === 1)).toBe(
      true,
    );
  });
});
