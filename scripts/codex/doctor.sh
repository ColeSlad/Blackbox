#!/bin/sh

SYSTEM_PYTHON=/usr/bin/python3
: "${TMPDIR:=/tmp}"
export TMPDIR
[ -x "$SYSTEM_PYTHON" ] || {
  printf '%s\n' 'error: /usr/bin/python3 is required by the harness doctor' >&2
  exit 1
}

if [ "${CODEX_HARNESS_CLEAN_ENVIRONMENT:-}" != "2" ]; then
  unset BASH_ENV ENV CDPATH GLOBIGNORE PYTHONHOME PYTHONPATH PYTHONSTARTUP
  unset LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
  unset DYLD_FRAMEWORK_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_FALLBACK_FRAMEWORK_PATH
  unset CPATH LIBRARY_PATH MANPATH SDKROOT DEVELOPER_DIR
  exec "$SYSTEM_PYTHON" -I -c '
import os
import shutil
import sys

base_names = {
    "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG",
    "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "TZ",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "CODEX_HOME",
}
def executable(name):
    candidate = shutil.which(name)
    if not candidate:
        return ""
    resolved = os.path.realpath(candidate)
    if not os.path.isabs(resolved) or not os.path.isfile(resolved) or not os.access(resolved, os.X_OK):
        raise SystemExit(f"error: invalid resolved executable for {name}")
    return resolved

codex_executable = executable("codex")
hermes_executable = executable("hermes")
environment = {
    name: os.environ[name]
    for name in base_names
    if name in os.environ
}
environment.update({
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "TMPDIR": os.environ.get("TMPDIR") or "/tmp",
    "CODEX_HARNESS_CLEAN_ENVIRONMENT": "2",
    "CODEX_HARNESS_BOOTSTRAP_PID": str(os.getpid()),
    "CODEX_HARNESS_CODEX_EXECUTABLE": codex_executable,
    "CODEX_HARNESS_HERMES_EXECUTABLE": hermes_executable,
    "CODEX_HARNESS_TOOL_PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
})
os.execve(
    "/bin/bash",
    ["/bin/bash", "--noprofile", "--norc", sys.argv[1], *sys.argv[2:]],
    environment,
)
' "$0" "$@"
  exit 126
fi

if ! /usr/bin/env -0 | /usr/bin/env -i \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$SYSTEM_PYTHON" -I -c '
import os
import sys

environment = {}
for entry in sys.stdin.buffer.read().split(b"\0"):
    if entry:
        name, value = entry.split(b"=", 1)
        environment[os.fsdecode(name)] = os.fsdecode(value)

allowed = {
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG",
    "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "TZ",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "CODEX_HOME",
    "CODEX_HARNESS_CLEAN_ENVIRONMENT", "CODEX_HARNESS_CODEX_EXECUTABLE",
    "CODEX_HARNESS_HERMES_EXECUTABLE", "CODEX_HARNESS_TOOL_PATH",
    "CODEX_HARNESS_BOOTSTRAP_PID", "PWD",
    "OLDPWD", "SHLVL", "_",
}
unexpected = sorted(set(environment) - allowed)
if unexpected:
    print(
        "error: forged clean-environment sentinel or unexpected variables: "
        + ", ".join(unexpected),
        file=sys.stderr,
    )
    raise SystemExit(1)
if environment.get("CODEX_HARNESS_CLEAN_ENVIRONMENT") != "2":
    raise SystemExit("error: invalid clean-environment sentinel")
if environment.get("CODEX_HARNESS_BOOTSTRAP_PID") != str(os.getppid()):
    raise SystemExit("error: clean bootstrap provenance does not match this process")
if environment.get("PATH") != "/usr/bin:/bin:/usr/sbin:/sbin":
    raise SystemExit("error: clean-environment PATH is not the fixed allowlist")
for name in ("CODEX_HARNESS_CODEX_EXECUTABLE", "CODEX_HARNESS_HERMES_EXECUTABLE"):
    value = environment.get(name, "")
    if value and (
        not os.path.isabs(value)
        or os.path.realpath(value) != value
        or not os.path.isfile(value)
        or not os.access(value, os.X_OK)
    ):
        raise SystemExit(f"error: invalid clean-environment executable: {name}")
if environment.get("CODEX_HARNESS_TOOL_PATH") != "/usr/bin:/bin:/usr/sbin:/sbin":
    raise SystemExit("error: forged clean-environment sentinel: control PATH is not fixed")
'; then
  exit 1
fi
CODEX_EXECUTABLE=${CODEX_HARNESS_CODEX_EXECUTABLE:-}
HERMES_EXECUTABLE=${CODEX_HARNESS_HERMES_EXECUTABLE:-}
CODEX_TOOL_PATH=${CODEX_HARNESS_TOOL_PATH:-}
unset CODEX_HARNESS_CLEAN_ENVIRONMENT CODEX_HARNESS_BOOTSTRAP_PID CODEX_HARNESS_TOOL_PATH
unset CODEX_HARNESS_CODEX_EXECUTABLE CODEX_HARNESS_HERMES_EXECUTABLE
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

codex_probe() {
  /usr/bin/env -i \
    PATH="$CODEX_TOOL_PATH" \
    HOME="${HOME:-}" \
    USER="${USER:-}" \
    LOGNAME="${LOGNAME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-}" \
    LC_ALL="${LC_ALL:-}" \
    LC_CTYPE="${LC_CTYPE:-}" \
    TERM="${TERM:-}" \
    NO_COLOR="${NO_COLOR:-}" \
    TZ="${TZ:-}" \
    SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
    SSL_CERT_DIR="${SSL_CERT_DIR:-}" \
    REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-}" \
    CURL_CA_BUNDLE="${CURL_CA_BUNDLE:-}" \
    NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" \
    CODEX_HOME="${CODEX_HOME:-}" \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    "$CODEX_EXECUTABLE" "$@"
}

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
  docs/CODEX_WORKFLOW.md \
  docs/tickets/templates/harness-improvement.md; do
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

if [[ -n "$CODEX_EXECUTABLE" ]]; then
  pass_check "codex is available: $(codex_probe --version 2>/dev/null)"
else
  fail_check "codex is not available"
fi

if codex_probe exec --help >/dev/null 2>&1; then
  pass_check "codex exec is available"
else
  fail_check "codex exec is unavailable"
fi

if codex_probe review --help >/dev/null 2>&1; then
  pass_check "codex review is available"
else
  fail_check "codex review is unavailable"
fi

if codex_probe features list 2>/dev/null | awk '$1 == "multi_agent" && $3 == "true" { found = 1 } END { exit !found }'; then
  pass_check "Codex multi-agent support is enabled"
else
  fail_check "Codex multi-agent support is not enabled"
fi

if [[ -n "$HERMES_EXECUTABLE" ]]; then
  warn_check "Hermes is installed; the explicit ticket wrapper will probe exact capabilities in an ephemeral home before writing"
else
  warn_check "Hermes is not installed; the optional backend remains unavailable and Codex stays the default"
fi

if [[ -x /usr/bin/sandbox-exec ]]; then
  pass_check "macOS sandbox-exec is available for fail-closed Hermes containment"
else
  warn_check "macOS sandbox-exec is unavailable; the optional Hermes backend will fail closed"
fi

for agent in \
  plan-validator \
  project-explorer \
  ticket-worker \
  ticket-reviewer \
  verification-auditor \
  ticket-closer \
  project-planner \
  harness-retrospective \
  harness-improver; do
  check_file ".codex/agents/$agent.toml"
done

for agent in \
  plan-validator \
  project-explorer \
  ticket-reviewer \
  verification-auditor \
  project-planner \
  harness-retrospective; do
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

if grep -Eq '^sandbox_mode = "workspace-write"$' .codex/agents/harness-improver.toml \
  && grep -Fq 'only writer' .codex/agents/harness-improver.toml; then
  pass_check "harness-improver is the sole approved harness writer"
else
  fail_check "harness-improver must be the sole approved harness writer"
fi

if grep -REn '^(model|model_provider|openai_api_key|api_key)[[:space:]]*=' .codex/config.toml .codex/agents >/dev/null 2>&1; then
  fail_check "project Codex configuration contains a model, provider, or credential override"
else
  pass_check "project Codex configuration inherits user model and credentials"
fi

for skill in \
  ticket-runner \
  ticket-review \
  ticket-close \
  project-plan \
  harness-retrospective \
  harness-improve; do
  check_file ".agents/skills/$skill/SKILL.md"
done

for prompt in \
  automated-ticket-run \
  hermes-ticket-worker \
  independent-review \
  ticket-closure \
  project-planning \
  harness-retrospective \
  harness-improvement; do
  check_file ".codex/prompts/$prompt.md"
done

for schema in \
  ticket-run-result \
  review-result \
  closure-result \
  project-plan-result \
  retrospective-result \
  harness-improvement-result; do
  check_file ".codex/schemas/$schema.schema.json"
done

for script in \
  common \
  doctor \
  run-hermes-worker \
  run-ticket \
  review-ticket \
  close-ticket \
  run-next-ready \
  plan-next \
  retrospective \
  apply-harness-improvement \
  autopilot; do
  check_file "scripts/codex/$script.sh"
done
check_file "scripts/codex/validate-harness.py"
check_file "scripts/codex/run-codex-observed.py"
if [[ -x scripts/codex/run-hermes-worker.sh ]]; then
  pass_check "Hermes worker wrapper is executable"
else
  fail_check "Hermes worker wrapper must be executable"
fi

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

if python3 scripts/codex/validate-harness.py; then
  pass_check "deterministic harness policy validation passes"
else
  fail_check "deterministic harness policy validation failed"
fi

warn_check "project-scoped agents and skills load only when Codex trusts this repository; restart Codex after harness changes"

if ((failures > 0)); then
  printf '%s\n' "Doctor found $failures blocking failure(s)." >&2
  exit 1
fi

printf '%s\n' 'Doctor completed without blocking failures.'
