import { expect, it } from "vitest";

import { PERSISTENCE_ERROR_CODES } from "../errors.js";
import { connectPostgres } from "./client.js";

it("sanitizes malformed credential-bearing client construction failures", async () => {
  const malformedUrl =
    "postgres://visible-user:visible-password@%zz/visible-database";
  let captured: unknown;
  try {
    await connectPostgres(malformedUrl);
  } catch (error) {
    captured = error;
  }
  expect(captured).toMatchObject({
    code: PERSISTENCE_ERROR_CODES.CONNECTION_FAILED,
    message: "Database connection failed.",
  });
  expect(String(captured)).not.toContain("visible-user");
  expect(String(captured)).not.toContain("visible-password");
  expect(String(captured)).not.toContain("visible-database");
});
