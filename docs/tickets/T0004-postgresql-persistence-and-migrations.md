# T0004 — PostgreSQL Persistence and Migrations

Status: Draft
Milestone: M0 — Foundation

## Outcome

A developer can start PostgreSQL 17 through local Compose, apply immutable
in-repository SQL migrations, and create and read initial command-side
aggregates through repository interfaces.

## Reason

Durable lifecycle and ledger work requires repeatable storage and migration
discipline before product workflows are introduced.

## Dependencies

- T0002 — must be Done
- T0003 — must be Done

## Preconditions

- T0002 canonical verification is available.
- T0003 version-1 contracts are stable.
- Docker Engine with Compose v2 is the supported local database prerequisite.
- Use PostgreSQL major 17 and the `postgres` npm package.
- Use an in-repository ordered SQL migrator; do not add an ORM or migration
  framework.

## Allowed Scope

- `compose.yaml`
- `.env.example`
- `.gitignore` for local database artifacts only
- New `packages/persistence/`
- SQL migrations under `packages/persistence/migrations/`
- Database fixtures under `fixtures/database/`
- Root workspace scripts and manifests
- `pnpm-lock.yaml`
- `.github/workflows/verify.yml` for the PostgreSQL test service
- `packages/config/` for integration-test configuration
- `README.md`
- Persistence clarification in `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/TICKETS.md`
- `docs/VERIFICATION.md`
- `docs/tickets/T0004-postgresql-persistence-and-migrations.md`

## Protected Areas

- Product API, CLI, worker-job, and web behavior
- T0003 schema meaning and transition rules
- Ledger ingestion owned by T0009
- Domain-event outbox publishing owned by later lifecycle work
- Queue implementation
- Git, worktree, Codex, command runner, causal, replay, and guardrail behavior
- Production deployment and hosted database configuration

## Requirements

### Platform

- Use PostgreSQL major 17.
- Use Docker Compose v2 for the local service.
- Use a PostgreSQL 17 Alpine image pinned to a verified immutable digest during
  implementation.
- Record the human-readable image tag beside the digest.
- Use a health check and named development volume.
- Provide non-secret local-only defaults through `.env.example`; keep actual
  `.env` files ignored.
- CI must use the same PostgreSQL major.

### Client and Package Boundary

- Add the `postgres` npm package as the single database runtime dependency.
- Create `packages/persistence`.
- Define database-neutral repository interfaces separately from PostgreSQL
  adapter implementations within that package.
- Domain code must not import PostgreSQL or persistence types.
- Use the client's parameterized tagged-template interface; do not concatenate
  SQL input.
- Return stable sanitized persistence errors without credentials, raw connection
  strings, or unsafe query parameters.

### Commands

Provide:

- `pnpm db:up`
- `pnpm db:down`
- `pnpm db:migrate`
- `pnpm db:status`
- `pnpm db:reset:dev`
- `pnpm db:smoke`
- `pnpm test:database`

`pnpm test:database` must be a required part of the root
`pnpm test:integration` command. T0002's canonical `pnpm verify` integration
stage must therefore run the database suite without adding a second CI
verification path.

`pnpm db:smoke` is a non-product verification command. It must refuse a
non-local database host, create one run, ticket, assignment, intent version, and
transaction through the public repository interfaces, read each record back,
print a sanitized success summary, and exit non-zero if any round trip fails. It
must not add product API, CLI workflow, or lifecycle behavior.

`db:reset:dev` must be visibly destructive, refuse non-local database hosts, and
require an explicit confirmation flag.

### Migration Runner

- Implement the migrator in repository TypeScript using the selected client and
  Node standard-library hashing.
- Do not add an ORM or migration dependency.
- Store immutable ordered SQL files:
  - `0001_schema_migrations.sql`;
  - `0002_initial_command_records.sql`.
- `schema_migrations` must record:
  - migration identifier;
  - file name;
  - SHA-256 checksum;
  - application timestamp.
- Apply pending migrations in lexical identifier order.
- Apply each migration transactionally where PostgreSQL permits.
- Refuse duplicate identifiers, ordering ambiguity, changed checksums, missing
  previously applied files, and unknown future database versions.
- Repeated migration execution must report current or no-op without modifying
  schema.
- Do not provide automatic production down migrations.

### Initial Schema

Create:

- `runs`;
- `tickets`;
- `ticket_dependencies`;
- `assignments`;
- `intents`;
- `transactions`;
- `schema_migrations`.

Use application-generated UUID identifiers.

Required relationships:

- tickets reference runs;
- ticket dependencies reference two tickets in the same run through tested
  repository behavior;
- assignments reference runs and tickets;
- intents reference assignments and have unique sequential
  `(assignment_id, version)`;
- transactions reference runs, tickets, and assignments.

Required persistence rules:

- status fields use T0003 vocabularies;
- extensible records include `schema_version`;
- required architecture fields are stored;
- timestamps use timezone-aware PostgreSQL timestamps;
- dependency pairs cannot self-reference;
- aggregate identity and foreign-key constraints are enforced;
- JSON payloads are used only for genuinely extensible structured fields and
  always have an explicit schema version.

### Repository Behavior

Implement only create and read operations for:

- run;
- ticket with dependencies;
- assignment;
- intent version;
- transaction.

Do not implement lifecycle services, status mutation APIs, outbox publication,
or product endpoints.

### Integration Testing

- Use an isolated test database or unique schema namespace.
- Test:
  - empty database to latest;
  - migration 0001 to latest;
  - repeated migration no-op;
  - changed-checksum rejection;
  - missing-applied-file rejection;
  - unknown-future-version rejection;
  - foreign keys and uniqueness;
  - ticket self-dependency rejection;
  - schema-version requirements;
  - one create and read round trip per aggregate;
  - sanitized connection and query failures.
- Required database tests must fail, not skip, when PostgreSQL is unavailable.
- Root `pnpm test:integration` must invoke `pnpm test:database` as a required
  suite, so database failures propagate through the existing `pnpm verify`
  integration stage.
- CI must start the pinned PostgreSQL service before exactly one `pnpm verify`
  invocation. The documented local flow must start the database with
  `pnpm db:up` and then run the same `pnpm verify` command.

## Dependency Evaluation

### `postgres`

- Intended use: PostgreSQL connections, transactions, and parameterized queries
  for the adapter and migration runner.
- Alternatives considered:
  - `pg` is viable but may require a separate declaration dependency and a more
    verbose query boundary;
  - an ORM would add mapping semantics before a measured need;
  - a migration framework duplicates the intentionally small ordered-SQL runner;
  - direct wire-protocol implementation is unsafe and unjustified.
- Security and license requirements:
  - record factual `pnpm view` version, repository, license, and publication
    metadata;
  - run the repository advisory audit;
  - inspect transitive dependencies;
  - verify Node 24 and ESM compatibility with an executable smoke test;
  - stop if maintenance, license compatibility, or advisory status cannot be
    established.
- Removal cost: medium; confined to `packages/persistence` adapters and the
  migrator.
- Pin the selected approved release exactly.

### Official PostgreSQL 17 Alpine Image

- Intended use: provide the disposable local development database and the CI
  database service with one reproducible PostgreSQL major and distribution.
- Alternatives considered:
  - a host-installed PostgreSQL server would make setup and CI parity dependent
    on undocumented machine state;
  - the official Debian-based image is viable but larger, while this increment
    requires no extension unavailable from the Alpine variant;
  - an embedded PostgreSQL package or test-container framework would add another
    dependency and duplicate the existing Compose boundary;
  - non-official images are rejected because their provenance and maintenance
    are unnecessary risks.
- Security and license requirements:
  - use only the Docker Official Image maintained for PostgreSQL;
  - during implementation, resolve a supported PostgreSQL 17 Alpine patch tag
    and its immutable multi-platform manifest digest;
  - record the human-readable tag beside the digest and use the same exact
    `tag@digest` reference in Compose and CI;
  - verify registry provenance, PostgreSQL support status, image publication
    metadata, base-image lineage, included-package licenses, and known
    vulnerabilities;
  - add no extensions or baked-in credentials;
  - stop if provenance, digest, license compatibility, support, or advisory
    status cannot be established.
- Replacement cost: low for another verified official PostgreSQL 17 image
  variant because SQL and repository interfaces remain unchanged; replacing
  PostgreSQL itself is outside this ticket and would have high migration cost.

## Acceptance Criteria

- `pnpm db:up` starts a healthy PostgreSQL 17 service.
- Empty-database migration creates metadata and all initial tables.
- A database at migration 0001 upgrades successfully.
- Reapplying migrations reports current or no-op.
- Changed, missing, duplicate, and future migration states fail safely.
- One record of every aggregate can be created and read through repository
  interfaces.
- Foreign-key, uniqueness, dependency, and schema-version constraints are
  behaviorally tested.
- Domain code has no PostgreSQL dependency.
- CI and local tests use the same commands and PostgreSQL major.
- Database unavailability fails required verification rather than skipping.
- No product API, ledger, outbox, queue, or lifecycle behavior is added.
- Aggregate verification passes.

## Automated Checks

- `pnpm db:up`
- Verify the Compose health check
- `pnpm db:migrate`
- `pnpm db:status`
- `pnpm db:smoke`
- `pnpm test:database`
- Verify `pnpm test:integration` invokes `pnpm test:database` and that the
  workflow invokes exactly one `pnpm verify` after PostgreSQL becomes healthy.
- Run empty-to-latest and 0001-to-latest migration tests
- Run checksum, missing-file, future-version, constraint, and round-trip tests
- Run `pnpm db:migrate` again and verify current or no-op
- Dependency metadata, license, transitive-dependency, advisory, and ESM smoke
  checks
- `pnpm verify`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- Verify no credentials, volumes, dumps, or generated database files are
  tracked

## Manual Verification

1. Remove any disposable Blackbox development database volume.
2. Run `pnpm db:up`.
3. Run migrations and inspect status.
4. Run `pnpm db:smoke` and confirm its sanitized success summary reports one
   successful create and read round trip for each required aggregate.
5. Restart PostgreSQL and confirm records remain readable.
6. Re-run migrations and confirm current or no-op.
7. Confirm the reset command refuses a non-local host and missing confirmation.
8. Run the explicitly confirmed development reset.
9. Confirm clean migration succeeds again.
10. Stop the service and remove the disposable volume.

## Exclusions

- Production deployment, backup, replication, or high availability
- Hosted PostgreSQL
- ORM or external migration framework
- Outbox publication
- Ledger ingestion and projections
- Queue tables
- Conflicts, validations, causal records, or guardrails
- Product API, CLI workflow, or UI
- Destructive production migrations
- Automatic down migrations

## Documentation Updates

- Document Docker Compose, PostgreSQL 17, database commands, and reset warnings
  in `README.md`.
- Record PostgreSQL 17, Postgres.js, and in-repository ordered SQL migrations in
  `docs/ARCHITECTURE.md`.
- Add migration and database verification details to `docs/VERIFICATION.md`.
- Record persistence capabilities and limitations in `docs/STATUS.md`.

## Rollback

- Revert code and configuration.
- Remove only disposable local development volumes through the documented
  confirmed command.
- Treat applied migrations as forward-only; never rewrite an applied migration
  or promise automatic production rollback.

## Reviewer Focus

- Migration ordering, checksums, and immutability
- Empty and prior-version database behavior
- Parameterized SQL and sanitized errors
- Domain and infrastructure separation
- Schema-version enforcement
- Exact dependency and image pins with factual evidence
- CI and local parity
- No premature ledger, outbox, queue, or product workflow
- No committed secrets or database artifacts

## Readiness

The PostgreSQL major, local-service mechanism, client, migration approach,
package boundary, and rollback policy are resolved. Factual version, digest,
license, maintenance, and advisory checks remain mandatory validation evidence,
not open design decisions. Separate `plan_validator` review and explicit human
promotion are still required before Ready.
