# Independent ticket review

Invoke the repository `$ticket-review` skill for the ticket path supplied after
this prompt. Review the selected ticket against the requested current changes.

Remain read-only. Prioritize acceptance criteria, correctness, regressions,
architecture, scope, dependencies, documentation accuracy, and tests. Include
staged, unstaged, and untracked changes when the request is for an uncommitted
review. Return findings in severity order with concrete paths, lines when
available, impact, and recommended actions.

End with exactly one line in the form `OVERALL_RESULT: <result>`, where
`<result>` is `PASS`, `PASS_WITH_NONBLOCKING_FINDINGS`, or `BLOCKED`.
