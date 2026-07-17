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

resolve_repo_directory() {
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
if not os.path.isdir(resolved):
    raise SystemExit("directory does not exist")
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

find_ticket_by_id() {
  local root=$1
  local ticket_id=$2

  require_command python3
  python3 - "$root" "$ticket_id" <<'PY'
import glob
import os
import sys

root, ticket_id = sys.argv[1:]
matches = []
for directory in ("tickets", "completed-tickets"):
    matches.extend(glob.glob(os.path.join(root, "docs", directory, f"{ticket_id}-*.md")))
if len(matches) != 1:
    raise SystemExit(f"expected exactly one ticket file for {ticket_id}; found {len(matches)}")
print(matches[0])
PY
}

select_next_ready_ticket() {
  local root=$1

  require_command python3
  python3 - "$root" <<'PY'
import glob
import os
import re
import sys

root = os.path.realpath(sys.argv[1])
index_path = os.path.join(root, "docs", "TICKETS.md")
row_pattern = re.compile(
    r"^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$"
)
tickets = []
with open(index_path, encoding="utf-8") as handle:
    for raw_line in handle:
        match = row_pattern.match(raw_line.rstrip())
        if match:
            tickets.append(tuple(part.strip() for part in match.groups()))

def individual_ticket(ticket_id):
    matches = []
    for directory in ("tickets", "completed-tickets"):
        matches.extend(glob.glob(os.path.join(root, "docs", directory, f"{ticket_id}-*.md")))
    if len(matches) != 1:
        return None, None, None
    with open(matches[0], encoding="utf-8") as handle:
        content = handle.read()
    match = re.search(r"^Status:\s*(.+?)\s*$", content, re.MULTILINE)
    dependency_section = re.search(
        r"^## Dependencies\s*$\n(?P<body>.*?)(?=^## |\Z)",
        content,
        re.MULTILINE | re.DOTALL,
    )
    if dependency_section is None:
        return (match.group(1) if match else None), matches[0], None
    dependency_body = dependency_section.group("body").strip()
    dependencies = re.findall(r"\bT[0-9]{4}\b", dependency_body)
    if not dependencies and dependency_body.rstrip(".").strip().casefold() != "none":
        return (match.group(1) if match else None), matches[0], None
    if len(dependencies) != len(set(dependencies)):
        return (match.group(1) if match else None), matches[0], None
    return (match.group(1) if match else None), matches[0], dependencies

for ticket_id, _title, index_status, index_dependencies_text in tickets:
    status, ticket_path, dependencies = individual_ticket(ticket_id)
    if status != "Ready" or ticket_path is None:
        continue
    if dependencies is None:
        print(f"error: {ticket_id} has a missing or invalid authoritative Dependencies section", file=sys.stderr)
        raise SystemExit(2)
    index_dependencies = [] if index_dependencies_text == "None" else [
        item.strip() for item in index_dependencies_text.split(",") if item.strip()
    ]
    if dependencies != index_dependencies:
        print(
            f"error: {ticket_id} dependency mismatch: ticket={dependencies or ['None']} "
            f"index={index_dependencies or ['None']}",
            file=sys.stderr,
        )
        raise SystemExit(2)
    dependency_statuses = [individual_ticket(dependency)[0] for dependency in dependencies]
    if any(dependency_status != "Done" for dependency_status in dependency_statuses):
        continue
    if index_status != status:
        print(
            f"warning: {ticket_id} index status is {index_status}; "
            f"authoritative ticket status is {status}",
            file=sys.stderr,
        )
    print(os.path.relpath(ticket_path, root))
    raise SystemExit(0)

raise SystemExit(1)
PY
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
