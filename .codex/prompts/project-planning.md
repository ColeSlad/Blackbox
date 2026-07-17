# Controlled project planning

Invoke the repository `$project-plan` skill in the mode supplied after this
prompt. Use `project_planner` read-only to propose exactly three dependency-
ordered Draft tickets. In execute mode, the invoking session is the sole writer
and may create only Draft ticket specifications and necessary Draft index rows.

After reading the skill and capturing status, spawn `project_planner` before
performing any planning-source audit in the parent. The planner owns that audit.

Run a separate read-only `plan_validator` pass after creating files. Never mark a
ticket Ready, modify application code, start implementation, commit, push, or
merge. Never wait unless a preceding spawn returned an active agent receiver;
return `BLOCKED` when spawning is unavailable. Return
`.codex/schemas/project-plan-result.schema.json` output.
