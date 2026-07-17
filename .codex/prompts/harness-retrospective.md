# Harness retrospective

Invoke the repository `$harness-retrospective` skill for the supplied ticket ID,
run-evidence directory, and optional manual-verification record.

After reading the skill and capturing status, immediately spawn
`harness_retrospective`; let it own the evidence audit instead of duplicating the
audit in the parent session.

Remain read-only. Distinguish one-off implementation defects from systemic
harness defects. Recommend at most one durable improvement using the required
preference order. Product scope is immutable in this workflow. Return a result
conforming to `.codex/schemas/retrospective-result.schema.json` with approval
still pending. Do not edit, approve, apply, commit, push, or merge.
Never call a wait operation unless the read-only agent spawn returned an active
receiver; return insufficient evidence if spawning is unavailable.
