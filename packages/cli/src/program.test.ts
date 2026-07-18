import { describe, expect, it, vi } from "vitest";

import { runCli } from "./program.js";

describe("blackbox --version", () => {
  it("prints the CLI package version", () => {
    const writeOutput = vi.fn();

    expect(runCli(["--version"], writeOutput)).toBe(0);
    expect(writeOutput).toHaveBeenCalledWith("0.1.0");
  });
});
