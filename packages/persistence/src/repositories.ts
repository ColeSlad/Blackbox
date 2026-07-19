import type {
  AgentAssignmentV1,
  IntentContractV1,
  RunV1,
  TicketV1,
  TransactionV1,
} from "@blackbox/contracts";

export interface RunRepository {
  create(record: RunV1): Promise<RunV1>;
  read(id: string): Promise<RunV1 | null>;
}

export interface TicketRepository {
  create(record: TicketV1): Promise<TicketV1>;
  read(id: string): Promise<TicketV1 | null>;
}

export interface AssignmentRepository {
  create(record: AgentAssignmentV1): Promise<AgentAssignmentV1>;
  read(id: string): Promise<AgentAssignmentV1 | null>;
}

export interface IntentRepository {
  create(record: IntentContractV1): Promise<IntentContractV1>;
  read(id: string): Promise<IntentContractV1 | null>;
}

export interface TransactionRepository {
  create(record: TransactionV1): Promise<TransactionV1>;
  read(id: string): Promise<TransactionV1 | null>;
}

export interface CommandRepositories {
  readonly runs: RunRepository;
  readonly tickets: TicketRepository;
  readonly assignments: AssignmentRepository;
  readonly intents: IntentRepository;
  readonly transactions: TransactionRepository;
}
