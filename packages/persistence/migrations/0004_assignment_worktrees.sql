ALTER TABLE runs
  ADD CONSTRAINT runs_id_repository_id_unique UNIQUE (id, repository_id);

ALTER TABLE lifecycle_outbox
  DROP CONSTRAINT lifecycle_outbox_aggregate_type_check,
  DROP CONSTRAINT lifecycle_outbox_event_name_check;

ALTER TABLE lifecycle_outbox
  ADD CONSTRAINT lifecycle_outbox_aggregate_type_check
    CHECK (aggregate_type IN ('assignment', 'run', 'ticket', 'worktree')),
  ADD CONSTRAINT lifecycle_outbox_event_name_check
    CHECK (event_name IN (
      'assignment.created', 'assignment.status_changed',
      'run.created', 'run.status_changed',
      'ticket.created', 'ticket.status_changed',
      'worktree.created', 'worktree.removed', 'worktree.retention_changed'
    ));

CREATE TABLE assignment_worktrees (
  id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  repository_id uuid NOT NULL,
  run_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  working_tree_root text NOT NULL CHECK (length(trim(working_tree_root)) > 0),
  common_git_directory text NOT NULL CHECK (length(trim(common_git_directory)) > 0),
  default_branch text NOT NULL CHECK (length(trim(default_branch)) > 0),
  base_commit_sha text NOT NULL CHECK (base_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  managed_path text NOT NULL UNIQUE CHECK (length(trim(managed_path)) > 0),
  branch_name text NOT NULL UNIQUE CHECK (length(trim(branch_name)) > 0),
  status text NOT NULL CHECK (status IN ('provisioning', 'active', 'removing', 'removed', 'failed')),
  retention_status text NOT NULL CHECK (retention_status IN ('releasable', 'retained')),
  operation_token uuid NOT NULL UNIQUE,
  operation_stage text NOT NULL CHECK (operation_stage IN (
    'reserved', 'branch_creating', 'worktree_creating', 'verifying',
    'activating', 'active', 'removing_worktree', 'deleting_branch',
    'finalizing_removal', 'removed'
  )),
  failure_disposition text NOT NULL CHECK (failure_disposition IN (
    'none', 'provision_cleanup_required', 'removal_reconcile_required'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  activated_at timestamptz,
  removed_at timestamptz,
  UNIQUE (assignment_id),
  UNIQUE (run_id, ticket_id, assignment_id, id),
  FOREIGN KEY (run_id, repository_id) REFERENCES runs(id, repository_id),
  FOREIGN KEY (run_id, ticket_id) REFERENCES tickets(run_id, id),
  FOREIGN KEY (run_id, ticket_id, assignment_id)
    REFERENCES assignments(run_id, ticket_id, id)
);

ALTER TABLE assignments
  ADD CONSTRAINT assignments_owned_worktree_fk
  FOREIGN KEY (run_id, ticket_id, id, worktree_id)
  REFERENCES assignment_worktrees(run_id, ticket_id, assignment_id, id);

CREATE FUNCTION enforce_assignment_worktree_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'removed' THEN
    RAISE EXCEPTION 'removed worktree is terminal' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'provisioning' AND NEW.status IN ('active', 'failed')) OR
    (OLD.status = 'active' AND NEW.status = 'removing') OR
    (OLD.status = 'removing' AND NEW.status IN ('removed', 'failed')) OR
    (OLD.status = 'failed' AND OLD.failure_disposition IN ('none', 'provision_cleanup_required') AND NEW.status = 'provisioning') OR
    (OLD.status = 'failed' AND OLD.failure_disposition = 'removal_reconcile_required' AND NEW.status IN ('removing', 'removed'))
  ) THEN
    RAISE EXCEPTION 'invalid worktree status transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.retention_status <> NEW.retention_status AND
     NOT (OLD.status = 'active' AND NEW.status = 'active') THEN
    RAISE EXCEPTION 'invalid worktree retention transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.operation_stage <> NEW.operation_stage AND NOT (
    (OLD.operation_stage = 'reserved' AND NEW.operation_stage = 'branch_creating') OR
    (OLD.operation_stage = 'branch_creating' AND NEW.operation_stage IN ('reserved', 'worktree_creating')) OR
    (OLD.operation_stage = 'worktree_creating' AND NEW.operation_stage IN ('reserved', 'verifying')) OR
    (OLD.operation_stage = 'verifying' AND NEW.operation_stage IN ('reserved', 'activating')) OR
    (OLD.operation_stage = 'activating' AND NEW.operation_stage IN ('reserved', 'active')) OR
    (OLD.operation_stage = 'active' AND NEW.operation_stage = 'removing_worktree') OR
    (OLD.operation_stage = 'removing_worktree' AND NEW.operation_stage = 'deleting_branch') OR
    (OLD.operation_stage = 'deleting_branch' AND NEW.operation_stage = 'finalizing_removal') OR
    (OLD.operation_stage = 'finalizing_removal' AND NEW.operation_stage = 'removed')
  ) THEN
    RAISE EXCEPTION 'invalid worktree operation stage transition' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (NEW.status = 'provisioning' AND (
      (NEW.failure_disposition = 'none' AND
        NEW.operation_stage IN ('reserved', 'branch_creating', 'worktree_creating', 'verifying', 'activating')) OR
      (NEW.failure_disposition = 'provision_cleanup_required' AND
        NEW.operation_stage IN ('branch_creating', 'worktree_creating', 'verifying', 'activating'))
    )) OR
    (NEW.status = 'active' AND NEW.failure_disposition = 'none' AND NEW.operation_stage = 'active') OR
    (NEW.status = 'removing' AND NEW.failure_disposition = 'none' AND
      NEW.operation_stage IN ('removing_worktree', 'deleting_branch', 'finalizing_removal')) OR
    (NEW.status = 'removed' AND NEW.failure_disposition = 'none' AND NEW.operation_stage = 'removed') OR
    (NEW.status = 'failed' AND NEW.failure_disposition IN ('none', 'provision_cleanup_required') AND
      NEW.operation_stage IN ('reserved', 'branch_creating', 'worktree_creating', 'verifying', 'activating')) OR
    (NEW.status = 'failed' AND NEW.failure_disposition = 'removal_reconcile_required' AND
      NEW.operation_stage IN ('removing_worktree', 'deleting_branch', 'finalizing_removal'))
  ) THEN
    RAISE EXCEPTION 'inconsistent worktree operation state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignment_worktrees_enforce_transition
BEFORE UPDATE ON assignment_worktrees
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_worktree_transition();
