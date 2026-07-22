import { timingSafeEqual } from "node:crypto";

import {
  APPLICATION_ERROR_CODES,
  ApplicationError,
  deferred,
  invalidInput,
  parseCreateRunInput,
  parseReserveAssignmentInput,
  type LifecycleService,
} from "@blackbox/application";
import { safePersistenceError } from "@blackbox/persistence";
import {
  safeWorktreeError,
  type AssignmentWorktreeV1,
  type WorktreeManager,
} from "@blackbox/worktrees";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import packageMetadata from "../package.json" with { type: "json" };

export interface ServerOptions {
  readonly lifecycle?: Pick<
    LifecycleService,
    | "blockTicket"
    | "cancelRun"
    | "cancelTicket"
    | "createRun"
    | "failRun"
    | "inspectRun"
    | "readyTicket"
    | "reserveAssignment"
    | "startRun"
    | "startTicketAssignment"
  >;
  readonly worktrees?: Pick<
    WorktreeManager,
    | "cleanup"
    | "inspect"
    | "patch"
    | "provision"
    | "releaseRetention"
    | "retain"
  >;
  readonly bearerToken?: string;
  readonly close?: () => Promise<void>;
}

interface RunParams {
  runId: string;
}

interface TicketParams extends RunParams {
  ticketId: string;
}

interface AssignmentParams extends TicketParams {
  assignmentId: string;
}

type PublicAssignmentWorktreeV1 = Readonly<
  Pick<
    AssignmentWorktreeV1,
    | "schema_version"
    | "id"
    | "repository_id"
    | "run_id"
    | "ticket_id"
    | "assignment_id"
    | "base_commit_sha"
    | "status"
    | "retention_status"
    | "created_at"
    | "updated_at"
    | "activated_at"
    | "removed_at"
  >
>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function authorizationHook(token: string) {
  const expected = `Bearer ${token}`;
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !tokenMatches(authorization, expected)
    ) {
      await reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid local bearer token is required.",
        },
      });
    }
  };
}

function statusForApplicationError(error: ApplicationError): number {
  switch (error.code) {
    case APPLICATION_ERROR_CODES.INVALID_INPUT:
      return 400;
    case APPLICATION_ERROR_CODES.NOT_FOUND:
      return 404;
    case APPLICATION_ERROR_CODES.CONFLICT:
    case APPLICATION_ERROR_CODES.INVALID_TRANSITION:
    case APPLICATION_ERROR_CODES.DEFERRED:
      return 409;
  }
}

function isMalformedRequest(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "statusCode") === 400
    );
  } catch {
    return false;
  }
}

function requireEmptyBody(body: unknown): void {
  if (body !== undefined && body !== null) {
    throw invalidInput();
  }
}

function requireRunIdentifier(params: RunParams): void {
  if (!UUID_PATTERN.test(params.runId)) {
    throw invalidInput();
  }
}

function requireTicketIdentifiers(params: TicketParams): void {
  requireRunIdentifier(params);
  if (!UUID_PATTERN.test(params.ticketId)) {
    throw invalidInput();
  }
}

function requireAssignmentIdentifiers(params: AssignmentParams): void {
  requireTicketIdentifiers(params);
  if (!UUID_PATTERN.test(params.assignmentId)) {
    throw invalidInput();
  }
}

function publicWorktree(
  record: AssignmentWorktreeV1,
): PublicAssignmentWorktreeV1 {
  return Object.freeze({
    schema_version: record.schema_version,
    id: record.id,
    repository_id: record.repository_id,
    run_id: record.run_id,
    ticket_id: record.ticket_id,
    assignment_id: record.assignment_id,
    base_commit_sha: record.base_commit_sha,
    status: record.status,
    retention_status: record.retention_status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    activated_at: record.activated_at,
    removed_at: record.removed_at,
  });
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get("/version", async () => ({ version: packageMetadata.version }));

  if (options.close !== undefined) {
    server.addHook("onClose", options.close);
  }

  if (options.lifecycle === undefined && options.worktrees === undefined) {
    if (options.bearerToken !== undefined) {
      throw new Error("Lifecycle service configuration is incomplete.");
    }
    return server;
  }
  if (options.bearerToken === undefined || !/\S/.test(options.bearerToken)) {
    throw new Error("A local lifecycle bearer token must be configured.");
  }

  if (options.lifecycle === undefined || options.worktrees === undefined) {
    throw new Error(
      "Lifecycle and worktree service configuration is incomplete.",
    );
  }
  const lifecycle = options.lifecycle;
  const worktrees = options.worktrees;
  const authenticate = authorizationHook(options.bearerToken);
  const routeOptions = { onRequest: authenticate };

  server.post("/v1/runs", routeOptions, async (request, reply) => {
    const input = parseCreateRunInput(request.body);
    return reply.code(201).send(await lifecycle.createRun(input));
  });
  server.get<{ Params: RunParams }>(
    "/v1/runs/:runId",
    routeOptions,
    async (request) => {
      requireRunIdentifier(request.params);
      return lifecycle.inspectRun(request.params.runId);
    },
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/start",
    routeOptions,
    async (request) => {
      requireRunIdentifier(request.params);
      return lifecycle.startRun(request.params.runId);
    },
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/ready",
    routeOptions,
    async (request) => {
      requireTicketIdentifiers(request.params);
      return lifecycle.readyTicket(
        request.params.runId,
        request.params.ticketId,
      );
    },
  );
  server.post<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/worktree/provision",
    routeOptions,
    async (request, reply) => {
      requireAssignmentIdentifiers(request.params);
      requireEmptyBody(request.body);
      const graph = await lifecycle.inspectRun(request.params.runId);
      return reply
        .code(201)
        .send(
          publicWorktree(
            await worktrees.provision(
              graph.run.repository_id,
              request.params.runId,
              request.params.ticketId,
              request.params.assignmentId,
            ),
          ),
        );
    },
  );
  server.get<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/worktree",
    routeOptions,
    async (request) => {
      requireAssignmentIdentifiers(request.params);
      const result = await worktrees.inspect(
        request.params.runId,
        request.params.ticketId,
        request.params.assignmentId,
      );
      return {
        worktree: publicWorktree(result.worktree),
        head_commit_sha: result.head_commit_sha,
        clean: result.clean,
        changed_paths: result.changed_paths,
      };
    },
  );
  server.get<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/worktree/patch",
    routeOptions,
    async (request) => {
      requireAssignmentIdentifiers(request.params);
      const result = await worktrees.patch(
        request.params.runId,
        request.params.ticketId,
        request.params.assignmentId,
      );
      return {
        worktree: publicWorktree(result.worktree),
        head_commit_sha: result.head_commit_sha,
        clean: result.clean,
        changed_paths: result.changed_paths,
        patch: {
          base_commit_sha: result.patch.baseCommitSha,
          sha256: result.patch.sha256,
          bytes_base64: Buffer.from(result.patch.bytes).toString("base64"),
        },
      };
    },
  );
  for (const [suffix, operation] of [
    ["retain", worktrees.retain.bind(worktrees)],
    ["release-retention", worktrees.releaseRetention.bind(worktrees)],
    ["cleanup", worktrees.cleanup.bind(worktrees)],
  ] as const) {
    server.post<{ Params: AssignmentParams }>(
      `/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/worktree/${suffix}`,
      routeOptions,
      async (request) => {
        requireAssignmentIdentifiers(request.params);
        requireEmptyBody(request.body);
        return publicWorktree(
          await operation(
            request.params.runId,
            request.params.ticketId,
            request.params.assignmentId,
          ),
        );
      },
    );
  }
  server.post<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/start",
    routeOptions,
    async (request) => {
      requireAssignmentIdentifiers(request.params);
      requireEmptyBody(request.body);
      return lifecycle.startTicketAssignment(
        request.params.runId,
        request.params.ticketId,
        request.params.assignmentId,
      );
    },
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments",
    routeOptions,
    async (request, reply) => {
      requireTicketIdentifiers(request.params);
      const input = parseReserveAssignmentInput(request.body);
      return reply
        .code(201)
        .send(
          await lifecycle.reserveAssignment(
            request.params.runId,
            request.params.ticketId,
            input,
          ),
        );
    },
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/block",
    routeOptions,
    async (request) => {
      requireTicketIdentifiers(request.params);
      return lifecycle.blockTicket(
        request.params.runId,
        request.params.ticketId,
      );
    },
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/cancel",
    routeOptions,
    async (request) => {
      requireTicketIdentifiers(request.params);
      return lifecycle.cancelTicket(
        request.params.runId,
        request.params.ticketId,
      );
    },
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/fail",
    routeOptions,
    async (request) => {
      requireRunIdentifier(request.params);
      return lifecycle.failRun(request.params.runId);
    },
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/cancel",
    routeOptions,
    async (request) => {
      requireRunIdentifier(request.params);
      return lifecycle.cancelRun(request.params.runId);
    },
  );

  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/start",
    routeOptions,
    async (request) => {
      requireTicketIdentifiers(request.params);
      throw deferred();
    },
  );
  server.post<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/activate",
    routeOptions,
    async (request) => {
      requireAssignmentIdentifiers(request.params);
      throw deferred();
    },
  );

  server.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ApplicationError) {
      await reply.code(statusForApplicationError(error)).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    const persistenceError = safePersistenceError(error);
    if (persistenceError !== undefined) {
      await reply.code(500).send({ error: persistenceError });
      return;
    }
    const worktreeError = safeWorktreeError(error);
    if (worktreeError !== undefined) {
      const statusCode =
        worktreeError.code === "WORKTREE_NOT_FOUND"
          ? 404
          : worktreeError.code === "WORKTREE_INVALID_INPUT"
            ? 400
            : 409;
      await reply.code(statusCode).send({ error: worktreeError });
      return;
    }
    if (isMalformedRequest(error)) {
      await reply.code(400).send({
        error: {
          code: APPLICATION_ERROR_CODES.INVALID_INPUT,
          message: "The request is invalid.",
        },
      });
      return;
    }
    await reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The lifecycle request could not be completed.",
      },
    });
  });

  return server;
}
