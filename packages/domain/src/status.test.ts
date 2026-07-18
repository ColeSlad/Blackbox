import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  ERROR_CODES,
  InvalidSchemaError,
  InvalidStateTransitionError,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  TICKET_STATUSES,
  TICKET_TRANSITIONS,
  TRANSACTION_STATUSES,
  TRANSACTION_TRANSITIONS,
  transitionAssignmentStatus,
  transitionRunStatus,
  transitionTicketStatus,
  transitionTransactionStatus,
  type AssignmentStatus,
  type RunStatus,
  type TicketStatus,
  type TransactionStatus,
} from "./index.js";

type TransitionCase<State extends string> = {
  states: readonly State[];
  transitions: Readonly<Record<State, readonly State[]>>;
  transition: (currentState: unknown, targetState: unknown) => State;
};

function describeTransitionMatrix<State extends string>(
  name: string,
  testCase: TransitionCase<State>,
): void {
  describe(`${name} lifecycle transitions`, () => {
    for (const currentState of testCase.states) {
      for (const targetState of testCase.states) {
        it(`${currentState} -> ${targetState} matches the frozen transition table`, () => {
          if (testCase.transitions[currentState].includes(targetState)) {
            expect(testCase.transition(currentState, targetState)).toBe(
              targetState,
            );
          } else {
            expect(() =>
              testCase.transition(currentState, targetState),
            ).toThrowError(InvalidStateTransitionError);
          }
        });
      }
    }

    it("rejects unknown current and target states through runtime parsing", () => {
      for (const [currentState, targetState, expectedPath] of [
        ["unknown", testCase.states[0], "current_state"],
        [testCase.states[0], "unknown", "target_state"],
      ] as const) {
        try {
          testCase.transition(currentState, targetState);
          expect.unreachable("unknown state should fail");
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidSchemaError);
          expect(error).toMatchObject({
            code: ERROR_CODES.invalidSchema,
            issuePaths: [[expectedPath]],
          });
        }
      }
    });

    it("exports deeply frozen vocabularies and transition tables", () => {
      expect(Object.isFrozen(testCase.states)).toBe(true);
      expect(Object.isFrozen(testCase.transitions)).toBe(true);
      for (const targets of Object.values(testCase.transitions)) {
        expect(Object.isFrozen(targets)).toBe(true);
      }
    });
  });
}

describeTransitionMatrix<RunStatus>("run", {
  states: RUN_STATUSES,
  transitions: RUN_TRANSITIONS,
  transition: transitionRunStatus,
});
describeTransitionMatrix<TicketStatus>("ticket", {
  states: TICKET_STATUSES,
  transitions: TICKET_TRANSITIONS,
  transition: transitionTicketStatus,
});
describeTransitionMatrix<AssignmentStatus>("assignment", {
  states: ASSIGNMENT_STATUSES,
  transitions: ASSIGNMENT_TRANSITIONS,
  transition: transitionAssignmentStatus,
});
describeTransitionMatrix<TransactionStatus>("transaction", {
  states: TRANSACTION_STATUSES,
  transitions: TRANSACTION_TRANSITIONS,
  transition: transitionTransactionStatus,
});

describe("domain errors", () => {
  it("does not retain external payloads in stable errors", () => {
    const externalPayload = { secret: "do-not-retain" };
    let caught: unknown;
    try {
      transitionRunStatus(externalPayload, "running");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidSchemaError);
    expect(JSON.stringify(caught)).not.toContain("do-not-retain");
  });
});
