# Codex Engineering Workflow

This repository-scoped harness plans Draft tickets, runs one bounded ticket
through controlled implementation, analyzes evidence for durable process
improvements, and applies one separately approved harness improvement. Every
write-capable workflow has one writer boundary and stops before commit or merge.

The harness is engineering infrastructure only. It does not implement Blackbox
product behavior.

## Prerequisites

- Git.
- A current Codex CLI installed and authenticated.
- Hermes Agent is optional. The direct ticket runner uses Codex by default and
  enables Hermes only after an explicit per-run selection and capability probe.
- The repository marked trusted when project-scoped Codex agents and skills
  should load.
- Bash and standard Unix command-line tools.
- Python 3 standard library for path validation, JSON handling, and evidence
  manifests.

The harness was reconciled against Codex CLI `0.144.5`. This version supports
`codex exec`, project custom agents, skills, `--output-schema`, and review modes
for uncommitted changes, a base branch, or a commit. `codex review` does not
currently expose `--json` or `--output-schema`; `review-ticket.sh` therefore
stores its human-readable result and requires an explicit overall-result marker.
If native uncommitted review is unavailable in a future installation, the script
falls back to read-only `codex exec` with the review schema.

This CLI's structured-output subset rejects some otherwise valid JSON Schema
keywords, including `allOf` and `uniqueItems` in the tested positions. The
repository schemas therefore use the supported structural subset and enforce
cross-field, zero-or-three, uniqueness, index-preservation, and writer-count
rules deterministically in the wrapper scripts.

Custom-agent spawning works in persistent `codex exec` sessions but failed in a
tested `--ephemeral` session with a missing parent-thread error. Repository
multi-agent wrappers intentionally do not use `--ephemeral`. Read-only planning
and retrospective agents can take several minutes while auditing the large
architecture and evidence sources; their scripts retain events and fail closed
on nonzero interruption.

Non-interactive scripts use the global `codex --ask-for-approval never` policy,
spelled as `codex -a never ...`, so a new permission request fails instead of
silently escalating. No script uses `danger-full-access`.

## One-time setup verification

Run from any repository subdirectory:

```bash
./scripts/codex/doctor.sh
```

The doctor reports Git state, planning documents, Codex capabilities, agent and
skill files, schemas, shell syntax, JSON validity, model/config overrides, and
obvious secret-file risks. Every live Codex capability probe receives an exact
credential-free environment, even if the invoking shell contains provider
credentials. The doctor also reminds you that a Codex restart may be needed
after adding project skills.

## Agent roles

- `plan_validator`: read-only prerequisite and ticket consistency gate.
- `project_explorer`: read-only repository map and verification plan.
- `ticket_worker`: the only implementation writer.
- Hermes worker backend: optional external sole implementation writer for one
  direct ticket run; it is not a Codex custom agent and is disabled by default.
- `verification_auditor`: read-only acceptance-evidence audit.
- `ticket_reviewer`: fresh independent read-only diff review.
- `ticket_closer`: the only writer in a later documentation-only closure run.
- `project_planner`: read-only product increment and Draft-ticket proposer.
- `harness_retrospective`: read-only systemic process-failure analyst.
- `harness_improver`: sole writer for one explicitly approved harness proposal.

A ticket worker never runs concurrently with another writer. The default Codex
backend may reuse its same worker for one focused repair cycle. The initial
Hermes backend stops on blocking review instead of starting a repair writer.
Closure is a separate run after a human verification record exists.

Planning uses read-only planner and validator agents; only the invoking planning
session may materialize Draft documents. Retrospectives have no writer.
Harness-improvement runs use one improver and a later independent read-only
reviewer. No workflow may overlap writer roles.

## Ticket planning

Preview the next three smallest dependency-ordered product increments:

```bash
./scripts/codex/plan-next.sh --dry-run
```

The default is dry-run, so Codex receives a read-only sandbox and only structured
planning evidence is stored. To materialize reviewed proposals from a clean
working tree:

```bash
./scripts/codex/plan-next.sh --execute
```

The `$project-plan` workflow reads product, architecture, status, ticket index,
accepted ADR, individual-ticket, completed-ticket, and verification sources. It
uses `project_planner` read-only, creates exactly three complete ticket
specifications as `Draft`, and runs `plan_validator` read-only as a separate
validation phase. Planning may create new files below `docs/tickets/` and any
necessary Draft rows in `docs/TICKETS.md`; it may not change application code.

A validation result never promotes a ticket automatically. A human must review
the specification, reconcile blockers, and make a separate explicit status
change to `Ready`. Only then may ticket execution be considered.

## Interactive ticket execution

Start Codex in the repository:

```bash
codex
```

Then invoke:

```text
$ticket-runner

Execute docs/tickets/T0001-project-skeleton.md.
```

The runner reads the individual ticket as the authority for its status and
scope, waits for both read-only gates, uses one writer only when both return
`GO`, audits real command evidence, obtains a fresh independent review, and
stops for human verification.

## Automated local ticket execution

```bash
./scripts/codex/run-ticket.sh docs/tickets/T0001-project-skeleton.md
```

The default backend is `codex`. To opt into Hermes for one direct, existing
harness-worktree run:

```bash
./scripts/codex/run-ticket.sh \
  --worker-backend hermes \
  docs/tickets/T0001-project-skeleton.md
```

The environment-key path above is unchanged. To explicitly hand the existing
Hermes `openai-codex` OAuth record to this one direct run instead, supply both
selectors:

```bash
./scripts/codex/run-ticket.sh \
  --worker-backend hermes \
  --hermes-auth-source user-hermes \
  --hermes-auth-provider openai-codex \
  docs/tickets/T0001-project-skeleton.md
```

The two selectors are inseparable and have no defaults. Partial, duplicate, or
unknown values fail before run evidence or a writer is created. They are not
accepted by autopilot or scheduling, and no file-auth source is inferred from a
present host file.

Hermes selection is mutually exclusive with the Codex `ticket_worker`. The
runner uses six mechanically separate execution phases: a read-only Codex gate
session, one shell-owned Hermes writer invocation after that Codex process has
exited, shell-owned verification in a disposable mirror, then distinct fresh
read-only Codex evidence-inspection, audit, and independent-review processes.
No Codex process is alive while Hermes writes, and no Hermes process is alive
during post gates. Only the fixed Hermes wrapper may edit ticket-scope files.

The script:

1. validates the ticket path and `Ready` status;
2. runs the harness doctor;
3. binds ticket-check executables into a private immutable PATH and saves
   pre-run Git state;
4. for the default backend, invokes one `codex exec` in `workspace-write` with
   approval escalation disabled;
5. for Hermes, runs `HERMES_READ_ONLY_GATES` under both Codex `read-only` and a
   macOS Seatbelt repository-and-Git-write denial, strictly validates one
   bounded schema result, invokes Hermes once, runs the exact ticket commands
   in a disposable isolated-Git verification mirror, then starts separate
   `HERMES_READ_ONLY_VERIFICATION`, `HERMES_READ_ONLY_AUDIT`, and
   `HERMES_READ_ONLY_REVIEW` processes under the same dual read-only controls;
6. directly supervises every Hermes-path Codex process through a retained
   process-group owner, captures its streams into controller-owned files, and
   gives the child write access only to its precreated structured-result file;
7. applies the ticket-run result schema to each Codex phase;
8. saves phase-specific JSONL events, structured results, summaries, stderr,
   post-run Git state, and diff summary;
9. propagates a nonzero phase, containment, parser, writer, or review status.

It automates validation, exploration, one worker, verification auditing, and
review. It does not perform human verification or documentation closure.

The gate-to-writer contract is a JSON object of at most 1,024 bytes with exactly
three unique keys and values: `worker_backend: HERMES`, `validator: GO`, and
`explorer: GO`. The parent parser rejects duplicate keys, unknown keys,
malformed JSON, contradictory statuses, blockers, unexpected changed files, an
already-run worker or review, and any status other than
`READY_FOR_IMPLEMENTATION`. Rejection stops before the wrapper and cannot fall
back to a Codex writer.

The Hermes wrapper runs only in a registered linked Git worktree with matching
ignored ticket-run metadata. The metadata binds the canonical root, Git dir,
common Git dir, HEAD, and branch captured by `run-ticket.sh`; the wrapper
recomputes and matches that identity before launch. It accepts no passthrough
flags, probes required CLI capabilities, rejects caller-supplied `HERMES_*`
controls, and sets a canonical `HERMES_WRITE_SAFE_ROOT`. Its fixed command is
`hermes chat -q ... --quiet --safe-mode --ignore-user-config --ignore-rules
--toolsets file`; the explicit OAuth path adds only `--provider openai-codex`.
Terminal, web, memory, skills, plugins, hooks, MCP, delegation,
scheduling, persistent learning, session continuation, autonomous worktrees,
and yolo mode are not enabled. Hermes runs once and emits only bounded, redacted
local evidence. The harness never installs Hermes or enables a web-capable
toolset. Provider network access required by the selected model remains a host
capability; the file tool remains the only enabled Hermes toolset.

Before any phase starts, the controller reads and hashes the selected ticket,
the automated-run prompt, schema, harness instructions, agent and skill
configuration, product and architecture authorities, status and ticket indexes,
verification guidance, ADR directories, and every ticket specification. The
ticket's `Ready` status, dependency statuses, acceptance criteria, and literal
automated-check commands are parsed from those immutable startup bytes. Hermes
may change product implementation files within ticket scope, but Seatbelt and
post-process hashes prevent it from changing those controller inputs. The
controller also compares HEAD, refs, indexes, Git metadata, and every registered
sibling worktree around the writer.

Both the capability probe and implementation run under `/usr/bin/sandbox-exec`.
Seatbelt denies process creation, so the fixed Hermes process cannot fork,
create a signal-ignoring descendant, call `setsid`, or detach a second process.
The help-only capability probe receives no provider credentials, auth file, user
configuration, source path in its arguments or environment, or network. An
immediate prelaunch descriptor check proves the held home contains only its
empty temporary directory. OS runtime directories created after the target
starts do not authorize an auth file or imported user configuration. An
anonymous pipe supplies the profile as `sandbox-exec` standard input. The
controller writes and closes the complete bounded profile before consuming
output; `sandbox-exec` consumes it and the Hermes target inherits EOF on
standard input with no nonstandard profile descriptor. The profile contains an
exact read-and-write denial for the selected canonical host auth source without
persisting or passing that source path to Hermes. Only after that probe proves every required
flag may the controller descriptor-walk the canonical caller home and auth store
without following symlinks. It requires current-user ownership, mode `0400` or
`0600`, a bounded regular file, stable identity and content while read, unique
JSON keys, auth-store version 1, and the supported Hermes v0.19
`openai-codex`/`chatgpt` schema. Unsupported, malformed, relocated, replaced,
oversized, insecure, or missing-provider sources stop before the exclusive
implementation marker and writer.

The controller extracts only the selected provider record and creates a minimal
version-1 `auth.json` through the already-held ephemeral-home descriptor with
`O_EXCL`, mode `0600`, file and directory `fsync`, and no credential digest. The
host source is closed before the writer. The contained writer receives neither
the source path nor provider environment values, remains explicitly denied host
source reads and writes, and may rotate tokens only in the ephemeral copy. User
configuration, unrelated providers, credential pools, model settings, rules,
and plugins are not imported; `--provider openai-codex` lets Hermes use its
supported built-in model selection while safe mode remains enabled.
For implementation it also denies writes outside the canonical worktree,
writes to Git metadata, and writes to `.codex-runs` except the ephemeral Hermes
home. If Seatbelt is missing or cannot apply the profile, the selected Hermes
run fails; there is no weaker fallback. This backend is therefore currently
macOS-host-only.

The runner, doctor, wrapper, Git, and Python helpers discard shell, Python,
dynamic-loader, compiler, Git-context, Git-config, SSH-command, and related
runtime injection variables before trusted subprocesses. Their internal
clean-environment markers are not trusted by name alone: each entry validates
the complete environment-name allowlist, fixed system control path, and
canonical resolved Codex and Hermes paths before continuing. Git and Python
helpers then resolve from `/usr/bin:/bin:/usr/sbin:/sbin`. Before any agent or
writer starts, the runner resolves every direct ticket-check executable plus
the Node package-manager toolchain from the caller's discovery path, records
each canonical target's identity and SHA-256 digest, and creates non-writable
regular-file launchers below the ignored run directory. Every agent and check
receives only that private executable directory plus the fixed system
directories. The runner revalidates the launcher and target bytes before each
phase and each writable check. This preserves split installations such as a
Codex binary below a Homebrew Cask and `pnpm` below `/opt/homebrew/bin` without
putting the caller's repository, Hermes home, temporary, sibling-worktree, or
other writable PATH directories into an agent environment. A Hermes attempt to
replace a previously selected executable stops before verification. The final
Hermes launch receives a newly constructed environment containing only fixed
system path, locale, certificate, safe-root, ephemeral home, and
provider-credential names on the environment-key path. The provider allowlist is
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`,
`MISTRAL_API_KEY`, `XAI_API_KEY`, `COHERE_API_KEY`, `AZURE_OPENAI_API_KEY`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`,
`AWS_DEFAULT_REGION`, `HF_TOKEN`, and `HUGGINGFACEHUB_API_TOKEN`. Values are
passed in memory, when nonempty must be 4–8192 bytes, are sorted longest-first, and are
replaced exactly in every retained Hermes output artifact before the bounded
evidence is written. Invocation metadata records neither credential values nor
the resolved executable path.

Provider credentials are supplied only to the contained Hermes implementation
process that may require them. The earlier `hermes chat --help` capability
probe, every read-only Codex gate, verification, audit, and review process, and
every doctor Codex capability probe receive a credential-free environment,
including when the outer runner inherited those values for the selected Hermes
backend.

For explicit file auth, the imported access, refresh, ID, and account strings
and any supported values written by a refresh join the same exact
longest-first in-memory redaction set. The controller redacts bounded output
before it is written, removes exact leak attempts from the worktree and blocks
the run, never records credential digests, and persists neither the source
content nor its exact path. The host source inode and bytes are never updated by
the harness. A missing, malformed, or unsafe post-run ephemeral auth file also
blocks, but only after the imported values and any bounded refreshed token
fields that can still be recovered safely are added to exact output and
workspace scrubbing. Failure messages do not include parser or credential
details.

This handoff limits credential placement and retained leakage; it does not make
a credentialed implementation model inherently trustworthy. The sole Hermes
writer necessarily sees the selected OAuth values in its ephemeral home and has
network access for provider inference. A malicious or compromised writer could
attempt network exfiltration before post-run scrubbing. Use the backend only for
the same ticket-scoped implementation trust granted to another credentialed
writer; the harness controls local sources, capabilities, evidence, and cleanup,
not arbitrary information flow through the allowed provider network.

`HERMES_WRITE_SAFE_ROOT` constrains the file tool, not arbitrary terminal
commands. The terminal toolset therefore remains prohibited. Provider
connectivity, when required by the chosen Hermes model, is a host responsibility
rather than an agent tool capability. A
missing or incompatible Hermes binary fails the selected run before an
implementation writer can edit.

`HERMES_HOME` exists below the ignored run directory only while the capability
probe and implementation process execute. The controller opens it before the
probe and retains that directory descriptor and inode through execution. Exit
and signal cleanup purges through the retained descriptor, then removes the
same inode through a symlink-safe scan of the canonical worktree. A renamed,
moved, replaced, or symlink-swapped home always fails the run even when confined
cleanup succeeds; a replacement symlink is unlinked without following its
external target. The composed prompt is passed in memory rather than written to
disk. Exact active process objects handle interruption, and Seatbelt prevents
descendant escape before cleanup. A stale home blocks reuse of that run
directory.

Normal exit, failure, `HUP`, `INT`, and `TERM` all purge copied auth and any
ephemeral configuration through the held descriptor. `SIGKILL` and host power
loss cannot run cleanup, so a stale mode-0600 home may still contain a copied
credential. Treat the entire interrupted run directory as sensitive, confirm no
Hermes process is using it, remove that stale ignored home from a trusted host
shell, and start a fresh run directory. Never bypass the stale-home gate or
reuse the interrupted directory.

Codex CLI `0.144.5` does not expose complete custom-agent spawn events. The
Hermes path therefore does not infer writer absence from event text. Repository
writes are mechanically denied for all four read-only Codex phases, their Git state is
compared before and after, the Hermes wrapper is shell-owned, and its
single-invocation marker is created exclusively. A stale supervisor PID file is
evidence only and is never used as signal authority.

For the default Codex backend, `run-ticket.sh` sends the Codex JSONL stream
through `scripts/codex/run-codex-observed.py`. On the Hermes backend, the
shell-owned Python controller launches each read-only Codex process directly,
records its retained process-group owner's actual PID before signals are
unblocked, and captures bounded stdout and stderr without live forwarding. On
failure or interruption, the controller repeatedly enumerates that still-owned
group, rechecks each member's group immediately before signaling its PID, waits
through bounded TERM/KILL stages, and releases the owner only after no member
remains. It never signals a bare numeric process-group ID that could have been
recycled. A successful phase must contain its own `turn.completed` event,
controller PID evidence, regular files, and a valid structured result. Prior
phase artifacts are hashed before a later process starts and rechecked after it
exits, so audit and review cannot rewrite earlier evidence.

Verification commands are normalized only for whitespace and must exactly match
the literal backtick commands in the immutable ticket. A substring, wrapper such
as `printf`, invented command, reordered command, or invented evidence path is
rejected. After Hermes exits, the controller freezes HEAD, status, staged and
unstaged binary diffs, and a content manifest that excludes ignored run evidence
except the tracked `.codex-runs/.gitkeep`. It creates a local no-alternates clone,
reconstructs that exact state, rejects unsafe symlinks or external Git metadata,
and compares the mirror to the frozen source before running checks.

Each command runs exactly once under a network-denied Seatbelt profile. The only
writable filesystem subtree is the disposable mirror; `/dev/null` is the sole
nonpersistent device exception required by Apple Git. HOME, temporary files,
and the empty global Git config also live inside the mirror, and the environment
contains neither provider credentials nor Codex/Hermes control variables. The
controller retains bounded stdout, stderr, exit status, hashes, command order,
and an implementation-binding digest, rejects nonzero or lingering processes,
proves the implementation worktree stayed unchanged, and destroys the mirror.
Only then may fresh read-only Codex verification inspect
`verification-evidence.json`; it cannot execute a writable check itself. Audit
and acceptance evidence may cite only that shell evidence or its bound read-only
verification result.

Codex CLI `0.144.5` does not expose custom-agent spawn events in the parent
`--json` stream, and successful collaboration waits can contain an empty
`receiver_thread_ids` array. The wrapper therefore cannot infer spawn failure
from that field. The skill requires explicit spawn-result confirmation and
fails closed when spawning itself reports failure; retained progress and event
logs remain the factual runtime evidence.

## Independent review

```bash
./scripts/codex/review-ticket.sh docs/tickets/T0001-project-skeleton.md
```

This wrapper remains read-only, reviews staged, unstaged, and untracked changes,
stores the result under `.codex-runs/reviews/`, and exits nonzero for a blocking
result. The current native review modes can be inspected with:

```bash
codex review --help
codex review --uncommitted
```

## Manual verification

Follow the selected ticket exactly. Do not reuse this generic template to omit a
ticket-specific step.

```text
Manual verification: Pass / Fail

Environment:
- Operating system:
- Browser:
- Node version:
- Package-manager version:

Checks:
- Dependency installation:
- Development server:
- Expected UI:
- Browser console:
- Tests:
- Production build:

Notes:
```

Store a completed local record under an ignored path such as
`.codex-runs/manual/T0001.md`. Record observed results, not intended results.

## Documentation closure

After automated evidence and independent review pass and a human record exists:

```bash
./scripts/codex/close-ticket.sh \
  docs/tickets/T0001-project-skeleton.md \
  .codex-runs/manual/T0001.md
```

The closure flow audits the evidence first, permits one documentation-only
writer, and verifies by file manifest that only `docs/STATUS.md`,
`docs/TICKETS.md`, the selected ticket, and `docs/completed-tickets/` changed
during the run.

## Commit and merge

Commit and merge are human-controlled, separate steps. After reviewing the full
diff and all evidence, a human may deliberately run commands such as:

```bash
git status --short
git diff --check
git diff
git add <reviewed-paths>
git commit
git push
```

No harness script stages, commits, pushes, rebases, or merges.

## Next-ready discovery

The convenience wrapper follows `docs/TICKETS.md` ordering and dependencies, but
uses each individual ticket file as the authority for `Ready` and `Done` status.
It selects at most one eligible ticket. Its default is read-only discovery:

```bash
./scripts/codex/run-next-ready.sh --dry-run
```

Write-capable execution requires the explicit `--execute` flag. The wrapper
never loops through tickets or creates a branch.

## One-ticket autopilot

Autopilot combines next-ready discovery, worktree isolation, and the existing
ticket runner. It handles exactly one ticket per invocation and defaults to
read-only planning:

```bash
./scripts/codex/autopilot.sh --dry-run
```

The dry run identifies at most one individual ticket whose status is `Ready`
and whose dependencies from its authoritative `## Dependencies` section are
individually `Done`. A dependency mismatch with `docs/TICKETS.md` blocks
selection rather than choosing a convenient source. The dry run creates no
branch, worktree, or writer.

Write-capable operation requires a clean `main` checkout and an explicit flag:

```bash
./scripts/codex/autopilot.sh --execute
```

The script creates one `codex/autopilot-*` branch and a dedicated sibling
worktree below `.codex-worktrees/`, invokes that worktree's
`scripts/codex/run-ticket.sh` exactly once, then stops. It never recursively
invokes itself, selects a second ticket, performs manual verification, closes
documentation, stages changes, commits, pushes, merges, or removes the worktree.
The final output identifies the ticket, branch, worktree, and exact human steps.
Autopilot deliberately passes no worker-backend option and remains Codex-only;
Hermes is available only from an explicit direct ticket-run invocation.

## Retrospective flow

After a ticket run—or after manual verification supplies additional evidence—run
a read-only retrospective against one explicit evidence directory:

```bash
./scripts/codex/retrospective.sh \
  T0001 \
  .codex-runs/T0001/TIMESTAMP \
  .codex-runs/manual/T0001.md
```

The manual record is optional. The `$harness-retrospective` workflow reads only
the named evidence, ticket, checks, review findings, and manual record. It
distinguishes one-off implementation defects from repeated or systemic harness
failures and emits either no improvement or one highest-value proposal.

The wrapper accepts only the latest timestamped direct ticket-run directory at
`.codex-runs/<ticket-id>/<timestamp>/`, verifies its metadata names that ticket
and the `ticket-runner` workflow, and rejects planning, review, closure,
retrospective, stale, or cross-ticket evidence. An optional manual record must
be named `.codex-runs/manual/<ticket-id>.md` or
`.codex-runs/manual/<ticket-id>-*.md`.

Recommendations prefer regression tests, deterministic checks, ticket
clarification, architecture clarification, skill updates, then `AGENTS.md`
updates. Structured results are stored below
`.codex-runs/retrospectives/<ticket-id>/<timestamp>/`. Every proposal remains
`PENDING`, forbids product-scope changes, and requires separate human approval.

## Harness-improvement approval

Do not edit a retrospective result to approve it. Create a separate ignored
record such as `.codex-runs/approvals/HR-example.md`. First compute the exact
proposal digest:

```bash
shasum -a 256 .codex-runs/retrospectives/T0001/TIMESTAMP/result.json
```

Bind the approval to both the proposal ID and digest:

```text
Harness improvement approval: Approved
Proposal ID: HR-example
Proposal SHA-256: SHA256_FROM_THE_COMMAND
Approved by: NAME
Reason: WHY THIS ONE CHANGE IS APPROVED
```

Preview the exact approved proposal without starting a writer:

```bash
./scripts/codex/apply-harness-improvement.sh \
  .codex-runs/retrospectives/T0001/TIMESTAMP/result.json \
  .codex-runs/approvals/HR-example.md \
  --dry-run
```

Apply it explicitly from a clean working tree:

```bash
./scripts/codex/apply-harness-improvement.sh \
  .codex-runs/retrospectives/T0001/TIMESTAMP/result.json \
  .codex-runs/approvals/HR-example.md \
  --execute
```

The `$harness-improve` workflow validates the pending proposal and digest-bound
separate approval before starting exactly one `harness_improver`. File manifests enforce
both proposal-specific paths and the global harness-only boundary: tests,
scripts, `AGENTS.md`, `.codex/`, `.agents/`, ticket templates, and this workflow
document. Product code and product requirements are prohibited.

The improver runs proposal checks and the doctor, then a fresh
`ticket_reviewer` performs independent read-only harness review. One focused
repair may reuse the same improver; a second writer is forbidden. The script
exits nonzero on failed validation, prohibited paths, blocking review, product
scope change, or an unconfirmed one-writer result. It stops before staging,
commit, push, or merge.

## Worktree isolation

Autopilot creates a branch and sibling worktree from a verified clean `main` so
ticket changes cannot dirty the canonical checkout. The worktree remains after
the run for evidence inspection, manual verification, closure, and human Git
decisions. Never point two writing workflows at the same worktree.

Worktrees do not relax ticket status, dependency, validation, review, or human
approval gates. Remove an abandoned worktree only after inspecting and retaining
needed evidence, and perform that cleanup manually outside the harness scripts.

## Scheduling criteria

No recurring scheduler is enabled. Do not schedule write-capable autopilot until
all of these conditions are demonstrated across multiple manually supervised
runs:

- dry-run selection consistently chooses the intended single ticket;
- ticket statuses and dependencies remain accurate;
- clean-main and worktree isolation failures are deterministic;
- runner evidence, review, and recovery are reliable;
- manual verification and closure remain explicitly human initiated;
- credential, sandbox, and approval behavior is understood on the host;
- failed runs do not trigger automatic retries or a second ticket.

Until then, scheduling may invoke read-only `doctor.sh`, planning dry-runs,
autopilot dry-runs, reviews, or retrospectives only. Any future scheduler is a
separate reviewed harness proposal and must not create a recursive loop.

## Optional GitHub review

`.github/workflows/codex-review.yml.example` is an opt-in, read-only template
using `openai/codex-action@v1`. It checks out the proposed merge commit with full
history, blocks untrusted fork PRs from the secret-bearing job, uses the
repository independent-review prompt, and uploads the result as an artifact.

To enable it, first review repository and fork-security requirements, configure
`OPENAI_API_KEY` as a GitHub secret, then copy the example:

```bash
cp .github/workflows/codex-review.yml.example .github/workflows/codex-review.yml
```

The example does not apply patches, commit, or merge.

## Run artifacts

Local evidence is stored below `.codex-runs/`:

- `<ticket-id>/<timestamp>/` for ticket runs;
- `reviews/<ticket-id>/<timestamp>/` for independent reviews;
- `closures/<ticket-id>/<timestamp>/` for documentation closure;
- `manual/` for human verification records.
- `planning/PROJECT/<timestamp>/` for three-ticket planning results;
- `retrospectives/<ticket-id>/<timestamp>/` for structured retrospective output;
- `improvements/<proposal-id>/<timestamp>/` for approved harness-improvement
  evidence;
- the dedicated autopilot worktree's `.codex-runs/<ticket-id>/<timestamp>/` for
  its one ticket run.

Artifacts include status snapshots, metadata, Codex events or review output,
structured results where supported, stderr, file manifests for closure, and diff
summaries. They are ignored by Git except for `.codex-runs/.gitkeep`.
The direct ticket runner installs a fail-closed artifact finalizer before Codex
starts. Because the Codex orchestrator must inherit the same allowlisted
provider values that the later Hermes wrapper may need, the finalizer replaces
every exact nonempty provider value, longest first, across every regular file in
the run directory after Codex stops. It performs symlink-safe atomic rewrites on
success, failure, and handled `HUP`, `INT`, or `TERM` interruption; redaction
failure makes the runner fail. An uncatchable `KILL` or host power loss cannot
run process cleanup, so raw ignored evidence should still be treated as
sensitive until the runner returns.
For explicit Hermes file auth, that warning includes the temporary mode-0600
auth copy below the run's ephemeral home. A normally returned run removes it;
an interrupted stale home must be recovered using the procedure above before a
fresh run.
An opted-in Hermes run additionally stores Codex evidence below
`phases/gate/`, `phases/verification/`, `phases/audit/`, and `phases/review/`,
the exact `hermes-gates.json` contract, bounded fixed invocation metadata, a
single-invocation marker, `verification-evidence.json`, bounded per-command logs
below `verification-commands/`, and bounded redacted final output below that
ticket run's `hermes/` directory. The ignored `toolchain.json` and regular-file
launchers retain the frozen executable selection used by the run without
placing source directories on agent PATH. Its temporary home, composed prompt,
and disposable verification mirror are removed before the workflow returns.

Raw model traces are local evidence, not automatically trusted proof. Summarize
accepted evidence into ticket documentation rather than committing raw traces.

## Troubleshooting

### Project agents do not load

Open Codex from the repository root, approve repository trust when prompted, and
restart Codex. Then run `./scripts/codex/doctor.sh`.

### A skill is not visible

Restart Codex after adding or changing `.agents/skills/`. Confirm the skill's
`SKILL.md` has valid `name` and `description` frontmatter.

### A CLI flag is unsupported

Run `codex --version`, `codex exec --help`, and `codex review --help`. Upgrade the
CLI through the installation method reported by `codex doctor --json`; for the
current Homebrew installation the command is:

```bash
brew upgrade --cask codex
```

Do not copy unsupported flags into scripts. Preserve read-only gates through the
documented `codex exec --sandbox read-only` fallback.

### Seatbelt validation fails inside Codex

macOS refuses a nested `sandbox-exec` profile from inside an already sandboxed
Codex tool process. Run `./scripts/codex/doctor.sh` or
`python3 -I scripts/codex/validate-harness.py` from a normal trusted host shell
to exercise the Hermes containment fixtures. Production Hermes selection also
fails closed if Seatbelt cannot apply; never skip the profile or substitute a
prompt-only claim.

### Non-interactive approval fails

This is expected when a run needs new authority. Inspect the request and rerun
interactively if a human chooses to grant it; do not weaken the script sandbox.

### The working tree is dirty

Inspect `git status --short`. Preserve unrelated changes and stop when they
cannot be separated safely from the selected ticket.

### A ticket is blocked by conflicting documents

Reconcile the authoritative ticket, accepted ADRs, and architecture before
implementation. `docs/TICKETS.md` is an index, while the individual ticket owns
its detailed status and scope.

### Review loops

Use at most one focused repair cycle with the same worker and one fresh review.
Stop as `BLOCKED` or `PARTIAL` if significant findings remain.

### Manual evidence is missing

Do not run closure. Complete the exact ticket steps and provide an explicit
`Manual verification: Pass` record first.

### Automated run recovery

Do not rerun blindly. Keep the failed branch and worktree unchanged, inspect the
run's `events.jsonl`, `codex.stderr.log`, structured result, status snapshots,
and diff summary, and determine whether any partial changes are safe to retain.
Run the relevant deterministic command manually. If the cause may be systemic,
run `retrospective.sh` against that exact evidence directory and seek approval
for at most one durable improvement.

After diagnosis, a human chooses whether to continue in the same isolated
worktree, discard it, or write a clarifying ticket. The harness never resets,
cleans, deletes a worktree, or automatically retries.

### Harness proposal is rejected or stale

Leave the retrospective result unchanged. Record rejection separately or create
a new retrospective from newer evidence. `apply-harness-improvement.sh` refuses
missing, ambiguous, mismatched, product-scope, or non-pending proposals before a
writer starts.
