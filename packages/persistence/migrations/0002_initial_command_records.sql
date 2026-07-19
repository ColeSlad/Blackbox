CREATE TABLE runs (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  repository_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  base_commit_sha text NOT NULL CHECK (base_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  status text NOT NULL CHECK (status IN ('created', 'running', 'completed', 'failed', 'cancelled')),
  configuration_version integer NOT NULL CHECK (configuration_version >= 1),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (id, schema_version)
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  run_id uuid NOT NULL REFERENCES runs(id),
  external_key text NOT NULL CHECK (length(trim(external_key)) > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'blocked', 'done', 'failed', 'cancelled')),
  acceptance_criteria text[] NOT NULL,
  manual_verification_steps text[] NOT NULL,
  UNIQUE (run_id, external_key),
  UNIQUE (run_id, id)
);

CREATE TABLE ticket_dependencies (
  run_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  dependency_ticket_id uuid NOT NULL,
  PRIMARY KEY (ticket_id, dependency_ticket_id),
  CHECK (ticket_id <> dependency_ticket_id),
  FOREIGN KEY (run_id, ticket_id) REFERENCES tickets(run_id, id),
  FOREIGN KEY (run_id, dependency_ticket_id) REFERENCES tickets(run_id, id)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  run_id uuid NOT NULL REFERENCES runs(id),
  ticket_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  worktree_id uuid,
  status text NOT NULL CHECK (status IN ('assigned', 'active', 'released', 'failed', 'cancelled')),
  assigned_at timestamptz NOT NULL,
  released_at timestamptz,
  UNIQUE (run_id, id),
  UNIQUE (run_id, ticket_id, id),
  FOREIGN KEY (run_id, ticket_id) REFERENCES tickets(run_id, id)
);

CREATE TABLE intents (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  version integer NOT NULL CHECK (version >= 1),
  goal text NOT NULL CHECK (length(trim(goal)) > 0),
  reads jsonb NOT NULL CHECK (jsonb_typeof(reads) = 'array'),
  writes jsonb NOT NULL CHECK (jsonb_typeof(writes) = 'array'),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'array'),
  public_contract_changes jsonb NOT NULL CHECK (jsonb_typeof(public_contract_changes) = 'array'),
  required_validations text[] NOT NULL,
  declared_effects jsonb NOT NULL CHECK (jsonb_typeof(declared_effects) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (assignment_id, version),
  UNIQUE (assignment_id, id, version)
);

CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  run_id uuid NOT NULL REFERENCES runs(id),
  ticket_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  intent_contract_id uuid NOT NULL,
  intent_version integer NOT NULL CHECK (intent_version >= 1),
  base_commit_sha text NOT NULL CHECK (base_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  prepared_patch_hash text CHECK (prepared_patch_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN (
    'declared', 'admitted', 'running', 'prepared', 'validating', 'eligible',
    'committed', 'rejected', 'cancelled', 'compensating', 'compensated', 'failed'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (run_id, ticket_id, assignment_id) REFERENCES assignments(run_id, ticket_id, id),
  FOREIGN KEY (assignment_id, intent_contract_id, intent_version) REFERENCES intents(assignment_id, id, version)
);
