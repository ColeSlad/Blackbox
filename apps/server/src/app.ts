import { timingSafeEqual } from "node:crypto";

import {
  APPLICATION_ERROR_CODES,
  ApplicationError,
  deferred,
  type LifecycleService,
} from "@blackbox/application";
import { safePersistenceError } from "@blackbox/persistence";
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

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get("/version", async () => ({ version: packageMetadata.version }));

  if (options.close !== undefined) {
    server.addHook("onClose", options.close);
  }

  if (options.lifecycle === undefined) {
    if (options.bearerToken !== undefined) {
      throw new Error("Lifecycle service configuration is incomplete.");
    }
    return server;
  }
  if (options.bearerToken === undefined || !/\S/.test(options.bearerToken)) {
    throw new Error("A local lifecycle bearer token must be configured.");
  }

  const lifecycle = options.lifecycle;
  const authenticate = authorizationHook(options.bearerToken);
  const routeOptions = { onRequest: authenticate };

  server.post("/v1/runs", routeOptions, async (request, reply) =>
    reply.code(201).send(await lifecycle.createRun(request.body)),
  );
  server.get<{ Params: RunParams }>(
    "/v1/runs/:runId",
    routeOptions,
    async (request) => lifecycle.inspectRun(request.params.runId),
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/start",
    routeOptions,
    async (request) => lifecycle.startRun(request.params.runId),
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/ready",
    routeOptions,
    async (request) =>
      lifecycle.readyTicket(request.params.runId, request.params.ticketId),
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments",
    routeOptions,
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await lifecycle.reserveAssignment(
            request.params.runId,
            request.params.ticketId,
            request.body,
          ),
        ),
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/block",
    routeOptions,
    async (request) =>
      lifecycle.blockTicket(request.params.runId, request.params.ticketId),
  );
  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/cancel",
    routeOptions,
    async (request) =>
      lifecycle.cancelTicket(request.params.runId, request.params.ticketId),
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/fail",
    routeOptions,
    async (request) => lifecycle.failRun(request.params.runId),
  );
  server.post<{ Params: RunParams }>(
    "/v1/runs/:runId/cancel",
    routeOptions,
    async (request) => lifecycle.cancelRun(request.params.runId),
  );

  server.post<{ Params: TicketParams }>(
    "/v1/runs/:runId/tickets/:ticketId/start",
    routeOptions,
    async () => {
      throw deferred();
    },
  );
  server.post<{ Params: AssignmentParams }>(
    "/v1/runs/:runId/tickets/:ticketId/assignments/:assignmentId/activate",
    routeOptions,
    async () => {
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
