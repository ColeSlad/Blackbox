#!/bin/sh

SYSTEM_PYTHON=/usr/bin/python3
: "${TMPDIR:=/tmp}"
export TMPDIR
[ -x "$SYSTEM_PYTHON" ] || {
  printf '%s\n' 'error: /usr/bin/python3 is required by the controlled Hermes wrapper' >&2
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

for name in os.environ:
    if name.startswith("HERMES_"):
        print(
            f"error: caller-supplied Hermes environment controls are forbidden: {name}",
            file=sys.stderr,
        )
        raise SystemExit(1)

base_names = {
    "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG",
    "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "TZ",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
}
provider_names = {
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "GEMINI_API_KEY", "OPENROUTER_API_KEY", "TOGETHER_API_KEY",
    "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY",
    "COHERE_API_KEY", "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION",
    "AWS_DEFAULT_REGION", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN",
}

candidate = shutil.which("hermes")
resolved = ""
if candidate:
    resolved = os.path.realpath(candidate)
    if not os.path.isabs(resolved) or not os.path.isfile(resolved) or not os.access(resolved, os.X_OK):
        raise SystemExit("error: invalid resolved executable for hermes")

environment = {
    name: os.environ[name]
    for name in base_names | provider_names
    if name in os.environ
}
environment.update({
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "TMPDIR": os.environ.get("TMPDIR") or "/tmp",
    "CODEX_HARNESS_CLEAN_ENVIRONMENT": "2",
    "CODEX_HARNESS_BOOTSTRAP_PID": str(os.getpid()),
    "CODEX_HARNESS_HERMES_EXECUTABLE": resolved,
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
    "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
    "OPENROUTER_API_KEY", "TOGETHER_API_KEY", "GROQ_API_KEY",
    "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY", "COHERE_API_KEY",
    "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "HF_TOKEN",
    "HUGGINGFACEHUB_API_TOKEN", "CODEX_HARNESS_CLEAN_ENVIRONMENT",
    "CODEX_HARNESS_HERMES_EXECUTABLE", "CODEX_HARNESS_BOOTSTRAP_PID",
    "PWD", "OLDPWD", "SHLVL", "_",
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
value = environment.get("CODEX_HARNESS_HERMES_EXECUTABLE", "")
if value and (
    not os.path.isabs(value)
    or os.path.realpath(value) != value
    or not os.path.isfile(value)
    or not os.access(value, os.X_OK)
):
    raise SystemExit("error: invalid clean-environment Hermes executable")
'; then
  exit 1
fi
HERMES_BIN=${CODEX_HARNESS_HERMES_EXECUTABLE:-}
unset CODEX_HARNESS_CLEAN_ENVIRONMENT CODEX_HARNESS_BOOTSTRAP_PID CODEX_HARNESS_HERMES_EXECUTABLE
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

if (($# != 3 && $# != 5)); then
  fail "usage: $0 TICKET_PATH RUN_DIRECTORY GATE_EVIDENCE_FILE [AUTH_SOURCE AUTH_PROVIDER]; arbitrary Hermes flags are forbidden"
fi

for argument in "${@:1:3}"; do
  if [[ "$argument" == -* ]]; then
    fail "Hermes wrapper flags are forbidden: $argument"
  fi
done
HERMES_AUTH_SOURCE=${4:-}
HERMES_AUTH_PROVIDER=${5:-}
if [[ -n "$HERMES_AUTH_SOURCE" || -n "$HERMES_AUTH_PROVIDER" ]]; then
  [[ "$HERMES_AUTH_SOURCE" == "user-hermes" && "$HERMES_AUTH_PROVIDER" == "openai-codex" ]] || fail "internal Hermes auth selection is invalid"
fi

ROOT=$(repository_root)
require_command python3
TICKET_FILE=$(resolve_repo_file "$ROOT" "$1") || fail "ticket path must name a file inside the repository"
TICKET_PATH=$(repo_relative_path "$ROOT" "$TICKET_FILE")
RUN_DIR=$(resolve_repo_directory "$ROOT" "$2") || fail "run directory must exist inside the repository"
GATE_FILE=$(resolve_repo_file "$ROOT" "$3") || fail "gate evidence must name a file inside the repository"
PROMPT_FILE="$ROOT/.codex/prompts/hermes-ticket-worker.md"
cd "$ROOT"

[[ -f "$ROOT/.git" ]] || fail "Hermes requires an existing linked Git worktree; the primary checkout is not permitted"
python3 -I - "$ROOT" "$RUN_DIR" "$GATE_FILE" "$TICKET_PATH" <<'PY' || fail "run evidence does not match the immutable current worktree identity"
import json
import os
import subprocess
import sys

root, run_dir, gate_file, ticket_path = sys.argv[1:]
root = os.path.realpath(root)
run_dir = os.path.realpath(run_dir)
gate_file = os.path.realpath(gate_file)
evidence_root = os.path.join(root, ".codex-runs")
if os.path.commonpath([evidence_root, run_dir]) != evidence_root:
    raise SystemExit(1)
if os.path.commonpath([run_dir, gate_file]) != run_dir:
    raise SystemExit(1)
with open(os.path.join(run_dir, "metadata.json"), encoding="utf-8") as handle:
    metadata = json.load(handle)
if metadata.get("workflow") != "ticket-runner":
    raise SystemExit(1)
if metadata.get("ticket_path") != ticket_path:
    raise SystemExit(1)
if metadata.get("worker_backend") != "HERMES":
    raise SystemExit(1)

def git(*arguments, allow_failure=False):
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0 and not allow_failure:
        raise SystemExit(1)
    return result.stdout.strip()

canonical_root = os.path.realpath(git("rev-parse", "--show-toplevel"))
git_dir = os.path.realpath(git("rev-parse", "--absolute-git-dir"))
git_common_dir = os.path.realpath(
    git("rev-parse", "--path-format=absolute", "--git-common-dir")
)
head = git("rev-parse", "--verify", "HEAD")
branch_result = subprocess.run(
    ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd=root,
    check=False,
    capture_output=True,
    text=True,
    env=os.environ.copy(),
)
branch = branch_result.stdout.strip() if branch_result.returncode == 0 else None
registered_output = git("worktree", "list", "--porcelain")
registered = {
    os.path.realpath(line.removeprefix("worktree "))
    for line in registered_output.splitlines()
    if line.startswith("worktree ")
}
identity = {
    "canonical_root": canonical_root,
    "git_dir": git_dir,
    "git_common_dir": git_common_dir,
    "head": head,
    "branch": branch,
}
if canonical_root != root or root not in registered:
    raise SystemExit(1)
if metadata.get("worktree_identity") != identity:
    raise SystemExit(1)
PY

RUN_RELATIVE=$(repo_relative_path "$ROOT" "$RUN_DIR")
git check-ignore -q "$RUN_RELATIVE" || fail "Hermes run evidence must be stored under an ignored path"

[[ -f "$PROMPT_FILE" ]] || fail "Hermes worker prompt is missing"
[[ $(wc -c <"$PROMPT_FILE") -le 131072 ]] || fail "Hermes base prompt exceeds 131072 bytes"
"$SYSTEM_PYTHON" -I - "$GATE_FILE" <<'PY' || fail "gate evidence is not the exact approved Hermes contract"
import json
import os
import stat
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


path = sys.argv[1]
descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    details = os.fstat(descriptor)
    if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= 1024:
        raise SystemExit(1)
    content = os.read(descriptor, 1025)
finally:
    os.close(descriptor)
try:
    evidence = json.loads(content.decode("utf-8"), object_pairs_hook=unique_object)
except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
    raise SystemExit(1)
if evidence != {
    "worker_backend": "HERMES",
    "validator": "GO",
    "explorer": "GO",
}:
    raise SystemExit(1)
PY

[[ -n "$HERMES_BIN" ]] || fail "Hermes is unavailable; install and authenticate it outside this harness before opting in"

"$SYSTEM_PYTHON" -I - <<'PY'
import os

provider_names = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "TOGETHER_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "COHERE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "HF_TOKEN",
    "HUGGINGFACEHUB_API_TOKEN",
)
for name in provider_names:
    value = os.environ.get(name)
    if value and not 4 <= len(value.encode("utf-8")) <= 8192:
        raise SystemExit(
            f"error: provider value length is outside the safe bound: {name}"
        )
PY

HERMES_EVIDENCE_DIR="$RUN_DIR/hermes"
HERMES_OUTPUT="$HERMES_EVIDENCE_DIR/final-output.log"
HERMES_INVOCATION="$HERMES_EVIDENCE_DIR/invocation.md"
HERMES_MARKER="$HERMES_EVIDENCE_DIR/implementation-invocation.started"
SEATBELT_EXECUTABLE=/usr/bin/sandbox-exec
[[ -x "$SEATBELT_EXECUTABLE" ]] || fail "Hermes requires macOS sandbox-exec; no weaker fallback is permitted"
mkdir -p "$HERMES_EVIDENCE_DIR"
[[ ! -e "$HERMES_EVIDENCE_DIR/home" ]] || fail "ephemeral Hermes home already exists; use a fresh run directory"

exec "$SYSTEM_PYTHON" -I - \
  "$HERMES_BIN" \
  "$ROOT" \
  "$RUN_DIR" \
  "$PROMPT_FILE" \
  "$GATE_FILE" \
  "$TICKET_PATH" \
  "$HERMES_OUTPUT" \
  "$HERMES_INVOCATION" \
  "$HERMES_MARKER" \
  "$SEATBELT_EXECUTABLE" \
  "$HERMES_AUTH_SOURCE" \
  "$HERMES_AUTH_PROVIDER" <<'PY'
import atexit
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time

(
    executable,
    root,
    run_dir,
    prompt_path,
    gate_path,
    ticket_path,
    output_path,
    invocation_path,
    marker_path,
    seatbelt_executable,
    auth_source_selector,
    auth_provider_selector,
) = sys.argv[1:]
root = os.path.realpath(root)
run_dir = os.path.abspath(run_dir)
evidence_dir = os.path.join(run_dir, "hermes")
home_path = os.path.join(evidence_dir, "home")
no_follow = getattr(os, "O_NOFOLLOW", 0)
directory_flag = getattr(os, "O_DIRECTORY", 0)
managed_signals = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)
active_process = None
cleanup_complete = False
home_relocated = False
file_auth_selected = (
    auth_source_selector == "user-hermes"
    and auth_provider_selector == "openai-codex"
)
if bool(auth_source_selector) != bool(auth_provider_selector) or (
    (auth_source_selector or auth_provider_selector) and not file_auth_selected
):
    raise SystemExit("invalid internal Hermes auth selection")
caller_home = os.environ.get("HOME", "")
canonical_caller_home = os.path.realpath(caller_home) if caller_home else ""
auth_source_path = (
    os.path.join(canonical_caller_home, ".hermes", "auth.json")
    if file_auth_selected
    else None
)
sensitive_values = ()


def command_output(*arguments):
    result = subprocess.run(
        ["git", "-C", root, *arguments],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Git identity command failed: {arguments}")
    return result.stdout.strip()


git_dir = os.path.realpath(command_output("rev-parse", "--absolute-git-dir"))
git_common_dir = os.path.realpath(
    command_output("rev-parse", "--path-format=absolute", "--git-common-dir")
)
registered_roots = tuple(
    sorted(
        os.path.realpath(line.removeprefix("worktree "))
        for line in command_output("worktree", "list", "--porcelain").splitlines()
        if line.startswith("worktree ")
    )
)
protected_paths = tuple(
    path
    for path in (
        os.path.join(root, "AGENTS.md"),
        os.path.join(root, ".codex"),
        os.path.join(root, ".agents"),
        os.path.join(root, "scripts", "codex"),
        os.path.join(root, "docs", "PRODUCT.md"),
        os.path.join(root, "docs", "ARCHITECTURE.md"),
        os.path.join(root, "docs", "STATUS.md"),
        os.path.join(root, "docs", "TICKETS.md"),
        os.path.join(root, "docs", "VERIFICATION.md"),
        os.path.join(root, "docs", "adrs"),
        os.path.join(root, "docs", "adr"),
        os.path.join(root, "docs", "tickets"),
    )
    if os.path.lexists(path)
)


def digest_file(path):
    descriptor = os.open(path, os.O_RDONLY | no_follow)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode):
            raise RuntimeError("immutable Hermes input is not a regular file")
        hasher = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            hasher.update(chunk)
        return hasher.hexdigest()
    finally:
        os.close(descriptor)


immutable_inputs = {
    path: digest_file(path)
    for path in (prompt_path, gate_path, os.path.join(root, ticket_path))
}


def assert_immutable_inputs():
    if {path: digest_file(path) for path in immutable_inputs} != immutable_inputs:
        raise RuntimeError("Hermes controller input changed before implementation")

os.mkdir(home_path, 0o700)
home_descriptor = os.open(
    home_path,
    os.O_RDONLY | directory_flag | no_follow,
)
expected_home = os.fstat(home_descriptor)
expected_home_identity = (expected_home.st_dev, expected_home.st_ino)
root_descriptor = os.open(root, os.O_RDONLY | directory_flag | no_follow)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def validate_openai_auth_document(document, *, minimal):
    if not isinstance(document, dict):
        raise ValueError("unsupported Hermes auth schema")
    allowed_top_level = {
        "version",
        "providers",
        "active_provider",
        "updated_at",
        "credential_pool",
    }
    if set(document) - allowed_top_level or type(document.get("version")) is not int:
        raise ValueError("unsupported Hermes auth schema")
    if document["version"] != 1:
        raise ValueError("unsupported Hermes auth schema")
    providers = document.get("providers")
    if not isinstance(providers, dict):
        raise ValueError("unsupported Hermes auth schema")
    if minimal and set(providers) != {"openai-codex"}:
        raise ValueError("unsupported ephemeral Hermes auth schema")
    if any(not isinstance(name, str) for name in providers):
        raise ValueError("unsupported Hermes auth schema")
    credential_pool = document.get("credential_pool")
    if credential_pool is not None and not isinstance(credential_pool, dict):
        raise ValueError("unsupported Hermes auth schema")
    for timestamp_name in ("updated_at",):
        timestamp = document.get(timestamp_name)
        if timestamp is not None and (
            not isinstance(timestamp, str) or not 1 <= len(timestamp.encode("utf-8")) <= 256
        ):
            raise ValueError("unsupported Hermes auth schema")
    active_provider = document.get("active_provider")
    if active_provider is not None and (
        not isinstance(active_provider, str)
        or not 1 <= len(active_provider.encode("utf-8")) <= 128
    ):
        raise ValueError("unsupported Hermes auth schema")

    state = providers.get("openai-codex")
    if not isinstance(state, dict) or set(state) - {
        "tokens",
        "last_refresh",
        "auth_mode",
        "label",
    }:
        raise ValueError("missing or unsupported openai-codex credential record")
    if state.get("auth_mode") != "chatgpt":
        raise ValueError("unsupported openai-codex authentication mode")
    last_refresh = state.get("last_refresh")
    if last_refresh is not None and (
        not isinstance(last_refresh, str)
        or not 1 <= len(last_refresh.encode("utf-8")) <= 256
    ):
        raise ValueError("unsupported openai-codex refresh metadata")
    label = state.get("label")
    if label is not None and (
        not isinstance(label, str) or not 1 <= len(label.encode("utf-8")) <= 256
    ):
        raise ValueError("unsupported openai-codex label")

    tokens = state.get("tokens")
    allowed_token_names = {
        "access_token",
        "refresh_token",
        "id_token",
        "account_id",
    }
    if not isinstance(tokens, dict) or set(tokens) - allowed_token_names:
        raise ValueError("unsupported openai-codex token record")
    for required_name in ("access_token", "refresh_token"):
        value = tokens.get(required_name)
        if not isinstance(value, str) or not 4 <= len(value.encode("utf-8")) <= 65536:
            raise ValueError("missing or unbounded openai-codex token")
    selected_tokens = {}
    selected_sensitive = []
    for name in ("access_token", "refresh_token", "id_token", "account_id"):
        if name not in tokens:
            continue
        value = tokens[name]
        if not isinstance(value, str) or not 1 <= len(value.encode("utf-8")) <= 65536:
            raise ValueError("invalid or unbounded openai-codex token field")
        selected_tokens[name] = value
        selected_sensitive.append(value.encode("utf-8"))
    selected_state = {
        "tokens": selected_tokens,
        "auth_mode": "chatgpt",
    }
    if last_refresh is not None:
        selected_state["last_refresh"] = last_refresh
    return selected_state, tuple(selected_sensitive)


def read_bounded_regular(descriptor, maximum_size):
    before = os.fstat(descriptor)
    if (
        not stat.S_ISREG(before.st_mode)
        or not 0 < before.st_size <= maximum_size
    ):
        raise ValueError("credential source is not a bounded regular file")
    content = bytearray()
    while len(content) <= maximum_size:
        chunk = os.read(descriptor, min(65536, maximum_size + 1 - len(content)))
        if not chunk:
            break
        content.extend(chunk)
    after = os.fstat(descriptor)
    stable_fields = (
        "st_dev",
        "st_ino",
        "st_uid",
        "st_gid",
        "st_mode",
        "st_size",
        "st_mtime_ns",
        "st_ctime_ns",
    )
    if len(content) != before.st_size or any(
        getattr(before, field) != getattr(after, field) for field in stable_fields
    ):
        raise ValueError("credential source changed while read")
    return before, bytes(content)


def open_canonical_auth_parent():
    if (
        not caller_home
        or not os.path.isabs(caller_home)
        or os.path.normpath(caller_home) != caller_home
        or canonical_caller_home != caller_home
        or caller_home == os.path.sep
    ):
        raise ValueError("caller home is not canonical")
    parts = [part for part in caller_home.split(os.path.sep) if part]
    if any(part in (".", "..") for part in parts):
        raise ValueError("caller home is not canonical")
    descriptor = os.open(os.path.sep, os.O_RDONLY | directory_flag | no_follow)
    try:
        for index, part in enumerate((*parts, ".hermes")):
            details = os.stat(part, dir_fd=descriptor, follow_symlinks=False)
            child = os.open(
                part,
                os.O_RDONLY | directory_flag | no_follow,
                dir_fd=descriptor,
            )
            opened = os.fstat(child)
            if (
                not stat.S_ISDIR(details.st_mode)
                or (details.st_dev, details.st_ino) != (opened.st_dev, opened.st_ino)
            ):
                os.close(child)
                raise ValueError("caller auth directory changed identity")
            if index >= len(parts) - 1 and opened.st_uid != os.getuid():
                os.close(child)
                raise ValueError("caller auth directory has the wrong owner")
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def import_selected_auth():
    parent_descriptor = open_canonical_auth_parent()
    try:
        entry = os.stat("auth.json", dir_fd=parent_descriptor, follow_symlinks=False)
        source_descriptor = os.open(
            "auth.json",
            os.O_RDONLY | no_follow,
            dir_fd=parent_descriptor,
        )
        try:
            details, raw = read_bounded_regular(source_descriptor, 262144)
        finally:
            os.close(source_descriptor)
        if (
            (entry.st_dev, entry.st_ino) != (details.st_dev, details.st_ino)
            or details.st_uid != os.getuid()
            or stat.S_IMODE(details.st_mode) not in (0o400, 0o600)
        ):
            raise ValueError("credential source ownership or mode is unsafe")
        current = os.stat("auth.json", dir_fd=parent_descriptor, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (details.st_dev, details.st_ino):
            raise ValueError("credential source changed identity")
    finally:
        os.close(parent_descriptor)

    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("credential source is malformed") from error
    selected_state, imported_sensitive = validate_openai_auth_document(
        document,
        minimal=False,
    )
    minimal_document = {
        "version": 1,
        "active_provider": "openai-codex",
        "providers": {"openai-codex": selected_state},
    }
    payload = (
        json.dumps(minimal_document, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    raw = b""
    document = None
    descriptor = os.open(
        "auth.json",
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow,
        0o600,
        dir_fd=home_descriptor,
    )
    try:
        os.fchmod(descriptor, 0o600)
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fsync(descriptor)
        created = os.fstat(descriptor)
        if (
            not stat.S_ISREG(created.st_mode)
            or created.st_uid != os.getuid()
            or stat.S_IMODE(created.st_mode) != 0o600
            or created.st_size != len(payload)
        ):
            raise ValueError("ephemeral credential file was not created securely")
    finally:
        os.close(descriptor)
    os.fsync(home_descriptor)
    return imported_sensitive


def current_ephemeral_auth_values():
    descriptor = os.open(
        "auth.json",
        os.O_RDONLY | no_follow,
        dir_fd=home_descriptor,
    )
    try:
        details, raw = read_bounded_regular(descriptor, 262144)
    finally:
        os.close(descriptor)
    if details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) not in (0o400, 0o600):
        raise ValueError("ephemeral credential file became unsafe")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("ephemeral credential file became malformed") from error
    _, values = validate_openai_auth_document(document, minimal=True)
    return values


def candidate_ephemeral_auth_values(raw):
    candidates = set()
    pattern = re.compile(
        rb'"(?:access_token|refresh_token|id_token|account_id)"\s*:\s*("(?:\\.|[^"\\])*")'
    )
    for match in pattern.finditer(raw):
        try:
            value = json.loads(match.group(1).decode("utf-8"))
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(value, str) and 1 <= len(value.encode("utf-8")) <= 65536:
            candidates.add(value.encode("utf-8"))
    return candidates


def inspect_ephemeral_auth_values():
    try:
        descriptor = os.open(
            "auth.json",
            os.O_RDONLY | no_follow,
            dir_fd=home_descriptor,
        )
        try:
            _, raw = read_bounded_regular(descriptor, 262144)
        finally:
            os.close(descriptor)
    except (OSError, ValueError):
        return (), False
    candidates = candidate_ephemeral_auth_values(raw)
    try:
        candidates.update(current_ephemeral_auth_values())
    except (OSError, ValueError):
        return tuple(candidates), False
    return tuple(candidates), True


def descriptor_contains_values(descriptor, values):
    maximum = max(len(value) for value in values)
    pending = b""
    while True:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            return any(value in pending for value in values)
        data = pending + chunk
        if any(value in data for value in values):
            return True
        pending = data[-(maximum - 1) :] if maximum > 1 else b""


def rewrite_workspace_file(directory_descriptor, name, details, values, counter):
    source = os.open(name, os.O_RDONLY | no_follow, dir_fd=directory_descriptor)
    try:
        opened = os.fstat(source)
        if (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino):
            raise RuntimeError("workspace credential-scan entry changed identity")
        if not descriptor_contains_values(source, values):
            return False
        os.lseek(source, 0, os.SEEK_SET)
        if opened.st_size <= 67108864:
            content = bytearray()
            while True:
                chunk = os.read(source, 65536)
                if not chunk:
                    break
                content.extend(chunk)
            rendered = bytes(content)
            for value in values:
                rendered = rendered.replace(value, b"<x>")
        else:
            rendered = b"<credential-redacted>\n"
        current = os.fstat(source)
        if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (
            opened.st_dev,
            opened.st_ino,
            opened.st_size,
            opened.st_mtime_ns,
        ):
            raise RuntimeError("workspace credential-scan entry changed while read")
    finally:
        os.close(source)

    temporary_name = f".codex-credential-redact-{os.getpid()}-{counter}"
    temporary = os.open(
        temporary_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow,
        stat.S_IMODE(details.st_mode) & 0o777,
        dir_fd=directory_descriptor,
    )
    try:
        offset = 0
        while offset < len(rendered):
            offset += os.write(temporary, rendered[offset:])
        os.fsync(temporary)
        os.fchmod(temporary, stat.S_IMODE(details.st_mode) & 0o777)
        current = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (details.st_dev, details.st_ino):
            raise RuntimeError("workspace credential-scan entry changed before redaction")
        os.replace(
            temporary_name,
            name,
            src_dir_fd=directory_descriptor,
            dst_dir_fd=directory_descriptor,
        )
        os.fsync(directory_descriptor)
    finally:
        try:
            os.close(temporary)
        except OSError:
            pass
        try:
            os.unlink(temporary_name, dir_fd=directory_descriptor)
        except FileNotFoundError:
            pass
    return True


def workspace_credential_matches(directory_descriptor, values, *, redact, relative=()):
    matches = 0
    counter = 0
    for name in os.listdir(directory_descriptor):
        if not relative and name in (".git", ".codex-runs"):
            continue
        details = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        encoded_name = os.fsencode(name)
        name_present = any(value in encoded_name for value in values)
        link_present = False
        link_target = None
        if stat.S_ISLNK(details.st_mode):
            link_target = os.readlink(name, dir_fd=directory_descriptor)
            link_present = any(
                value in os.fsencode(link_target) for value in values
            )
        if stat.S_ISDIR(details.st_mode):
            child = os.open(
                name,
                os.O_RDONLY | directory_flag | no_follow,
                dir_fd=directory_descriptor,
            )
            try:
                opened = os.fstat(child)
                if (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino):
                    raise RuntimeError("workspace credential-scan directory changed identity")
                matches += workspace_credential_matches(
                    child,
                    values,
                    redact=redact,
                    relative=(*relative, name),
                )
            finally:
                os.close(child)
        elif stat.S_ISREG(details.st_mode):
            descriptor = os.open(
                name,
                os.O_RDONLY | no_follow,
                dir_fd=directory_descriptor,
            )
            try:
                opened = os.fstat(descriptor)
                if (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino):
                    raise RuntimeError("workspace credential-scan entry changed identity")
                present = descriptor_contains_values(descriptor, values)
            finally:
                os.close(descriptor)
            if present:
                matches += 1
                if redact:
                    counter += 1
                    rewrite_workspace_file(
                        directory_descriptor,
                        name,
                        details,
                        values,
                        counter,
                    )
        if link_present:
            matches += 1
            if redact:
                rendered_target = os.fsencode(link_target)
                for value in values:
                    rendered_target = rendered_target.replace(value, b"<x>")
                os.unlink(name, dir_fd=directory_descriptor)
                os.symlink(
                    os.fsdecode(rendered_target),
                    name,
                    dir_fd=directory_descriptor,
                )
        if name_present:
            matches += 1
            if redact:
                rendered_name = encoded_name
                for value in values:
                    rendered_name = rendered_name.replace(value, b"<x>")
                destination = os.fsdecode(rendered_name)
                try:
                    os.stat(
                        destination,
                        dir_fd=directory_descriptor,
                        follow_symlinks=False,
                    )
                except FileNotFoundError:
                    pass
                else:
                    raise RuntimeError("credential-redacted workspace name collides")
                os.rename(
                    name,
                    destination,
                    src_dir_fd=directory_descriptor,
                    dst_dir_fd=directory_descriptor,
                )
        if redact and (link_present or name_present):
            os.fsync(directory_descriptor)
    return matches


def remove_contents(directory_descriptor):
    for name in os.listdir(directory_descriptor):
        details = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if stat.S_ISDIR(details.st_mode):
            child_descriptor = os.open(
                name,
                os.O_RDONLY | directory_flag | no_follow,
                dir_fd=directory_descriptor,
            )
            try:
                opened = os.fstat(child_descriptor)
                if (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino):
                    raise RuntimeError("Hermes cleanup entry changed identity")
                remove_contents(child_descriptor)
            finally:
                os.close(child_descriptor)
            os.rmdir(name, dir_fd=directory_descriptor)
        else:
            os.unlink(name, dir_fd=directory_descriptor)


def scan_identity(directory_descriptor, relative=()):
    matches = []
    for name in os.listdir(directory_descriptor):
        details = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if not stat.S_ISDIR(details.st_mode):
            continue
        child_relative = (*relative, name)
        identity = (details.st_dev, details.st_ino)
        if identity == expected_home_identity:
            matches.append(child_relative)
            continue
        child_descriptor = os.open(
            name,
            os.O_RDONLY | directory_flag | no_follow,
            dir_fd=directory_descriptor,
        )
        try:
            opened = os.fstat(child_descriptor)
            if (opened.st_dev, opened.st_ino) != identity:
                raise RuntimeError("safe-root scan entry changed identity")
            matches.extend(scan_identity(child_descriptor, child_relative))
        finally:
            os.close(child_descriptor)
    return matches


def open_relative_parent(parts):
    descriptor = os.dup(root_descriptor)
    try:
        for part in parts:
            child_descriptor = os.open(
                part,
                os.O_RDONLY | directory_flag | no_follow,
                dir_fd=descriptor,
            )
            os.close(descriptor)
            descriptor = child_descriptor
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def cleanup_hermes_home():
    global cleanup_complete, home_relocated
    if cleanup_complete:
        return
    cleanup_complete = True
    expected_relative = os.path.relpath(home_path, root).split(os.sep)
    if (
        not expected_relative
        or expected_relative[0] != ".codex-runs"
        or any(part in ("", ".", "..") for part in expected_relative)
    ):
        raise RuntimeError("refusing Hermes cleanup outside ignored run evidence")

    expected_parent = open_relative_parent(expected_relative[:-1])
    try:
        try:
            current = os.stat(
                expected_relative[-1],
                dir_fd=expected_parent,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            current = None
        exact = (
            current is not None
            and stat.S_ISDIR(current.st_mode)
            and (current.st_dev, current.st_ino) == expected_home_identity
        )
        if not exact:
            home_relocated = True
            if current is not None and stat.S_ISLNK(current.st_mode):
                os.unlink(expected_relative[-1], dir_fd=expected_parent)
    finally:
        os.close(expected_parent)

    opened = os.fstat(home_descriptor)
    if (opened.st_dev, opened.st_ino) != expected_home_identity:
        raise RuntimeError("held Hermes-home descriptor changed identity")
    remove_contents(home_descriptor)

    matches = scan_identity(root_descriptor)
    if len(matches) > 1:
        raise RuntimeError("Hermes home identity appeared more than once")
    if len(matches) == 1:
        parent = open_relative_parent(matches[0][:-1])
        try:
            os.rmdir(matches[0][-1], dir_fd=parent)
        finally:
            os.close(parent)
    elif not home_relocated:
        raise RuntimeError("Hermes home disappeared during confined cleanup")

    if home_relocated:
        raise RuntimeError(
            "Hermes home was relocated or replaced; contents were purged through the held descriptor"
        )


def cleanup_at_exit():
    try:
        cleanup_hermes_home()
    except BaseException as error:
        print(
            f"error: confined Hermes-home cleanup failed: {error}",
            file=sys.stderr,
            flush=True,
        )
        os._exit(1)
    finally:
        try:
            os.close(home_descriptor)
        except OSError:
            pass
        try:
            os.close(root_descriptor)
        except OSError:
            pass


atexit.register(cleanup_at_exit)


def seatbelt_quote(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def seatbelt_profile(write_root, *, allow_network):
    rules = [
        "(version 1)",
        "(allow default)",
        "(deny process-fork)",
        "(deny file-write*)",
        f'(allow file-write* (subpath "{seatbelt_quote(write_root)}"))',
    ]
    if not allow_network:
        rules.append("(deny network*)")
    if write_root == root:
        git_marker = os.path.join(root, ".git")
        rules.append(f'(deny file-write* (literal "{seatbelt_quote(git_marker)}"))')
        rules.append(f'(deny file-write* (subpath "{seatbelt_quote(git_dir)}"))')
        rules.append(f'(deny file-write* (subpath "{seatbelt_quote(git_common_dir)}"))')
        for registered_root in registered_roots:
            if registered_root != root:
                rules.append(
                    f'(deny file-write* (subpath "{seatbelt_quote(registered_root)}"))'
                )
        for protected_path in protected_paths:
            rule = "subpath" if os.path.isdir(protected_path) else "literal"
            rules.append(
                f'(deny file-write* ({rule} "{seatbelt_quote(protected_path)}"))'
            )
        rules.append(f'(deny file-write* (subpath "{seatbelt_quote(run_dir)}"))')
        rules.append(f'(allow file-write* (subpath "{seatbelt_quote(home_path)}"))')
    if auth_source_path is not None:
        rules.append(
            f'(deny file-read* (literal "{seatbelt_quote(auth_source_path)}"))'
        )
        rules.append(
            f'(deny file-write* (literal "{seatbelt_quote(auth_source_path)}"))'
        )
    return "\n".join(rules)


provider_credentials = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "TOGETHER_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "COHERE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "HF_TOKEN",
    "HUGGINGFACEHUB_API_TOKEN",
)


def fixed_environment(write_root, *, include_provider_credentials):
    base_names = (
        "PATH",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "NODE_EXTRA_CA_CERTS",
    )
    inherited_names = (
        (*base_names, *provider_credentials)
        if include_provider_credentials
        else base_names
    )
    environment = {
        name: os.environ[name]
        for name in inherited_names
        if os.environ.get(name)
    }
    environment["HOME"] = home_path
    environment["TMPDIR"] = os.path.join(home_path, "tmp")
    environment["__CF_USER_TEXT_ENCODING"] = "0x0:0:0"
    environment["HERMES_HOME"] = home_path
    environment["HERMES_WRITE_SAFE_ROOT"] = write_root
    os.makedirs(environment["TMPDIR"], mode=0o700, exist_ok=True)
    return (
        environment,
        provider_credentials if include_provider_credentials else (),
    )


def terminate_active(initial_signal):
    process = active_process
    if process is None or process.poll() is not None:
        return
    process.send_signal(initial_signal)
    try:
        process.wait(timeout=3)
        return
    except subprocess.TimeoutExpired:
        process.terminate()
    try:
        process.wait(timeout=2)
        return
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def forward_signal(signum, _frame):
    try:
        terminate_active(signum)
    finally:
        raise SystemExit(128 + signum)


for managed_signal in managed_signals:
    signal.signal(managed_signal, forward_signal)
signal.pthread_sigmask(signal.SIG_UNBLOCK, managed_signals)


def run_sandboxed(
    arguments,
    write_root,
    capture_limit,
    *,
    include_provider_credentials,
    allow_network,
    additional_sensitive=(),
    collect_ephemeral_auth=False,
):
    global active_process
    environment, _ = fixed_environment(
        write_root,
        include_provider_credentials=include_provider_credentials,
    )
    if write_root == home_path and sorted(os.listdir(home_descriptor)) != ["tmp"]:
        raise RuntimeError("Hermes capability home is not empty before launch")
    profile = seatbelt_profile(write_root, allow_network=allow_network).encode("utf-8")
    if not profile or len(profile) > 65536:
        raise RuntimeError("Hermes Seatbelt profile is unbounded")
    profile_read, profile_write = os.pipe()
    command = [
        seatbelt_executable,
        "-f",
        "/dev/stdin",
        *arguments,
    ]
    signal.pthread_sigmask(signal.SIG_BLOCK, managed_signals)
    process = None
    try:
        process = subprocess.Popen(
            command,
            cwd=write_root,
            env=environment,
            stdin=profile_read,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            close_fds=True,
        )
        active_process = process
        os.close(profile_read)
        profile_read = -1
        offset = 0
        while offset < len(profile):
            written = os.write(profile_write, profile[offset:])
            if written <= 0:
                raise RuntimeError("Hermes Seatbelt profile handoff stalled")
            offset += written
        os.close(profile_write)
        profile_write = -1
    except BaseException:
        if process is not None:
            terminate_active(signal.SIGTERM)
            active_process = None
        raise RuntimeError("Hermes Seatbelt profile handoff failed") from None
    finally:
        for descriptor in (profile_read, profile_write):
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
        signal.pthread_sigmask(signal.SIG_UNBLOCK, managed_signals)
    if process is None:
        raise RuntimeError("sandboxed Hermes process did not start")
    captured = bytearray()
    saw_more = False
    assert process.stdout is not None
    for chunk in iter(lambda: process.stdout.read(8192), b""):
        remaining = capture_limit - len(captured)
        if remaining > 0:
            captured.extend(chunk[:remaining])
        if len(chunk) > max(remaining, 0):
            saw_more = True
    status = process.wait()
    active_process = None
    credential_values = {
        os.environ[name].encode("utf-8")
        for name in provider_credentials
        if os.environ.get(name)
    }
    credential_values.update(additional_sensitive)
    ephemeral_auth_valid = True
    if collect_ephemeral_auth:
        refreshed_values, ephemeral_auth_valid = inspect_ephemeral_auth_values()
        credential_values.update(refreshed_values)
    credential_values = sorted(credential_values, key=len, reverse=True)
    for value in credential_values:
        captured = captured.replace(value, b"<x>")
    if auth_source_path is not None:
        captured = captured.replace(auth_source_path.encode("utf-8"), b"<auth-source>")
    workspace_redactions = 0
    if collect_ephemeral_auth and credential_values:
        workspace_redactions = workspace_credential_matches(
            root_descriptor,
            tuple(credential_values),
            redact=True,
        )
    return (
        status,
        bytes(captured),
        saw_more,
        credential_values,
        workspace_redactions,
        ephemeral_auth_valid,
    )


capability_status, capability_output, capability_truncated, _, _, _ = run_sandboxed(
    [executable, "chat", "--help"],
    home_path,
    65536,
    include_provider_credentials=False,
    allow_network=False,
)
if capability_status != 0 or capability_truncated:
    if capability_output:
        sys.stderr.buffer.write(capability_output)
        if not capability_output.endswith(b"\n"):
            sys.stderr.buffer.write(b"\n")
        sys.stderr.flush()
    raise SystemExit("Hermes chat capability probe failed")
capability_text = capability_output.decode("utf-8", errors="replace")
for capability in (
    "-q",
    "--quiet",
    "--safe-mode",
    "--ignore-user-config",
    "--ignore-rules",
    "--toolsets",
    "--provider",
):
    if capability not in capability_text:
        raise SystemExit(f"Hermes lacks required capability: {capability}")

if file_auth_selected:
    try:
        sensitive_values = import_selected_auth()
        if workspace_credential_matches(
            root_descriptor,
            sensitive_values,
            redact=False,
        ):
            raise ValueError("selected credential already appears in the worktree")
    except (OSError, ValueError, RuntimeError):
        raise SystemExit("Hermes file authentication source failed validation")

assert_immutable_inputs()
with open(prompt_path, encoding="utf-8") as handle:
    base_prompt = handle.read()
with open(gate_path, encoding="utf-8") as handle:
    gate_evidence = handle.read()
prompt = (
    f"{base_prompt}\nSelected ticket: {ticket_path}\n\n"
    f"Read-only gate evidence follows:\n\n{gate_evidence}"
)
if len(prompt.encode("utf-8")) > 196608:
    raise SystemExit("Hermes ticket prompt exceeds 196608 bytes")

write_exclusive_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow
try:
    marker_descriptor = os.open(marker_path, write_exclusive_flags, 0o600)
except FileExistsError:
    raise SystemExit("the Hermes implementation writer was already invoked for this run")
with os.fdopen(marker_descriptor, "w", encoding="ascii") as handle:
    handle.write("started\n")
    handle.flush()
    os.fsync(handle.fileno())

invocation = f"""# Hermes worker invocation

- Backend: HERMES
- Executable: resolved compatible Hermes binary
- Working directory: {root}
- Safe write root: {root}
- Ephemeral home: held open by inode and removed on exit
- Containment: macOS Seatbelt denies process-fork, outside-root writes, Git metadata writes, and run-evidence writes except the ephemeral home
- Capability probe: credential-free and network-denied before the implementation marker is created
- Command: hermes chat -q <bounded-in-memory-ticket-prompt> --quiet --safe-mode --ignore-user-config --ignore-rules --toolsets file
- Authentication: explicit ephemeral openai-codex OAuth copy when both direct-run selectors are present; otherwise the unchanged provider-environment path
- Implementation environment: fixed allowlist, HERMES_HOME, and HERMES_WRITE_SAFE_ROOT; provider environment values are omitted for explicit file authentication
- Terminal, web, memory, skills, plugins, hooks, MCP, delegation, scheduling, persistence, resume, continuation, autonomous worktrees, and yolo mode: disabled
"""
credential_values = sorted(
    {
        os.environ[name]
        for name in provider_credentials
        if os.environ.get(name)
    },
    key=len,
    reverse=True,
)
for value in credential_values:
    invocation = invocation.replace(value, "<x>")
invocation_descriptor = os.open(invocation_path, write_exclusive_flags, 0o600)
with os.fdopen(invocation_descriptor, "w", encoding="utf-8") as handle:
    handle.write(invocation)

assert_immutable_inputs()
implementation_arguments = [
        executable,
        "chat",
        "-q",
        prompt,
        "--quiet",
        "--safe-mode",
        "--ignore-user-config",
        "--ignore-rules",
        "--toolsets",
        "file",
    ]
if file_auth_selected:
    implementation_arguments.extend(("--provider", "openai-codex"))
(
    implementation_status,
    captured,
    saw_more,
    _,
    workspace_redactions,
    ephemeral_auth_valid,
) = run_sandboxed(
    implementation_arguments,
    root,
    131072,
    include_provider_credentials=not file_auth_selected,
    allow_network=True,
    additional_sensitive=sensitive_values,
    collect_ephemeral_auth=file_auth_selected,
)
assert_immutable_inputs()
text = captured.decode("utf-8", errors="replace")
text = re.sub(
    r"(?i)\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*[^\s,;]+",
    r"\1=<redacted>",
    text,
)
text = re.sub(r"\bsk-[A-Za-z0-9_-]{12,}\b", "<redacted-key>", text)
if saw_more:
    text += "\n[output truncated at 131072 bytes]\n"
output_descriptor = os.open(output_path, write_exclusive_flags, 0o600)
with os.fdopen(output_descriptor, "w", encoding="utf-8") as handle:
    handle.write(text)
print(f"Hermes implementation evidence: {evidence_dir}")
if workspace_redactions:
    print(
        "Hermes attempted to persist selected credentials; exact values were redacted and the run is blocked.",
        file=sys.stderr,
    )
    implementation_status = 1
if not ephemeral_auth_valid:
    print(
        "Hermes ephemeral authentication failed post-run validation; imported credentials were redacted and the run is blocked.",
        file=sys.stderr,
    )
    implementation_status = 1
if implementation_status != 0:
    print(
        f"Hermes writer exited with status {implementation_status}; inspect the bounded redacted evidence.",
        file=sys.stderr,
    )
raise SystemExit(implementation_status)
PY
