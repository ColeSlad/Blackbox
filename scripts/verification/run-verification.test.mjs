import { describe, expect, it } from "vitest";

import { runVerification, verificationGates } from "./run-verification.mjs";

function createExecutor(attemptedGates, failure) {
  return (command, arguments_, options) => {
    expect(command).toBe("pnpm");
    expect(arguments_).toHaveLength(2);
    expect(arguments_[0]).toBe("run");
    expect(options).toEqual({ shell: false, stdio: "inherit" });

    const gate = arguments_[1];
    attemptedGates.push(gate);

    return {
      status: gate === failure?.gate ? failure.status : 0,
    };
  };
}

describe("verification runner", () => {
  it("runs every gate once in order when all gates succeed", () => {
    const attemptedGates = [];

    const status = runVerification(createExecutor(attemptedGates));

    expect(status).toBe(0);
    expect(attemptedGates).toEqual(verificationGates);
  });

  it.each(
    verificationGates.map((gate, gateIndex) => ({
      gate,
      gateIndex,
      sentinelStatus: 40 + gateIndex,
    })),
  )(
    "preserves a $gate failure and skips every later gate",
    ({ gate, gateIndex, sentinelStatus }) => {
      const attemptedGates = [];

      const status = runVerification(
        createExecutor(attemptedGates, { gate, status: sentinelStatus }),
      );

      expect(status).toBe(sentinelStatus);
      expect(attemptedGates).toEqual(verificationGates.slice(0, gateIndex + 1));
    },
  );
});
