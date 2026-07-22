import {
  APPLICATION_ERROR_CODES,
  conflict,
  notFound,
} from "@blackbox/application";
import { queryError } from "@blackbox/persistence";
import { WORKTREE_ERROR_CODES, worktreeError } from "@blackbox/worktrees";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer, type ServerOptions } from "./app.js";

const token = "disposable-local-token";
const runId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";
const uppercaseId = "AAAAAAAA-0000-4000-8000-000000000001";
const createRunBody = {
  repository_id: "10000000-0000-4000-8000-000000000001",
  title: "Run",
  base_commit_sha: "a".repeat(40),
  configuration_version: 1,
  tickets: [
    {
      external_key: "T0001",
      title: "Ticket",
      description: "Description",
      dependencies: [],
      acceptance_criteria: ["Pass"],
      manual_verification_steps: ["Inspect"],
    },
  ],
};
const graph = {
  run: {
    schema_version: 1 as const,
    id: runId,
    repository_id: "10000000-0000-4000-8000-000000000001",
    title: "Run",
    base_commit_sha: "a".repeat(40),
    status: "created" as const,
    configuration_version: 1,
    created_at: "2026-07-19T20:00:00.000Z",
    started_at: null,
    completed_at: null,
  },
  tickets: [],
  assignments: [],
};

const internalWorktree = {
  schema_version: 1 as const,
  id: "00000000-0000-4000-8000-000000000004",
  repository_id: graph.run.repository_id,
  run_id: runId,
  ticket_id: ticketId,
  assignment_id: assignmentId,
  working_tree_root: "/canonical/repository",
  common_git_directory: "/canonical/repository/.git",
  default_branch: "main",
  base_commit_sha: "a".repeat(40),
  managed_path: "/canonical/managed/worktree",
  branch_name: `blackbox/worktree/${runId}/${ticketId}/${assignmentId}`,
  status: "active" as const,
  retention_status: "releasable" as const,
  operation_token: "00000000-0000-4000-8000-000000000005",
  operation_stage: "active" as const,
  failure_disposition: "none" as const,
  created_at: "2026-07-19T20:00:00.000Z",
  updated_at: "2026-07-19T20:00:00.000Z",
  activated_at: "2026-07-19T20:00:00.000Z",
  removed_at: null,
};

function worktrees() {
  return {
    provision: vi.fn().mockResolvedValue(internalWorktree),
    inspect: vi.fn().mockResolvedValue({
      worktree: internalWorktree,
      head_commit_sha: "a".repeat(40),
      clean: true,
      changed_paths: [],
    }),
    patch: vi.fn().mockResolvedValue({
      worktree: internalWorktree,
      head_commit_sha: "a".repeat(40),
      clean: true,
      changed_paths: [],
      patch: {
        baseCommitSha: "a".repeat(40),
        sha256: `sha256:${"b".repeat(64)}`,
        bytes: Uint8Array.from([1, 2, 3]),
      },
    }),
    retain: vi.fn().mockResolvedValue(internalWorktree),
    releaseRetention: vi.fn().mockResolvedValue(internalWorktree),
    cleanup: vi.fn().mockResolvedValue(internalWorktree),
  };
}

type LifecycleApplication = NonNullable<ServerOptions["lifecycle"]>;

function lifecycle(
  overrides: Partial<LifecycleApplication> = {},
): LifecycleApplication {
  return {
    createRun: vi.fn().mockResolvedValue(graph),
    inspectRun: vi.fn().mockResolvedValue(graph),
    startRun: vi.fn().mockResolvedValue(graph),
    readyTicket: vi.fn().mockResolvedValue(graph),
    reserveAssignment: vi.fn().mockResolvedValue(graph),
    blockTicket: vi.fn().mockResolvedValue(graph),
    cancelTicket: vi.fn().mockResolvedValue(graph),
    failRun: vi.fn().mockResolvedValue(graph),
    cancelRun: vi.fn().mockResolvedValue(graph),
    startTicketAssignment: vi.fn().mockResolvedValue(graph),
    ...overrides,
  } as LifecycleApplication;
}

const openServers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(async (server) => server.close()),
  );
});

function serverWith(application = lifecycle()) {
  const server = buildServer({
    lifecycle: application,
    worktrees: worktrees(),
    bearerToken: token,
  });
  openServers.push(server);
  return server;
}

describe("server lifecycle API", () => {
  it("keeps GET /version public", async () => {
    const server = buildServer();
    openServers.push(server);
    const response = await server.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: "0.1.0" });
  });

  it.each([
    ["POST", "/v1/runs"],
    ["GET", `/v1/runs/${runId}`],
    ["POST", `/v1/runs/${runId}/start`],
    ["POST", `/v1/runs/${runId}/tickets/${ticketId}/ready`],
    ["POST", `/v1/runs/${runId}/tickets/${ticketId}/assignments`],
    ["POST", `/v1/runs/${runId}/tickets/${ticketId}/block`],
    ["POST", `/v1/runs/${runId}/tickets/${ticketId}/cancel`],
    ["POST", `/v1/runs/${runId}/fail`],
    ["POST", `/v1/runs/${runId}/cancel`],
    [
      "POST",
      `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}/worktree/provision`,
    ],
    [
      "GET",
      `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}/worktree`,
    ],
    [
      "POST",
      `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}/start`,
    ],
  ])("rejects unauthenticated %s %s", async (method, url) => {
    const server = serverWith();
    const response = await server.inject({
      method: method as "GET" | "POST",
      url,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid local bearer token is required.",
      },
    });
  });

  it("rejects an incorrect token without exposing either token", async () => {
    const server = serverWith();
    const response = await server.inject({
      method: "GET",
      url: `/v1/runs/${runId}`,
      headers: { authorization: "Bearer incorrect-secret" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain("incorrect-secret");
  });

  it("routes authenticated create and lifecycle commands", async () => {
    const application = lifecycle();
    const server = serverWith(application);
    const headers = { authorization: `Bearer ${token}` };
    const requests = [
      ["POST", "/v1/runs", createRunBody, 201],
      ["GET", `/v1/runs/${runId}`, undefined, 200],
      ["POST", `/v1/runs/${runId}/start`, undefined, 200],
      ["POST", `/v1/runs/${runId}/tickets/${ticketId}/ready`, undefined, 200],
      [
        "POST",
        `/v1/runs/${runId}/tickets/${ticketId}/assignments`,
        { agent_id: assignmentId },
        201,
      ],
      ["POST", `/v1/runs/${runId}/tickets/${ticketId}/block`, undefined, 200],
      ["POST", `/v1/runs/${runId}/tickets/${ticketId}/cancel`, undefined, 200],
      ["POST", `/v1/runs/${runId}/fail`, undefined, 200],
      ["POST", `/v1/runs/${runId}/cancel`, undefined, 200],
    ] as const;
    for (const [method, url, payload, statusCode] of requests) {
      const response = await server.inject({
        method,
        url,
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual(graph);
    }
    expect(application.createRun).toHaveBeenCalledWith(createRunBody);
    expect(application.reserveAssignment).toHaveBeenCalledWith(
      runId,
      ticketId,
      { agent_id: assignmentId },
    );
  });

  it("returns sanitized not-found, conflict, malformed, and persistence errors", async () => {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const cases = [
      [notFound(), 404, "NOT_FOUND"],
      [conflict("The request conflicts with current state."), 409, "CONFLICT"],
      [queryError(), 500, "PERSISTENCE_QUERY_FAILED"],
    ] as const;
    for (const [error, statusCode, code] of cases) {
      const server = serverWith(
        lifecycle({ inspectRun: vi.fn().mockRejectedValue(error) }),
      );
      const response = await server.inject({
        method: "GET",
        url: `/v1/runs/${runId}`,
        headers,
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json().error.code).toBe(code);
      expect(response.body).not.toMatch(/SELECT|stack|password|token/i);
    }

    const server = serverWith();
    const malformed = await server.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("INVALID_INPUT");
  });

  it("explicitly refuses ticket start and assignment activation", async () => {
    const server = serverWith();
    const headers = { authorization: `Bearer ${token}` };
    for (const url of [
      `/v1/runs/${runId}/tickets/${ticketId}/start`,
      `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}/activate`,
    ]) {
      const response = await server.inject({ method: "POST", url, headers });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("DEFERRED");
    }
  });

  it("routes assignment-bound worktree operations without caller paths, refs, bases, or tokens", async () => {
    const application = lifecycle();
    const manager = worktrees();
    const server = buildServer({
      lifecycle: application,
      worktrees: manager,
      bearerToken: token,
    });
    openServers.push(server);
    const headers = { authorization: `Bearer ${token}` };
    const root = `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}`;
    const cases = [
      ["POST", `${root}/worktree/provision`, 201],
      ["GET", `${root}/worktree`, 200],
      ["GET", `${root}/worktree/patch`, 200],
      ["POST", `${root}/worktree/retain`, 200],
      ["POST", `${root}/worktree/release-retention`, 200],
      ["POST", `${root}/worktree/cleanup`, 200],
      ["POST", `${root}/start`, 200],
    ] as const;
    for (const [method, url, statusCode] of cases) {
      const response = await server.inject({ method, url, headers });
      expect(response.statusCode).toBe(statusCode);
      expect(response.body).not.toContain(internalWorktree.operation_token);
      expect(response.body).not.toContain(internalWorktree.managed_path);
      expect(response.body).not.toContain(internalWorktree.working_tree_root);
      expect(response.body).not.toContain(
        internalWorktree.common_git_directory,
      );
      expect(response.body).not.toMatch(
        /operation_token|operation_stage|failure_disposition|working_tree_root|common_git_directory|managed_path|default_branch|branch_name/,
      );
    }
    expect(manager.provision).toHaveBeenCalledWith(
      graph.run.repository_id,
      runId,
      ticketId,
      assignmentId,
    );
    expect(application.startTicketAssignment).toHaveBeenCalledWith(
      runId,
      ticketId,
      assignmentId,
    );
    const patch = await server.inject({
      method: "GET",
      url: `${root}/worktree/patch`,
      headers,
    });
    expect(patch.json().patch).toEqual({
      base_commit_sha: "a".repeat(40),
      sha256: `sha256:${"b".repeat(64)}`,
      bytes_base64: "AQID",
    });
    const injected = await server.inject({
      method: "POST",
      url: `${root}/worktree/retain`,
      headers,
      payload: { path: "/caller", branch: "caller", operation_token: "x" },
    });
    expect(injected.statusCode).toBe(400);
    expect(manager.retain).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bad-run", ticketId, assignmentId],
    [runId, "bad-ticket", assignmentId],
    [runId, ticketId, "bad-assignment"],
    [uppercaseId, ticketId, assignmentId],
    [runId, uppercaseId, assignmentId],
    [runId, ticketId, uppercaseId],
  ])(
    "rejects malformed or noncanonical cleanup ownership before manager access",
    async (malformedRunId, malformedTicketId, malformedAssignmentId) => {
      const manager = worktrees();
      const server = buildServer({
        lifecycle: lifecycle(),
        worktrees: manager,
        bearerToken: token,
      });
      openServers.push(server);
      const response = await server.inject({
        method: "POST",
        url: `/v1/runs/${malformedRunId}/tickets/${malformedTicketId}/assignments/${malformedAssignmentId}/worktree/cleanup`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: APPLICATION_ERROR_CODES.INVALID_INPUT,
          message: "The request is invalid.",
        },
      });
      expect(manager.cleanup).not.toHaveBeenCalled();
    },
  );

  it("rejects uppercase lifecycle route identifiers before service access", async () => {
    const application = lifecycle();
    const server = buildServer({
      lifecycle: application,
      worktrees: worktrees(),
      bearerToken: token,
    });
    openServers.push(server);

    const response = await server.inject({
      method: "GET",
      url: `/v1/runs/${uppercaseId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(
      APPLICATION_ERROR_CODES.INVALID_INPUT,
    );
    expect(application.inspectRun).not.toHaveBeenCalled();
  });

  it("rejects uppercase lifecycle body identifiers before service access", async () => {
    const application = lifecycle();
    const server = buildServer({
      lifecycle: application,
      worktrees: worktrees(),
      bearerToken: token,
    });
    openServers.push(server);
    const headers = { authorization: `Bearer ${token}` };

    const runResponse = await server.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: { ...createRunBody, repository_id: uppercaseId },
    });
    expect(runResponse.statusCode).toBe(400);
    expect(runResponse.json().error.code).toBe(
      APPLICATION_ERROR_CODES.INVALID_INPUT,
    );
    expect(application.createRun).not.toHaveBeenCalled();

    const assignmentResponse = await server.inject({
      method: "POST",
      url: `/v1/runs/${runId}/tickets/${ticketId}/assignments`,
      headers,
      payload: { agent_id: uppercaseId },
    });
    expect(assignmentResponse.statusCode).toBe(400);
    expect(assignmentResponse.json().error.code).toBe(
      APPLICATION_ERROR_CODES.INVALID_INPUT,
    );
    expect(application.reserveAssignment).not.toHaveBeenCalled();
  });

  it("returns sanitized stable worktree errors", async () => {
    const manager = worktrees();
    manager.inspect.mockRejectedValue(
      worktreeError(WORKTREE_ERROR_CODES.BINDING_DRIFT),
    );
    const server = buildServer({
      lifecycle: lifecycle(),
      worktrees: manager,
      bearerToken: token,
    });
    openServers.push(server);
    const response = await server.inject({
      method: "GET",
      url: `/v1/runs/${runId}/tickets/${ticketId}/assignments/${assignmentId}/worktree`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: WORKTREE_ERROR_CODES.BINDING_DRIFT,
        message: "The repository binding identity has changed.",
      },
    });
    expect(response.body).not.toMatch(/stack|SELECT|operation_token/i);
  });

  it("requires complete local lifecycle configuration", () => {
    expect(() =>
      buildServer({ lifecycle: lifecycle(), worktrees: worktrees() }),
    ).toThrow("bearer token");
    expect(() =>
      buildServer({ lifecycle: lifecycle(), bearerToken: token }),
    ).toThrow("worktree service");
  });
});
