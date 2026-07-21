#!/bin/sh

SYSTEM_PYTHON=/usr/bin/python3
: "${TMPDIR:=/tmp}"
export TMPDIR
[ -x "$SYSTEM_PYTHON" ] || {
  printf '%s\n' 'error: /usr/bin/python3 is required by the controlled ticket runner' >&2
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
provider_names = {
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "GEMINI_API_KEY", "OPENROUTER_API_KEY", "TOGETHER_API_KEY",
    "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY",
    "COHERE_API_KEY", "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION",
    "AWS_DEFAULT_REGION", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN",
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
tool_directories = []
for candidate in (codex_executable, hermes_executable):
    if candidate:
        directory = os.path.dirname(candidate)
        if directory not in tool_directories:
            tool_directories.append(directory)
for directory in ("/usr/bin", "/bin", "/usr/sbin", "/sbin"):
    if directory not in tool_directories:
        tool_directories.append(directory)
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
    "CODEX_HARNESS_CODEX_EXECUTABLE": codex_executable,
    "CODEX_HARNESS_HERMES_EXECUTABLE": hermes_executable,
    "CODEX_HARNESS_TOOL_PATH": os.pathsep.join(tool_directories),
    "CODEX_HARNESS_DISCOVERY_PATH": os.environ.get("PATH", ""),
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
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "GEMINI_API_KEY", "OPENROUTER_API_KEY", "TOGETHER_API_KEY",
    "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY",
    "COHERE_API_KEY", "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION",
    "AWS_DEFAULT_REGION", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN",
    "CODEX_HARNESS_CLEAN_ENVIRONMENT", "CODEX_HARNESS_CODEX_EXECUTABLE",
    "CODEX_HARNESS_HERMES_EXECUTABLE", "CODEX_HARNESS_TOOL_PATH",
    "CODEX_HARNESS_DISCOVERY_PATH",
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
expected_directories = []
for name in ("CODEX_HARNESS_CODEX_EXECUTABLE", "CODEX_HARNESS_HERMES_EXECUTABLE"):
    value = environment.get(name, "")
    if value and os.path.dirname(value) not in expected_directories:
        expected_directories.append(os.path.dirname(value))
for directory in ("/usr/bin", "/bin", "/usr/sbin", "/sbin"):
    if directory not in expected_directories:
        expected_directories.append(directory)
if environment.get("CODEX_HARNESS_TOOL_PATH") != os.pathsep.join(expected_directories):
    raise SystemExit("error: forged clean-environment sentinel: tool PATH does not match resolved binaries")
discovery_path = environment.get("CODEX_HARNESS_DISCOVERY_PATH", "")
for entry in discovery_path.split(os.pathsep):
    if not entry or not os.path.isabs(entry):
        raise SystemExit("error: caller PATH contains an empty or relative executable directory")
'; then
  exit 1
fi
CODEX_EXECUTABLE=${CODEX_HARNESS_CODEX_EXECUTABLE:-}
HERMES_EXECUTABLE=${CODEX_HARNESS_HERMES_EXECUTABLE:-}
CODEX_TOOL_PATH=${CODEX_HARNESS_TOOL_PATH:-}
DISCOVERY_PATH=${CODEX_HARNESS_DISCOVERY_PATH:-}
unset CODEX_HARNESS_CLEAN_ENVIRONMENT CODEX_HARNESS_BOOTSTRAP_PID
unset CODEX_HARNESS_CODEX_EXECUTABLE CODEX_HARNESS_HERMES_EXECUTABLE CODEX_HARNESS_TOOL_PATH
unset CODEX_HARNESS_DISCOVERY_PATH
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source "$SCRIPT_DIR/common.sh"

[[ -n "$CODEX_EXECUTABLE" ]] || fail "Codex is unavailable"

WORKER_BACKEND=CODEX
HERMES_AUTH_SOURCE=
HERMES_AUTH_PROVIDER=
TICKET_ARGUMENT=
while (($# > 0)); do
  case "$1" in
    --worker-backend)
      (($# >= 2)) || fail "--worker-backend requires codex or hermes"
      case "$2" in
        codex)
          WORKER_BACKEND=CODEX
          ;;
        hermes)
          WORKER_BACKEND=HERMES
          ;;
        *)
          fail "--worker-backend must be codex or hermes"
          ;;
      esac
      shift 2
      ;;
    --hermes-auth-source)
      (($# >= 2)) || fail "--hermes-auth-source requires user-hermes"
      [[ -z "$HERMES_AUTH_SOURCE" ]] || fail "--hermes-auth-source may be specified only once"
      HERMES_AUTH_SOURCE=$2
      shift 2
      ;;
    --hermes-auth-provider)
      (($# >= 2)) || fail "--hermes-auth-provider requires openai-codex"
      [[ -z "$HERMES_AUTH_PROVIDER" ]] || fail "--hermes-auth-provider may be specified only once"
      HERMES_AUTH_PROVIDER=$2
      shift 2
      ;;
    --*)
      fail "unsupported option: $1"
      ;;
    *)
      [[ -z "$TICKET_ARGUMENT" ]] || fail "exactly one ticket path is required"
      TICKET_ARGUMENT=$1
      shift
      ;;
  esac
done
[[ -n "$TICKET_ARGUMENT" ]] || fail "usage: $0 [--worker-backend codex|hermes] [--hermes-auth-source user-hermes --hermes-auth-provider openai-codex] docs/tickets/T0001-project-skeleton.md"
if [[ -n "$HERMES_AUTH_SOURCE" || -n "$HERMES_AUTH_PROVIDER" ]]; then
  [[ "$WORKER_BACKEND" == "HERMES" ]] || fail "Hermes auth selectors require --worker-backend hermes"
  [[ -n "$HERMES_AUTH_SOURCE" && -n "$HERMES_AUTH_PROVIDER" ]] || fail "Hermes file auth requires both --hermes-auth-source and --hermes-auth-provider"
  [[ "$HERMES_AUTH_SOURCE" == "user-hermes" ]] || fail "--hermes-auth-source must be user-hermes"
  [[ "$HERMES_AUTH_PROVIDER" == "openai-codex" ]] || fail "--hermes-auth-provider must be openai-codex"
fi

ROOT=$(repository_root)
require_command python3
TICKET_FILE=$(resolve_repo_file "$ROOT" "$TICKET_ARGUMENT") || fail "ticket path must name a file inside the repository"
TICKET_PATH=$(repo_relative_path "$ROOT" "$TICKET_FILE")
TICKET_ID=$(ticket_id_from_path "$TICKET_FILE")
cd "$ROOT"

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
  "$SCRIPT_DIR/doctor.sh"

STATUS=$(ticket_status "$TICKET_FILE")
if [[ "$STATUS" != "Ready" ]]; then
  fail "$TICKET_PATH is not Ready (status: ${STATUS:-missing})"
fi

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

RUN_DIR=$(create_run_directory "$ROOT" "" "$TICKET_ID")
RUN_ARTIFACTS_REDACTED=false
CODEX_SUPERVISOR_PID=
PENDING_TICKET_SIGNAL=

redact_run_artifacts() {
  "$SYSTEM_PYTHON" -I - "$ROOT" "$RUN_DIR" <<'PY' &
import hashlib
import os
import signal
import stat
import sys

for managed_signal in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
    signal.signal(managed_signal, signal.SIG_IGN)

root = os.path.realpath(sys.argv[1])
run_dir = os.path.abspath(sys.argv[2])
relative_run_dir = os.path.relpath(run_dir, root)
parts = relative_run_dir.split(os.sep)
if not parts or parts[0] != ".codex-runs" or any(part in ("", ".", "..") for part in parts):
    raise SystemExit("refusing to redact outside ignored run evidence")

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
patterns = tuple(sorted(
    {
        os.environ[name].encode("utf-8")
        for name in provider_names
        if os.environ.get(name)
    },
    key=len,
    reverse=True,
))
maximum_pattern = max((len(pattern) for pattern in patterns), default=1)
replacement = b"<x>"


def redact_chunk(data, final):
    output = bytearray()
    position = 0
    safe_end = len(data) if final else max(0, len(data) - maximum_pattern)
    while position < safe_end:
        match = next(
            (pattern for pattern in patterns if data.startswith(pattern, position)),
            None,
        )
        if match is None:
            output.append(data[position])
            position += 1
        else:
            output.extend(replacement)
            position += len(match)
    return bytes(output), data[position:]


def safe_name(directory_descriptor, name, entry_type):
    encoded = os.fsencode(name)
    if not any(pattern in encoded for pattern in patterns):
        return name
    digest = hashlib.sha256(encoded).hexdigest()[:20]
    candidate = f".redacted-{entry_type}-{digest}"
    try:
        os.stat(candidate, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        raise RuntimeError("redacted evidence-name collision")
    os.rename(
        name,
        candidate,
        src_dir_fd=directory_descriptor,
        dst_dir_fd=directory_descriptor,
    )
    return candidate


def temporary_name(directory_descriptor, name):
    digest = hashlib.sha256(os.fsencode(name)).hexdigest()[:20]
    for counter in range(1000):
        candidate = f".redact-{digest}-{counter}"
        try:
            descriptor = os.open(
                candidate,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow,
                0o600,
                dir_fd=directory_descriptor,
            )
            return candidate, descriptor
        except FileExistsError:
            continue
    raise RuntimeError("could not allocate a confined redaction file")


def redact_file(directory_descriptor, name, expected):
    source_descriptor = os.open(
        name,
        os.O_RDONLY | no_follow,
        dir_fd=directory_descriptor,
    )
    temporary = None
    try:
        actual = os.fstat(source_descriptor)
        if not stat.S_ISREG(actual.st_mode):
            raise RuntimeError("retained evidence changed type during redaction")
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise RuntimeError("retained evidence changed identity during redaction")
        temporary, temporary_descriptor = temporary_name(
            directory_descriptor, name
        )
        os.fchmod(temporary_descriptor, stat.S_IMODE(actual.st_mode))
        with os.fdopen(source_descriptor, "rb", closefd=True) as source, os.fdopen(
            temporary_descriptor, "wb", closefd=True
        ) as destination:
            source_descriptor = -1
            pending = b""
            while True:
                chunk = source.read(65536)
                if not chunk:
                    break
                original = pending + chunk
                rendered, pending = redact_chunk(original, False)
                destination.write(rendered)
            rendered, remaining = redact_chunk(pending, True)
            if remaining:
                raise RuntimeError("redaction left unprocessed bytes")
            destination.write(rendered)
            destination.flush()
            os.fsync(destination.fileno())
        current = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (actual.st_dev, actual.st_ino):
            raise RuntimeError("retained evidence was replaced during redaction")
        os.replace(
            temporary,
            name,
            src_dir_fd=directory_descriptor,
            dst_dir_fd=directory_descriptor,
        )
        temporary = None
    finally:
        if source_descriptor >= 0:
            os.close(source_descriptor)
        if temporary is not None:
            os.unlink(temporary, dir_fd=directory_descriptor)


def redact_directory(directory_descriptor):
    for original_name in sorted(os.listdir(directory_descriptor)):
        details = os.stat(
            original_name,
            dir_fd=directory_descriptor,
            follow_symlinks=False,
        )
        if stat.S_ISLNK(details.st_mode):
            raise RuntimeError("symlinks are forbidden in retained run evidence")
        entry_type = "directory" if stat.S_ISDIR(details.st_mode) else "file"
        name = safe_name(directory_descriptor, original_name, entry_type)
        if name != original_name:
            details = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if stat.S_ISDIR(details.st_mode):
            if stat.S_IMODE(details.st_mode) & 0o500 != 0o500:
                raise PermissionError("retained evidence directory is unreadable")
            child_descriptor = os.open(
                name,
                os.O_RDONLY | directory_flag | no_follow,
                dir_fd=directory_descriptor,
            )
            try:
                opened = os.fstat(child_descriptor)
                if (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino):
                    raise RuntimeError("retained evidence directory changed identity")
                redact_directory(child_descriptor)
            finally:
                os.close(child_descriptor)
        elif stat.S_ISREG(details.st_mode):
            redact_file(directory_descriptor, name, details)
        else:
            raise RuntimeError("unsupported retained evidence entry type")


no_follow = getattr(os, "O_NOFOLLOW", 0)
directory_flag = getattr(os, "O_DIRECTORY", 0)
descriptor = os.open(root, os.O_RDONLY | directory_flag | no_follow)
try:
    for part in parts:
        child_descriptor = os.open(
            part,
            os.O_RDONLY | directory_flag | no_follow,
            dir_fd=descriptor,
        )
        os.close(descriptor)
        descriptor = child_descriptor
    redact_directory(descriptor)
finally:
    os.close(descriptor)
PY
  local redaction_pid=$!
  local redaction_status
  set +e
  while true; do
    wait "$redaction_pid"
    redaction_status=$?
    if kill -0 "$redaction_pid" 2>/dev/null; then
      continue
    fi
    break
  done
  set -e
  if ((redaction_status != 0)); then
    return 1
  fi
  RUN_ARTIFACTS_REDACTED=true
}

finalize_ticket_run() {
  local status=$?
  trap - EXIT
  if [[ "$RUN_ARTIFACTS_REDACTED" != true ]]; then
    if ! "$SYSTEM_PYTHON" -I - "$RUN_DIR/redaction-active.txt" <<'PY'
import os
import sys

descriptor = os.open(
    sys.argv[1],
    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
    0o600,
)
with os.fdopen(descriptor, "w", encoding="ascii") as handle:
    handle.write("active\n")
    handle.flush()
    os.fsync(handle.fileno())
PY
    then
      printf '%s\n' 'error: failed to mark ticket-run redaction active' >&2
      status=1
    fi
    if ! redact_run_artifacts; then
      printf '%s\n' 'error: failed to redact retained ticket-run artifacts' >&2
      status=1
    fi
  fi
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ -n "$PENDING_TICKET_SIGNAL" ]]; then
    status=$PENDING_TICKET_SIGNAL
  fi
  exit "$status"
}

handle_ticket_signal() {
  local status=$1
  PENDING_TICKET_SIGNAL=$status
  if [[ -n "$CODEX_SUPERVISOR_PID" ]] && kill -0 "$CODEX_SUPERVISOR_PID" 2>/dev/null; then
    kill -"$((status - 128))" "$CODEX_SUPERVISOR_PID" 2>/dev/null || true
  fi
}

trap finalize_ticket_run EXIT
trap 'handle_ticket_signal 129' HUP
trap 'handle_ticket_signal 130' INT
trap 'handle_ticket_signal 143' TERM

write_run_metadata "$RUN_DIR/metadata.json" "$TICKET_ID" "$TICKET_PATH" "ticket-runner"
WORKTREE_ROOT=$("$SYSTEM_PYTHON" -I - "$ROOT" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
)
WORKTREE_GIT_DIR=$(git rev-parse --absolute-git-dir)
WORKTREE_COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
WORKTREE_HEAD=$(git rev-parse --verify HEAD)
WORKTREE_BRANCH=$(git symbolic-ref --quiet --short HEAD || true)
WORKTREE_GIT_DIR=$("$SYSTEM_PYTHON" -I - "$WORKTREE_GIT_DIR" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
)
WORKTREE_COMMON_DIR=$("$SYSTEM_PYTHON" -I - "$WORKTREE_COMMON_DIR" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
)
"$SYSTEM_PYTHON" -I - \
  "$RUN_DIR/metadata.json" \
  "$WORKER_BACKEND" \
  "$WORKTREE_ROOT" \
  "$WORKTREE_GIT_DIR" \
  "$WORKTREE_COMMON_DIR" \
  "$WORKTREE_HEAD" \
  "$WORKTREE_BRANCH" <<'PY'
import json
import sys

(
    path,
    worker_backend,
    worktree_root,
    git_dir,
    git_common_dir,
    head,
    branch,
) = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    metadata = json.load(handle)
metadata["worker_backend"] = worker_backend
metadata["worktree_identity"] = {
    "canonical_root": worktree_root,
    "git_dir": git_dir,
    "git_common_dir": git_common_dir,
    "head": head,
    "branch": branch or None,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(metadata, handle, indent=2)
    handle.write("\n")
PY
TOOLCHAIN_MANIFEST="$RUN_DIR/toolchain.json"
TOOLCHAIN_PATH_FILE="$RUN_DIR/toolchain-path.txt"
"$SYSTEM_PYTHON" -I - \
  "$ROOT" \
  "$RUN_DIR" \
  "$TICKET_FILE" \
  "$DISCOVERY_PATH" \
  "$CODEX_EXECUTABLE" \
  "$HERMES_EXECUTABLE" \
  "$TOOLCHAIN_MANIFEST" <<'PY' >"$TOOLCHAIN_PATH_FILE"
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import sys

(
    root,
    run_dir,
    ticket_path,
    discovery_path,
    codex_executable,
    hermes_executable,
    manifest_path,
) = sys.argv[1:]
root = os.path.realpath(root)
run_dir = os.path.realpath(run_dir)
fixed_system_path = "/usr/bin:/bin:/usr/sbin:/sbin"
toolchain_root = os.path.join(run_dir, "toolchain")
toolchain_bin = os.path.join(toolchain_root, "bin")
if os.path.lexists(toolchain_root):
    raise SystemExit("error: private toolchain already exists")
os.makedirs(toolchain_bin, mode=0o700)


def file_sha256(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    hasher = hashlib.sha256()
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise SystemExit("error: bound tool target is not a regular file")
        while True:
            chunk = os.read(descriptor, 65536)
            if not chunk:
                break
            hasher.update(chunk)
    finally:
        os.close(descriptor)
    return hasher.hexdigest(), opened


def ticket_commands():
    with open(ticket_path, encoding="utf-8") as handle:
        ticket = handle.read()
    section = re.search(
        r"^## Automated verification\s*$\n(.*?)(?=^## |\Z)",
        ticket,
        flags=re.MULTILINE | re.DOTALL,
    )
    if section is None:
        raise SystemExit("error: ticket has no Automated verification section")
    commands = tuple(
        dict.fromkeys(" ".join(command.split()) for command in re.findall(r"`([^`]+)`", section.group(1)))
    )
    if not commands or any(not command for command in commands):
        raise SystemExit("error: ticket has no literal automated verification command")
    return commands


required_names = set()
system_names = {"bash", "env", "git", "python3", "sh"}
for command in ticket_commands():
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    expect_command = True
    for token in lexer:
        if token in {"&&", "||", ";", "|", "&", "("}:
            expect_command = True
            continue
        if token in {")", "<", ">", ">>", "2>", "2>>"}:
            continue
        if not expect_command or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
            continue
        expect_command = False
        if "/" not in token and token not in system_names:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", token):
                raise SystemExit("error: ticket uses an unsupported verification executable name")
            required_names.add(token)

candidate_names = required_names | {"codex", "node", "pnpm", "corepack", "npm", "npx"}
if hermes_executable:
    candidate_names.add("hermes")
explicit = {"codex": codex_executable, "hermes": hermes_executable}
entries = []
for name in sorted(candidate_names):
    candidate = explicit.get(name) or shutil.which(name, path=discovery_path)
    if not candidate:
        if name in required_names:
            raise SystemExit(f"error: required ticket-check executable is unavailable: {name}")
        continue
    target = os.path.realpath(candidate)
    if not os.path.isabs(target) or not os.path.isfile(target) or not os.access(target, os.X_OK):
        raise SystemExit(f"error: invalid bound executable for {name}")
    target_sha256, target_details = file_sha256(target)
    wrapper_path = os.path.join(toolchain_bin, name)
    wrapper = f"#!/bin/sh\nexec {shlex.quote(target)} \"$@\"\n".encode("utf-8")
    descriptor = os.open(
        wrapper_path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o500,
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(wrapper)
        handle.flush()
        os.fsync(handle.fileno())
    wrapper_details = os.stat(wrapper_path, follow_symlinks=False)
    entries.append(
        {
            "name": name,
            "target": target,
            "target_sha256": target_sha256,
            "target_identity": {
                "device": target_details.st_dev,
                "inode": target_details.st_ino,
                "mode": stat.S_IMODE(target_details.st_mode),
                "size": target_details.st_size,
                "modified_ns": target_details.st_mtime_ns,
            },
            "wrapper": wrapper_path,
            "wrapper_sha256": hashlib.sha256(wrapper).hexdigest(),
            "wrapper_identity": {
                "device": wrapper_details.st_dev,
                "inode": wrapper_details.st_ino,
                "mode": stat.S_IMODE(wrapper_details.st_mode),
                "size": wrapper_details.st_size,
            },
        }
    )

bound_names = {entry["name"] for entry in entries}
missing = sorted(required_names - bound_names)
if missing:
    raise SystemExit("error: unresolved ticket-check executables: " + ", ".join(missing))
safe_path = os.pathsep.join((toolchain_bin, fixed_system_path))
manifest = {
    "version": 1,
    "root": root,
    "run_dir": run_dir,
    "safe_path": safe_path,
    "required_names": sorted(required_names),
    "entries": entries,
}
descriptor = os.open(
    manifest_path,
    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
    0o400,
)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
print(safe_path)
PY
IFS= read -r CODEX_TOOL_PATH <"$TOOLCHAIN_PATH_FILE"
unset DISCOVERY_PATH HERMES_EXECUTABLE
printf '%s\n' "$TICKET_PATH" >"$RUN_DIR/ticket-path.txt"
capture_git_status "$ROOT" "$RUN_DIR/pre-run-status.txt"

PROMPT_FILE="$ROOT/.codex/prompts/automated-ticket-run.md"
SCHEMA_FILE="$ROOT/.codex/schemas/ticket-run-result.schema.json"
RESULT_FILE="$RUN_DIR/result.json"
HERMES_WRAPPER="$SCRIPT_DIR/run-hermes-worker.sh"
SEATBELT_EXECUTABLE=/usr/bin/sandbox-exec

[[ -f "$PROMPT_FILE" ]] || fail "automated ticket prompt is missing"
[[ -f "$SCHEMA_FILE" ]] || fail "ticket result schema is missing"
if [[ "$WORKER_BACKEND" == "HERMES" ]]; then
  [[ -x "$HERMES_WRAPPER" ]] || fail "Hermes worker wrapper is unavailable"
  [[ -x "$SEATBELT_EXECUTABLE" ]] || fail "Hermes requires macOS sandbox-exec; no weaker fallback is permitted"
fi

"$SYSTEM_PYTHON" -I - \
  "$ROOT" \
  "$RUN_DIR" \
  "$RESULT_FILE" \
  "$WORKER_BACKEND" \
  "$TICKET_ID" \
  "$TICKET_PATH" \
  "$PROMPT_FILE" \
  "$SCHEMA_FILE" \
  "$SYSTEM_PYTHON" \
  "$SCRIPT_DIR/run-codex-observed.py" \
  "$CODEX_EXECUTABLE" \
  "$CODEX_TOOL_PATH" \
  "$TOOLCHAIN_MANIFEST" \
  "$HERMES_WRAPPER" \
  "$SEATBELT_EXECUTABLE" \
  "$WORKTREE_GIT_DIR" \
  "$WORKTREE_COMMON_DIR" \
  "$HERMES_AUTH_SOURCE" \
  "$HERMES_AUTH_PROVIDER" <<'PY' &
import hashlib
import json
import os
import re
import selectors
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time

(
    root,
    run_dir,
    result_path,
    worker_backend,
    ticket_id,
    ticket_path,
    prompt_path,
    schema_path,
    system_python,
    observer_path,
    codex_executable,
    codex_tool_path,
    toolchain_manifest_path,
    hermes_wrapper,
    seatbelt_executable,
    expected_git_dir,
    expected_common_dir,
    hermes_auth_source,
    hermes_auth_provider,
) = sys.argv[1:]
root = os.path.realpath(root)
run_dir = os.path.abspath(run_dir)
expected_git_dir = os.path.realpath(expected_git_dir)
expected_common_dir = os.path.realpath(expected_common_dir)
with open(ticket_path if os.path.isabs(ticket_path) else os.path.join(root, ticket_path), "rb") as handle:
    immutable_ticket_bytes = handle.read()
immutable_ticket_digest = hashlib.sha256(immutable_ticket_bytes).hexdigest()
immutable_ticket_text = immutable_ticket_bytes.decode("utf-8")
with open(prompt_path, "rb") as handle:
    immutable_prompt = handle.read()
with open(schema_path, "rb") as handle:
    immutable_schema = handle.read()
managed_signals = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)
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
active_process = None
active_kind = None


def seatbelt_quote(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')


def git_bytes(*arguments):
    result = subprocess.run(
        ["git", "-C", root, *arguments],
        check=False,
        capture_output=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Git evidence command failed: {arguments}")
    return result.stdout


def git_optional_bytes(*arguments):
    result = subprocess.run(
        ["git", "-C", root, *arguments],
        check=False,
        capture_output=True,
        env=os.environ.copy(),
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"Git evidence command failed: {arguments}")
    return result.stdout


def git_bytes_at(worktree, *arguments):
    result = subprocess.run(
        ["git", "-C", worktree, *arguments],
        check=False,
        capture_output=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Git evidence command failed for {worktree}: {arguments}")
    return result.stdout


def git_optional_bytes_at(worktree, *arguments):
    result = subprocess.run(
        ["git", "-C", worktree, *arguments],
        check=False,
        capture_output=True,
        env=os.environ.copy(),
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"Git evidence command failed for {worktree}: {arguments}")
    return result.stdout


def canonical_git_path(*arguments):
    return os.path.realpath(os.fsdecode(git_bytes(*arguments)).strip())


def worktree_roots():
    payload = os.fsdecode(git_bytes("worktree", "list", "--porcelain", "-z"))
    roots = []
    for entry in payload.split("\0"):
        if entry.startswith("worktree "):
            roots.append(os.path.realpath(entry.removeprefix("worktree ")))
    return sorted(set(roots))


def read_only_profile(result_file):
    protected = set(worktree_roots())
    protected.update((root, expected_git_dir, expected_common_dir))
    rules = ["(version 1)", "(allow default)"]
    rules.extend(
        f'(deny file-write* (subpath "{seatbelt_quote(path)}"))'
        for path in sorted(protected)
    )
    rules.append(f'(allow file-write* (literal "{seatbelt_quote(result_file)}"))')
    return "\n".join(rules)


def file_identity(path, content_stable=False):
    try:
        details = os.lstat(path)
    except FileNotFoundError:
        return None
    digest = None
    target = None
    if stat.S_ISREG(details.st_mode):
        hasher = hashlib.sha256()
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            while True:
                chunk = os.read(descriptor, 65536)
                if not chunk:
                    break
                hasher.update(chunk)
        finally:
            os.close(descriptor)
        digest = hasher.hexdigest()
    elif stat.S_ISLNK(details.st_mode):
        target = os.readlink(path)
    return (
        None if content_stable else details.st_dev,
        None if content_stable else details.st_ino,
        stat.S_IFMT(details.st_mode),
        stat.S_IMODE(details.st_mode),
        details.st_size,
        digest,
        target,
    )


def directory_manifest(path):
    if not os.path.lexists(path):
        return None
    entries = []
    if not os.path.isdir(path) or os.path.islink(path):
        return ((".", file_identity(path, os.path.basename(path) == "index")),)
    for current, directories, files in os.walk(path, followlinks=False):
        directories.sort()
        files.sort()
        relative = os.path.relpath(current, path)
        entries.append((relative, file_identity(current)))
        for name in directories:
            candidate = os.path.join(current, name)
            if os.path.islink(candidate):
                entries.append((os.path.relpath(candidate, path), file_identity(candidate)))
        for name in files:
            candidate = os.path.join(current, name)
            entries.append(
                (
                    os.path.relpath(candidate, path),
                    file_identity(candidate, name == "index"),
                )
            )
    return tuple(entries)


def protected_paths():
    candidates = (
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
    return tuple(sorted(path for path in candidates if os.path.lexists(path)))


protected_baseline = tuple(
    (path, directory_manifest(path)) for path in protected_paths()
)


def assert_protected_immutable(label):
    current = tuple((path, directory_manifest(path)) for path, _ in protected_baseline)
    if current != protected_baseline:
        changed = [
            path
            for (path, before), (_, after) in zip(protected_baseline, current)
            if before != after
        ]
        raise RuntimeError(
            f"{label} changed immutable controller inputs: " + ", ".join(changed)
        )
    ticket_file = os.path.join(root, ticket_path)
    with open(ticket_file, "rb") as handle:
        current_ticket = handle.read()
    if hashlib.sha256(current_ticket).hexdigest() != immutable_ticket_digest:
        raise RuntimeError(f"{label} changed the selected ticket bytes")


def repository_snapshot():
    actual_root = canonical_git_path("rev-parse", "--show-toplevel")
    actual_git_dir = canonical_git_path("rev-parse", "--absolute-git-dir")
    actual_common_dir = canonical_git_path(
        "rev-parse", "--path-format=absolute", "--git-common-dir"
    )
    if (actual_root, actual_git_dir, actual_common_dir) != (
        root,
        expected_git_dir,
        expected_common_dir,
    ):
        raise RuntimeError("worktree identity changed")
    metadata_paths = {
        os.path.join(expected_git_dir, "HEAD"),
        os.path.join(expected_git_dir, "index"),
        os.path.join(expected_git_dir, "commondir"),
        os.path.join(expected_git_dir, "gitdir"),
        os.path.join(expected_git_dir, "logs"),
        os.path.join(expected_common_dir, "HEAD"),
        os.path.join(expected_common_dir, "config"),
        os.path.join(expected_common_dir, "packed-refs"),
        os.path.join(expected_common_dir, "refs"),
        os.path.join(expected_common_dir, "logs", "refs"),
        os.path.join(expected_common_dir, "worktrees"),
    }
    sibling_states = []
    for worktree in worktree_roots():
        sibling_states.append(
            (
                worktree,
                git_bytes_at(worktree, "rev-parse", "--verify", "HEAD"),
                git_optional_bytes_at(worktree, "symbolic-ref", "--quiet", "HEAD"),
                git_bytes_at(worktree, "write-tree"),
                git_bytes_at(
                    worktree,
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                ),
                git_bytes_at(worktree, "diff", "--cached", "--binary"),
            )
        )
    return {
        "root": file_identity(root),
        "git_dir": file_identity(expected_git_dir),
        "common_dir": file_identity(expected_common_dir),
        "head": git_bytes("rev-parse", "--verify", "HEAD"),
        "branch": git_optional_bytes("symbolic-ref", "--quiet", "HEAD"),
        "index_tree": git_bytes("write-tree"),
        "status": git_bytes(
            "status", "--porcelain=v1", "-z", "--untracked-files=all"
        ),
        "cached_diff": git_bytes("diff", "--cached", "--binary"),
        "refs": git_bytes(
            "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)%00"
        ),
        "worktrees": git_bytes("worktree", "list", "--porcelain", "-z"),
        "sibling_states": tuple(sibling_states),
        "metadata": tuple(
            (path, directory_manifest(path)) for path in sorted(metadata_paths)
        ),
    }


def repository_state():
    return git_bytes("status", "--porcelain=v1", "-z", "--untracked-files=all")


def write_exclusive(path, data, mode=0o600):
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        mode,
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def terminate_active(initial_signal):
    global active_process
    process = active_process
    if process is None or process.poll() is not None:
        return
    if active_kind == "codex":
        process.send_signal(signal.SIGINT)
    elif active_kind in ("codex-direct", "verification-command"):
        terminate_owned_group(process, initial_signal)
        release_group_owner(process)
    else:
        process.send_signal(initial_signal)
    try:
        process.wait(timeout=4)
        return
    except subprocess.TimeoutExpired:
        pass
    process.terminate()
    try:
        process.wait(timeout=2)
        return
    except subprocess.TimeoutExpired:
        pass
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


def run_managed(command, kind, evidence_name, environment=None):
    global active_kind, active_process
    pid_path = os.path.join(run_dir, f"{evidence_name}-supervisor.pid")
    signal.pthread_sigmask(signal.SIG_BLOCK, managed_signals)
    process = None
    try:
        process = subprocess.Popen(
            command,
            cwd=root,
            env=environment or os.environ.copy(),
            start_new_session=True,
        )
        active_process = process
        active_kind = kind
        write_exclusive(pid_path, f"{process.pid}\n".encode("ascii"))
    finally:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, managed_signals)
    if process is None:
        raise RuntimeError(f"{evidence_name} did not start")
    status = process.wait()
    active_process = None
    active_kind = None
    return status, process.pid


def phase_paths(label, final=False, isolated=False):
    directory = run_dir
    if isolated:
        phases_root = os.path.join(run_dir, "phases")
        os.makedirs(phases_root, mode=0o700, exist_ok=True)
        directory = os.path.join(phases_root, label)
        os.mkdir(directory, 0o700)
    return {
        "directory": directory,
        "input": os.path.join(directory, "invocation.md" if isolated else f"{label}-invocation.md"),
        "events": os.path.join(directory, "events.jsonl" if isolated else f"{label}-events.jsonl"),
        "stderr": os.path.join(directory, "stderr.log" if isolated else f"{label}-codex.stderr.log"),
        "progress": os.path.join(directory, "progress.log" if isolated else f"{label}-progress.log"),
        "result": result_path if final else os.path.join(directory, "result.json" if isolated else f"{label}-result.json"),
        "pid": os.path.join(directory, "supervisor.pid" if isolated else f"{label}-supervisor.pid"),
    }


def render_invocation(phase, extra):
    base = immutable_prompt.decode("utf-8")
    text = (
        f"{base}\n\nPhase: {phase}\n"
        f"Ticket path: {ticket_path}\n"
        f"Worker backend: {worker_backend}\n{extra}\n"
    )
    return text.encode("utf-8")


GROUP_OWNER_SOURCE = r'''
import json
import os
import signal
import subprocess
import sys

command = json.loads(sys.argv[1])
status_descriptor = int(sys.argv[2])
released = False


def release(_signum, _frame):
    global released
    released = True


for managed in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
    signal.signal(managed, signal.SIG_IGN)
signal.signal(signal.SIGUSR1, release)

child = subprocess.Popen(
    command,
    stdin=sys.stdin.buffer,
    stdout=sys.stdout.buffer,
    stderr=sys.stderr.buffer,
)
status = child.wait()
payload = json.dumps(
    {"child_pid": child.pid, "exit_code": status},
    separators=(",", ":"),
).encode("ascii") + b"\n"
os.write(status_descriptor, payload)
os.close(status_descriptor)
while not released:
    signal.pause()
'''


def assert_group_owner(owner):
    if owner.poll() is not None:
        raise RuntimeError("process-group owner exited before cleanup completed")
    try:
        group_id = os.getpgid(owner.pid)
    except ProcessLookupError as error:
        raise RuntimeError("process-group owner disappeared") from error
    if group_id != owner.pid:
        raise RuntimeError("process-group owner no longer owns its original group")
    return group_id


def owned_group_members(owner):
    group_id = assert_group_owner(owner)
    result = subprocess.run(
        ["/bin/ps", "-axo", "pid=,pgid="],
        check=False,
        capture_output=True,
        text=True,
        env=credential_free_codex_environment(),
    )
    if result.returncode != 0:
        raise RuntimeError("could not enumerate the owned process group")
    members = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 2:
            continue
        process_id, process_group = map(int, fields)
        if process_group == group_id and process_id != owner.pid:
            members.append(process_id)
    return tuple(sorted(set(members)))


def signal_owned_members(owner, signum):
    group_id = assert_group_owner(owner)
    signaled = False
    for process_id in owned_group_members(owner):
        try:
            if os.getpgid(process_id) != group_id:
                continue
            os.kill(process_id, signum)
            signaled = True
        except ProcessLookupError:
            continue
    return signaled


def terminate_owned_group(owner, initial_signal):
    if owner.poll() is not None:
        return False
    had_members = False
    stages = (
        (initial_signal, 4.0),
        (signal.SIGTERM, 2.0),
        (signal.SIGKILL, 2.0),
    )
    for signum, duration in stages:
        members = owned_group_members(owner)
        if not members:
            return had_members
        had_members = True
        signal_owned_members(owner, signum)
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            if not owned_group_members(owner):
                return had_members
            time.sleep(0.02)
    if owned_group_members(owner):
        raise RuntimeError("owned process-group members survived SIGKILL")
    return had_members


def release_group_owner(owner):
    if owner.poll() is not None:
        return
    if owned_group_members(owner):
        raise RuntimeError("cannot release a process-group owner with live members")
    assert_group_owner(owner)
    owner.send_signal(signal.SIGUSR1)
    owner.wait(timeout=2)


def start_group_owned_process(command, cwd, environment, stdin):
    status_read, status_write = os.pipe()
    try:
        owner = subprocess.Popen(
            [
                system_python,
                "-I",
                "-c",
                GROUP_OWNER_SOURCE,
                json.dumps(command, separators=(",", ":")),
                str(status_write),
            ],
            cwd=cwd,
            env=environment,
            stdin=stdin,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            pass_fds=(status_write,),
        )
    finally:
        os.close(status_write)
    assert_group_owner(owner)
    return owner, status_read


def credential_free_codex_environment():
    environment = os.environ.copy()
    for name in provider_names:
        environment.pop(name, None)
    for name in tuple(environment):
        if name.startswith("HERMES_"):
            environment.pop(name, None)
    environment["PATH"] = codex_tool_path
    return environment


def run_codex_direct(label, phase, extra, final):
    global active_kind, active_process
    paths = phase_paths(label, final=final, isolated=True)
    write_exclusive(paths["input"], render_invocation(phase, extra))
    write_exclusive(paths["result"], b"")
    events_descriptor = os.open(
        paths["events"],
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    stderr_descriptor = os.open(
        paths["stderr"],
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    progress_descriptor = os.open(
        paths["progress"],
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    codex = [
        seatbelt_executable,
        "-p",
        read_only_profile(paths["result"]),
        codex_executable,
        "-a",
        "never",
        "exec",
        "--sandbox",
        "read-only",
        "--json",
        "--output-schema",
        schema_path,
        "--output-last-message",
        paths["result"],
        "-",
    ]
    input_handle = open(paths["input"], "rb")
    process = None
    status_descriptor = None
    signal.pthread_sigmask(signal.SIG_BLOCK, managed_signals)
    try:
        process, status_descriptor = start_group_owned_process(
            codex,
            root,
            credential_free_codex_environment(),
            input_handle,
        )
        active_process = process
        active_kind = "codex-direct"
        write_exclusive(paths["pid"], f"{process.pid}\n".encode("ascii"))
    finally:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, managed_signals)
    if process is None or process.stdout is None or process.stderr is None:
        raise RuntimeError(f"{label} did not start")
    maximum = 16 * 1024 * 1024
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, (events_descriptor, "events"))
    selector.register(process.stderr, selectors.EVENT_READ, (stderr_descriptor, "stderr"))
    selector.register(status_descriptor, selectors.EVENT_READ, (None, "status"))
    sizes = {"events": 0, "stderr": 0}
    os.write(progress_descriptor, b"Codex phase started under direct supervision.\n")
    overflow = None
    lingering_descendant = False
    group_checked = False
    child_status = None
    status_payload = bytearray()
    try:
        while selector.get_map():
            for key, _ in selector.select(timeout=0.2):
                file_descriptor = (
                    key.fileobj if isinstance(key.fileobj, int) else key.fileobj.fileno()
                )
                chunk = os.read(file_descriptor, 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    if isinstance(key.fileobj, int):
                        os.close(key.fileobj)
                    else:
                        key.fileobj.close()
                    if key.data[1] == "status":
                        if len(status_payload) > 4096:
                            raise RuntimeError("Codex child-status evidence exceeded its bound")
                        child_record = json.loads(status_payload.decode("ascii"))
                        if set(child_record) != {"child_pid", "exit_code"}:
                            raise RuntimeError("Codex child-status evidence is malformed")
                        if not isinstance(child_record["child_pid"], int) or child_record["child_pid"] <= 1:
                            raise RuntimeError("Codex child PID evidence is invalid")
                        if not isinstance(child_record["exit_code"], int):
                            raise RuntimeError("Codex child exit evidence is invalid")
                        child_status = child_record["exit_code"]
                    continue
                descriptor, stream_name = key.data
                if stream_name == "status":
                    status_payload.extend(chunk)
                    if len(status_payload) > 4096:
                        overflow = "status"
                        terminate_active(signal.SIGTERM)
                    continue
                sizes[stream_name] += len(chunk)
                if sizes[stream_name] > maximum:
                    overflow = stream_name
                    terminate_active(signal.SIGTERM)
                    break
                os.write(descriptor, chunk)
            if overflow is not None:
                break
            if child_status is not None and not group_checked:
                group_checked = True
                lingering_descendant = (
                    terminate_owned_group(process, signal.SIGTERM)
                    or lingering_descendant
                )
                release_group_owner(process)
        if child_status is None:
            raise RuntimeError("Codex group owner produced no child exit evidence")
        status = child_status
    finally:
        selector.close()
        input_handle.close()
        for descriptor in (events_descriptor, stderr_descriptor):
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        if process is not None and process.poll() is None:
            lingering_descendant = (
                terminate_owned_group(process, signal.SIGTERM)
                or lingering_descendant
            )
            release_group_owner(process)
        active_process = None
        active_kind = None
    if lingering_descendant:
        status = 1
        os.write(
            progress_descriptor,
            b"Lingering Codex descendant was terminated before the retained group owner was released.\n",
        )
    if overflow is not None:
        status = 1
        os.write(progress_descriptor, f"{overflow} evidence exceeded 16777216 bytes.\n".encode("ascii"))
    os.write(progress_descriptor, f"Codex phase exited with status {status}.\n".encode("ascii"))
    os.fsync(progress_descriptor)
    os.close(progress_descriptor)
    return status, paths["result"], process.pid, paths


def run_codex_phase(label, phase, extra, read_only, final=False):
    validate_toolchain_manifest(f"before {label}")
    if read_only:
        if not os.path.isfile(seatbelt_executable) or not os.access(
            seatbelt_executable, os.X_OK
        ):
            raise RuntimeError("macOS sandbox-exec is required for read-only Codex phases")
        assert_protected_immutable(f"before {label}")
        before = repository_snapshot()
        status, output, process_pid, paths = run_codex_direct(
            label,
            phase,
            extra,
            final,
        )
        after = repository_snapshot()
        validate_toolchain_manifest(f"after {label}")
        assert_protected_immutable(f"after {label}")
        if after != before:
            changed_components = sorted(key for key in before if before[key] != after.get(key))
            raise RuntimeError(
                f"{label} changed repository state despite read-only containment: "
                + ", ".join(changed_components)
            )
        return status, output, process_pid, paths
    paths = phase_paths(label, final=final)
    write_exclusive(paths["input"], render_invocation(phase, extra))
    codex = [
        codex_executable,
        "-a",
        "never",
        "exec",
        "--sandbox",
        "read-only" if read_only else "workspace-write",
        "--json",
        "--output-schema",
        schema_path,
        "--output-last-message",
        paths["result"],
        "-",
    ]
    observer = [
        system_python,
        "-I",
        observer_path,
        "--input",
        paths["input"],
        "--events",
        paths["events"],
        "--stderr",
        paths["stderr"],
        "--progress",
        paths["progress"],
        "--",
        *codex,
    ]
    environment = os.environ.copy()
    environment["PATH"] = codex_tool_path
    status, process_pid = run_managed(observer, "codex", label, environment)
    return status, paths["result"], process_pid, paths


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def bounded_json(path, maximum=1048576):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode):
            raise ValueError("structured result is not a regular file")
        if details.st_size <= 0 or details.st_size > maximum:
            raise ValueError("structured result size is outside the safe bound")
        data = os.read(descriptor, maximum + 1)
    finally:
        os.close(descriptor)
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)


def exact_keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f"{label} has unknown, missing, or malformed fields")


def require_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")


top_keys = (
    "ticket_id",
    "ticket_path",
    "status",
    "summary",
    "validator",
    "explorer",
    "worker",
    "changed_files",
    "commands",
    "checks",
    "acceptance_criteria",
    "review",
    "manual_verification_required",
    "next_action",
)


def validate_validator(value):
    exact_keys(value, ("result", "summary", "blockers"), "validator")
    if value["result"] != "GO" or value["blockers"] != []:
        raise ValueError("validator is not exactly GO with no blockers")
    require_string(value["summary"], "validator summary")


def validate_explorer(value):
    exact_keys(
        value,
        ("result", "summary", "plan", "verification_map", "blockers"),
        "explorer",
    )
    if value["result"] != "GO" or value["blockers"] != []:
        raise ValueError("explorer is not exactly GO with no blockers")
    require_string(value["summary"], "explorer summary")
    for name in ("plan", "verification_map"):
        if not isinstance(value[name], list) or not value[name] or not all(
            isinstance(item, str) and item.strip() for item in value[name]
        ):
            raise ValueError(f"explorer {name} must be a nonempty string list")


def validate_worker(value, expected_result):
    exact_keys(value, ("backend", "result", "summary"), "worker")
    if value["backend"] != "HERMES" or value["result"] != expected_result:
        raise ValueError("worker backend or result is inconsistent")
    require_string(value["summary"], "worker summary")


def ticket_section(title):
    match = re.search(
        rf"^## {re.escape(title)}\s*$\n(?P<body>.*?)(?=^## |\Z)",
        immutable_ticket_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise ValueError(f"ticket is missing {title}")
    return match.group("body")


def ticket_bullets(title):
    body = ticket_section(title)
    bullets = []
    current = None
    for raw in body.splitlines():
        if raw.startswith("- "):
            if current is not None:
                bullets.append(current)
            current = raw[2:].strip()
        elif current is not None and (raw.startswith("  ") or not raw.strip()):
            if raw.strip():
                current += " " + raw.strip()
        elif current is not None:
            bullets.append(current)
            current = None
    if current is not None:
        bullets.append(current)
    if not bullets:
        raise ValueError(f"ticket has no {title} bullets")
    return bullets


def validate_immutable_ticket():
    status_match = re.search(
        r"^Status:\s*(\S+)\s*$",
        immutable_ticket_text,
        flags=re.MULTILINE,
    )
    if status_match is None or status_match.group(1) != "Ready":
        raise ValueError("immutable selected ticket is not Ready")
    dependency_ids = []
    for line in ticket_section("Dependencies").splitlines():
        match = re.match(r"^-\s+(T\d{4})\b", line.strip())
        if match:
            dependency_ids.append(match.group(1))
    ticket_directory = os.path.join(root, "docs", "tickets")
    for dependency_id in dependency_ids:
        matches = [
            name
            for name in os.listdir(ticket_directory)
            if name.startswith(dependency_id + "-") and name.endswith(".md")
        ]
        if len(matches) != 1:
            raise ValueError(f"dependency ticket is missing or ambiguous: {dependency_id}")
        dependency_path = os.path.join(ticket_directory, matches[0])
        with open(dependency_path, encoding="utf-8") as handle:
            dependency_text = handle.read()
        dependency_status = re.search(
            r"^Status:\s*(\S+)\s*$",
            dependency_text,
            flags=re.MULTILINE,
        )
        if dependency_status is None or dependency_status.group(1) != "Done":
            raise ValueError(f"dependency is not Done: {dependency_id}")
    ticket_bullets("Acceptance criteria")
    ticket_bullets("Automated verification")
    required_commands()


def required_commands():
    commands = []
    for bullet in ticket_bullets("Automated verification"):
        for command in re.findall(r"`([^`]+)`", bullet):
            normalized = " ".join(command.split())
            if not normalized or "\x00" in normalized or "\n" in command:
                raise ValueError("ticket contains an unsupported literal verification command")
            commands.append(normalized)
    if not commands:
        raise ValueError("ticket has no literal automated verification command")
    return tuple(dict.fromkeys(commands))


def actual_changed_files():
    payload = os.fsdecode(repository_state()).split("\0")
    changed = {}
    index = 0
    while index < len(payload):
        entry = payload[index]
        index += 1
        if not entry:
            continue
        code = entry[:2]
        path = entry[3:]
        if "R" in code or "C" in code:
            if index >= len(payload):
                raise ValueError("malformed Git rename status")
            path = payload[index]
            index += 1
            change = "RENAMED"
        elif code == "??" or "A" in code:
            change = "ADDED"
        elif "D" in code:
            change = "DELETED"
        else:
            change = "MODIFIED"
        if not path.startswith(".codex-runs/"):
            changed[path] = change
    return changed


def validate_changed_files(values):
    if not isinstance(values, list):
        raise ValueError("changed_files is malformed")
    reported = {}
    for value in values:
        exact_keys(value, ("path", "change", "reason"), "changed file")
        require_string(value["path"], "changed file path")
        require_string(value["reason"], "changed file reason")
        if value["path"] in reported:
            raise ValueError("changed file is duplicated")
        reported[value["path"]] = value["change"]
    if reported != actual_changed_files():
        raise ValueError("reported changed files do not match Git state")


def phase_evidence(label, expected_pid, paths):
    required = ("input", "events", "stderr", "progress", "result")
    for name in required:
        path = paths[name]
        details = os.lstat(path)
        if not stat.S_ISREG(details.st_mode):
            raise ValueError(f"{label} {name} evidence is not a regular file")
        if name in ("input", "events", "result") and details.st_size <= 0:
            raise ValueError(f"{label} {name} evidence is empty")
        if os.path.commonpath((paths["directory"], os.path.abspath(path))) != paths["directory"] and name != "result":
            raise ValueError(f"{label} evidence escaped its owned directory")
    with open(paths["pid"], encoding="ascii") as handle:
        pid = int(handle.read().strip())
    if pid <= 1 or pid != expected_pid:
        raise ValueError(f"{label} process evidence is invalid")
    completed = False
    forbidden_commands = set(required_commands()) if label == "verification" else set()
    with open(paths["events"], encoding="utf-8") as handle:
        for line in handle:
            event = json.loads(line, object_pairs_hook=unique_object)
            item = event.get("item") if isinstance(event, dict) else None
            if (
                isinstance(item, dict)
                and item.get("type") == "command_execution"
                and " ".join(str(item.get("command", "")).split())
                in forbidden_commands
            ):
                raise ValueError("read-only verification reran a shell-owned ticket check")
            if isinstance(event, dict) and event.get("type") == "turn.completed":
                completed = True
    if not completed:
        raise ValueError(f"{label} has no completed-turn evidence")
    return paths, pid


def artifact_manifest(paths):
    return tuple(
        (path, directory_manifest(path))
        for path in sorted(set(paths))
    )


def assert_artifact_manifest(manifest, label):
    current = tuple((path, directory_manifest(path)) for path, _ in manifest)
    if current != manifest:
        changed = [
            path
            for (path, before), (_, after) in zip(manifest, current)
            if before != after
        ]
        raise RuntimeError(
            f"{label} changed prior phase evidence: " + ", ".join(changed)
        )


def phase_artifacts(paths):
    return tuple(paths[name] for name in ("input", "events", "stderr", "progress", "result", "pid"))


def writer_immutable_state():
    snapshot = repository_snapshot()
    snapshot.pop("root", None)
    snapshot.pop("status", None)
    snapshot["sibling_states"] = tuple(
        state for state in snapshot["sibling_states"] if state[0] != root
    )
    return snapshot


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def snapshot_manifest(directory):
    directory = os.path.realpath(directory)
    records = []

    def visit(current, relative):
        with os.scandir(current) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
        for entry in children:
            if not relative and entry.name == ".git":
                continue
            if relative == ".codex-runs" and entry.name != ".gitkeep":
                continue
            if entry.name == ".git":
                raise RuntimeError("nested Git metadata is forbidden in verification snapshots")
            child_relative = os.path.join(relative, entry.name) if relative else entry.name
            details = entry.stat(follow_symlinks=False)
            mode = stat.S_IMODE(details.st_mode)
            if stat.S_ISDIR(details.st_mode):
                records.append(
                    {
                        "path": child_relative,
                        "type": "directory",
                        "mode": mode,
                    }
                )
                visit(entry.path, child_relative)
            elif stat.S_ISREG(details.st_mode):
                descriptor = os.open(
                    entry.path,
                    os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                )
                hasher = hashlib.sha256()
                size = 0
                try:
                    opened = os.fstat(descriptor)
                    if (opened.st_dev, opened.st_ino) != (
                        details.st_dev,
                        details.st_ino,
                    ):
                        raise RuntimeError("snapshot file changed identity while reading")
                    while True:
                        chunk = os.read(descriptor, 65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        hasher.update(chunk)
                finally:
                    os.close(descriptor)
                if size != details.st_size:
                    raise RuntimeError("snapshot file changed size while reading")
                records.append(
                    {
                        "path": child_relative,
                        "type": "file",
                        "mode": mode,
                        "size": size,
                        "sha256": hasher.hexdigest(),
                    }
                )
            elif stat.S_ISLNK(details.st_mode):
                target = os.readlink(entry.path)
                if os.path.isabs(target):
                    raise RuntimeError(
                        f"absolute symlink is unsafe for verification snapshot: {child_relative}"
                    )
                resolved = os.path.realpath(entry.path)
                if os.path.commonpath((directory, resolved)) != directory:
                    raise RuntimeError(
                        f"symlink escapes verification snapshot: {child_relative}"
                    )
                resolved_relative = os.path.relpath(resolved, directory)
                if resolved_relative.split(os.sep)[0] in (".git", ".codex-runs"):
                    raise RuntimeError(
                        f"symlink targets excluded controller state: {child_relative}"
                    )
                records.append(
                    {
                        "path": child_relative,
                        "type": "symlink",
                        "mode": mode,
                        "target": target,
                    }
                )
            else:
                raise RuntimeError(
                    f"unsupported entry in verification snapshot: {child_relative}"
                )

    visit(directory, "")
    return records


def copy_snapshot(source, destination, manifest):
    for record in manifest:
        source_path = os.path.join(source, record["path"])
        destination_path = os.path.join(destination, record["path"])
        if os.path.commonpath((destination, os.path.abspath(destination_path))) != destination:
            raise RuntimeError("verification snapshot destination escaped")
        if record["type"] == "directory":
            os.makedirs(destination_path, mode=record["mode"], exist_ok=True)
            os.chmod(destination_path, record["mode"])
        elif record["type"] == "symlink":
            os.makedirs(os.path.dirname(destination_path), mode=0o700, exist_ok=True)
            os.symlink(record["target"], destination_path)
        else:
            os.makedirs(os.path.dirname(destination_path), mode=0o700, exist_ok=True)
            source_descriptor = os.open(
                source_path,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            )
            destination_descriptor = os.open(
                destination_path,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0),
                record["mode"],
            )
            try:
                while True:
                    chunk = os.read(source_descriptor, 65536)
                    if not chunk:
                        break
                    offset = 0
                    while offset < len(chunk):
                        written = os.write(destination_descriptor, chunk[offset:])
                        if written <= 0:
                            raise RuntimeError("verification snapshot copy made no progress")
                        offset += written
                os.fsync(destination_descriptor)
                os.fchmod(destination_descriptor, record["mode"])
            finally:
                os.close(source_descriptor)
                os.close(destination_descriptor)


def verification_profile(mirror):
    return "\n".join(
        (
            "(version 1)",
            "(allow default)",
            "(deny network*)",
            "(deny file-write*)",
            '(allow file-write* (literal "/dev/null"))',
            f'(allow file-write* (subpath "{seatbelt_quote(mirror)}"))',
        )
    )


def verification_environment(mirror):
    environment = credential_free_codex_environment()
    for name in tuple(environment):
        if name.startswith("CODEX_") or name.startswith("HERMES_"):
            environment.pop(name, None)
    runtime_root = os.path.join(mirror, ".git", "codex-verification")
    home = os.path.join(runtime_root, "home")
    temporary = os.path.join(runtime_root, "tmp")
    os.makedirs(home, mode=0o700)
    os.makedirs(temporary, mode=0o700)
    git_config = os.path.join(home, "gitconfig")
    write_exclusive(git_config, b"")
    environment.update(
        {
            "HOME": home,
            "TMPDIR": temporary,
            "TMP": temporary,
            "TEMP": temporary,
            "PATH": codex_tool_path,
            "CI": "1",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": git_config,
            "GIT_TERMINAL_PROMPT": "0",
        }
    )
    return environment


def capture_owned_process(command, cwd, environment, timeout):
    global active_kind, active_process
    signal.pthread_sigmask(signal.SIG_BLOCK, managed_signals)
    owner = None
    status_descriptor = None
    try:
        owner, status_descriptor = start_group_owned_process(
            command,
            cwd,
            environment,
            subprocess.DEVNULL,
        )
        active_process = owner
        active_kind = "verification-command"
    finally:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, managed_signals)
    if owner is None or owner.stdout is None or owner.stderr is None:
        raise RuntimeError("verification command did not start")
    selector = selectors.DefaultSelector()
    selector.register(owner.stdout, selectors.EVENT_READ, "stdout")
    selector.register(owner.stderr, selectors.EVENT_READ, "stderr")
    selector.register(status_descriptor, selectors.EVENT_READ, "status")
    streams = {"stdout": bytearray(), "stderr": bytearray(), "status": bytearray()}
    child_status = None
    lingering = False
    released = False
    deadline = time.monotonic() + timeout
    maximum = 16 * 1024 * 1024
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise RuntimeError("verification command exceeded its time bound")
            for key, _ in selector.select(timeout=0.2):
                file_descriptor = (
                    key.fileobj if isinstance(key.fileobj, int) else key.fileobj.fileno()
                )
                chunk = os.read(file_descriptor, 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    if isinstance(key.fileobj, int):
                        os.close(key.fileobj)
                    else:
                        key.fileobj.close()
                    if key.data == "status":
                        record = json.loads(streams["status"].decode("ascii"))
                        if set(record) != {"child_pid", "exit_code"}:
                            raise RuntimeError("verification child-status evidence is malformed")
                        if not isinstance(record["child_pid"], int) or record["child_pid"] <= 1:
                            raise RuntimeError("verification child PID is invalid")
                        if not isinstance(record["exit_code"], int):
                            raise RuntimeError("verification child exit status is invalid")
                        child_status = record["exit_code"]
                    continue
                streams[key.data].extend(chunk)
                if len(streams[key.data]) > maximum:
                    raise RuntimeError(
                        f"verification {key.data} exceeded {maximum} bytes"
                    )
            if child_status is not None and not released:
                lingering = terminate_owned_group(owner, signal.SIGTERM)
                release_group_owner(owner)
                released = True
        if child_status is None:
            raise RuntimeError("verification command produced no exit evidence")
    finally:
        selector.close()
        if owner is not None and owner.poll() is None:
            lingering = terminate_owned_group(owner, signal.SIGTERM) or lingering
            release_group_owner(owner)
        active_process = None
        active_kind = None
    return child_status, bytes(streams["stdout"]), bytes(streams["stderr"]), lingering


def purge_verification_parent(parent, expected_identity):
    details = os.lstat(parent)
    if (details.st_dev, details.st_ino) != expected_identity or not stat.S_ISDIR(
        details.st_mode
    ):
        raise RuntimeError("verification mirror parent changed identity")

    def repair_permissions(function, path, _error):
        os.chmod(path, 0o700, follow_symlinks=False)
        function(path)

    shutil.rmtree(parent, onerror=repair_permissions)
    if os.path.lexists(parent):
        raise RuntimeError("verification mirror cleanup did not complete")


def run_shell_verification():
    source_before = snapshot_manifest(root)
    source_manifest_sha = hash_bytes(canonical_json(source_before))
    source_state = {
        "status": repository_state(),
        "unstaged": git_bytes("diff", "--binary"),
        "staged": git_bytes("diff", "--cached", "--binary"),
        "head": git_bytes("rev-parse", "--verify", "HEAD").strip(),
    }
    frozen = {
        "head_sha256": hash_bytes(source_state["head"]),
        "status_sha256": hash_bytes(source_state["status"]),
        "unstaged_diff_sha256": hash_bytes(source_state["unstaged"]),
        "staged_diff_sha256": hash_bytes(source_state["staged"]),
        "source_manifest_sha256": source_manifest_sha,
    }
    implementation_binding = hash_bytes(canonical_json(frozen))
    parent_base = "/private/tmp" if os.path.isdir("/private/tmp") else "/tmp"
    parent = tempfile.mkdtemp(prefix="blackbox-verification-", dir=parent_base)
    parent_details = os.lstat(parent)
    parent_identity = (parent_details.st_dev, parent_details.st_ino)
    mirror = os.path.join(parent, "worktree")
    evidence_directory = os.path.join(run_dir, "verification-commands")
    os.mkdir(evidence_directory, 0o700)
    records = []
    cleanup_error = None
    operation_error = None
    def mirror_git(*arguments, input_data=None):
        result = subprocess.run(
            ["/usr/bin/git", "-C", mirror, *arguments],
            input=input_data,
            check=False,
            capture_output=True,
            env=credential_free_codex_environment(),
        )
        if result.returncode != 0:
            raise RuntimeError(f"isolated verification Git command failed: {arguments}")
        return result.stdout

    try:
        clone = subprocess.run(
            [
                "/usr/bin/git",
                "clone",
                "--quiet",
                "--no-local",
                "--no-hardlinks",
                "--no-checkout",
                root,
                mirror,
            ],
            check=False,
            capture_output=True,
            env=credential_free_codex_environment(),
        )
        if clone.returncode != 0:
            raise RuntimeError("could not create an isolated verification repository")
        mirror_git("remote", "remove", "origin")
        mirror_git("update-ref", "--no-deref", "HEAD", source_state["head"])
        mirror_git("read-tree", source_state["head"])
        if source_state["staged"]:
            mirror_git("apply", "--cached", "--binary", "-", input_data=source_state["staged"])
        copy_snapshot(root, mirror, source_before)
        source_after = snapshot_manifest(root)
        if source_after != source_before:
            raise RuntimeError("implementation worktree changed while its snapshot was copied")
        if snapshot_manifest(mirror) != source_before:
            raise RuntimeError("verification mirror does not match the frozen worktree manifest")
        mirror_git_dir = os.path.realpath(
            os.fsdecode(mirror_git("rev-parse", "--absolute-git-dir")).strip()
        )
        mirror_common_dir = os.path.realpath(
            os.fsdecode(
                mirror_git("rev-parse", "--path-format=absolute", "--git-common-dir")
            ).strip()
        )
        if mirror_git_dir != os.path.join(mirror, ".git") or mirror_common_dir != mirror_git_dir:
            raise RuntimeError("verification repository is not isolated inside the mirror")
        if os.path.exists(os.path.join(mirror_git_dir, "objects", "info", "alternates")):
            raise RuntimeError("verification repository points to external Git objects")
        mirror_state = {
            "status": mirror_git(
                "status", "--porcelain=v1", "-z", "--untracked-files=all"
            ),
            "unstaged": mirror_git("diff", "--binary"),
            "staged": mirror_git("diff", "--cached", "--binary"),
            "head": mirror_git("rev-parse", "--verify", "HEAD").strip(),
        }
        if mirror_state != source_state:
            raise RuntimeError("isolated verification Git state differs from implementation")
        environment = verification_environment(mirror)
        profile = verification_profile(mirror)
        for index, command in enumerate(required_commands(), start=1):
            validate_toolchain_manifest(f"before verification command {index}")
            status, stdout, stderr, lingering = capture_owned_process(
                [
                    seatbelt_executable,
                    "-p",
                    profile,
                    "/bin/bash",
                    "--noprofile",
                    "--norc",
                    "-c",
                    command,
                ],
                mirror,
                environment,
                1800,
            )
            stdout_path = os.path.join(evidence_directory, f"{index:03d}.stdout.log")
            stderr_path = os.path.join(evidence_directory, f"{index:03d}.stderr.log")
            write_exclusive(stdout_path, stdout)
            write_exclusive(stderr_path, stderr)
            records.append(
                {
                    "command": command,
                    "exit_code": status,
                    "stdout": os.path.relpath(stdout_path, root),
                    "stdout_sha256": hash_bytes(stdout),
                    "stderr": os.path.relpath(stderr_path, root),
                    "stderr_sha256": hash_bytes(stderr),
                    "lingering_processes_terminated": lingering,
                }
            )
            if status != 0:
                raise RuntimeError(
                    f"verification command failed with status {status}: {command}"
                )
            if lingering:
                raise RuntimeError(
                    f"verification command left a lingering process: {command}"
                )
        if repository_state() != source_state["status"]:
            raise RuntimeError("verification commands changed the implementation worktree")
        if snapshot_manifest(root) != source_before:
            raise RuntimeError("verification commands changed frozen implementation content")
    except Exception as error:
        operation_error = error
    finally:
        try:
            purge_verification_parent(parent, parent_identity)
        except Exception as error:
            cleanup_error = error
    evidence = {
        "version": 1,
        "ticket_id": ticket_id,
        "ticket_path": ticket_path,
        "worker_backend": "HERMES",
        "implementation_binding_sha256": implementation_binding,
        "frozen_state": frozen,
        "commands": records,
        "mirror_destroyed": not os.path.lexists(parent),
    }
    evidence_path = os.path.join(run_dir, "verification-evidence.json")
    write_exclusive(
        evidence_path,
        json.dumps(evidence, indent=2, sort_keys=True).encode("utf-8") + b"\n",
    )
    if cleanup_error is not None:
        raise RuntimeError(f"verification mirror cleanup failed: {cleanup_error}")
    if operation_error is not None:
        raise RuntimeError(f"shell verification failed: {operation_error}")
    if not records or any(record["exit_code"] != 0 for record in records):
        raise RuntimeError("verification evidence does not contain all passing commands")
    return evidence_path, evidence, implementation_binding


def validate_shell_verification(path, expected_binding):
    evidence = bounded_json(path, maximum=4 * 1024 * 1024)
    exact_keys(
        evidence,
        (
            "version",
            "ticket_id",
            "ticket_path",
            "worker_backend",
            "implementation_binding_sha256",
            "frozen_state",
            "commands",
            "mirror_destroyed",
        ),
        "shell verification evidence",
    )
    if evidence["version"] != 1:
        raise ValueError("shell verification evidence version is unsupported")
    if evidence["ticket_id"] != ticket_id or evidence["ticket_path"] != ticket_path:
        raise ValueError("shell verification evidence identifies a different ticket")
    if evidence["worker_backend"] != "HERMES":
        raise ValueError("shell verification evidence identifies a different backend")
    if evidence["implementation_binding_sha256"] != expected_binding:
        raise ValueError("shell verification evidence is bound to different implementation bytes")
    frozen_state = evidence["frozen_state"]
    exact_keys(
        frozen_state,
        (
            "head_sha256",
            "status_sha256",
            "unstaged_diff_sha256",
            "staged_diff_sha256",
            "source_manifest_sha256",
        ),
        "shell verification frozen state",
    )
    if any(
        not isinstance(digest, str)
        or re.fullmatch(r"[0-9a-f]{64}", digest) is None
        for digest in frozen_state.values()
    ):
        raise ValueError("shell verification frozen-state digest is invalid")
    if hash_bytes(canonical_json(frozen_state)) != expected_binding:
        raise ValueError("shell verification binding does not match its frozen state")
    if evidence["mirror_destroyed"] is not True:
        raise ValueError("shell verification mirror was not destroyed")
    commands = evidence["commands"]
    if not isinstance(commands, list) or [record.get("command") for record in commands] != list(required_commands()):
        raise ValueError("shell verification evidence omitted or reordered ticket commands")
    for record in commands:
        exact_keys(
            record,
            (
                "command",
                "exit_code",
                "stdout",
                "stdout_sha256",
                "stderr",
                "stderr_sha256",
                "lingering_processes_terminated",
            ),
            "shell verification command",
        )
        if record["exit_code"] != 0 or record["lingering_processes_terminated"] is not False:
            raise ValueError("shell verification command did not complete cleanly")
        for name in ("stdout", "stderr"):
            output_path = os.path.join(root, record[name])
            if os.path.commonpath((run_dir, os.path.abspath(output_path))) != run_dir:
                raise ValueError("shell verification output escaped run evidence")
            details = os.lstat(output_path)
            if not stat.S_ISREG(details.st_mode):
                raise ValueError("shell verification output is not a regular file")
            if sha256_file(output_path) != record[f"{name}_sha256"]:
                raise ValueError("shell verification output digest does not match")
    return evidence


def validate_commands_and_checks(result, evidence_path, shell_evidence, required_map):
    commands = result["commands"]
    checks = result["checks"]
    if not isinstance(commands, list) or not commands:
        raise ValueError("verification commands must be nonempty")
    if not isinstance(checks, list) or not checks:
        raise ValueError("verification checks must be nonempty")
    expected_evidence = os.path.relpath(evidence_path, root)
    evidence_details = os.lstat(evidence_path)
    if not stat.S_ISREG(evidence_details.st_mode):
        raise ValueError("verification event evidence is not a regular file")
    if len(sha256_file(evidence_path)) != 64:
        raise ValueError("verification evidence digest is invalid")
    claimed = []
    for command in commands:
        exact_keys(command, ("command", "result", "exit_code", "evidence"), "command")
        require_string(command["command"], "command text")
        require_string(command["evidence"], "command evidence")
        if command["result"] != "PASS" or command["exit_code"] != 0:
            raise ValueError("every verification command must pass with exit zero")
        normalized_command = " ".join(command["command"].split())
        if command["command"] != normalized_command:
            raise ValueError("claimed verification command is not normalized")
        if command["evidence"] != expected_evidence:
            raise ValueError("claimed command references missing or non-phase evidence")
        claimed.append(normalized_command)
    check_names = []
    for check in checks:
        exact_keys(check, ("name", "status", "evidence"), "check")
        require_string(check["name"], "check name")
        require_string(check["evidence"], "check evidence")
        if check["status"] != "PASS":
            raise ValueError("every automated check must pass")
        if check["evidence"] != expected_evidence:
            raise ValueError("check references missing or non-phase evidence")
        check_names.append(check["name"])
    missing_map = sorted(set(required_map) - set(check_names))
    if missing_map:
        raise ValueError("verification omitted explorer-mapped checks")
    for command in required_commands():
        if command not in claimed:
            raise ValueError(f"required ticket command was not executed: {command}")
    if claimed != [record["command"] for record in shell_evidence["commands"]]:
        raise ValueError("claimed commands differ from shell-owned verification evidence")


def validate_acceptance(values, allowed_evidence):
    required = ticket_bullets("Acceptance criteria")
    if not isinstance(values, list) or not values:
        raise ValueError("acceptance criteria must be nonempty")
    reported = []
    for value in values:
        exact_keys(value, ("criterion", "status", "evidence"), "acceptance criterion")
        require_string(value["criterion"], "criterion")
        require_string(value["evidence"], "acceptance evidence")
        if value["status"] != "PASS":
            raise ValueError("every acceptance criterion must pass")
        if value["evidence"] not in allowed_evidence:
            raise ValueError("acceptance criterion references unbound evidence")
        reported.append(value["criterion"])
    if reported != required:
        raise ValueError("auditor criteria do not exactly match the ticket")


def validate_gate_result(path):
    result = bounded_json(path)
    exact_keys(result, top_keys, "gate result")
    if result["ticket_id"] != ticket_id or result["ticket_path"] != ticket_path:
        raise ValueError("gate result identifies a different ticket")
    if result["status"] != "READY_FOR_IMPLEMENTATION":
        raise ValueError("gate result did not authorize implementation")
    require_string(result["summary"], "gate summary")
    validate_validator(result["validator"])
    validate_explorer(result["explorer"])
    validate_worker(result["worker"], "NOT_RUN")
    if result["changed_files"] != []:
        raise ValueError("gate phase reported repository changes")
    for name in ("commands", "checks", "acceptance_criteria"):
        if not isinstance(result[name], list):
            raise ValueError(f"{name} is malformed")
    exact_keys(result["review"], ("result", "summary", "findings"), "review")
    if result["review"]["result"] != "NOT_RUN" or result["review"]["findings"] != []:
        raise ValueError("gate phase performed an unexpected review")
    require_string(result["review"]["summary"], "review summary")
    if result["manual_verification_required"] is not False:
        raise ValueError("gate phase cannot request manual verification")
    require_string(result["next_action"], "next action")
    return result


def validate_verification_result(
    path,
    gate,
    paths,
    shell_evidence_path,
    shell_evidence,
):
    result = bounded_json(path)
    exact_keys(result, top_keys, "verification result")
    if result["ticket_id"] != ticket_id or result["ticket_path"] != ticket_path:
        raise ValueError("verification result identifies a different ticket")
    if result["status"] != "PARTIAL":
        raise ValueError("verification success must use PARTIAL pending audit and review")
    require_string(result["summary"], "verification summary")
    if result["validator"] != gate["validator"] or result["explorer"] != gate["explorer"]:
        raise ValueError("verification changed gate evidence")
    validate_validator(result["validator"])
    validate_explorer(result["explorer"])
    validate_worker(result["worker"], "COMPLETE")
    validate_changed_files(result["changed_files"])
    validate_commands_and_checks(
        result,
        shell_evidence_path,
        shell_evidence,
        gate["explorer"]["verification_map"],
    )
    if result["acceptance_criteria"] != []:
        raise ValueError("verification phase cannot claim acceptance audit")
    exact_keys(result["review"], ("result", "summary", "findings"), "review")
    if result["review"]["result"] != "NOT_RUN" or result["review"]["findings"] != []:
        raise ValueError("verification phase cannot claim review")
    require_string(result["review"]["summary"], "verification review summary")
    if result["manual_verification_required"] is not False:
        raise ValueError("verification phase cannot open the manual gate")
    require_string(result["next_action"], "verification next action")
    return result


def validate_audit_result(
    path,
    gate,
    verification,
    verification_paths,
    shell_evidence_path,
):
    result = bounded_json(path)
    exact_keys(result, top_keys, "audit result")
    if result["ticket_id"] != ticket_id or result["ticket_path"] != ticket_path:
        raise ValueError("audit result identifies a different ticket")
    if result["status"] != "PARTIAL":
        raise ValueError("accepted audit must use PARTIAL pending review")
    require_string(result["summary"], "audit summary")
    if result["validator"] != gate["validator"] or result["explorer"] != gate["explorer"]:
        raise ValueError("audit changed gate evidence")
    validate_worker(result["worker"], "COMPLETE")
    if result["changed_files"] != verification["changed_files"]:
        raise ValueError("audit changed the verified file manifest")
    if result["commands"] != verification["commands"] or result["checks"] != verification["checks"]:
        raise ValueError("audit changed verification evidence")
    allowed_evidence = {
        os.path.relpath(shell_evidence_path, root),
        os.path.relpath(verification_paths["result"], root),
    }
    for evidence_path in (
        shell_evidence_path,
        verification_paths["result"],
    ):
        details = os.lstat(evidence_path)
        if not stat.S_ISREG(details.st_mode) or len(sha256_file(evidence_path)) != 64:
            raise ValueError("auditor referenced invalid verification evidence")
    validate_acceptance(result["acceptance_criteria"], allowed_evidence)
    exact_keys(result["review"], ("result", "summary", "findings"), "review")
    if result["review"]["result"] != "NOT_RUN" or result["review"]["findings"] != []:
        raise ValueError("audit phase cannot claim independent review")
    require_string(result["review"]["summary"], "audit review summary")
    if result["manual_verification_required"] is not False:
        raise ValueError("audit phase cannot open the manual gate")
    require_string(result["next_action"], "audit next action")
    return result


def validate_review_result(path, gate, verification, audit):
    result = bounded_json(path)
    exact_keys(result, top_keys, "review result")
    if result["ticket_id"] != ticket_id or result["ticket_path"] != ticket_path:
        raise ValueError("review result identifies a different ticket")
    if result["status"] != "READY_FOR_MANUAL_VERIFICATION":
        raise ValueError("review did not produce the exact manual-verification status")
    require_string(result["summary"], "review summary")
    if result["validator"] != gate["validator"] or result["explorer"] != gate["explorer"]:
        raise ValueError("review changed gate evidence")
    validate_worker(result["worker"], "COMPLETE")
    for name in ("changed_files", "commands", "checks"):
        if result[name] != verification[name]:
            raise ValueError(f"review changed verified {name}")
    if result["acceptance_criteria"] != audit["acceptance_criteria"]:
        raise ValueError("review changed audited acceptance evidence")
    exact_keys(result["review"], ("result", "summary", "findings"), "review")
    if result["review"]["result"] != "PASS" or result["review"]["findings"] != []:
        raise ValueError("independent review is not exactly PASS with no findings")
    require_string(result["review"]["summary"], "independent review summary")
    if result["manual_verification_required"] is not True:
        raise ValueError("successful review must require human manual verification")
    require_string(result["next_action"], "review next action")
    return result


def write_gate_contract():
    contract = {
        "worker_backend": "HERMES",
        "validator": "GO",
        "explorer": "GO",
    }
    path = os.path.join(run_dir, "hermes-gates.json")
    write_exclusive(
        path,
        (json.dumps(contract, separators=(",", ":")) + "\n").encode("utf-8"),
    )
    return path


def write_failed_result(gate, summary):
    failed = dict(gate)
    failed["status"] = "IMPLEMENTATION_FAILED"
    failed["summary"] = summary
    failed["worker"] = {
        "backend": "HERMES",
        "result": "FAILED",
        "summary": summary,
    }
    failed["review"] = {
        "result": "NOT_RUN",
        "summary": "Post-implementation review did not run.",
        "findings": [],
    }
    failed["manual_verification_required"] = False
    failed["next_action"] = "Inspect Hermes evidence; no fallback writer was started."
    write_exclusive(
        result_path,
        (json.dumps(failed, indent=2) + "\n").encode("utf-8"),
    )


def write_rejected_gate_result(gate_result_path, error):
    status = "IMPLEMENTATION_FAILED"
    validator_result = "NOT_RUN"
    explorer_result = "NOT_RUN"
    try:
        candidate = bounded_json(gate_result_path)
        if isinstance(candidate, dict):
            validator = candidate.get("validator")
            explorer = candidate.get("explorer")
            if isinstance(validator, dict):
                validator_result = validator.get("result", "NOT_RUN")
            if isinstance(explorer, dict):
                explorer_result = explorer.get("result", "NOT_RUN")
            if validator_result == "BLOCKED":
                status = "BLOCKED_VALIDATION"
            elif explorer_result == "BLOCKED":
                status = "BLOCKED_EXPLORATION"
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    result = {
        "ticket_id": ticket_id,
        "ticket_path": ticket_path,
        "status": status,
        "summary": f"Implementation gate rejected: {error}",
        "validator": {
            "result": validator_result
            if validator_result in ("GO", "BLOCKED", "NOT_RUN")
            else "NOT_RUN",
            "summary": "See gate phase evidence.",
            "blockers": [str(error)],
        },
        "explorer": {
            "result": explorer_result
            if explorer_result in ("GO", "BLOCKED", "NOT_RUN")
            else "NOT_RUN",
            "summary": "See gate phase evidence.",
            "plan": [],
            "verification_map": [],
            "blockers": [str(error)],
        },
        "worker": {
            "backend": "HERMES",
            "result": "NOT_RUN",
            "summary": "No implementation writer was started.",
        },
        "changed_files": [],
        "commands": [],
        "checks": [],
        "acceptance_criteria": [],
        "review": {
            "result": "NOT_RUN",
            "summary": "Review did not run.",
            "findings": [],
        },
        "manual_verification_required": False,
        "next_action": "Correct or re-run the read-only gates; no writer ran.",
    }
    write_exclusive(
        result_path,
        (json.dumps(result, indent=2) + "\n").encode("utf-8"),
    )


def changed_file_records():
    return [
        {
            "path": path,
            "change": change,
            "reason": "Observed directly from the post-Hermes Git status.",
        }
        for path, change in sorted(actual_changed_files().items())
    ]


def write_post_failure(gate, status, summary, rejected_path=None):
    if rejected_path and os.path.lexists(rejected_path):
        destination = os.path.join(
            run_dir,
            f"rejected-{os.path.basename(rejected_path)}",
        )
        if os.path.lexists(destination):
            raise RuntimeError("rejected post-result evidence already exists")
        os.replace(rejected_path, destination)
    result = {
        "ticket_id": ticket_id,
        "ticket_path": ticket_path,
        "status": status,
        "summary": summary,
        "validator": gate["validator"],
        "explorer": gate["explorer"],
        "worker": {
            "backend": "HERMES",
            "result": "COMPLETE",
            "summary": "Hermes exited successfully; post-implementation gates did not all pass.",
        },
        "changed_files": changed_file_records(),
        "commands": [],
        "checks": [],
        "acceptance_criteria": [],
        "review": {
            "result": "BLOCKED" if status == "REVIEW_BLOCKED" else "NOT_RUN",
            "summary": "Post-implementation evidence was rejected by the shell-owned controller.",
            "findings": [
                {
                    "severity": "BLOCKER",
                    "title": "Invalid post-implementation evidence",
                    "path": ticket_path,
                    "line": None,
                    "explanation": summary,
                    "recommended_action": "Inspect retained phase evidence and rerun without starting a repair writer.",
                }
            ] if status == "REVIEW_BLOCKED" else [],
        },
        "manual_verification_required": False,
        "next_action": "Inspect retained phase evidence; the manual-verification gate is closed.",
    }
    write_exclusive(
        result_path,
        (json.dumps(result, indent=2) + "\n").encode("utf-8"),
    )


def sha256_file(path):
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def validate_toolchain_manifest(label):
    manifest_details = os.stat(toolchain_manifest_path, follow_symlinks=False)
    if not stat.S_ISREG(manifest_details.st_mode) or manifest_details.st_size > 1048576:
        raise RuntimeError(f"{label}: private toolchain manifest is invalid")
    manifest = bounded_json(toolchain_manifest_path)
    if set(manifest) != {
        "version",
        "root",
        "run_dir",
        "safe_path",
        "required_names",
        "entries",
    }:
        raise RuntimeError(f"{label}: private toolchain manifest has unexpected fields")
    if (
        manifest["version"] != 1
        or manifest["root"] != root
        or manifest["run_dir"] != run_dir
        or manifest["safe_path"] != codex_tool_path
    ):
        raise RuntimeError(f"{label}: private toolchain binding is inconsistent")
    expected_bin = os.path.join(run_dir, "toolchain", "bin")
    if codex_tool_path != os.pathsep.join(
        (expected_bin, "/usr/bin", "/bin", "/usr/sbin", "/sbin")
    ):
        raise RuntimeError(f"{label}: executable PATH escaped the frozen private map")
    if os.path.realpath(expected_bin) != expected_bin or not os.path.isdir(expected_bin):
        raise RuntimeError(f"{label}: private executable directory is not canonical")
    entries = manifest["entries"]
    required_names = manifest["required_names"]
    if not isinstance(entries, list) or not isinstance(required_names, list):
        raise RuntimeError(f"{label}: private toolchain lists are malformed")
    names = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "name",
            "target",
            "target_sha256",
            "target_identity",
            "wrapper",
            "wrapper_sha256",
            "wrapper_identity",
        }:
            raise RuntimeError(f"{label}: private toolchain entry is malformed")
        name = entry["name"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", name):
            raise RuntimeError(f"{label}: private executable name is invalid")
        names.append(name)
        target = entry["target"]
        wrapper = entry["wrapper"]
        if not isinstance(target, str) or os.path.realpath(target) != target:
            raise RuntimeError(f"{label}: bound executable target is not canonical")
        if wrapper != os.path.join(expected_bin, name):
            raise RuntimeError(f"{label}: executable wrapper escaped the private map")
        target_details = os.stat(target, follow_symlinks=False)
        wrapper_details = os.stat(wrapper, follow_symlinks=False)
        if not stat.S_ISREG(target_details.st_mode) or not stat.S_ISREG(wrapper_details.st_mode):
            raise RuntimeError(f"{label}: bound executable changed type")
        target_identity = entry["target_identity"]
        wrapper_identity = entry["wrapper_identity"]
        if target_identity != {
            "device": target_details.st_dev,
            "inode": target_details.st_ino,
            "mode": stat.S_IMODE(target_details.st_mode),
            "size": target_details.st_size,
            "modified_ns": target_details.st_mtime_ns,
        }:
            raise RuntimeError(f"{label}: bound executable changed identity")
        if wrapper_identity != {
            "device": wrapper_details.st_dev,
            "inode": wrapper_details.st_ino,
            "mode": stat.S_IMODE(wrapper_details.st_mode),
            "size": wrapper_details.st_size,
        }:
            raise RuntimeError(f"{label}: executable wrapper changed identity")
        if stat.S_IMODE(wrapper_details.st_mode) != 0o500:
            raise RuntimeError(f"{label}: executable wrapper became writable")
        if sha256_file(target) != entry["target_sha256"]:
            raise RuntimeError(f"{label}: bound executable changed content")
        if sha256_file(wrapper) != entry["wrapper_sha256"]:
            raise RuntimeError(f"{label}: executable wrapper changed content")
    if len(names) != len(set(names)) or required_names != sorted(set(required_names)):
        raise RuntimeError(f"{label}: private toolchain names are not unique")
    if not set(required_names).issubset(names):
        raise RuntimeError(f"{label}: private toolchain omitted a required check executable")


def git_output(*arguments):
    result = subprocess.run(
        ["git", "-C", root, *arguments],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Git evidence command failed: {arguments}")
    return result.stdout


validate_immutable_ticket()
validate_toolchain_manifest("controller startup")
assert_protected_immutable("controller startup")


if worker_backend == "CODEX":
    status, _, _, _ = run_codex_phase(
        "full",
        "CODEX_FULL",
        "Do not invoke Hermes. Use exactly one configured Codex ticket_worker for implementation.",
        False,
        final=True,
    )
else:
    gate_status, gate_result_path, gate_pid, gate_paths = run_codex_phase(
        "gate",
        "HERMES_READ_ONLY_GATES",
        (
            "Run only validator and explorer. Do not edit, spawn a writer, invoke "
            "Hermes, run implementation, or continue to post checks."
        ),
        True,
    )
    if gate_status != 0:
        raise SystemExit(gate_status)
    try:
        phase_evidence("gate", gate_pid, gate_paths)
        gate = validate_gate_result(gate_result_path)
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        write_rejected_gate_result(gate_result_path, error)
        raise SystemExit(1)
    prior_evidence = artifact_manifest(
        (*phase_artifacts(gate_paths), os.path.join(run_dir, "metadata.json"))
    )
    gate_contract = write_gate_contract()
    prior_evidence = artifact_manifest(
        (*(path for path, _ in prior_evidence), gate_contract)
    )
    assert_artifact_manifest(prior_evidence, "before Hermes")
    validate_toolchain_manifest("before Hermes")
    writer_state = writer_immutable_state()
    hermes_environment = os.environ.copy()
    hermes_environment["PATH"] = codex_tool_path
    hermes_status, _ = run_managed(
        [
            hermes_wrapper,
            ticket_path,
            run_dir,
            gate_contract,
            hermes_auth_source,
            hermes_auth_provider,
        ],
        "hermes",
        "hermes",
        hermes_environment,
    )
    validate_toolchain_manifest("after Hermes")
    assert_protected_immutable("after Hermes")
    current_writer_state = writer_immutable_state()
    if current_writer_state != writer_state:
        changed_components = sorted(
            key
            for key in writer_state
            if writer_state[key] != current_writer_state.get(key)
        )
        raise RuntimeError(
            "Hermes changed Git metadata, an index, or a sibling worktree: "
            + ", ".join(changed_components)
        )
    assert_artifact_manifest(prior_evidence, "Hermes")
    if hermes_status != 0:
        write_failed_result(
            gate,
            f"Hermes writer exited with status {hermes_status}; no fallback writer was started.",
        )
        status = hermes_status
    else:
        prior_evidence = artifact_manifest(
            (
                *(path for path, _ in prior_evidence),
                os.path.join(run_dir, "hermes"),
                os.path.join(run_dir, "hermes-supervisor.pid"),
            )
        )
        status = 1
        try:
            assert_artifact_manifest(prior_evidence, "before shell verification")
            shell_evidence_path, shell_evidence, implementation_binding = run_shell_verification()
            shell_evidence = validate_shell_verification(
                shell_evidence_path,
                implementation_binding,
            )
            shell_evidence_sha = sha256_file(shell_evidence_path)
            prior_evidence = artifact_manifest(
                (
                    *(path for path, _ in prior_evidence),
                    shell_evidence_path,
                    os.path.join(run_dir, "verification-commands"),
                )
            )
            assert_artifact_manifest(prior_evidence, "before verification inspection")
            verification_status, verification_path, verification_pid, verification_paths = run_codex_phase(
                "verification",
                "HERMES_READ_ONLY_VERIFICATION",
                (
                    f"Hermes completed once. Gate result: {gate_result_path}. "
                    f"Hermes evidence: {os.path.join(run_dir, 'hermes')}. Shell-owned "
                    f"verification evidence: {shell_evidence_path} (SHA-256 "
                    f"{shell_evidence_sha}, implementation binding "
                    f"{implementation_binding}). Inspect that immutable evidence; do "
                    "not execute or rerun any command. Return PARTIAL, exact gate evidence, worker "
                    "HERMES/COMPLETE, the exact Git changed-file manifest, commands and "
                    "checks copied exactly from passing retained evidence, no acceptance audit, "
                    f"Use {os.path.relpath(shell_evidence_path, root)} "
                    "as every command/check evidence path. "
                    "review NOT_RUN, and manual_verification_required false. Do not "
                    "audit, review, edit, or start any writer."
                ),
                True,
            )
            if verification_status != 0:
                raise ValueError(
                    f"verification process exited with status {verification_status}"
                )
            phase_evidence("verification", verification_pid, verification_paths)
            assert_artifact_manifest(prior_evidence, "verification")
            verification = validate_verification_result(
                verification_path,
                gate,
                verification_paths,
                shell_evidence_path,
                shell_evidence,
            )
            verification_sha = sha256_file(verification_path)
            prior_evidence = artifact_manifest(
                (*(path for path, _ in prior_evidence), *phase_artifacts(verification_paths))
            )
            assert_artifact_manifest(prior_evidence, "before audit")
            audit_status, audit_path, audit_pid, audit_paths = run_codex_phase(
                "audit",
                "HERMES_READ_ONLY_AUDIT",
                (
                    f"Act only as the verification auditor in this fresh process. "
                    f"Gate: {gate_result_path}. Immutable verification result: "
                    f"{verification_path} (SHA-256 {verification_sha}). Map every "
                    "ticket acceptance-criteria bullet in exact order to retained "
                    f"evidence. Cite only {os.path.relpath(shell_evidence_path, root)} "
                    f"or {os.path.relpath(verification_path, root)}. Return PARTIAL, copy gate, worker, changed files, "
                    "commands, and checks exactly; require every criterion PASS; "
                    "review NOT_RUN and manual_verification_required false. Do not "
                    "rerun checks, review, edit, or start any writer."
                ),
                True,
            )
            if audit_status != 0:
                raise ValueError(f"audit process exited with status {audit_status}")
            phase_evidence("audit", audit_pid, audit_paths)
            assert_artifact_manifest(prior_evidence, "audit")
            if audit_pid == verification_pid:
                raise ValueError("verification and audit did not use fresh processes")
            audit = validate_audit_result(
                audit_path,
                gate,
                verification,
                verification_paths,
                shell_evidence_path,
            )
            audit_sha = sha256_file(audit_path)
            prior_evidence = artifact_manifest(
                (*(path for path, _ in prior_evidence), *phase_artifacts(audit_paths))
            )
            assert_artifact_manifest(prior_evidence, "before review")
            review_status, review_path, review_pid, review_paths = run_codex_phase(
                "review",
                "HERMES_READ_ONLY_REVIEW",
                (
                    f"Act only as the independent ticket reviewer in this fresh "
                    f"process. Gate: {gate_result_path}. Immutable verification: "
                    f"{verification_path} (SHA-256 {verification_sha}). Immutable "
                    f"audit: {audit_path} (SHA-256 {audit_sha}). Inspect the complete "
                    "diff independently. Only if there are zero findings or blockers, "
                    "return READY_FOR_MANUAL_VERIFICATION, copy all prior evidence "
                    "exactly, review PASS with an empty findings array, and "
                    "manual_verification_required true. Otherwise return a blocked "
                    "status with manual_verification_required false. Do not edit, "
                    "repair, invoke Hermes, or start any writer."
                ),
                True,
                final=True,
            )
            if review_status != 0:
                raise ValueError(f"review process exited with status {review_status}")
            phase_evidence("review", review_pid, review_paths)
            assert_artifact_manifest(prior_evidence, "review")
            if len({verification_pid, audit_pid, review_pid}) != 3:
                raise ValueError("post gates did not use three fresh process boundaries")
            validate_review_result(review_path, gate, verification, audit)
            prior_evidence = artifact_manifest(
                (*(path for path, _ in prior_evidence), *phase_artifacts(review_paths))
            )
            assert_protected_immutable("before manual-verification success")
            assert_artifact_manifest(prior_evidence, "before manual-verification success")
            status = 0
        except (OSError, RuntimeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            failure_status = (
                "REVIEW_BLOCKED"
                if os.path.lexists(result_path)
                else "VERIFICATION_FAILED"
            )
            write_post_failure(
                gate,
                failure_status,
                f"Post-implementation gate rejected: {error}",
                result_path if os.path.lexists(result_path) else None,
            )
            status = 1

with open(os.path.join(run_dir, "post-run-status.txt"), "w", encoding="utf-8") as handle:
    handle.write(git_output("status", "--short", "--branch"))
with open(os.path.join(run_dir, "diff-summary.txt"), "w", encoding="utf-8") as handle:
    handle.write("--- unstaged ---\n")
    handle.write(git_output("diff", "--stat"))
    handle.write("--- staged ---\n")
    handle.write(git_output("diff", "--cached", "--stat"))
    handle.write("--- untracked ---\n")
    handle.write(git_output("ls-files", "--others", "--exclude-standard"))

if not os.path.isfile(result_path) or os.path.getsize(result_path) == 0:
    summary = "No structured result was produced. Inspect phase event and stderr logs.\n"
else:
    try:
        result = bounded_json(result_path)
        fields = (
            ("Ticket", result.get("ticket_id", "unknown")),
            ("Status", result.get("status", "unknown")),
            ("Summary", result.get("summary", "")),
            ("Next action", result.get("next_action", "")),
        )
        summary = "\n".join(
            f"{label}: {value}" for label, value in fields if value
        ) + "\n"
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        summary = f"Structured result could not be parsed: {error}\n"
with open(os.path.join(run_dir, "final-message.txt"), "w", encoding="utf-8") as handle:
    handle.write(summary)

print(f"Run directory: {run_dir}")
print(f"Worker backend: {worker_backend}")
if status == 0:
    print(
        "Next human action: inspect result.json and complete the ticket "
        "manual-verification steps if requested."
    )
else:
    print(
        f"Ticket workflow exited with status {status}. Inspect phase evidence.",
        file=sys.stderr,
    )
raise SystemExit(status)
PY
CODEX_SUPERVISOR_PID=$!
set +e
wait "$CODEX_SUPERVISOR_PID"
controller_status=$?
if [[ -n "$PENDING_TICKET_SIGNAL" ]] && kill -0 "$CODEX_SUPERVISOR_PID" 2>/dev/null; then
  wait "$CODEX_SUPERVISOR_PID"
  controller_status=$?
fi
set -e

CODEX_SUPERVISOR_PID=
if [[ -n "$PENDING_TICKET_SIGNAL" ]]; then
  exit "$PENDING_TICKET_SIGNAL"
fi
exit "$controller_status"
