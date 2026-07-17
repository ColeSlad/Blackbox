# Product Definition

## Product summary

Blackbox is a transactional runtime and causal debugger for teams of autonomous coding agents. It captures each agent's declared intent and observed effects, stages work in isolated Git worktrees, detects cross-agent conflicts before merge, and reconstructs the earliest decisive cause when an integration run fails.

The MVP focuses on parallel Codex agents working in a single software repository. It is designed to make multi-agent development safer, reproducible, and understandable without requiring teams to trust opaque agent behavior.

## Target users

Primary users:

- Engineers and technical founders running multiple Codex agents against one repository.
- Developer-platform teams building internal multi-agent coding systems.
- AI infrastructure engineers evaluating agent orchestration strategies.
- Engineering managers who need evidence that agent-generated changes are safe to merge.

Secondary users:

- Researchers studying multi-agent coordination, failure attribution, and agent reliability.
- Agent-framework vendors that need a reference runtime for transactional execution and debugging.

## User problem

Parallel coding agents can produce individually reasonable changes that are collectively unsafe. Git detects textual merge conflicts, but it does not reliably detect semantic conflicts such as incompatible API assumptions, stale schemas, changed authorization contracts, invalidated plans, or migrations that only fail after integration.

When a run fails, existing traces often show what happened but not:

- Which assumption first became invalid.
- Which agent introduced or propagated the failure.
- Whether the failure depended on execution order.
- Which proposed guardrail would prevent recurrence without blocking valid work.

Users need a runtime that prevents unsafe effects when possible and provides reproducible, evidence-backed diagnosis when prevention fails.

## Primary user journey

1. The user initializes Blackbox in a Git repository and defines an agent run containing two or more coding tickets.
2. Each agent receives an isolated worktree and submits an intent contract describing its goal, expected reads, expected writes, assumptions, public contract changes, and required validations.
3. Blackbox admits, warns, delays, or rejects work based on declared and observed conflicts.
4. Agents execute through an instrumented command and filesystem boundary. Blackbox records commands, file reads and writes, patches, test results, resource versions, and important agent decisions.
5. Blackbox stages each completed change and runs ticket-level and cross-agent integration checks before accepting it.
6. When validation succeeds, the user receives a merge-ready result with an execution record and evidence for each acceptance criterion.
7. When validation fails, the user receives a causal failure report identifying the earliest decisive step, affected agents, relevant evidence, replay instructions, and candidate prevention rules.
8. The user may approve a proposed rule, rerun the scenario, and compare safety, completion rate, and overblocking.

## MVP capabilities

- Create a run containing multiple coding-agent tickets and isolated Git worktrees.
- Accept and validate a structured intent contract for every writing agent.
- Record an append-only execution ledger containing agent, command, tool, file, patch, test, validation, and state-transition events.
- Compare declared intent with observed reads and writes.
- Detect deterministic conflicts including overlapping writes, stale base commits, changed files, changed symbols, migration collisions, and invalidated declared assumptions.
- Stage completed patches and run repository-defined validation commands before merge eligibility.
- Build a causal dependency graph linking observations, assumptions, decisions, mutations, validations, and outcomes.
- Reproduce a failed integration run from recorded repository state and command inputs when external nondeterminism is not involved.
- Produce an evidence-backed failure report with an earliest decisive step and contributing causal chain.
- Generate candidate deterministic guardrails from known failure classes and evaluate them against recorded scenarios.
- Provide a local web interface showing run status, agent intents, execution timelines, conflicts, validation evidence, and failure reports.

## Non-goals

- Acting as a general-purpose coding agent or replacing Codex.
- Supporting arbitrary enterprise APIs, financial transactions, email, CRM, Kubernetes, or production deployments in the MVP.
- Guaranteeing deterministic replay of model generation or uncontrolled external services.
- Automatically merging changes into a protected branch without a user-controlled policy.
- Fully autonomous synthesis and activation of semantic policies without human approval.
- Solving general distributed transactions across unrelated external systems.
- Providing model training, fine-tuning, or weight-level interpretability.
- Serving as a hosted multi-tenant SaaS platform in the first implementation.
- Detecting every possible semantic code conflict. The MVP prioritizes explicit, observable, and testable conflict classes.

## Product principles

- **Observe actual effects, not just agent narration.** Declared intent is useful but never treated as complete or authoritative.
- **State changes define success.** A plausible explanation is not a substitute for a correct repository and passing validations.
- **Stage before commit.** Consequential changes must be validated at the durability boundary.
- **Evidence before attribution.** Failure reports must link claims to recorded events, versions, commands, diffs, and test outcomes.
- **Prefer deterministic checks.** Language-model judgment may enrich analysis but must not replace available programmatic validation.
- **Make uncertainty visible.** Causal conclusions and semantic conflicts must expose confidence and alternative explanations.
- **Do not overblock silently.** Every rejection or delay must include a reason, evidence, and a path to resolution.
- **Human approval remains the final authority.** Learned guardrails and merges remain reviewable in the MVP.
- **Local-first and inspectable.** The core system should run locally and store data in formats users can inspect and export.
- **Framework-neutral event model.** Codex is the first integration, but core data structures must not depend on one agent framework.

## Success criteria

The MVP succeeds when all of the following are demonstrably true:

1. A user can configure and run at least four parallel Codex coding tickets against one repository using isolated worktrees.
2. Blackbox records enough information to reconstruct which agent executed each command, touched each file, produced each patch, and satisfied or failed each validation.
3. The system reliably blocks or flags all seeded deterministic conflict scenarios in the MVP benchmark, including overlapping writes, stale-base writes, migration identifier collisions, and changes that invalidate declared file-version assumptions.
4. A clean multi-agent run can complete without manual repair caused by the control plane itself.
5. A seeded integration failure can be reproduced from a recorded repository snapshot and command sequence.
6. For benchmark failures with known ground truth, the failure report identifies the expected earliest decisive event or an explicitly accepted equivalent causal event.
7. Every failure claim in the UI links to concrete evidence in the execution ledger.
8. Candidate guardrails can be evaluated against both failing and successful recorded scenarios, with false-positive blocking reported.
9. The complete demo runs locally from documented commands on a clean machine.
10. Build, lint, type checking, automated tests, production build, and documented manual verification all pass.

Initial benchmark targets:

- 100% recall on the deterministic conflict classes implemented by the MVP.
- At least 90% replay success for scenarios whose dependencies are fully local and recorded.
- At least 80% exact-or-equivalent earliest-decisive-step accuracy on a curated set of twenty ground-truth failure scenarios.
- Less than 10% unnecessary blocking on a curated set of safe parallel scenarios.
- No unexplained state mutation outside an agent's recorded transaction boundary.

These are development targets, not claims of general reliability outside the benchmark.

## Open product questions

- Should the first user experience orchestrate Codex directly, or wrap an existing user-managed Codex process?
- How much intent-contract authoring should be explicit versus inferred from the ticket and runtime behavior?
- Which conflict classes create enough value to justify hard blocking rather than warnings?
- Should the MVP support one shared integration branch, a merge queue, or dependency-ordered patch application?
- What is the smallest useful causal report that engineers will trust during daily development?
- Should model prompts and responses be stored by default, redacted, hashed, or optional?
- What evidence is sufficient to call an event the earliest decisive cause rather than merely correlated?
- Should guardrails be repository-specific, organization-wide, or both?
- How should the product represent jointly caused failures without forcing a single-agent blame assignment?
- Which parts of a run should be exportable as a portable replay bundle?