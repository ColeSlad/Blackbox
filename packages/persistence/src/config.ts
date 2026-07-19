import { configurationError } from "./errors.js";

export const DEFAULT_DATABASE_URL =
  "postgres://blackbox:blackbox@127.0.0.1:55432/blackbox";

export interface DatabaseConfig {
  readonly url: string;
}

export function readDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const url = environment.BLACKBOX_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  validateDatabaseUrl(url);
  return Object.freeze({ url });
}

export function validateDatabaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError();
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname === "" ||
    parsed.pathname.length <= 1 ||
    parsed.pathname.slice(1).includes("/") ||
    parsed.hash !== ""
  ) {
    throw configurationError();
  }
  return parsed;
}

export function assertLocalDatabaseUrl(value: string): URL {
  const parsed = validateDatabaseUrl(value);
  if (!isLocalHostname(parsed.hostname)) {
    throw configurationError();
  }
  return parsed;
}

function isLocalHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    hostname.toLowerCase(),
  );
}
