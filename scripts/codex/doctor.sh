#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

ROOT=$(repository_root)
cd "$ROOT"

failures=0

pass_check() {
  printf '[PASS] %s\n' "$1"
}

warn_check() {
  printf '[WARN] %s\n' "$1"
}

fail_check() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

check_file() {
  if [[ -f "$1" ]]; then
    pass_check "$1 exists"
  else
    fail_check "$1 is missing"
  fi
}

printf 'Repository root: %s\n' "$ROOT"
printf '%s\n' 'Working tree:'
git status --short --branch

for document in \
  AGENTS.md \
  .codex/config.toml \
  .gitignore \
  .codex-runs/.gitkeep \
  docs/PRODUCT.md \
  docs/ARCHITECTURE.md \
  docs/STATUS.md \
  docs/TICKETS.md \
  docs/VERIFICATION.md \
  docs/CODEX_WORKFLOW.md; do
  check_file "$document"
done

if [[ -d docs/tickets ]]; then
  pass_check "docs/tickets exists"
else
  fail_check "docs/tickets is missing"
fi

if command -v python3 >/dev/null 2>&1; then
  pass_check "python3 is available"
else
  fail_check "python3 is required by the harness scripts"
fi

if command -v codex >/dev/null 2>&1; then
  pass_check "codex is available: $(codex --version 2>/dev/null)"
else
  fail_check "codex is not available"
fi

if codex exec --help >/dev/null 2>&1; then
  pass_check "codex exec is available"
else
  fail_check "codex exec is unavailable"
fi

if codex review --help >/dev/null 2>&1; then
  pass_check "codex review is available"
else
  fail_check "codex review is unavailable"
fi

if codex features list 2>/dev/null | awk '$1 == "multi_agent" && $3 == "true" { found = 1 } END { exit !found }'; then
  pass_check "Codex multi-agent support is enabled"
else
  fail_check "Codex multi-agent support is not enabled"
fi

for agent in \
  plan-validator \
  project-explorer \
  ticket-worker \
  ticket-reviewer \
  verification-auditor \
  ticket-closer; do
  check_file ".codex/agents/$agent.toml"
done

for agent in plan-validator project-explorer ticket-reviewer verification-auditor; do
  file=".codex/agents/$agent.toml"
  if [[ -f "$file" ]] && grep -Eq '^sandbox_mode = "read-only"$' "$file"; then
    pass_check "$agent is read-only"
  else
    fail_check "$agent must use a read-only sandbox"
  fi
done

if grep -Eq '^sandbox_mode = "workspace-write"$' .codex/agents/ticket-worker.toml; then
  pass_check "ticket-worker is the implementation writer"
else
  fail_check "ticket-worker must use workspace-write"
fi

if grep -Eq '^sandbox_mode = "workspace-write"$' .codex/agents/ticket-closer.toml \
  && grep -Fq 'Modify documentation only' .codex/agents/ticket-closer.toml; then
  pass_check "ticket-closer is documentation-only"
else
  fail_check "ticket-closer must be documentation-only"
fi

if grep -REn '^(model|model_provider|openai_api_key|api_key)[[:space:]]*=' .codex/config.toml .codex/agents >/dev/null 2>&1; then
  fail_check "project Codex configuration contains a model, provider, or credential override"
else
  pass_check "project Codex configuration inherits user model and credentials"
fi

for skill in ticket-runner ticket-review ticket-close; do
  check_file ".agents/skills/$skill/SKILL.md"
done

for prompt in automated-ticket-run independent-review ticket-closure; do
  check_file ".codex/prompts/$prompt.md"
done

for schema in ticket-run-result review-result closure-result; do
  check_file ".codex/schemas/$schema.schema.json"
done

for script in common doctor run-ticket review-ticket close-ticket run-next-ready; do
  check_file "scripts/codex/$script.sh"
done

if git check-ignore -q .codex-runs/doctor-evidence.tmp \
  && ! git check-ignore -q .codex-runs/.gitkeep; then
  pass_check ".codex-runs evidence is ignored and .gitkeep is preserved"
else
  fail_check ".codex-runs ignore rules are incorrect"
fi

if find .codex .agents scripts/codex .github -type f \
  \( -name '.env' -o -name '.env.*' -o -iname '*credential*' -o -iname '*secret*' \) \
  -print | grep -q .; then
  fail_check "an obvious secret filename exists in the harness"
else
  pass_check "no obvious secret files exist in the harness"
fi

if grep -REn 'sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]]' \
  .codex .agents scripts/codex docs/CODEX_WORKFLOW.md .github/workflows 2>/dev/null; then
  fail_check "a possible literal secret exists in a harness file"
else
  pass_check "no obvious literal secrets exist in harness content"
fi

if find scripts/codex -type f -name '*.sh' -print0 | xargs -0 bash -n; then
  pass_check "all harness shell scripts pass bash -n"
else
  fail_check "a harness shell script has invalid syntax"
fi

if python3 - .codex/schemas/*.schema.json <<'PY'
import json
import sys

for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as handle:
        json.load(handle)
PY
then
  pass_check "all JSON schemas parse"
else
  fail_check "a JSON schema is invalid"
fi

warn_check "project-scoped agents and skills load only when Codex trusts this repository; restart Codex after harness changes"

if ((failures > 0)); then
  printf '%s\n' "Doctor found $failures blocking failure(s)." >&2
  exit 1
fi

printf '%s\n' 'Doctor completed without blocking failures.'
