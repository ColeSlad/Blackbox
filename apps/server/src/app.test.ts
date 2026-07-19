import { conflict, notFound } from "@blackbox/application";
import { queryError } from "@blackbox/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer, type ServerOptions } from "./app.js";

const token = "disposable-local-token";
const runId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";
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
  const server = buildServer({ lifecycle: application, bearerToken: token });
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
      ["POST", "/v1/runs", { title: "input" }, 201],
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
    expect(application.createRun).toHaveBeenCalledWith({ title: "input" });
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

  it("requires complete local lifecycle configuration", () => {
    expect(() => buildServer({ lifecycle: lifecycle() })).toThrow(
      "bearer token",
    );
  });
});
