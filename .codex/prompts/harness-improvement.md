# Approved harness improvement

Invoke the repository `$harness-improve` skill for the supplied structured
proposal and separate ID-and-SHA-256-bound approval record.

Validate both before writing. Use exactly one `harness_improver` as the sole
writer, enforce the allowed harness paths, run deterministic checks, and obtain
a fresh independent read-only review. Never change product scope or application
code, weaken a safety gate, start a product ticket, commit, push, merge, or
schedule another run. Return `.codex/schemas/harness-improvement-result.schema.json`.
Never wait unless the preceding writer or reviewer spawn returned an active
receiver; stop as blocked if a required spawn is unavailable.
