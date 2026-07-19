CREATE TABLE lifecycle_outbox (
  event_id uuid PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('assignment', 'run', 'ticket')),
  aggregate_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES runs(id),
  event_name text NOT NULL CHECK (event_name IN (
    'assignment.created', 'assignment.status_changed',
    'run.created', 'run.status_changed',
    'ticket.created', 'ticket.status_changed'
  )),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX assignments_one_live_reservation_per_ticket
  ON assignments (ticket_id)
  WHERE status IN ('assigned', 'active');

CREATE FUNCTION reject_ticket_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reachable(ticket_id) AS (
      SELECT NEW.dependency_ticket_id
      UNION
      SELECT dependency.dependency_ticket_id
      FROM ticket_dependencies dependency
      JOIN reachable ON dependency.ticket_id = reachable.ticket_id
      WHERE dependency.run_id = NEW.run_id
    )
    SELECT 1 FROM reachable WHERE ticket_id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION 'ticket dependency cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ticket_dependencies_reject_cycle
BEFORE INSERT ON ticket_dependencies
FOR EACH ROW EXECUTE FUNCTION reject_ticket_dependency_cycle();

CREATE FUNCTION reject_lifecycle_outbox_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lifecycle outbox records are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER lifecycle_outbox_reject_update_or_delete
BEFORE UPDATE OR DELETE ON lifecycle_outbox
FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_outbox_mutation();

CREATE TRIGGER lifecycle_outbox_reject_truncate
BEFORE TRUNCATE ON lifecycle_outbox
FOR EACH STATEMENT EXECUTE FUNCTION reject_lifecycle_outbox_mutation();
