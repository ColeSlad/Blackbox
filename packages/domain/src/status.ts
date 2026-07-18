import { InvalidSchemaError, InvalidStateTransitionError } from "./errors.js";

export const RUN_STATUSES = Object.freeze([
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const);

export const TICKET_STATUSES = Object.freeze([
  "pending",
  "ready",
  "running",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const);

export const ASSIGNMENT_STATUSES = Object.freeze([
  "assigned",
  "active",
  "released",
  "failed",
  "cancelled",
] as const);

export const TRANSACTION_STATUSES = Object.freeze([
  "declared",
  "admitted",
  "running",
  "prepared",
  "validating",
  "eligible",
  "committed",
  "rejected",
  "cancelled",
  "compensating",
  "compensated",
  "failed",
] as const);

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

type TransitionTable<State extends string> = Readonly<
  Record<State, readonly State[]>
>;

function freezeTransitions<State extends string>(
  transitions: Record<State, readonly State[]>,
): TransitionTable<State> {
  for (const targets of Object.values(transitions)) {
    Object.freeze(targets);
  }
  return Object.freeze(transitions);
}

export const RUN_TRANSITIONS = freezeTransitions<RunStatus>({
  created: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
});

export const TICKET_TRANSITIONS = freezeTransitions<TicketStatus>({
  pending: ["ready", "blocked", "cancelled"],
  ready: ["running", "blocked", "cancelled"],
  running: ["done", "blocked", "failed", "cancelled"],
  blocked: ["ready", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
});

export const ASSIGNMENT_TRANSITIONS = freezeTransitions<AssignmentStatus>({
  assigned: ["active", "failed", "cancelled"],
  active: ["released", "failed", "cancelled"],
  released: [],
  failed: [],
  cancelled: [],
});

export const TRANSACTION_TRANSITIONS = freezeTransitions<TransactionStatus>({
  declared: ["admitted", "rejected", "cancelled", "failed"],
  admitted: ["running", "rejected", "cancelled", "failed"],
  running: ["prepared", "rejected", "cancelled", "failed"],
  prepared: ["validating", "rejected", "cancelled", "failed"],
  validating: ["eligible", "rejected", "cancelled", "failed"],
  eligible: ["committed", "rejected", "cancelled", "failed"],
  committed: ["compensating"],
  rejected: [],
  cancelled: [],
  compensating: ["compensated", "failed"],
  compensated: [],
  failed: [],
});

function parseState<State extends string>(
  value: unknown,
  states: readonly State[],
  path: "current_state" | "target_state",
): State {
  if (typeof value !== "string" || !states.includes(value as State)) {
    throw new InvalidSchemaError([[path]]);
  }
  return value as State;
}

function transition<State extends string>(
  currentValue: unknown,
  targetValue: unknown,
  states: readonly State[],
  transitions: TransitionTable<State>,
): State {
  const currentState = parseState(currentValue, states, "current_state");
  const targetState = parseState(targetValue, states, "target_state");
  if (!transitions[currentState].includes(targetState)) {
    throw new InvalidStateTransitionError(currentState, targetState);
  }
  return targetState;
}

export function transitionRunStatus(
  currentState: unknown,
  targetState: unknown,
): RunStatus {
  return transition(currentState, targetState, RUN_STATUSES, RUN_TRANSITIONS);
}

export function transitionTicketStatus(
  currentState: unknown,
  targetState: unknown,
): TicketStatus {
  return transition(
    currentState,
    targetState,
    TICKET_STATUSES,
    TICKET_TRANSITIONS,
  );
}

export function transitionAssignmentStatus(
  currentState: unknown,
  targetState: unknown,
): AssignmentStatus {
  return transition(
    currentState,
    targetState,
    ASSIGNMENT_STATUSES,
    ASSIGNMENT_TRANSITIONS,
  );
}

export function transitionTransactionStatus(
  currentState: unknown,
  targetState: unknown,
): TransactionStatus {
  return transition(
    currentState,
    targetState,
    TRANSACTION_STATUSES,
    TRANSACTION_TRANSITIONS,
  );
}
