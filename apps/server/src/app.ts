import Fastify, { type FastifyInstance } from "fastify";

import packageMetadata from "../package.json" with { type: "json" };

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get("/version", async () => ({ version: packageMetadata.version }));

  return server;
}
