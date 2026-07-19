import { randomUUID } from "node:crypto";

import {
  PERSISTENCE_ERROR_CODES,
  assertLocalDatabaseUrl,
  createPostgresPersistence,
  migrateDatabase,
  readDatabaseConfig,
} from "@blackbox/persistence";
import { describe, expect, it } from "vitest";

import { APPLICATION_ERROR_CODES } from "./errors.js";
import { LifecycleService, type CreateRunInput } from "./lifecycle-service.js";

const input: CreateRunInput = {
  repository_id: "10000000-0000-4000-8000-000000000001",
  title: "Database lifecycle",
  base_commit_sha: "a".repeat(40),
  configuration_version: 1,
  tickets: [
    {
      external_key: "root",
      title: "Root",
      description: "Root ticket",
      dependencies: [],
      acceptance_criteria: ["Pass"],
      manual_verification_steps: ["Inspect"],
    },
    {
      external_key: "dependent",
      title: "Dependent",
      description: "Dependent ticket",
      dependencies: ["root"],
      acceptance_criteria: ["Pass"],
      manual_verification_steps: ["Inspect"],
    },
  ],
};

async function withTestDatabase<T>(
  operation: (
    persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  ) => Promise<T>,
): Promise<T> {
  const configured = assertLocalDatabaseUrl(readDatabaseConfig().url);
  const databaseName = `blackbox_lifecycle_${randomUUID().replaceAll("-", "")}`;
  const administrationUrl = new URL(configured);
  administrationUrl.pathname = "/postgres";
  const administration = await createPostgresPersistence(
    administrationUrl.toString(),
  );
  const administrationSql = administration.sql;
  const testUrl = new URL(configured);
  testUrl.pathname = `/${databaseName}`;

  try {
    await administrationSql`CREATE DATABASE ${administrationSql(databaseName)}`;
    const persistence = await createPostgresPersistence(testUrl.toString());
    try {
      await migrateDatabase(persistence.sql);
      return await operation(persistence);
    } finally {
      await persistence.close();
    }
  } finally {
    await administrationSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
    `.catch(() => undefined);
    await administrationSql`
      DROP DATABASE IF EXISTS ${administrationSql(databaseName)}
    `.catch(() => undefined);
    await administration.close().catch(() => undefined);
  }
}

function ids(values: readonly string[]): () => string {
  let index = 0;
  return () => values[index++] ?? randomUUID();
}

async function lifecycleRows(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  runId: string,
) {
  return {
    runs: await persistence.sql`
      SELECT id, status, started_at, completed_at
      FROM runs WHERE id = ${runId} ORDER BY id
    `,
    tickets: await persistence.sql`
      SELECT id, status FROM tickets WHERE run_id = ${runId} ORDER BY id
    `,
    assignments: await persistence.sql`
      SELECT id, status, released_at
      FROM assignments WHERE run_id = ${runId} ORDER BY id
    `,
    outbox: await persistence.sql`
      SELECT event_id, aggregate_type, aggregate_id, event_name, occurred_at,
             payload
      FROM lifecycle_outbox WHERE run_id = ${runId}
      ORDER BY aggregate_type, aggregate_id, event_id
    `,
  };
}

describe("PostgreSQL lifecycle adapter", () => {
  it("persists and deterministically inspects a graph with exact outbox records", async () => {
    await withTestDatabase(async (persistence) => {
      const service = new LifecycleService(persistence.lifecycle, {
        clock: () => "2026-07-19T20:00:00.000Z",
      });
      const created = await service.createRun(input);
      const inspected = await service.inspectRun(created.run.id);
      expect(inspected).toEqual(created);

      const outbox = await persistence.sql`
        SELECT schema_version, aggregate_type, aggregate_id, run_id,
               event_name, occurred_at, payload
        FROM lifecycle_outbox
        ORDER BY aggregate_type, aggregate_id
      `;
      expect(outbox).toHaveLength(3);
      expect(outbox.map((event) => event.event_name)).toEqual([
        "run.created",
        "ticket.created",
        "ticket.created",
      ]);
      expect(outbox.map((event) => event.aggregate_id)).toEqual([
        created.run.id,
        ...[...created.tickets].map((ticket) => ticket.id).sort(),
      ]);
      expect(outbox.every((event) => event.schema_version === 1)).toBe(true);
      expect(outbox.every((event) => event.run_id === created.run.id)).toBe(
        true,
      );
      expect(outbox[0]?.payload).toEqual(created.run);
    });
  });

  it("rolls an entire create graph back when an outbox insert fails", async () => {
    await withTestDatabase(async (persistence) => {
      const duplicateEventId = "30000000-0000-4000-8000-000000000001";
      const service = new LifecycleService(persistence.lifecycle, {
        clock: () => "2026-07-19T20:00:00.000Z",
        identifier: ids([
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
          duplicateEventId,
          duplicateEventId,
        ]),
      });
      await expect(service.createRun(input)).rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
      });
      const counts = await persistence.sql`
        SELECT
          (SELECT count(*)::integer FROM runs) AS runs,
          (SELECT count(*)::integer FROM tickets) AS tickets,
          (SELECT count(*)::integer FROM ticket_dependencies) AS dependencies,
          (SELECT count(*)::integer FROM lifecycle_outbox) AS outbox
      `;
      expect(counts[0]).toEqual({
        runs: 0,
        tickets: 0,
        dependencies: 0,
        outbox: 0,
      });
    });
  });

  it("enforces same-run acyclic dependencies in PostgreSQL", async () => {
    await withTestDatabase(async (persistence) => {
      const service = new LifecycleService(persistence.lifecycle);
      const first = await service.createRun(input);
      const second = await service.createRun({
        ...input,
        repository_id: "10000000-0000-4000-8000-000000000002",
      });
      const firstRoot = first.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      const firstDependent = first.tickets.find(
        (ticket) => ticket.external_key === "dependent",
      )!;
      const secondRoot = second.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;

      await expect(
        persistence.sql`
          INSERT INTO ticket_dependencies (run_id, ticket_id, dependency_ticket_id)
          VALUES (${first.run.id}, ${firstRoot.id}, ${firstDependent.id})
        `,
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        persistence.sql`
          INSERT INTO ticket_dependencies (run_id, ticket_id, dependency_ticket_id)
          VALUES (${first.run.id}, ${firstRoot.id}, ${secondRoot.id})
        `,
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("serializes concurrent reservations and keeps one live owner", async () => {
    await withTestDatabase(async (persistence) => {
      const firstService = new LifecycleService(persistence.lifecycle);
      const secondService = new LifecycleService(persistence.lifecycle);
      const created = await firstService.createRun(input);
      const root = created.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      await firstService.startRun(created.run.id);
      await firstService.readyTicket(created.run.id, root.id);

      const results = await Promise.allSettled([
        firstService.reserveAssignment(created.run.id, root.id, {
          agent_id: "20000000-0000-4000-8000-000000000001",
        }),
        secondService.reserveAssignment(created.run.id, root.id, {
          agent_id: "20000000-0000-4000-8000-000000000002",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { code: APPLICATION_ERROR_CODES.CONFLICT },
      });
      const live = await persistence.sql`
        SELECT id FROM assignments
        WHERE ticket_id = ${root.id} AND status IN ('assigned', 'active')
      `;
      expect(live).toHaveLength(1);
      const assignmentEvents = await persistence.sql`
        SELECT event_id FROM lifecycle_outbox
        WHERE event_name = 'assignment.created' AND aggregate_id = ${live[0]?.id}
      `;
      expect(assignmentEvents).toHaveLength(1);
    });
  });

  it.each(["cancelled", "failed"] as const)(
    "returns a consistent graph when inspection races a %s cascade",
    async (target) => {
      await withTestDatabase(async (persistence) => {
        const service = new LifecycleService(persistence.lifecycle);
        const created = await service.createRun(input);
        const root = created.tickets.find(
          (ticket) => ticket.external_key === "root",
        )!;
        const dependent = created.tickets.find(
          (ticket) => ticket.external_key === "dependent",
        )!;
        await service.startRun(created.run.id);
        await service.readyTicket(created.run.id, root.id);
        await service.reserveAssignment(created.run.id, root.id, {
          agent_id: "20000000-0000-4000-8000-000000000001",
        });
        await service.blockTicket(created.run.id, dependent.id);

        let releaseLock = (): void => undefined;
        let announceLock = (): void => undefined;
        const lockReleased = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        const lockAcquired = new Promise<void>((resolve) => {
          announceLock = resolve;
        });
        const blocker = persistence.sql.begin(async (transaction) => {
          await transaction`
            SELECT id FROM runs WHERE id = ${created.run.id} FOR UPDATE
          `;
          announceLock();
          await lockReleased;
        });
        await lockAcquired;

        let inspectionSettled = false;
        const inspection = service.inspectRun(created.run.id).then((graph) => {
          inspectionSettled = true;
          return graph;
        });
        const cascade =
          target === "failed"
            ? service.failRun(created.run.id)
            : service.cancelRun(created.run.id);
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(inspectionSettled).toBe(false);
        releaseLock();
        await blocker;

        const [inspected, cascaded] = await Promise.all([inspection, cascade]);
        const beforeCascade =
          inspected.run.status === "running" &&
          inspected.tickets.find((ticket) => ticket.id === root.id)?.status ===
            "ready" &&
          inspected.tickets.find((ticket) => ticket.id === dependent.id)
            ?.status === "blocked" &&
          inspected.assignments[0]?.status === "assigned";
        const afterCascade =
          inspected.run.status === target &&
          inspected.tickets.every((ticket) => ticket.status === "cancelled") &&
          inspected.assignments[0]?.status ===
            (target === "failed" ? "failed" : "cancelled");
        expect(beforeCascade || afterCascade).toBe(true);
        expect(cascaded.run.status).toBe(target);
        expect(
          cascaded.tickets.every((ticket) => ticket.status === "cancelled"),
        ).toBe(true);
      });
    },
  );

  it("uses the partial index for both assigned and active ownership", async () => {
    await withTestDatabase(async (persistence) => {
      const service = new LifecycleService(persistence.lifecycle);
      const created = await service.createRun(input);
      const root = created.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      await service.startRun(created.run.id);
      await service.readyTicket(created.run.id, root.id);
      await service.reserveAssignment(created.run.id, root.id, {
        agent_id: "20000000-0000-4000-8000-000000000001",
      });
      await persistence.sql`
        UPDATE assignments SET status = 'active' WHERE ticket_id = ${root.id}
      `;
      await expect(
        persistence.sql`
          INSERT INTO assignments (
            id, schema_version, run_id, ticket_id, agent_id, worktree_id,
            status, assigned_at, released_at
          ) VALUES (
            ${randomUUID()}, 1, ${created.run.id}, ${root.id}, ${randomUUID()},
            NULL, 'assigned', ${"2026-07-19T20:00:00.000Z"}, NULL
          )
        `,
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("reads committed dependency state and rolls a status change back with its event", async () => {
    await withTestDatabase(async (persistence) => {
      const service = new LifecycleService(persistence.lifecycle);
      const created = await service.createRun(input);
      const root = created.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      const dependent = created.tickets.find(
        (ticket) => ticket.external_key === "dependent",
      )!;
      await service.startRun(created.run.id);
      await expect(
        service.readyTicket(created.run.id, dependent.id),
      ).rejects.toMatchObject({ code: APPLICATION_ERROR_CODES.CONFLICT });
      await persistence.sql`UPDATE tickets SET status = 'done' WHERE id = ${root.id}`;
      await expect(
        service.readyTicket(created.run.id, dependent.id),
      ).resolves.toMatchObject({
        tickets: expect.arrayContaining([
          expect.objectContaining({ id: dependent.id, status: "ready" }),
        ]),
      });

      const existingEvent = await persistence.sql`
        SELECT event_id FROM lifecycle_outbox ORDER BY event_id LIMIT 1
      `;
      const rollbackService = new LifecycleService(persistence.lifecycle, {
        identifier: () => String(existingEvent[0]?.event_id),
      });
      const dependentBefore = await persistence.sql`
        SELECT status FROM tickets WHERE id = ${dependent.id}
      `;
      await expect(
        rollbackService.blockTicket(created.run.id, dependent.id),
      ).rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
      });
      const dependentAfter = await persistence.sql`
        SELECT status FROM tickets WHERE id = ${dependent.id}
      `;
      expect(dependentAfter).toEqual(dependentBefore);
    });
  });

  it.each(["block", "cancel", "fail"] as const)(
    "rolls back all database state and earlier events after a late %s outbox failure",
    async (command) => {
      await withTestDatabase(async (persistence) => {
        const service = new LifecycleService(persistence.lifecycle);
        const created = await service.createRun(input);
        const root = created.tickets.find(
          (ticket) => ticket.external_key === "root",
        )!;
        const dependent = created.tickets.find(
          (ticket) => ticket.external_key === "dependent",
        )!;
        await service.startRun(created.run.id);
        await service.readyTicket(created.run.id, root.id);
        await service.reserveAssignment(created.run.id, root.id, {
          agent_id: "20000000-0000-4000-8000-000000000001",
        });
        if (command !== "block") {
          await service.blockTicket(created.run.id, dependent.id);
        }

        const existingEvent = await persistence.sql`
          SELECT event_id FROM lifecycle_outbox ORDER BY event_id LIMIT 1
        `;
        const failureIds =
          command === "block"
            ? [randomUUID(), String(existingEvent[0]?.event_id)]
            : [randomUUID(), randomUUID(), String(existingEvent[0]?.event_id)];
        const failingService = new LifecycleService(persistence.lifecycle, {
          identifier: ids(failureIds),
        });
        const before = await lifecycleRows(persistence, created.run.id);

        const operation =
          command === "block"
            ? failingService.blockTicket(created.run.id, root.id)
            : command === "cancel"
              ? failingService.cancelRun(created.run.id)
              : failingService.failRun(created.run.id);
        await expect(operation).rejects.toMatchObject({
          code: PERSISTENCE_ERROR_CODES.CONSTRAINT_VIOLATION,
        });

        await expect(
          lifecycleRows(persistence, created.run.id),
        ).resolves.toEqual(before);
      });
    },
  );

  it("prevents update, deletion, and truncation of lifecycle outbox records", async () => {
    await withTestDatabase(async (persistence) => {
      const service = new LifecycleService(persistence.lifecycle);
      await service.createRun({ ...input, tickets: [input.tickets[0]!] });
      await expect(
        persistence.sql`UPDATE lifecycle_outbox SET event_name = event_name`,
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        persistence.sql`DELETE FROM lifecycle_outbox`,
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        persistence.sql`TRUNCATE lifecycle_outbox`,
      ).rejects.toMatchObject({ code: "55000" });
      const records = await persistence.sql`
        SELECT event_id FROM lifecycle_outbox
      `;
      expect(records).toHaveLength(2);
    });
  });
});
