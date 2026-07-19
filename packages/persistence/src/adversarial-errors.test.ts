import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "./commands/output.js";
import {
  PERSISTENCE_ERROR_CODES,
  PersistenceError,
  queryError,
} from "./errors.js";
import { getMigrationStatus } from "./migrator.js";
import type { DatabaseSql } from "./postgres/client.js";
import { createPostgresRepositories } from "./postgres/repositories.js";

const secret = "hostile-proxy-secret";
const originalExitCode = process.exitCode;

type HostileTrap = "get" | "getPrototypeOf" | "has";

function hostileValue(trap: HostileTrap): object {
  const handler: ProxyHandler<object> = {};
  handler[trap] = () => {
    throw new Error(secret);
  };
  return new Proxy(Object.create(null) as object, handler);
}

function throwingSql(value: unknown): DatabaseSql {
  return (() => {
    throw value;
  }) as unknown as DatabaseSql;
}

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe.each<HostileTrap>(["getPrototypeOf", "has", "get"])(
  "hostile %s trap",
  (trap) => {
    it("cannot escape or leak through command output", async () => {
      const output: string[] = [];
      vi.spyOn(console, "error").mockImplementation((message: unknown) => {
        output.push(String(message));
      });

      await runCommand(async () => {
        throw hostileValue(trap);
      });

      expect(output).toEqual([
        "PERSISTENCE_COMMAND_FAILED: Database command failed.",
      ]);
      expect(output.join("\n")).not.toContain(secret);
      expect(process.exitCode).toBe(1);
    });

    it("cannot escape or leak through migration normalization", async () => {
      const operation = getMigrationStatus(throwingSql(hostileValue(trap)));
      await expect(operation).rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.QUERY_FAILED,
        message: "Database operation failed.",
      });
      await expect(operation).rejects.not.toThrow(secret);
    });

    it("cannot escape or leak through repository normalization", async () => {
      const repositories = createPostgresRepositories(
        throwingSql(hostileValue(trap)),
      );
      const operation = repositories.runs.read(
        "10000000-0000-4000-8000-000000000001",
      );
      await expect(operation).rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.QUERY_FAILED,
        message: "Database operation failed.",
      });
      await expect(operation).rejects.not.toThrow(secret);
    });
  },
);

describe("trusted persistence errors", () => {
  it("preserves internally created stable errors", async () => {
    const output: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    await runCommand(async () => {
      throw queryError();
    });
    expect(output).toEqual([
      "PERSISTENCE_QUERY_FAILED: Database operation failed.",
    ]);
  });

  it("does not trust attacker-created class instances", async () => {
    const output: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    await runCommand(async () => {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.QUERY_FAILED, secret);
    });
    expect(output).toEqual([
      "PERSISTENCE_COMMAND_FAILED: Database command failed.",
    ]);
    expect(output.join("\n")).not.toContain(secret);
  });
});
