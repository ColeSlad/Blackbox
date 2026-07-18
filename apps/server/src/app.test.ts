import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./app.js";

const openServers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(async (server) => server.close()),
  );
});

describe("GET /version", () => {
  it("reports the server package version", async () => {
    const server = buildServer();
    openServers.push(server);

    const response = await server.inject({ method: "GET", url: "/version" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: "0.1.0" });
  });
});
