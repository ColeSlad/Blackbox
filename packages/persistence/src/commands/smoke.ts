import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type {
  AgentAssignmentV1,
  IntentContractV1,
  RunV1,
  TicketV1,
  TransactionV1,
} from "@blackbox/contracts";

import { assertLocalDatabaseUrl, readDatabaseConfig } from "../config.js";
import { createPostgresPersistence } from "../postgres/index.js";
import { runCommand } from "./output.js";

await runCommand(async () => {
  const config = readDatabaseConfig();
  assertLocalDatabaseUrl(config.url);
  const persistence = await createPostgresPersistence(config.url);
  const createdAt = new Date().toISOString();
  const runId = randomUUID();
  const ticketId = randomUUID();
  const assignmentId = randomUUID();
  const intentId = randomUUID();
  const run: RunV1 = {
    schema_version: 1,
    id: runId,
    repository_id: randomUUID(),
    title: "Persistence smoke run",
    base_commit_sha: "a".repeat(40),
    status: "created",
    configuration_version: 1,
    created_at: createdAt,
    started_at: null,
    completed_at: null,
  };
  const ticket: TicketV1 = {
    schema_version: 1,
    id: ticketId,
    run_id: runId,
    external_key: `smoke-${ticketId}`,
    title: "Persistence smoke ticket",
    description: "Checks create and read persistence boundaries.",
    status: "pending",
    dependencies: [],
    acceptance_criteria: ["Every record round trips."],
    manual_verification_steps: ["Inspect the sanitized summary."],
  };
  const assignment: AgentAssignmentV1 = {
    schema_version: 1,
    id: assignmentId,
    run_id: runId,
    ticket_id: ticketId,
    agent_id: randomUUID(),
    worktree_id: null,
    status: "assigned",
    assigned_at: createdAt,
    released_at: null,
  };
  const intent: IntentContractV1 = {
    schema_version: 1,
    id: intentId,
    assignment_id: assignmentId,
    version: 1,
    goal: "Verify repository round trips.",
    reads: [],
    writes: [],
    assumptions: [],
    public_contract_changes: [],
    required_validations: ["database-smoke"],
    declared_effects: [],
    created_at: createdAt,
  };
  const transaction: TransactionV1 = {
    schema_version: 1,
    id: randomUUID(),
    run_id: runId,
    ticket_id: ticketId,
    assignment_id: assignmentId,
    intent_contract_id: intentId,
    intent_version: 1,
    base_commit_sha: "a".repeat(40),
    prepared_patch_hash: null,
    status: "declared",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
  };

  try {
    const repositories = persistence.repositories;
    await repositories.runs.create(run);
    await repositories.tickets.create(ticket);
    await repositories.assignments.create(assignment);
    await repositories.intents.create(intent);
    await repositories.transactions.create(transaction);
    assert.deepEqual(await repositories.runs.read(run.id), run);
    assert.deepEqual(await repositories.tickets.read(ticket.id), ticket);
    assert.deepEqual(
      await repositories.assignments.read(assignment.id),
      assignment,
    );
    assert.deepEqual(await repositories.intents.read(intent.id), intent);
    assert.deepEqual(
      await repositories.transactions.read(transaction.id),
      transaction,
    );
  } finally {
    await persistence.close();
  }
  console.log(
    "Database smoke passed: run=1 ticket=1 assignment=1 intent=1 transaction=1.",
  );
});
