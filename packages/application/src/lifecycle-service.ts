import { randomUUID } from "node:crypto";

import {
  parseAgentAssignmentV1,
  parseRunV1,
  parseTicketV1,
  type AgentAssignmentV1,
  type JsonObjectV1,
  type RunV1,
  type TicketV1,
} from "@blackbox/contracts";
import {
  InvalidStateTransitionError,
  transitionAssignmentStatus,
  transitionRunStatus,
  transitionTicketStatus,
} from "@blackbox/domain";
import type {
  LifecycleOutboxRecord,
  LifecyclePersistence,
  LifecycleRunGraph,
  LifecycleUnitOfWork,
} from "@blackbox/persistence";
import type { AssignmentWorktreeV1 } from "@blackbox/worktrees";

import {
  conflict,
  deferred,
  invalidInput,
  invalidTransition,
  notFound,
} from "./errors.js";

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CreateTicketInput {
  readonly external_key: string;
  readonly title: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly manual_verification_steps: readonly string[];
}

export interface CreateRunInput {
  readonly repository_id: string;
  readonly title: string;
  readonly base_commit_sha: string;
  readonly configuration_version: number;
  readonly tickets: readonly CreateTicketInput[];
}

export interface ReserveAssignmentInput {
  readonly agent_id: string;
}

export interface LifecycleServiceOptions {
  readonly clock?: () => string;
  readonly identifier?: () => string;
  readonly worktreeVerifier?: WorktreeActivationVerifier;
}

export interface WorktreeActivationVerifier {
  verifyActiveRecord(record: AssignmentWorktreeV1): Promise<void>;
}

type AggregateMutation =
  | {
      readonly aggregateType: "run";
      readonly record: RunV1;
      readonly eventName: "run.created";
      readonly payload: JsonObjectV1;
    }
  | {
      readonly aggregateType: "ticket";
      readonly record: TicketV1;
      readonly eventName: "ticket.created";
      readonly payload: JsonObjectV1;
    }
  | {
      readonly aggregateType: "assignment";
      readonly record: AgentAssignmentV1;
      readonly eventName: "assignment.created";
      readonly payload: JsonObjectV1;
    }
  | {
      readonly aggregateType: "run" | "ticket" | "assignment";
      readonly record: RunV1 | TicketV1 | AgentAssignmentV1;
      readonly eventName:
        | "run.status_changed"
        | "ticket.status_changed"
        | "assignment.status_changed";
      readonly payload: JsonObjectV1;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && /\S/.test(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function parseTicketInput(value: unknown): CreateTicketInput {
  const keys = [
    "acceptance_criteria",
    "dependencies",
    "description",
    "external_key",
    "manual_verification_steps",
    "title",
  ];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    !nonEmptyString(value.external_key) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.description) ||
    !stringArray(value.dependencies) ||
    !stringArray(value.acceptance_criteria) ||
    !stringArray(value.manual_verification_steps) ||
    new Set(value.dependencies).size !== value.dependencies.length
  ) {
    throw invalidInput();
  }
  return Object.freeze({
    external_key: value.external_key,
    title: value.title,
    description: value.description,
    dependencies: Object.freeze([...value.dependencies]),
    acceptance_criteria: Object.freeze([...value.acceptance_criteria]),
    manual_verification_steps: Object.freeze([
      ...value.manual_verification_steps,
    ]),
  });
}

export function parseCreateRunInput(value: unknown): CreateRunInput {
  const keys = [
    "base_commit_sha",
    "configuration_version",
    "repository_id",
    "tickets",
    "title",
  ];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    !nonEmptyString(value.repository_id) ||
    !UUID_PATTERN.test(value.repository_id) ||
    !nonEmptyString(value.title) ||
    typeof value.base_commit_sha !== "string" ||
    !SHA_PATTERN.test(value.base_commit_sha) ||
    typeof value.configuration_version !== "number" ||
    !Number.isInteger(value.configuration_version) ||
    value.configuration_version < 1 ||
    !Array.isArray(value.tickets) ||
    value.tickets.length === 0
  ) {
    throw invalidInput();
  }
  const tickets = value.tickets.map(parseTicketInput);
  validateTicketGraph(tickets);
  return Object.freeze({
    repository_id: value.repository_id,
    title: value.title,
    base_commit_sha: value.base_commit_sha,
    configuration_version: value.configuration_version,
    tickets: Object.freeze(tickets),
  });
}

export function parseReserveAssignmentInput(
  value: unknown,
): ReserveAssignmentInput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["agent_id"]) ||
    typeof value.agent_id !== "string" ||
    !UUID_PATTERN.test(value.agent_id)
  ) {
    throw invalidInput();
  }
  return Object.freeze({ agent_id: value.agent_id });
}

function validateTicketGraph(tickets: readonly CreateTicketInput[]): void {
  const byKey = new Map<string, CreateTicketInput>();
  for (const ticket of tickets) {
    if (byKey.has(ticket.external_key)) {
      throw invalidInput("Ticket external keys must be unique.");
    }
    byKey.set(ticket.external_key, ticket);
  }
  for (const ticket of tickets) {
    for (const dependency of ticket.dependencies) {
      if (dependency === ticket.external_key) {
        throw invalidInput("A ticket cannot depend on itself.");
      }
      if (!byKey.has(dependency)) {
        throw invalidInput("Every dependency must name a ticket in the run.");
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      throw invalidInput("Ticket dependencies must be acyclic.");
    }
    if (visited.has(key)) {
      return;
    }
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependencies ?? []) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of [...byKey.keys()].sort()) {
    visit(key);
  }
}

function validateIdentifier(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw invalidInput();
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedGraph(graph: LifecycleRunGraph): LifecycleRunGraph {
  return Object.freeze({
    run: graph.run,
    tickets: Object.freeze(
      [...graph.tickets]
        .map((ticket) =>
          Object.freeze({
            ...ticket,
            dependencies: [...ticket.dependencies].sort(),
          }),
        )
        .sort(
          (left, right) =>
            compareStrings(left.external_key, right.external_key) ||
            compareStrings(left.id, right.id),
        ),
    ),
    assignments: Object.freeze(
      [...graph.assignments].sort((left, right) =>
        compareStrings(left.id, right.id),
      ),
    ),
  });
}

function asPayload(value: object): JsonObjectV1 {
  return value as JsonObjectV1;
}

function statusPayload(from: string, to: string): JsonObjectV1 {
  return Object.freeze({ from, to });
}

function transitionOrThrow<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof InvalidStateTransitionError) {
      throw invalidTransition();
    }
    throw error;
  }
}

export class LifecycleService {
  private readonly clock: () => string;
  private readonly identifier: () => string;
  private readonly worktreeVerifier: WorktreeActivationVerifier | undefined;

  constructor(
    private readonly persistence: LifecyclePersistence,
    options: LifecycleServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.identifier = options.identifier ?? randomUUID;
    this.worktreeVerifier = options.worktreeVerifier;
  }

  private nextIdentifier(): string {
    const identifier = this.identifier();
    validateIdentifier(identifier);
    return identifier;
  }

  async createRun(value: unknown): Promise<LifecycleRunGraph> {
    const input = parseCreateRunInput(value);
    const occurredAt = this.clock();
    const runId = this.nextIdentifier();
    const ticketIds = new Map(
      [...input.tickets]
        .sort((left, right) =>
          compareStrings(left.external_key, right.external_key),
        )
        .map((ticket) => [ticket.external_key, this.nextIdentifier()]),
    );
    const run = parseRunV1({
      schema_version: 1,
      id: runId,
      repository_id: input.repository_id,
      title: input.title,
      base_commit_sha: input.base_commit_sha,
      status: "created",
      configuration_version: input.configuration_version,
      created_at: occurredAt,
      started_at: null,
      completed_at: null,
    });
    const tickets = input.tickets.map((ticket) =>
      parseTicketV1({
        schema_version: 1,
        id: ticketIds.get(ticket.external_key),
        run_id: runId,
        external_key: ticket.external_key,
        title: ticket.title,
        description: ticket.description,
        status: "pending",
        dependencies: ticket.dependencies.map((key) => ticketIds.get(key)),
        acceptance_criteria: [...ticket.acceptance_criteria],
        manual_verification_steps: [...ticket.manual_verification_steps],
      }),
    );
    const mutations: AggregateMutation[] = [
      {
        aggregateType: "run",
        record: run,
        eventName: "run.created",
        payload: asPayload(run),
      },
      ...tickets.map((ticket): AggregateMutation => ({
        aggregateType: "ticket",
        record: ticket,
        eventName: "ticket.created",
        payload: asPayload(ticket),
      })),
    ];

    await this.persistence.transaction(async (unitOfWork) => {
      await unitOfWork.insertRun(run);
      for (const ticket of [...tickets].sort((left, right) =>
        compareStrings(left.id, right.id),
      )) {
        await unitOfWork.insertTicket(ticket);
      }
      for (const ticket of [...tickets].sort((left, right) =>
        compareStrings(left.id, right.id),
      )) {
        for (const dependencyId of [...ticket.dependencies].sort()) {
          await unitOfWork.insertDependency(run.id, ticket.id, dependencyId);
        }
      }
      await this.writeEvents(unitOfWork, mutations, occurredAt);
    });

    return sortedGraph({ run, tickets, assignments: [] });
  }

  async inspectRun(runId: string): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    const graph = await this.persistence.readRunGraph(runId);
    if (graph === null) {
      throw notFound();
    }
    return sortedGraph(graph);
  }

  async startRun(runId: string): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      const status = transitionOrThrow(() =>
        transitionRunStatus(graph.run.status, "running"),
      );
      const run = parseRunV1({
        ...graph.run,
        status,
        started_at: occurredAt,
      });
      await unitOfWork.updateRun(run, graph.run.status);
      await this.writeEvents(
        unitOfWork,
        [this.statusMutation("run", run, graph.run.status)],
        occurredAt,
      );
      return { ...graph, run };
    });
  }

  async readyTicket(
    runId: string,
    ticketId: string,
  ): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    validateIdentifier(ticketId);
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      if (graph.run.status !== "running") {
        throw conflict("Tickets can become ready only in a running run.");
      }
      const ticket = this.requireTicket(graph, ticketId);
      const dependencies = new Map(
        graph.tickets.map((candidate) => [candidate.id, candidate]),
      );
      if (
        ticket.dependencies.some(
          (dependencyId) => dependencies.get(dependencyId)?.status !== "done",
        )
      ) {
        throw conflict("Every ticket dependency must be done.");
      }
      const status = transitionOrThrow(() =>
        transitionTicketStatus(ticket.status, "ready"),
      );
      const updated = parseTicketV1({ ...ticket, status });
      await unitOfWork.updateTicket(updated, ticket.status);
      await this.writeEvents(
        unitOfWork,
        [this.statusMutation("ticket", updated, ticket.status)],
        occurredAt,
      );
      return this.replaceTicket(graph, updated);
    });
  }

  async reserveAssignment(
    runId: string,
    ticketId: string,
    value: unknown,
  ): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    validateIdentifier(ticketId);
    const input = parseReserveAssignmentInput(value);
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      if (graph.run.status !== "running") {
        throw conflict("Assignments can be reserved only in a running run.");
      }
      const ticket = this.requireTicket(graph, ticketId);
      if (ticket.status !== "ready") {
        throw conflict("Assignments can be reserved only for a ready ticket.");
      }
      if (
        graph.assignments.some(
          (assignment) =>
            assignment.ticket_id === ticketId &&
            ["assigned", "active"].includes(assignment.status),
        )
      ) {
        throw conflict("The ticket already has a live assignment reservation.");
      }
      const assignment = parseAgentAssignmentV1({
        schema_version: 1,
        id: this.nextIdentifier(),
        run_id: runId,
        ticket_id: ticketId,
        agent_id: input.agent_id,
        worktree_id: null,
        status: "assigned",
        assigned_at: occurredAt,
        released_at: null,
      });
      await unitOfWork.insertAssignment(assignment);
      await this.writeEvents(
        unitOfWork,
        [
          {
            aggregateType: "assignment",
            record: assignment,
            eventName: "assignment.created",
            payload: asPayload(assignment),
          },
        ],
        occurredAt,
      );
      return { ...graph, assignments: [...graph.assignments, assignment] };
    });
  }

  async startTicketAssignment(
    runId: string,
    ticketId: string,
    assignmentId: string,
  ): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    validateIdentifier(ticketId);
    validateIdentifier(assignmentId);
    if (this.worktreeVerifier === undefined) {
      throw deferred();
    }
    const worktreeVerifier = this.worktreeVerifier;
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      if (graph.run.status !== "running") {
        throw conflict("A ticket can start only in a running run.");
      }
      const ticket = this.requireTicket(graph, ticketId);
      const assignment = graph.assignments.find(
        (candidate) => candidate.id === assignmentId,
      );
      if (
        ticket.status !== "ready" ||
        assignment === undefined ||
        assignment.run_id !== runId ||
        assignment.ticket_id !== ticketId ||
        assignment.status !== "assigned" ||
        assignment.worktree_id === null ||
        unitOfWork.readAssignmentWorktree === undefined
      ) {
        throw conflict("The ticket assignment is not eligible to start.");
      }
      const worktree = await unitOfWork.readAssignmentWorktree(
        assignment.worktree_id,
      );
      if (
        worktree === null ||
        worktree.id !== assignment.worktree_id ||
        worktree.repository_id !== graph.run.repository_id ||
        worktree.run_id !== runId ||
        worktree.ticket_id !== ticketId ||
        worktree.assignment_id !== assignmentId ||
        worktree.base_commit_sha !== graph.run.base_commit_sha ||
        worktree.status !== "active"
      ) {
        throw conflict("The assignment worktree proof is inconsistent.");
      }
      await worktreeVerifier.verifyActiveRecord(worktree);
      const updatedTicket = parseTicketV1({
        ...ticket,
        status: transitionOrThrow(() =>
          transitionTicketStatus(ticket.status, "running"),
        ),
      });
      const updatedAssignment = parseAgentAssignmentV1({
        ...assignment,
        status: transitionOrThrow(() =>
          transitionAssignmentStatus(assignment.status, "active"),
        ),
      });
      await unitOfWork.updateTicket(updatedTicket, ticket.status);
      await unitOfWork.updateAssignment(updatedAssignment, assignment.status);
      await this.writeEvents(
        unitOfWork,
        [
          this.statusMutation("ticket", updatedTicket, ticket.status),
          this.statusMutation(
            "assignment",
            updatedAssignment,
            assignment.status,
          ),
        ],
        occurredAt,
      );
      return {
        ...this.replaceTicket(graph, updatedTicket),
        assignments: graph.assignments.map((candidate) =>
          candidate.id === assignmentId ? updatedAssignment : candidate,
        ),
      };
    });
  }

  async blockTicket(
    runId: string,
    ticketId: string,
  ): Promise<LifecycleRunGraph> {
    return this.disposeTicket(runId, ticketId, "blocked");
  }

  async cancelTicket(
    runId: string,
    ticketId: string,
  ): Promise<LifecycleRunGraph> {
    return this.disposeTicket(runId, ticketId, "cancelled");
  }

  async cancelRun(runId: string): Promise<LifecycleRunGraph> {
    return this.disposeRun(runId, "cancelled");
  }

  async failRun(runId: string): Promise<LifecycleRunGraph> {
    return this.disposeRun(runId, "failed");
  }

  private async disposeTicket(
    runId: string,
    ticketId: string,
    target: "blocked" | "cancelled",
  ): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    validateIdentifier(ticketId);
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      const ticket = this.requireTicket(graph, ticketId);
      if (!["pending", "ready"].includes(ticket.status)) {
        throw invalidTransition();
      }
      const ticketStatus = transitionOrThrow(() =>
        transitionTicketStatus(ticket.status, target),
      );
      const updatedTicket = parseTicketV1({ ...ticket, status: ticketStatus });
      const assignment = graph.assignments.find(
        (candidate) =>
          candidate.ticket_id === ticketId && candidate.status === "assigned",
      );
      const mutations: AggregateMutation[] = [];
      let assignments = graph.assignments;
      if (assignment !== undefined) {
        const status = transitionOrThrow(() =>
          transitionAssignmentStatus(assignment.status, "cancelled"),
        );
        const updatedAssignment = parseAgentAssignmentV1({
          ...assignment,
          status,
          released_at: occurredAt,
        });
        await unitOfWork.updateAssignment(updatedAssignment, assignment.status);
        mutations.push(
          this.statusMutation(
            "assignment",
            updatedAssignment,
            assignment.status,
          ),
        );
        assignments = graph.assignments.map((candidate) =>
          candidate.id === assignment.id ? updatedAssignment : candidate,
        );
      }
      await unitOfWork.updateTicket(updatedTicket, ticket.status);
      mutations.push(
        this.statusMutation("ticket", updatedTicket, ticket.status),
      );
      await this.writeEvents(unitOfWork, mutations, occurredAt);
      return {
        ...this.replaceTicket(graph, updatedTicket),
        assignments,
      };
    });
  }

  private async disposeRun(
    runId: string,
    target: "failed" | "cancelled",
  ): Promise<LifecycleRunGraph> {
    validateIdentifier(runId);
    const occurredAt = this.clock();
    return this.mutateGraph(runId, occurredAt, async (unitOfWork, graph) => {
      const runStatus = transitionOrThrow(() =>
        transitionRunStatus(graph.run.status, target),
      );
      const run = parseRunV1({
        ...graph.run,
        status: runStatus,
        completed_at: occurredAt,
      });
      const assignmentTarget = target === "failed" ? "failed" : "cancelled";
      const assignments = [...graph.assignments];
      const tickets = [...graph.tickets];
      const mutations: AggregateMutation[] = [];

      for (const [index, assignment] of assignments.entries()) {
        if (assignment.status !== "assigned") {
          continue;
        }
        const status = transitionOrThrow(() =>
          transitionAssignmentStatus(assignment.status, assignmentTarget),
        );
        const updated = parseAgentAssignmentV1({
          ...assignment,
          status,
          released_at: occurredAt,
        });
        await unitOfWork.updateAssignment(updated, assignment.status);
        assignments[index] = updated;
        mutations.push(
          this.statusMutation("assignment", updated, assignment.status),
        );
      }

      await unitOfWork.updateRun(run, graph.run.status);
      mutations.push(this.statusMutation("run", run, graph.run.status));

      for (const [index, ticket] of tickets.entries()) {
        if (!["pending", "ready", "blocked"].includes(ticket.status)) {
          continue;
        }
        const status = transitionOrThrow(() =>
          transitionTicketStatus(ticket.status, "cancelled"),
        );
        const updated = parseTicketV1({ ...ticket, status });
        await unitOfWork.updateTicket(updated, ticket.status);
        tickets[index] = updated;
        mutations.push(this.statusMutation("ticket", updated, ticket.status));
      }

      await this.writeEvents(unitOfWork, mutations, occurredAt);
      return { run, tickets, assignments };
    });
  }

  private async mutateGraph(
    runId: string,
    _occurredAt: string,
    operation: (
      unitOfWork: LifecycleUnitOfWork,
      graph: LifecycleRunGraph,
    ) => Promise<LifecycleRunGraph>,
  ): Promise<LifecycleRunGraph> {
    const result = await this.persistence.transaction(async (unitOfWork) => {
      const graph = await unitOfWork.readRunGraph(runId);
      if (graph === null) {
        throw notFound();
      }
      return operation(unitOfWork, graph);
    });
    return sortedGraph(result);
  }

  private requireTicket(graph: LifecycleRunGraph, ticketId: string): TicketV1 {
    const ticket = graph.tickets.find((candidate) => candidate.id === ticketId);
    if (ticket === undefined || ticket.run_id !== graph.run.id) {
      throw notFound();
    }
    return ticket;
  }

  private replaceTicket(
    graph: LifecycleRunGraph,
    ticket: TicketV1,
  ): LifecycleRunGraph {
    return {
      ...graph,
      tickets: graph.tickets.map((candidate) =>
        candidate.id === ticket.id ? ticket : candidate,
      ),
    };
  }

  private statusMutation(
    aggregateType: "assignment" | "run" | "ticket",
    record: AgentAssignmentV1 | RunV1 | TicketV1,
    from: string,
  ): AggregateMutation {
    return {
      aggregateType,
      record,
      eventName: `${aggregateType}.status_changed`,
      payload: statusPayload(from, record.status),
    } as AggregateMutation;
  }

  private async writeEvents(
    unitOfWork: LifecycleUnitOfWork,
    mutations: readonly AggregateMutation[],
    occurredAt: string,
  ): Promise<void> {
    const ordered = [...mutations].sort(
      (left, right) =>
        compareStrings(left.aggregateType, right.aggregateType) ||
        compareStrings(left.record.id, right.record.id),
    );
    for (const mutation of ordered) {
      const record: LifecycleOutboxRecord = Object.freeze({
        schema_version: 1,
        event_id: this.nextIdentifier(),
        aggregate_type: mutation.aggregateType,
        aggregate_id: mutation.record.id,
        run_id:
          mutation.aggregateType === "run"
            ? mutation.record.id
            : "run_id" in mutation.record
              ? mutation.record.run_id
              : mutation.record.id,
        event_name: mutation.eventName,
        occurred_at: occurredAt,
        payload: mutation.payload,
      });
      await unitOfWork.insertOutbox(record);
    }
  }
}
