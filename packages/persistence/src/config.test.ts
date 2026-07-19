import { describe, expect, it } from "vitest";

import {
  assertLocalDatabaseUrl,
  DEFAULT_DATABASE_URL,
  readDatabaseConfig,
} from "./config.js";
import { PERSISTENCE_ERROR_CODES, PersistenceError } from "./errors.js";

describe("database configuration", () => {
  it("provides the documented local-only default", () => {
    expect(readDatabaseConfig({}).url).toBe(DEFAULT_DATABASE_URL);
  });

  it.each([
    "not-a-url",
    "https://127.0.0.1/database",
    "postgres://127.0.0.1",
    "postgres://127.0.0.1/database#secret",
  ])("rejects invalid database configuration without retaining it", (url) => {
    let captured: unknown;
    try {
      readDatabaseConfig({ BLACKBOX_DATABASE_URL: url });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(PersistenceError);
    expect((captured as PersistenceError).code).toBe(
      PERSISTENCE_ERROR_CODES.CONFIGURATION_INVALID,
    );
    expect(String(captured)).not.toContain(url);
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "accepts the local database host %s",
    (host) => {
      expect(
        assertLocalDatabaseUrl(`postgres://user:pass@${host}:55432/blackbox`)
          .hostname,
      ).toBeTruthy();
    },
  );

  it("refuses remote hosts without exposing credentials", () => {
    const url = "postgres://visible-user:visible-password@db.example/blackbox";
    expect(() => assertLocalDatabaseUrl(url)).toThrowError(
      expect.objectContaining({
        code: PERSISTENCE_ERROR_CODES.CONFIGURATION_INVALID,
      }),
    );
    try {
      assertLocalDatabaseUrl(url);
    } catch (error) {
      expect(String(error)).not.toContain("visible-user");
      expect(String(error)).not.toContain("visible-password");
    }
  });
});
