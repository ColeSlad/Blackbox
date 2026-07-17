#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

repository_root() {
  git rev-parse --show-toplevel 2>/dev/null || fail "run this command inside a Git repository"
}

resolve_repo_file() {
  local root=$1
  local candidate=$2

  require_command python3
  python3 - "$root" "$candidate" <<'PY'
import os
import sys

root = os.path.realpath(sys.argv[1])
candidate = sys.argv[2]
if not os.path.isabs(candidate):
    candidate = os.path.join(root, candidate)
resolved = os.path.realpath(candidate)
try:
    inside = os.path.commonpath([root, resolved]) == root
except ValueError:
    inside = False
if not inside:
    raise SystemExit("path is outside the repository")
if not os.path.isfile(resolved):
    raise SystemExit("file does not exist")
print(resolved)
PY
}

repo_relative_path() {
  local root=$1
  local path=$2

  require_command python3
  python3 - "$root" "$path" <<'PY'
import os
import sys

print(os.path.relpath(os.path.realpath(sys.argv[2]), os.path.realpath(sys.argv[1])))
PY
}

ticket_id_from_path() {
  local name
  name=$(basename "$1")
  printf '%s\n' "${name%%-*}"
}

ticket_status() {
  sed -n 's/^Status:[[:space:]]*//p' "$1" | head -n 1
}

utc_timestamp() {
  date -u '+%Y%m%dT%H%M%SZ'
}

create_run_directory() {
  local root=$1
  local category=$2
  local ticket_id=$3
  local base
  if [[ -n "$category" ]]; then
    base="$root/.codex-runs/$category/$ticket_id/$(utc_timestamp)"
  else
    base="$root/.codex-runs/$ticket_id/$(utc_timestamp)"
  fi
  local run_dir=$base
  local suffix=1

  while [[ -e "$run_dir" ]]; do
    run_dir="${base}-${suffix}"
    suffix=$((suffix + 1))
  done
  mkdir -p "$run_dir"
  printf '%s\n' "$run_dir"
}

capture_git_status() {
  local root=$1
  local destination=$2
  git -C "$root" status --short --branch >"$destination"
}

capture_diff_summary() {
  local root=$1
  local destination=$2

  {
    printf '%s\n' '--- unstaged ---'
    git -C "$root" diff --stat
    printf '%s\n' '--- staged ---'
    git -C "$root" diff --cached --stat
    printf '%s\n' '--- untracked ---'
    git -C "$root" ls-files --others --exclude-standard
  } >"$destination"
}

write_run_metadata() {
  local destination=$1
  local ticket_id=$2
  local ticket_path=$3
  local workflow=$4

  require_command python3
  python3 - "$destination" "$ticket_id" "$ticket_path" "$workflow" <<'PY'
import datetime
import json
import sys

destination, ticket_id, ticket_path, workflow = sys.argv[1:]
payload = {
    "ticket_id": ticket_id,
    "ticket_path": ticket_path,
    "workflow": workflow,
    "started_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(destination, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
}

render_result_summary() {
  local source=$1
  local destination=$2

  require_command python3
  python3 - "$source" "$destination" <<'PY'
import json
import os
import sys

source, destination = sys.argv[1:]
if not os.path.isfile(source) or os.path.getsize(source) == 0:
    text = "No structured result was produced. Inspect the event and stderr logs.\n"
else:
    try:
        with open(source, encoding="utf-8") as handle:
            data = json.load(handle)
        fields = [
            ("Ticket", data.get("ticket_id", "unknown")),
            ("Status", data.get("status", data.get("result", "unknown"))),
            ("Summary", data.get("summary", "")),
            ("Next action", data.get("next_action", "")),
        ]
        text = "\n".join(f"{label}: {value}" for label, value in fields if value) + "\n"
    except (OSError, json.JSONDecodeError) as error:
        text = f"Structured result could not be parsed: {error}\n"
with open(destination, "w", encoding="utf-8") as handle:
    handle.write(text)
PY
}

write_file_manifest() {
  local root=$1
  local destination=$2

  require_command python3
  python3 - "$root" "$destination" <<'PY'
import hashlib
import json
import os
import stat
import sys

root = os.path.realpath(sys.argv[1])
destination = sys.argv[2]
manifest = {}

def entry_metadata(path):
    details = os.lstat(path)
    mode = stat.S_IMODE(details.st_mode)
    if stat.S_ISLNK(details.st_mode):
        entry_type = "symlink"
        digest = hashlib.sha256(os.readlink(path).encode()).hexdigest()
    elif stat.S_ISDIR(details.st_mode):
        entry_type = "directory"
        digest = None
    elif stat.S_ISREG(details.st_mode):
        entry_type = "file"
        hasher = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
    else:
        entry_type = "other"
        digest = None
    return {"type": entry_type, "mode": mode, "sha256": digest}

manifest["."] = entry_metadata(root)
for current, directories, files in os.walk(root):
    relative_dir = os.path.relpath(current, root)
    directories[:] = [
        name for name in directories
        if os.path.join(relative_dir, name).replace(os.sep, "/")
        not in {"./.git", "./.codex-runs"}
        and name not in {".git", ".codex-runs"}
    ]
    for name in directories:
        path = os.path.join(current, name)
        relative = os.path.relpath(path, root).replace(os.sep, "/")
        manifest[relative] = entry_metadata(path)
    for name in files:
        path = os.path.join(current, name)
        relative = os.path.relpath(path, root).replace(os.sep, "/")
        if relative.startswith(".git/") or relative.startswith(".codex-runs/"):
            continue
        manifest[relative] = entry_metadata(path)
with open(destination, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
}

compare_file_manifests() {
  local before=$1
  local after=$2
  local destination=$3

  require_command python3
  python3 - "$before" "$after" "$destination" <<'PY'
import json
import sys

before_path, after_path, destination = sys.argv[1:]
with open(before_path, encoding="utf-8") as handle:
    before = json.load(handle)
with open(after_path, encoding="utf-8") as handle:
    after = json.load(handle)
changed = sorted(path for path in set(before) | set(after) if before.get(path) != after.get(path))
with open(destination, "w", encoding="utf-8") as handle:
    for path in changed:
        handle.write(path + "\n")
PY
}
