import type { AgentAssignmentV1, RunV1, TicketV1 } from "@blackbox/contracts";
import type {
  LifecycleOutboxRecord,
  LifecyclePersistence,
  LifecycleRunGraph,
  LifecycleUnitOfWork,
} from "@blackbox/persistence";
import { describe, expect, it } from "vitest";

import { APPLICATION_ERROR_CODES } from "./errors.js";
import { LifecycleService, type CreateRunInput } from "./lifecycle-service.js";

interface FakeState {
  runs: RunV1[];
  tickets: TicketV1[];
  assignments: AgentAssignmentV1[];
  outbox: LifecycleOutboxRecord[];
}

class FakeUnitOfWork implements LifecycleUnitOfWork {
  constructor(
    private readonly state: FakeState,
    private readonly failEventName?: string,
    private readonly attemptedEventNames?: string[],
  ) {}

  async readRunGraph(runId: string): Promise<LifecycleRunGraph | null> {
    const run = this.state.runs.find((candidate) => candidate.id === runId);
    return run === undefined
      ? null
      : {
          run,
          tickets: this.state.tickets.filter(
            (ticket) => ticket.run_id === runId,
          ),
          assignments: this.state.assignments.filter(
            (assignment) => assignment.run_id === runId,
          ),
        };
  }

  async insertRun(record: RunV1): Promise<void> {
    this.state.runs.push(record);
  }

  async insertTicket(record: TicketV1): Promise<void> {
    this.state.tickets.push({ ...record, dependencies: [] });
  }

  async insertDependency(
    _runId: string,
    ticketId: string,
    dependencyTicketId: string,
  ): Promise<void> {
    const index = this.state.tickets.findIndex(
      (ticket) => ticket.id === ticketId,
    );
    const ticket = this.state.tickets[index];
    if (ticket === undefined) {
      throw new Error("missing ticket");
    }
    this.state.tickets[index] = {
      ...ticket,
      dependencies: [...ticket.dependencies, dependencyTicketId],
    };
  }

  async insertAssignment(record: AgentAssignmentV1): Promise<void> {
    this.state.assignments.push(record);
  }

  async updateRun(
    record: RunV1,
    expectedStatus: RunV1["status"],
  ): Promise<void> {
    const index = this.state.runs.findIndex(
      (run) => run.id === record.id && run.status === expectedStatus,
    );
    if (index === -1) {
      throw new Error("stale run");
    }
    this.state.runs[index] = record;
  }

  async updateTicket(
    record: TicketV1,
    expectedStatus: TicketV1["status"],
  ): Promise<void> {
    const index = this.state.tickets.findIndex(
      (ticket) => ticket.id === record.id && ticket.status === expectedStatus,
    );
    if (index === -1) {
      throw new Error("stale ticket");
    }
    this.state.tickets[index] = record;
  }

  async updateAssignment(
    record: AgentAssignmentV1,
    expectedStatus: AgentAssignmentV1["status"],
  ): Promise<void> {
    const index = this.state.assignments.findIndex(
      (assignment) =>
        assignment.id === record.id && assignment.status === expectedStatus,
    );
    if (index === -1) {
      throw new Error("stale assignment");
    }
    this.state.assignments[index] = record;
  }

  async insertOutbox(record: LifecycleOutboxRecord): Promise<void> {
    this.attemptedEventNames?.push(record.event_name);
    if (record.event_name === this.failEventName) {
      throw new Error("injected outbox failure");
    }
    this.state.outbox.push(record);
  }
}

class FakePersistence implements LifecyclePersistence {
  state: FakeState = { runs: [], tickets: [], assignments: [], outbox: [] };
  failEventName?: string;
  readonly attemptedEventNames: string[] = [];

  async readRunGraph(runId: string): Promise<LifecycleRunGraph | null> {
    return new FakeUnitOfWork(this.state).readRunGraph(runId);
  }

  async transaction<T>(
    operation: (unitOfWork: LifecycleUnitOfWork) => Promise<T>,
  ): Promise<T> {
    const snapshot = structuredClone(this.state);
    const result = await operation(
      new FakeUnitOfWork(
        snapshot,
        this.failEventName,
        this.attemptedEventNames,
      ),
    );
    this.state = snapshot;
    return result;
  }
}

const input: CreateRunInput = {
  repository_id: "10000000-0000-4000-8000-000000000001",
  title: "Coordinated change",
  base_commit_sha: "a".repeat(40),
  configuration_version: 1,
  tickets: [
    {
      external_key: "root",
      title: "Root",
      description: "Build the root",
      dependencies: [],
      acceptance_criteria: ["Root passes"],
      manual_verification_steps: ["Inspect root"],
    },
    {
      external_key: "dependent",
      title: "Dependent",
      description: "Build the dependent",
      dependencies: ["root"],
      acceptance_criteria: ["Dependent passes"],
      manual_verification_steps: ["Inspect dependent"],
    },
  ],
};

function identifierFactory(): () => string {
  let value = 0;
  return () => {
    value += 1;
    return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
  };
}

function createHarness(times = ["2026-07-19T20:00:00.000Z"]) {
  const persistence = new FakePersistence();
  let clockReads = 0;
  const service = new LifecycleService(persistence, {
    clock: () => times[clockReads++] ?? times.at(-1)!,
    identifier: identifierFactory(),
  });
  return { persistence, service, clockReads: () => clockReads };
}

describe("LifecycleService", () => {
  it("creates a graph atomically with deterministic IDs, ordering, and one event per aggregate", async () => {
    const { persistence, service, clockReads } = createHarness();

    const graph = await service.createRun(input);

    expect(clockReads()).toBe(1);
    expect(graph.run).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      status: "created",
      created_at: "2026-07-19T20:00:00.000Z",
    });
    expect(graph.tickets.map((ticket) => ticket.external_key)).toEqual([
      "dependent",
      "root",
    ]);
    expect(graph.tickets[0]?.dependencies).toEqual([
      "00000000-0000-4000-8000-000000000003",
    ]);
    expect(persistence.state.outbox.map((event) => event.event_name)).toEqual([
      "run.created",
      "ticket.created",
      "ticket.created",
    ]);
    expect(persistence.state.outbox.map((event) => event.occurred_at)).toEqual([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:00:00.000Z",
    ]);
  });

  it("orders non-ASCII external keys by locale-independent UTF-16 values", async () => {
    const { service } = createHarness();
    const tickets = ["é", "ä", "z", "a"].map((externalKey) => ({
      ...input.tickets[0]!,
      external_key: externalKey,
    }));

    const graph = await service.createRun({ ...input, tickets });

    expect(graph.tickets.map((ticket) => ticket.external_key)).toEqual([
      "a",
      "z",
      "ä",
      "é",
    ]);
  });

  it.each([
    ["duplicate", { ...input, tickets: [...input.tickets, input.tickets[0]!] }],
    [
      "missing",
      {
        ...input,
        tickets: [{ ...input.tickets[0]!, dependencies: ["missing"] }],
      },
    ],
    [
      "self",
      {
        ...input,
        tickets: [{ ...input.tickets[0]!, dependencies: ["root"] }],
      },
    ],
    [
      "cycle",
      {
        ...input,
        tickets: [
          { ...input.tickets[0]!, dependencies: ["dependent"] },
          input.tickets[1]!,
        ],
      },
    ],
  ])("rejects a %s graph without persistence", async (_name, invalidGraph) => {
    const { persistence, service } = createHarness();
    await expect(service.createRun(invalidGraph)).rejects.toMatchObject({
      code: APPLICATION_ERROR_CODES.INVALID_INPUT,
    });
    expect(persistence.state).toEqual({
      runs: [],
      tickets: [],
      assignments: [],
      outbox: [],
    });
  });

  it("starts, readies, reserves, and blocks with one clock read per command", async () => {
    const times = [
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
      "2026-07-19T20:02:00.000Z",
      "2026-07-19T20:03:00.000Z",
      "2026-07-19T20:04:00.000Z",
      "2026-07-19T20:05:00.000Z",
      "2026-07-19T20:06:00.000Z",
    ];
    const { persistence, service, clockReads } = createHarness(times);
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
    await service.readyTicket(created.run.id, root.id);
    const reserved = await service.reserveAssignment(created.run.id, root.id, {
      agent_id: "20000000-0000-4000-8000-000000000001",
    });
    const assignment = reserved.assignments[0]!;
    expect(persistence.state.outbox.at(-1)).toEqual({
      schema_version: 1,
      event_id: "00000000-0000-4000-8000-000000000010",
      aggregate_type: "assignment",
      aggregate_id: assignment.id,
      run_id: created.run.id,
      event_name: "assignment.created",
      occurred_at: times[4],
      payload: assignment,
    });
    await expect(
      service.reserveAssignment(created.run.id, root.id, {
        agent_id: "20000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ code: APPLICATION_ERROR_CODES.CONFLICT });
    const blocked = await service.blockTicket(created.run.id, root.id);

    expect(clockReads()).toBe(7);
    expect(reserved.run.started_at).toBe(times[1]);
    expect(reserved.assignments[0]).toMatchObject({
      status: "assigned",
      assigned_at: times[4],
      released_at: null,
      worktree_id: null,
    });
    expect(blocked.assignments[0]).toMatchObject({
      status: "cancelled",
      released_at: times[6],
    });
    expect(
      blocked.tickets.find((ticket) => ticket.id === root.id)?.status,
    ).toBe("blocked");
    expect(persistence.state.outbox.slice(-2)).toEqual([
      {
        schema_version: 1,
        event_id: "00000000-0000-4000-8000-000000000011",
        aggregate_type: "assignment",
        aggregate_id: assignment.id,
        run_id: created.run.id,
        event_name: "assignment.status_changed",
        occurred_at: times[6],
        payload: { from: "assigned", to: "cancelled" },
      },
      {
        schema_version: 1,
        event_id: "00000000-0000-4000-8000-000000000012",
        aggregate_type: "ticket",
        aggregate_id: root.id,
        run_id: created.run.id,
        event_name: "ticket.status_changed",
        occurred_at: times[6],
        payload: { from: "ready", to: "blocked" },
      },
    ]);
  });

  it.each(["cancelled", "failed"] as const)(
    "applies the documented %s run cascade",
    async (target) => {
      const times = Array.from(
        { length: 6 },
        (_, index) => `2026-07-19T20:0${index}:00.000Z`,
      );
      const { persistence, service } = createHarness(times);
      const created = await service.createRun(input);
      const root = created.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      await service.startRun(created.run.id);
      await service.readyTicket(created.run.id, root.id);
      await service.reserveAssignment(created.run.id, root.id, {
        agent_id: "20000000-0000-4000-8000-000000000001",
      });
      const dependent = created.tickets.find(
        (ticket) => ticket.external_key === "dependent",
      )!;
      await service.blockTicket(created.run.id, dependent.id);
      const beforeCascade = persistence.state.outbox.length;

      const graph =
        target === "failed"
          ? await service.failRun(created.run.id)
          : await service.cancelRun(created.run.id);

      expect(graph.run).toMatchObject({
        status: target,
        completed_at: times[5],
      });
      expect(graph.tickets.map((ticket) => ticket.status)).toEqual([
        "cancelled",
        "cancelled",
      ]);
      expect(graph.assignments[0]).toMatchObject({
        status: target === "failed" ? "failed" : "cancelled",
        released_at: times[5],
      });
      const assignment = graph.assignments[0]!;
      expect(persistence.state.outbox.slice(beforeCascade)).toEqual([
        {
          schema_version: 1,
          event_id: expect.any(String),
          aggregate_type: "assignment",
          aggregate_id: assignment.id,
          run_id: created.run.id,
          event_name: "assignment.status_changed",
          occurred_at: times[5],
          payload: {
            from: "assigned",
            to: target === "failed" ? "failed" : "cancelled",
          },
        },
        {
          schema_version: 1,
          event_id: expect.any(String),
          aggregate_type: "run",
          aggregate_id: created.run.id,
          run_id: created.run.id,
          event_name: "run.status_changed",
          occurred_at: times[5],
          payload: { from: "running", to: target },
        },
        {
          schema_version: 1,
          event_id: expect.any(String),
          aggregate_type: "ticket",
          aggregate_id: dependent.id,
          run_id: created.run.id,
          event_name: "ticket.status_changed",
          occurred_at: times[5],
          payload: { from: "blocked", to: "cancelled" },
        },
        {
          schema_version: 1,
          event_id: expect.any(String),
          aggregate_type: "ticket",
          aggregate_id: root.id,
          run_id: created.run.id,
          event_name: "ticket.status_changed",
          occurred_at: times[5],
          payload: { from: "ready", to: "cancelled" },
        },
      ]);
    },
  );

  it("supports created-run cancellation and pending-ticket cancellation", async () => {
    const { service } = createHarness([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
    ]);
    const first = await service.createRun(input);
    const cancelledRun = await service.cancelRun(first.run.id);
    expect(cancelledRun.run.status).toBe("cancelled");
    expect(
      cancelledRun.tickets.every((ticket) => ticket.status === "cancelled"),
    ).toBe(true);

    const secondHarness = createHarness([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
    ]);
    const second = await secondHarness.service.createRun(input);
    const root = second.tickets.find(
      (ticket) => ticket.external_key === "root",
    )!;
    const cancelledTicket = await secondHarness.service.cancelTicket(
      second.run.id,
      root.id,
    );
    expect(
      cancelledTicket.tickets.find((ticket) => ticket.id === root.id)?.status,
    ).toBe("cancelled");
  });

  it("transitions a pending ticket to blocked and back to ready", async () => {
    const { persistence, service } = createHarness([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
      "2026-07-19T20:02:00.000Z",
      "2026-07-19T20:03:00.000Z",
    ]);
    const created = await service.createRun(input);
    const root = created.tickets.find(
      (ticket) => ticket.external_key === "root",
    )!;
    await service.startRun(created.run.id);
    const beforeBlock = persistence.state.outbox.length;
    await service.blockTicket(created.run.id, root.id);
    expect(persistence.state.outbox.slice(beforeBlock)).toEqual([
      expect.objectContaining({
        aggregate_type: "ticket",
        aggregate_id: root.id,
        event_name: "ticket.status_changed",
        payload: { from: "pending", to: "blocked" },
      }),
    ]);
    const ready = await service.readyTicket(created.run.id, root.id);
    expect(ready.tickets.find((ticket) => ticket.id === root.id)?.status).toBe(
      "ready",
    );
  });

  it("refuses failure before run start and reservation before ticket readiness", async () => {
    const { service } = createHarness([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
      "2026-07-19T20:02:00.000Z",
    ]);
    const created = await service.createRun(input);
    const root = created.tickets.find(
      (ticket) => ticket.external_key === "root",
    )!;
    await expect(service.failRun(created.run.id)).rejects.toMatchObject({
      code: APPLICATION_ERROR_CODES.INVALID_TRANSITION,
    });
    await service.startRun(created.run.id);
    await expect(
      service.reserveAssignment(created.run.id, root.id, {
        agent_id: "20000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ code: APPLICATION_ERROR_CODES.CONFLICT });
  });

  it("rolls state and outbox back together when event persistence fails", async () => {
    const { persistence, service } = createHarness([
      "2026-07-19T20:00:00.000Z",
      "2026-07-19T20:01:00.000Z",
    ]);
    const created = await service.createRun(input);
    const outboxCount = persistence.state.outbox.length;
    persistence.failEventName = "run.status_changed";

    await expect(service.startRun(created.run.id)).rejects.toThrow(
      "injected outbox failure",
    );
    expect(persistence.state.runs[0]?.status).toBe("created");
    expect(persistence.state.outbox).toHaveLength(outboxCount);
  });

  it.each([
    ["block", "assignment.status_changed", "ticket.status_changed"],
    ["cancel", "assignment.status_changed", "run.status_changed"],
    ["fail", "assignment.status_changed", "run.status_changed"],
  ] as const)(
    "rolls back every %s mutation when a later outbox insert fails",
    async (command, firstAttempt, secondAttempt) => {
      const { persistence, service } = createHarness(
        Array.from(
          { length: 8 },
          (_, index) => `2026-07-19T20:0${index}:00.000Z`,
        ),
      );
      const created = await service.createRun(input);
      const root = created.tickets.find(
        (ticket) => ticket.external_key === "root",
      )!;
      await service.startRun(created.run.id);
      await service.readyTicket(created.run.id, root.id);
      await service.reserveAssignment(created.run.id, root.id, {
        agent_id: "20000000-0000-4000-8000-000000000001",
      });
      const before = structuredClone(persistence.state);
      persistence.attemptedEventNames.splice(0);
      persistence.failEventName = "ticket.status_changed";

      const operation =
        command === "block"
          ? service.blockTicket(created.run.id, root.id)
          : command === "cancel"
            ? service.cancelRun(created.run.id)
            : service.failRun(created.run.id);
      await expect(operation).rejects.toThrow("injected outbox failure");

      expect(persistence.state).toEqual(before);
      expect(persistence.attemptedEventNames.slice(0, 2)).toEqual([
        firstAttempt,
        secondAttempt,
      ]);
      expect(persistence.attemptedEventNames.at(-1)).toBe(
        "ticket.status_changed",
      );
    },
  );

  it("returns stable not-found and invalid-transition errors", async () => {
    const { service } = createHarness();
    await expect(
      service.inspectRun("00000000-0000-4000-8000-999999999999"),
    ).rejects.toMatchObject({ code: APPLICATION_ERROR_CODES.NOT_FOUND });
    const created = await service.createRun(input);
    await expect(
      service
        .startRun(created.run.id)
        .then(() => service.startRun(created.run.id)),
    ).rejects.toMatchObject({
      code: APPLICATION_ERROR_CODES.INVALID_TRANSITION,
    });
  });
});
