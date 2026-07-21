#!/usr/bin/python3 -I

import os
import sys

FIXED_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
VALIDATOR_ENVIRONMENT = {
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "NO_COLOR",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "__CF_USER_TEXT_ENCODING",
    "CODEX_HARNESS_PYTHON_ISOLATED",
}

if os.environ.get("CODEX_HARNESS_PYTHON_ISOLATED") != "2":
    allowed = {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "NO_COLOR",
        "TZ",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    }
    isolated_environment = {
        name: value for name, value in os.environ.items() if name in allowed
    }
    isolated_environment["PATH"] = FIXED_SYSTEM_PATH
    isolated_environment["TMPDIR"] = os.environ.get("TMPDIR") or "/tmp"
    isolated_environment["CODEX_HARNESS_PYTHON_ISOLATED"] = "2"
    os.execve(
        sys.executable,
        [sys.executable, "-I", os.path.abspath(__file__), *sys.argv[1:]],
        isolated_environment,
    )
unexpected_validator_environment = sorted(set(os.environ) - VALIDATOR_ENVIRONMENT)
if unexpected_validator_environment:
    print(
        "error: forged Python-isolation sentinel or unexpected variables: "
        + ", ".join(unexpected_validator_environment),
        file=sys.stderr,
    )
    raise SystemExit(1)
if os.environ.get("PATH") != FIXED_SYSTEM_PATH:
    raise SystemExit("error: isolated validator PATH is not the fixed allowlist")
del os.environ["CODEX_HARNESS_PYTHON_ISOLATED"]

import json
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FAILURES = []
HOST_SYSTEM_PYTHON = "/usr/bin/python3"


def check(condition, message):
    if condition:
        print(f"[PASS] {message}")
    else:
        print(f"[FAIL] {message}", file=sys.stderr)
        FAILURES.append(message)


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def compile_generated_python(path, label):
    result = subprocess.run(
        [HOST_SYSTEM_PYTHON, "-I", "-m", "py_compile", str(path)],
        env={"PATH": FIXED_SYSTEM_PATH},
        check=False,
        capture_output=True,
        text=True,
    )
    check(result.returncode == 0, f"{label} compiles with host /usr/bin/python3")


def read_agent_config(path):
    content = path.read_text(encoding="utf-8")
    config = {}
    for key in ("name", "description", "sandbox_mode"):
        match = re.search(rf'^{key}\s*=\s*"([^"]*)"\s*$', content, re.MULTILINE)
        if match:
            config[key] = match.group(1)
    instructions = re.search(
        r'^developer_instructions\s*=\s*"""(.*?)"""\s*$',
        content,
        re.MULTILINE | re.DOTALL,
    )
    if instructions:
        config["developer_instructions"] = instructions.group(1)
    return config


read_only_agents = {
    "plan-validator": "plan_validator",
    "project-explorer": "project_explorer",
    "ticket-reviewer": "ticket_reviewer",
    "verification-auditor": "verification_auditor",
    "project-planner": "project_planner",
    "harness-retrospective": "harness_retrospective",
}
writer_agents = {
    "ticket-worker": "ticket_worker",
    "ticket-closer": "ticket_closer",
    "harness-improver": "harness_improver",
}

host_python_version = subprocess.run(
    [HOST_SYSTEM_PYTHON, "-I", "-c", "import sys; print('.'.join(map(str, sys.version_info[:2])))"],
    env={"PATH": FIXED_SYSTEM_PATH},
    check=False,
    capture_output=True,
    text=True,
)
check(
    host_python_version.returncode == 0
    and host_python_version.stdout.strip() == "3.9",
    "generated fixtures are syntax-checked by host /usr/bin/python3 3.9",
)

for filename, agent_name in read_only_agents.items():
    path = ROOT / ".codex" / "agents" / f"{filename}.toml"
    config = read_agent_config(path)
    instructions = config.get("developer_instructions", "").lower()
    check(config.get("name") == agent_name, f"{agent_name} has the expected identity")
    check(config.get("sandbox_mode") == "read-only", f"{agent_name} is sandboxed read-only")
    check("edit" in instructions and ("never" in instructions or "without" in instructions), f"{agent_name} explicitly forbids edits")

for filename, agent_name in writer_agents.items():
    path = ROOT / ".codex" / "agents" / f"{filename}.toml"
    config = read_agent_config(path)
    check(config.get("name") == agent_name, f"{agent_name} has the expected identity")
    check(config.get("sandbox_mode") == "workspace-write", f"{agent_name} uses workspace-write")

workflow_writers = {
    ".agents/skills/ticket-runner/SKILL.md": "Spawn exactly one `ticket_worker`",
    ".agents/skills/ticket-close/SKILL.md": "Spawn exactly one `ticket_closer`",
    ".agents/skills/harness-improve/SKILL.md": "Spawn exactly one `harness_improver`",
}
for path, marker in workflow_writers.items():
    content = read(path)
    check(content.count(marker) == 1, f"{path} declares exactly one named writer")

ticket_runner_skill = read(".agents/skills/ticket-runner/SKILL.md")
validation_gate = ticket_runner_skill.find("Do not start a writing agent while either read-only agent is running")
implementation_writer = ticket_runner_skill.find("Spawn exactly one `ticket_worker`")
check(-1 < validation_gate < implementation_writer, "ticket read-only gates precede its implementation writer")
check("AGENT_SPAWN_FAILED" in ticket_runner_skill, "ticket runner fails closed when a required spawn fails")
check("Never\n   call `wait` unless at least one confirmed spawned agent remains active" in ticket_runner_skill, "ticket runner waits only for confirmed active agents")
check(
    "do not audit, review, edit, or start a writer" in ticket_runner_skill
    and "Do not invoke the Hermes wrapper or spawn another implementation writer" in ticket_runner_skill,
    "Hermes path forbids a Codex implementation writer",
)
check("invokes\n   `scripts/codex/run-hermes-worker.sh` exactly once" in ticket_runner_skill, "Hermes path names exactly one fixed writer wrapper")
check("For the HERMES backend, stop\n   with `REVIEW_BLOCKED`" in ticket_runner_skill, "blocking Hermes review cannot start a repair writer")

automated_ticket_prompt = read(".codex/prompts/automated-ticket-run.md")
check("Never issue a collaboration wait unless a previously" in automated_ticket_prompt, "automated ticket prompt waits only for confirmed agents")
check("AGENT_SPAWN_FAILED" in automated_ticket_prompt, "automated ticket prompt requires successful agent spawning")
check("Do not spawn `ticket_worker`" in automated_ticket_prompt and "shell-owned workflow" in automated_ticket_prompt, "automated prompt keeps Hermes and Codex writers mutually exclusive")
check(
    "verification auditor" in automated_ticket_prompt
    and "independent\nreviewer" in automated_ticket_prompt,
    "Hermes selection preserves audit and independent review",
)
check("Stop before human manual verification" in automated_ticket_prompt, "Hermes selection preserves the human verification stop")

project_plan = read(".agents/skills/project-plan/SKILL.md")
check("sole planning writer" in project_plan, "project planning declares one invoking-session writer")
check(bool(re.search(r"Do\s+not spawn a writing subagent", project_plan)), "project planning forbids writing subagents")
check("Never mark one `Ready`" in project_plan, "project planning cannot promote Draft tickets")
check("never\n   call a wait operation with no active agent" in project_plan, "project planning forbids receiver-less waits")

retrospective_skill = read(".agents/skills/harness-retrospective/SKILL.md")
check("Do not edit files" in retrospective_skill, "retrospective skill is change-free")
check("at most one" in retrospective_skill.lower() or "one highest-value" in retrospective_skill.lower(), "retrospective emits at most one recommendation")
check(bool(re.search(r"never wait\s+with no agent", retrospective_skill)), "retrospective forbids receiver-less waits")

autopilot = read("scripts/codex/autopilot.sh")
check(autopilot.count("./scripts/codex/run-ticket.sh") == 1, "autopilot invokes the ticket runner exactly once")
check(not re.search(r"^\s*(for|while|until)\b", autopilot, re.MULTILINE), "autopilot has no ticket-processing loop")
check("autopilot.sh" not in autopilot, "autopilot never recursively invokes itself")
check("--execute" in autopilot and "--dry-run" in autopilot, "autopilot defaults dry and requires explicit execution")
check("git worktree add" in autopilot, "autopilot creates an isolated worktree")
worktree_cd = autopilot.find('cd "$WORKTREE"')
worktree_runner = autopilot.find("./scripts/codex/run-ticket.sh")
check(-1 < worktree_cd < worktree_runner, "autopilot enters the worktree before invoking its runner")
check("--worker-backend" not in autopilot and "hermes" not in autopilot.lower(), "autopilot remains Codex-only and cannot opt into Hermes")

next_ready = read("scripts/codex/run-next-ready.sh")
check(next_ready.count('exec "$SCRIPT_DIR/run-ticket.sh"') == 1, "next-ready invokes at most one ticket runner")
check(not re.search(r"^\s*(for|while|until)\b", next_ready, re.MULTILINE), "next-ready has no ticket-processing loop")

common_script = read("scripts/codex/common.sh")
check("dependency_section" in common_script and "dependencies != index_dependencies" in common_script, "ticket selection uses authoritative individual dependencies and blocks index drift")

shell_scripts = sorted((ROOT / "scripts" / "codex").glob("*.sh"))
unsafe_git = re.compile(
    r"(?:^|[;&|]\s*|\bthen\s+)git(?:\s+-C\s+(?:\"[^\"]+\"|'[^']+'|\S+))?\s+"
    r"(?:add|commit|push|merge|reset|clean)\b"
)
for path in shell_scripts:
    content = path.read_text(encoding="utf-8")
    relative = path.relative_to(ROOT)
    check("danger-" + "full-access" not in content, f"{relative} never requests unrestricted sandboxing")
    check("dangerously-bypass-" not in content, f"{relative} never bypasses approvals or sandboxing")
    check(not unsafe_git.search(content), f"{relative} never stages, commits, pushes, merges, resets, or cleans")
    if re.search(r"\bcodex\s+-a\s+never\s+exec\b", content):
        check("--sandbox" in content, f"{relative} gives every Codex exec an explicit sandbox")

retrospective_script = read("scripts/codex/retrospective.sh")
check("--sandbox read-only" in retrospective_script, "retrospective automation is read-only")
check("codex -a never exec" in retrospective_script, "retrospective disables unattended approval escalation")
check("LATEST_EVIDENCE" in retrospective_script and 'metadata.get("workflow") == "ticket-runner"' in retrospective_script, "retrospective binds the latest ticket-run evidence")
check(".codex-runs/manual/$TICKET_ID" in retrospective_script, "retrospective binds optional manual evidence to the ticket")

plan_script = read("scripts/codex/plan-next.sh")
check("SANDBOX_MODE=read-only" in plan_script, "planning dry-run uses a read-only sandbox")
check("SANDBOX_MODE=workspace-write" in plan_script, "planning execute mode is explicit")
check("pre-run-ticket-index.md" in plan_script and "filtered_after == before_index_lines" in plan_script, "planning preserves all pre-existing ticket-index content")

improvement_script = read("scripts/codex/apply-harness-improvement.sh")
preflight_position = improvement_script.find("validate_proposal_and_approval")
doctor_position = improvement_script.find('"$SCRIPT_DIR/doctor.sh"')
writer_position = improvement_script.find("codex -a never exec")
check(-1 < preflight_position < writer_position, "proposal and approval validation precede the improvement writer")
check(-1 < doctor_position < writer_position, "deterministic checks precede the improvement writer")
check("proposal sha-256:" in improvement_script.lower() and "hashlib.sha256" in improvement_script, "harness approval binds the exact proposal digest")

run_ticket = read("scripts/codex/run-ticket.sh")
check(
    run_ticket.find('STATUS=$(ticket_status')
    < run_ticket.find("run-codex-observed.py"),
    "ticket status validation precedes implementation",
)
check("run-codex-observed.py" in run_ticket, "ticket execution uses the live event observer")
check(bool(re.search(r"^WORKER_BACKEND=CODEX$", run_ticket, re.MULTILINE)), "direct ticket runner defaults to the Codex backend")
check("--worker-backend" in run_ticket and "WORKER_BACKEND=HERMES" in run_ticket, "direct ticket runner requires explicit Hermes opt-in")
check("--worker-backend must be codex or hermes" in run_ticket, "direct ticket runner rejects unknown backends")
check(
    "Hermes file auth requires both --hermes-auth-source and --hermes-auth-provider" in run_ticket
    and '[[ "$HERMES_AUTH_SOURCE" == "user-hermes" ]]' in run_ticket
    and '[[ "$HERMES_AUTH_PROVIDER" == "openai-codex" ]]' in run_ticket,
    "direct runner requires the exact paired Hermes file-auth selectors",
)
check(run_ticket.count('run-hermes-worker.sh') == 1, "direct runner names the fixed Hermes wrapper exactly once")
check("Do not invoke Hermes" in run_ticket, "default Codex invocation explicitly excludes Hermes")
check("no fallback writer was started" in run_ticket, "Hermes wrapper failure stops implementation")
check('metadata["worktree_identity"]' in run_ticket, "ticket runner records immutable worktree identity")
check(
    '"--sandbox",\n        "read-only",' in run_ticket
    and 'read_only_profile(paths["result"])' in run_ticket
    and '"read-only" if read_only else "workspace-write"' in run_ticket,
    "ticket runner uses its resolved Codex executable with explicit CLI and Seatbelt sandboxes",
)
check(
    "forged clean-environment sentinel" in run_ticket
    and 'PATH") != "/usr/bin:/bin:/usr/sbin:/sbin"' in run_ticket,
    "ticket runner validates its exact clean environment before trust",
)
check(
    "CODEX_HARNESS_DISCOVERY_PATH" in run_ticket
    and 'TOOLCHAIN_MANIFEST="$RUN_DIR/toolchain.json"' in run_ticket
    and 'safe_path = os.pathsep.join((toolchain_bin, fixed_system_path))' in run_ticket
    and "validate_toolchain_manifest" in run_ticket
    and "target_sha256" in run_ticket
    and "wrapper_sha256" in run_ticket,
    "ticket runner freezes caller discovery into a bound private executable map",
)
check(
    'codex_tool_path != os.pathsep.join(' in run_ticket
    and '"/usr/bin", "/bin", "/usr/sbin", "/sbin"' in run_ticket
    and 'environment["PATH"] = codex_tool_path' in run_ticket,
    "agent and verification PATH contains only the frozen map and fixed system directories",
)
redaction_position = run_ticket.find("trap finalize_ticket_run EXIT")
observer_position = run_ticket.find("run-codex-observed.py")
check(
    -1 < redaction_position < observer_position
    and "redact_run_artifacts" in run_ticket
    and "handle_ticket_signal" in run_ticket,
    "ticket runner installs artifact redaction before Codex can emit evidence",
)
check(
    'replacement = b"<x>"' in run_ticket
    and "key=len,\n    reverse=True" in run_ticket,
    "ticket-run artifact redaction uses exact longest-first provider values",
)
check(
    "symlinks are forbidden in retained run evidence" in run_ticket
    and "retained evidence directory is unreadable" in run_ticket
    and "failed to redact retained ticket-run artifacts" in run_ticket,
    "ticket-run redaction fails closed on traversal and scrub errors",
)
check(
    "signal.pthread_sigmask(signal.SIG_BLOCK" in run_ticket
    and "active_process = process" in run_ticket
    and "start_new_session=True" in run_ticket
    and "process.poll() is not None" in run_ticket
    and "supervisor.pid" in run_ticket,
    "ticket runner supervises the active process object before signals are unblocked",
)
check(
    "immutable_ticket_text" in run_ticket
    and "assert_protected_immutable" in run_ticket
    and 'ticket_bullets("Acceptance criteria")' in run_ticket
    and "required_commands()" in run_ticket,
    "ticket status, criteria, and literal checks are immutable controller inputs",
)
check(
    "credential_free_codex_environment" in run_ticket
    and "environment.pop(name, None)" in run_ticket
    and "artifact_manifest" in run_ticket
    and "assert_artifact_manifest" in run_ticket,
    "read-only phases receive no provider credentials and cannot rewrite prior evidence",
)
check(
    "sibling_states" in run_ticket
    and "GROUP_OWNER_SOURCE" in run_ticket
    and "owned_group_members" in run_ticket
    and "release_group_owner" in run_ticket
    and "os.killpg" not in run_ticket
    and "selectors.DefaultSelector" in run_ticket,
    "direct supervision retains group ownership through bounded descendant cleanup",
)
verification_profile_source = run_ticket.split(
    "def verification_profile(mirror):", 1
)[1].split("def verification_environment(mirror):", 1)[0]
check(
    "run_shell_verification" in run_ticket
    and "verification_profile" in run_ticket
    and '"--no-local"' in run_ticket
    and "implementation_binding_sha256" in run_ticket
    and '"(deny file-write*)"' in run_ticket
    and '"(deny network*)"' in run_ticket
    and verification_profile_source.count("(allow file-write*") == 2
    and '(literal "/dev/null")' in verification_profile_source
    and "seatbelt_quote(mirror)" in verification_profile_source,
    "Hermes checks run in a disposable bound isolated-Git verification mirror",
)
doctor_script = read("scripts/codex/doctor.sh")
check(
    "codex_probe()" in doctor_script
    and "codex_probe --version" in doctor_script
    and "codex_probe exec --help" in doctor_script
    and "codex_probe review --help" in doctor_script
    and "codex_probe features list" in doctor_script
    and "/usr/bin/env -i" in doctor_script,
    "doctor invokes every Codex probe through its credential-free exact environment",
)
check(
    run_ticket.find('/usr/bin/env -i \\\n  PATH="$CODEX_TOOL_PATH"')
    < run_ticket.find('STATUS=$(ticket_status'),
    "ticket runner invokes doctor credential-free before ticket execution",
)
for injection_variable in (
    "PYTHONPATH",
    "BASH_ENV",
    "LD_PRELOAD",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_GLOBAL",
):
    check(injection_variable in run_ticket, f"ticket runner controls runtime injection variable {injection_variable}")

for clean_script_path in (
    "scripts/codex/run-ticket.sh",
    "scripts/codex/run-hermes-worker.sh",
    "scripts/codex/doctor.sh",
):
    clean_script = read(clean_script_path)
    check(
        "if ! /usr/bin/env -0 | /usr/bin/env -i" in clean_script
        and "forged clean-environment sentinel" in clean_script,
        f"{clean_script_path} fails closed on exact clean-environment validation",
    )

hermes_wrapper = read("scripts/codex/run-hermes-worker.sh")
for required_fragment in (
    '[[ -f "$ROOT/.git" ]]',
    'git("worktree", "list", "--porcelain")',
    'metadata.get("workflow") != "ticket-runner"',
    'metadata.get("worker_backend") != "HERMES"',
    'metadata.get("worktree_identity") != identity',
    'HERMES_WRITE_SAFE_ROOT',
    'HERMES_HOME',
    '"--quiet"',
    '"--safe-mode"',
    '"--ignore-user-config"',
    '"--ignore-rules"',
    '"--toolsets"',
    '"file"',
    '131072',
    '"(deny process-fork)"',
    'cleanup_hermes_home',
):
    check(required_fragment in hermes_wrapper, f"Hermes wrapper contains required control: {required_fragment}")
check("caller-supplied Hermes environment controls are forbidden" in hermes_wrapper, "Hermes wrapper rejects caller feature overrides")
check("arbitrary Hermes flags are forbidden" in hermes_wrapper and "Hermes wrapper flags are forbidden" in hermes_wrapper, "Hermes wrapper rejects passthrough and dangerous flags")
check(hermes_wrapper.count('"chat",\n        "-q"') == 1, "Hermes wrapper contains one implementation chat invocation")
check("terminal" not in hermes_wrapper.lower().split("command = [", 1)[1].split("]", 1)[0], "Hermes command does not enable terminal tools")
check("http://" not in hermes_wrapper and "https://" not in hermes_wrapper, "Hermes wrapper contains no network endpoint")
check("ticket-worker-prompt.md" not in hermes_wrapper, "Hermes wrapper never persists the composed ticket prompt")
check("provider_credentials = (" in hermes_wrapper, "Hermes environment uses a fixed provider-credential allowlist")
capability_probe_position = hermes_wrapper.find(
    'capability_status, capability_output, capability_truncated, _, _, _ = run_sandboxed('
)
implementation_position = hermes_wrapper.find(
    ") = run_sandboxed(\n    implementation_arguments,"
)
check(
    -1 < capability_probe_position < implementation_position
    and hermes_wrapper.count("include_provider_credentials=False") == 1
    and "include_provider_credentials=not file_auth_selected" in hermes_wrapper
    and hermes_wrapper.count("allow_network=False") == 1
    and hermes_wrapper.count("allow_network=True") == 1
    and "(deny network*)" in hermes_wrapper,
    "Hermes capability probe is credential-free and network-confined before the sole credentialed writer",
)
check(
    "forged clean-environment sentinel" in hermes_wrapper
    and 'PATH") != "/usr/bin:/bin:/usr/sbin:/sbin"' in hermes_wrapper,
    "Hermes wrapper validates its exact clean environment before trust",
)
check(
    "sorted(credential_values, key=len, reverse=True)" in hermes_wrapper
    and 'captured = captured.replace(value, b"<x>")' in hermes_wrapper,
    "Hermes evidence redacts exact provider values longest first",
)
check(
    'auth_source_selector == "user-hermes"' in hermes_wrapper
    and 'auth_provider_selector == "openai-codex"' in hermes_wrapper
    and "import_selected_auth" in hermes_wrapper
    and "object_pairs_hook=unique_object" in hermes_wrapper
    and "details.st_uid != os.getuid()" in hermes_wrapper
    and "caller auth directory has the wrong owner" in hermes_wrapper
    and "stat.S_IMODE(details.st_mode) not in (0o400, 0o600)" in hermes_wrapper
    and "os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow" in hermes_wrapper
    and '"version": 1' in hermes_wrapper,
    "Hermes file auth is explicit, schema-bound, descriptor-confined, and exclusively created",
)
check(
    '(deny file-read* (literal' in hermes_wrapper
    and '(deny file-write* (literal' in hermes_wrapper
    and '"-f",\n        "/dev/stdin"' in hermes_wrapper
    and "stdin=profile_read" in hermes_wrapper
    and "close_fds=True" in hermes_wrapper
    and "pass_fds=" not in hermes_wrapper,
    "Hermes auth-source denials use a closed standard-input profile rather than arguments, environment, or inherited nonstandard descriptors",
)
check(
    "current_ephemeral_auth_values" in hermes_wrapper
    and "candidate_ephemeral_auth_values" in hermes_wrapper
    and "inspect_ephemeral_auth_values" in hermes_wrapper
    and "workspace_credential_matches" in hermes_wrapper
    and "additional_sensitive=sensitive_values" in hermes_wrapper
    and 'captured = captured.replace(auth_source_path.encode("utf-8"), b"<auth-source>")' in hermes_wrapper
    and "if not ephemeral_auth_valid:" in hermes_wrapper,
    "Hermes original and refreshed values, retained output, source paths, and workspace leak attempts are scrubbed before invalid refreshes block",
)
check(
    'write_root == home_path and sorted(os.listdir(home_descriptor)) != ["tmp"]'
    in hermes_wrapper,
    "Hermes controller proves the capability home is empty immediately before launch",
)
check(
    "signal.pthread_sigmask(signal.SIG_BLOCK" in hermes_wrapper
    and hermes_wrapper.find("signal.pthread_sigmask(signal.SIG_BLOCK")
    < hermes_wrapper.find("process = subprocess.Popen(")
    and "active_process = process" in hermes_wrapper
    and 'exec "$SYSTEM_PYTHON" -I -' in hermes_wrapper,
    "Hermes controller blocks signals until its exact process object is known",
)
check(
    "os.O_RDONLY | directory_flag | no_follow" in hermes_wrapper
    and "home was relocated or replaced" in hermes_wrapper
    and "expected_home_identity" in hermes_wrapper,
    "Hermes cleanup is descriptor-confined and inode-bound",
)
check(
    "protected_paths = tuple(" in hermes_wrapper
    and 'os.path.join(root, "docs", "tickets")' in hermes_wrapper
    and "registered_roots" in hermes_wrapper,
    "Hermes Seatbelt protects harness authority, tickets, Git, and sibling worktrees",
)

ticket_worker_agent = read(".codex/agents/ticket-worker.toml")
check("backend HERMES" in ticket_worker_agent and "refuse immediately" in ticket_worker_agent, "Codex ticket_worker refuses Hermes-selected runs")

with (ROOT / ".codex" / "schemas" / "ticket-run-result.schema.json").open(encoding="utf-8") as handle:
    ticket_run_schema = json.load(handle)
worker_schema = ticket_run_schema["properties"]["worker"]
check("backend" in worker_schema["required"], "ticket-run result requires a worker backend")
check(worker_schema["properties"]["backend"].get("enum") == ["CODEX", "HERMES"], "ticket-run result records only CODEX or HERMES")

with tempfile.TemporaryDirectory() as forged_validator_directory:
    forged_validator_path = Path(forged_validator_directory)
    forged_validator_marker = forged_validator_path / "python-startup-marker"
    forged_validator_script = forged_validator_path / "sitecustomize.py"
    forged_validator_script.write_text(
        "from pathlib import Path\n"
        f"Path({str(forged_validator_marker)!r}).write_text('injected')\n",
        encoding="utf-8",
    )
    compile_generated_python(forged_validator_script, "forged startup fixture")
    forged_validator_result = subprocess.run(
        [sys.executable, "-I", str(Path(__file__).resolve())],
        env={
            "PATH": FIXED_SYSTEM_PATH,
            "CODEX_HARNESS_PYTHON_ISOLATED": "2",
            "PYTHONPATH": str(forged_validator_path),
        },
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    check(
        forged_validator_result.returncode != 0
        and "forged Python-isolation sentinel"
        in forged_validator_result.stderr,
        "forged validator isolation sentinel is rejected",
    )
    check(
        not forged_validator_marker.exists(),
        "forged validator sentinel cannot activate Python startup code",
    )

with tempfile.TemporaryDirectory() as forged_doctor_directory:
    forged_doctor_path = Path(forged_doctor_directory)
    forged_doctor_marker = forged_doctor_path / "shell-startup-marker"
    forged_doctor_hook = forged_doctor_path / "shell-hook.sh"
    forged_doctor_hook.write_text(
        f"printf injected > {forged_doctor_marker}\n", encoding="utf-8"
    )
    forged_doctor_result = subprocess.run(
        [str(ROOT / "scripts/codex/doctor.sh")],
        cwd=ROOT,
        env={
            "PATH": FIXED_SYSTEM_PATH,
            "CODEX_HARNESS_CLEAN_ENVIRONMENT": "2",
            "BASH_ENV": str(forged_doctor_hook),
        },
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    check(
        forged_doctor_result.returncode != 0
        and "forged clean-environment sentinel" in forged_doctor_result.stderr,
        "forged doctor clean-environment sentinel is rejected",
    )
    check(
        not forged_doctor_marker.exists(),
        "forged doctor sentinel cannot activate shell startup code",
    )

for clean_script, arguments in (
    (ROOT / "scripts/codex/doctor.sh", []),
    (ROOT / "scripts/codex/run-ticket.sh", ["docs/tickets/T0001-project-skeleton.md"]),
    (
        ROOT / "scripts/codex/run-hermes-worker.sh",
        ["docs/tickets/T0001-project-skeleton.md", ".codex-runs", ".codex-runs/.gitkeep"],
    ),
):
    forged_exact_environment = {
        "PATH": FIXED_SYSTEM_PATH,
        "CODEX_HARNESS_CLEAN_ENVIRONMENT": "2",
        "CODEX_HARNESS_BOOTSTRAP_PID": "1",
        "CODEX_HARNESS_CODEX_EXECUTABLE": "/usr/bin/false",
        "CODEX_HARNESS_HERMES_EXECUTABLE": "/usr/bin/false",
        "CODEX_HARNESS_TOOL_PATH": FIXED_SYSTEM_PATH,
    }
    if clean_script.name == "run-hermes-worker.sh":
        forged_exact_environment.pop("CODEX_HARNESS_CODEX_EXECUTABLE")
        forged_exact_environment.pop("CODEX_HARNESS_TOOL_PATH")
    forged_exact = subprocess.run(
        [str(clean_script), *arguments],
        cwd=ROOT,
        env=forged_exact_environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    check(
        forged_exact.returncode != 0
        and "bootstrap provenance" in forged_exact.stderr,
        f"{clean_script.name} rejects an exactly allowlisted forged internal environment",
    )


def file_hashes(directory):
    hashes = {}
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if ".git" in relative.parts or ".codex-runs" in relative.parts or not path.is_file():
            continue
        hashes[str(relative)] = path.read_bytes()
    return hashes


def stable_ticket_runs(base):
    if not base.exists():
        return set()
    if not base.is_dir():
        raise RuntimeError(f"ticket-run evidence root is not a directory: {base}")
    metadata_paths = tuple(base.glob("*/*/metadata.json"))
    runs = set()
    for metadata_path in metadata_paths:
        try:
            with metadata_path.open("rb") as metadata_file:
                metadata_file.read(1)
        except FileNotFoundError as error:
            raise RuntimeError(
                f"stable ticket-run metadata disappeared during enumeration: {metadata_path}"
            ) from error
        runs.add(metadata_path.parent)
    return runs


def hermes_environment(path_value, **extra):
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("HERMES_")
    }
    environment["PATH"] = path_value
    environment.update(extra)
    return environment


def credential_free_environment(path_value):
    environment = hermes_environment(path_value)
    for name in (
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
        "HF_TOKEN",
        "HUGGINGFACEHUB_API_TOKEN",
    ):
        environment.pop(name, None)
    return environment


def sanitized_process_error(text, extra_values=()):
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
        "HF_TOKEN",
        "HUGGINGFACEHUB_API_TOKEN",
    )
    values = {
        os.environ[name] for name in provider_names if os.environ.get(name)
    }
    values.update(value for value in extra_values if value)
    rendered = text
    for value in sorted(values, key=len, reverse=True):
        rendered = rendered.replace(value, "<x>")
    return rendered[-2000:]


def optional_file_bytes(path):
    try:
        return True, path.read_bytes()
    except FileNotFoundError:
        return False, b""


def worktree_identity(path):
    def git(*arguments, allow_failure=False):
        result = subprocess.run(
            ["git", *arguments],
            cwd=path,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 and not allow_failure:
            raise RuntimeError(result.stderr)
        return result.stdout.strip(), result.returncode

    root, _ = git("rev-parse", "--show-toplevel")
    git_dir, _ = git("rev-parse", "--absolute-git-dir")
    common_dir, _ = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    head, _ = git("rev-parse", "--verify", "HEAD")
    branch, branch_status = git(
        "symbolic-ref", "--quiet", "--short", "HEAD", allow_failure=True
    )
    return {
        "canonical_root": os.path.realpath(root),
        "git_dir": os.path.realpath(git_dir),
        "git_common_dir": os.path.realpath(common_dir),
        "head": head,
        "branch": branch if branch_status == 0 else None,
    }


with tempfile.TemporaryDirectory() as doctor_temporary_directory:
    doctor_temporary_path = Path(doctor_temporary_directory)
    doctor_log = doctor_temporary_path / "codex-probes.jsonl"
    doctor_bin = doctor_temporary_path / "bin"
    doctor_bin.mkdir()
    doctor_codex = doctor_bin / "codex"
    doctor_codex.write_text(
        """#!/usr/bin/python3
import json
import os
import sys
import time
from pathlib import Path

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
visible = {name: os.environ[name] for name in provider_names if os.environ.get(name)}
with Path(__LOG__).open("a", encoding="utf-8") as handle:
    handle.write(
        json.dumps(
            {"arguments": sys.argv[1:], "pid": os.getpid(), "visible": visible}
        )
        + "\\n"
    )
print(" ".join(visible.values()))
if sys.argv[1:] == ["--version"]:
    print("codex-cli fixture")
elif sys.argv[1:] == ["features", "list"]:
    time.sleep(30)
else:
    print("fixture help")
""".replace("#!/usr/bin/python3", f"#!{sys.executable}").replace(
            "__LOG__", repr(str(doctor_log))
        ),
        encoding="utf-8",
    )
    doctor_codex.chmod(0o755)
    compile_generated_python(doctor_codex, "doctor Codex fixture")
    doctor_secret = "fixture-live-doctor-secret-123456789"
    doctor_environment = credential_free_environment(
        f"{doctor_bin}{os.pathsep}{FIXED_SYSTEM_PATH}"
    )
    doctor_environment["OPENAI_API_KEY"] = doctor_secret
    doctor_process = subprocess.Popen(
        [str(ROOT / "scripts/codex/doctor.sh")],
        cwd=ROOT,
        env=doctor_environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    doctor_records = []
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if doctor_log.exists():
            doctor_records = [
                json.loads(line)
                for line in doctor_log.read_text(encoding="utf-8").splitlines()
                if line
            ]
            if len(doctor_records) >= 4:
                break
        if doctor_process.poll() is not None:
            break
        time.sleep(0.01)
    doctor_process.terminate()
    for record in doctor_records:
        try:
            os.kill(record["pid"], signal.SIGTERM)
        except ProcessLookupError:
            pass
    doctor_stdout, doctor_stderr = doctor_process.communicate(timeout=5)
    check(
        len(doctor_records) == 4
        and all(record["visible"] == {} for record in doctor_records)
        and doctor_secret not in doctor_stdout
        and doctor_secret not in doctor_stderr
        and doctor_secret not in doctor_log.read_text(encoding="utf-8"),
        "doctor gives every live Codex probe an exact credential-free environment",
    )


seatbelt_probe = subprocess.run(
    [
        "/usr/bin/sandbox-exec",
        "-p",
        "(version 1) (allow default)",
        "/usr/bin/true",
    ],
    check=False,
    capture_output=True,
    text=True,
)
seatbelt_available = seatbelt_probe.returncode == 0
check(
    seatbelt_available,
    "macOS Seatbelt can apply nested profiles for containment validation",
)

if seatbelt_available:
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_path = Path(os.path.realpath(temporary_directory))
        worktree_path = temporary_path / "fixture-worktree"
        worktree_result = subprocess.run(
            [
                "git",
                "-C",
                str(ROOT),
                "worktree",
                "add",
                "--detach",
                str(worktree_path),
                "HEAD",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        check(
            worktree_result.returncode == 0,
            "Hermes validation creates a temporary linked worktree",
        )
        try:
            if worktree_result.returncode == 0:
                copied_files = (
                    "scripts/codex/common.sh",
                    "scripts/codex/run-ticket.sh",
                    "scripts/codex/run-hermes-worker.sh",
                    "scripts/codex/run-codex-observed.py",
                    ".codex/prompts/automated-ticket-run.md",
                    ".codex/prompts/hermes-ticket-worker.md",
                    ".codex/schemas/ticket-run-result.schema.json",
                )
                for relative_path in copied_files:
                    source = ROOT / relative_path
                    destination = worktree_path / relative_path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)

                wrapper_path = worktree_path / "scripts/codex/run-hermes-worker.sh"
                runner_path = worktree_path / "scripts/codex/run-ticket.sh"
                wrapper_path.chmod(0o755)
                runner_path.chmod(0o755)
                doctor_stub = worktree_path / "scripts/codex/doctor.sh"
                doctor_stub.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                doctor_stub.chmod(0o755)

                ticket_path = worktree_path / "docs/tickets/T9999-hermes-fixture.md"
                ticket_path.write_text(
                    "# T9999 — Hermes fixture\n\n"
                    "Status: Ready\n\n"
                    "## Dependencies\n\n- None.\n\n"
                    "## Acceptance criteria\n\n"
                    "- The controlled fixture change is present and verified.\n\n"
                    "## Automated verification\n\n"
                    "- `pnpm verify`\n\n"
                    "## Manual verification\n\n"
                    "1. Inspect the controlled fixture change.\n",
                    encoding="utf-8",
                )
                ticket_relative = str(ticket_path.relative_to(worktree_path))
                immutable_fixture_paths = tuple(
                    path
                    for path in (
                        worktree_path / "AGENTS.md",
                        worktree_path / ".codex/prompts/automated-ticket-run.md",
                        worktree_path / ".codex/prompts/hermes-ticket-worker.md",
                        worktree_path / "scripts/codex/run-ticket.sh",
                        worktree_path / "docs/PRODUCT.md",
                        ticket_path,
                    )
                    if path.is_file()
                )
                immutable_fixture_bytes = {
                    path: path.read_bytes() for path in immutable_fixture_paths
                }

                def prepare_run(name, gate_text=None):
                    run_dir = (
                        worktree_path
                        / ".codex-runs"
                        / "HERMES-FIXTURE"
                        / name
                    )
                    run_dir.mkdir(parents=True)
                    metadata = {
                        "ticket_id": "HERMES-FIXTURE",
                        "ticket_path": ticket_relative,
                        "workflow": "ticket-runner",
                        "worker_backend": "HERMES",
                        "worktree_identity": worktree_identity(worktree_path),
                    }
                    (run_dir / "metadata.json").write_text(
                        json.dumps(metadata, indent=2) + "\n",
                        encoding="utf-8",
                    )
                    gate_file = run_dir / "hermes-gates.json"
                    gate_file.write_text(
                        gate_text
                        or json.dumps(
                            {
                                "worker_backend": "HERMES",
                                "validator": "GO",
                                "explorer": "GO",
                            },
                            separators=(",", ":"),
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    return run_dir, gate_file

                fake_mode = temporary_path / "fake-hermes-mode.txt"
                fake_codex_control = temporary_path / "fake-codex-control.json"
                fake_codex_log = temporary_path / "fake-codex.jsonl"
                doctor_probe_log = temporary_path / "doctor-probe.jsonl"
                verification_external_target = temporary_path / "verification-external"
                verification_external_target.mkdir()
                fake_codex_bin = temporary_path / "fake-codex-bin"
                fake_hermes_bin = temporary_path / "fake-hermes-bin"
                fake_tool_bin = temporary_path / "fake-tool-bin"
                for executable_directory in (
                    fake_codex_bin,
                    fake_hermes_bin,
                    fake_tool_bin,
                ):
                    executable_directory.mkdir()
                fixture_user_home = Path(
                    os.path.realpath(temporary_path / "fixture-user-home")
                )
                fixture_hermes_home = fixture_user_home / ".hermes"
                fixture_hermes_home.mkdir(parents=True, mode=0o700)
                fixture_auth_source = Path(
                    os.path.realpath(fixture_hermes_home / "auth.json")
                )
                fixture_access_token = "fixture-file-access-token-123456789"
                fixture_refresh_token = "fixture-file-refresh-token-123456789"
                fixture_id_token = "fixture-file-id-token-123456789"
                fixture_account_id = "fixture-file-account-123456789"
                refreshed_access_token = "fixture-refreshed-access-token-987654321"
                refreshed_refresh_token = "fixture-refreshed-refresh-token-987654321"
                refreshed_id_token = "fixture-refreshed-id-token-987654321"
                unrelated_token = "fixture-unrelated-provider-token-123456789"
                file_auth_values = (
                    fixture_access_token,
                    fixture_refresh_token,
                    fixture_id_token,
                    fixture_account_id,
                    refreshed_access_token,
                    refreshed_refresh_token,
                    refreshed_id_token,
                    unrelated_token,
                )

                def supported_auth_document():
                    return {
                        "version": 1,
                        "providers": {
                            "openai-codex": {
                                "tokens": {
                                    "access_token": fixture_access_token,
                                    "refresh_token": fixture_refresh_token,
                                    "id_token": fixture_id_token,
                                    "account_id": fixture_account_id,
                                },
                                "last_refresh": "2026-07-20T00:00:00Z",
                                "auth_mode": "chatgpt",
                            },
                            "unrelated-provider": {
                                "tokens": {"access_token": unrelated_token},
                            },
                        },
                        "active_provider": "unrelated-provider",
                        "credential_pool": {
                            "unrelated-provider": [
                                {"access_token": unrelated_token}
                            ]
                        },
                        "updated_at": "2026-07-20T00:00:00Z",
                    }

                def write_supported_auth():
                    if fixture_auth_source.exists() or fixture_auth_source.is_symlink():
                        fixture_auth_source.unlink()
                    fixture_auth_source.write_text(
                        json.dumps(supported_auth_document(), indent=2) + "\n",
                        encoding="utf-8",
                    )
                    fixture_auth_source.chmod(0o600)

                write_supported_auth()
                fake_hermes = fake_hermes_bin / "hermes"
                fake_hermes.write_text(
                    """#!/usr/bin/python3
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

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
mode = Path(__MODE__).read_text(encoding="utf-8").strip()
arguments = sys.argv[1:]
root = Path(os.environ["HERMES_WRITE_SAFE_ROOT"])
home = Path(os.environ["HERMES_HOME"])
auth_source = Path(__AUTH_SOURCE__)
file_auth_fixture = mode.startswith("file-auth")


def inspect_inherited_channels():
    stdin_content = sys.stdin.buffer.read()
    descriptor_numbers = []
    descriptor_contents = []
    for descriptor in range(3, 256):
        try:
            os.fstat(descriptor)
        except OSError:
            continue
        descriptor_numbers.append(descriptor)
        was_blocking = None
        try:
            was_blocking = os.get_blocking(descriptor)
            os.set_blocking(descriptor, False)
            descriptor_contents.append(os.read(descriptor, 65536))
        except OSError:
            descriptor_contents.append(b"")
        finally:
            if was_blocking is not None:
                try:
                    os.set_blocking(descriptor, was_blocking)
                except OSError:
                    pass
    argument_content = "\\0".join(arguments).encode("utf-8", errors="replace")
    environment_content = "\\0".join(
        f"{name}={value}" for name, value in sorted(os.environ.items())
    ).encode("utf-8", errors="replace")
    inherited_content = b"\\0".join(
        (argument_content, environment_content, stdin_content, *descriptor_contents)
    )
    profile_channels = b"\\0".join((stdin_content, *descriptor_contents))
    source_bytes = os.fsencode(str(auth_source))
    return {
        "stdin_eof": stdin_content == b"",
        "nonstandard_descriptors": descriptor_numbers,
        "source_path_exposed": source_bytes in inherited_content,
        "profile_bytes_exposed": any(
            marker in profile_channels
            for marker in (source_bytes, b"(deny process-fork)", b"(deny file-read*")
        ),
    }


channel_observation = inspect_inherited_channels()

if arguments == ["chat", "--help"]:
    visible_provider_values = {
        name: os.environ[name]
        for name in provider_names
        if os.environ.get(name)
    }
    source_read_denied = None
    source_write_denied = None
    if file_auth_fixture:
        try:
            auth_source.read_bytes()
        except PermissionError:
            source_read_denied = True
        else:
            source_read_denied = False
        try:
            with auth_source.open("ab") as handle:
                handle.write(b"unsafe")
        except PermissionError:
            source_write_denied = True
        else:
            source_write_denied = False
    probe_observation = {
        "attempted_stdout_exfiltration": True,
        "visible_names": sorted(visible_provider_values),
        "preexisting_home_names": sorted(path.name for path in home.iterdir()),
        "auth_present_before_probe_record": (home / "auth.json").exists(),
        "source_path_exposed": channel_observation["source_path_exposed"],
        "profile_bytes_exposed": channel_observation["profile_bytes_exposed"],
        "stdin_eof": channel_observation["stdin_eof"],
        "nonstandard_descriptors": channel_observation["nonstandard_descriptors"],
        "source_read_denied": source_read_denied,
        "source_write_denied": source_write_denied,
    }
    (home / "probe-provider-observation.json").write_text(
        json.dumps(
            probe_observation,
            sort_keys=True,
        )
        + "\\n",
        encoding="utf-8",
    )
    print(
        "probe-credential-exfiltration "
        + " ".join(visible_provider_values.values())
    )
    if visible_provider_values:
        raise SystemExit(84)
    if mode == "incompatible":
        print("usage: hermes chat")
        raise SystemExit(0)
    if mode == "probe-child":
        try:
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
                ]
            )
        except PermissionError:
            child = None
        if child is not None:
            child.kill()
            child.wait()
            raise SystemExit(44)
    print("-q --quiet --safe-mode --ignore-user-config --ignore-rules --toolsets --provider")
    raise SystemExit(0)

log_path = Path(__WORKTREE__) / "fake-hermes-log.jsonl"
probe_observation = json.loads(
    (home / "probe-provider-observation.json").read_text(encoding="utf-8")
)
writer_provider_names = sorted(
    name for name in provider_names if os.environ.get(name)
)
auth_observation = None
if file_auth_fixture:
    auth_path = home / "auth.json"
    auth_document = json.loads(auth_path.read_text(encoding="utf-8"))
    auth_state = auth_document["providers"]["openai-codex"]
    auth_tokens = auth_state["tokens"]
    imported_auth_mode = oct(auth_path.stat().st_mode & 0o777)
    try:
        auth_source.read_bytes()
    except PermissionError:
        writer_source_read_denied = True
    else:
        writer_source_read_denied = False
    try:
        with auth_source.open("ab") as handle:
            handle.write(b"unsafe")
    except PermissionError:
        writer_source_write_denied = True
    else:
        writer_source_write_denied = False
    refreshed_document = {
        "version": 1,
        "active_provider": "openai-codex",
        "providers": {
            "openai-codex": {
                "tokens": {
                    "access_token": __REFRESHED_ACCESS__,
                    "refresh_token": __REFRESHED_REFRESH__,
                    "id_token": __REFRESHED_ID__,
                    "account_id": auth_tokens["account_id"],
                },
                "last_refresh": "2026-07-21T00:00:00Z",
                "auth_mode": "chatgpt",
            }
        },
        "updated_at": "2026-07-21T00:00:00Z",
    }
    if mode == "file-auth-malformed-refresh":
        auth_path.write_text(
            '{"access_token":' + json.dumps(__REFRESHED_ACCESS__)
            + ',"refresh_token":' + json.dumps(__REFRESHED_REFRESH__)
            + ',"id_token":' + json.dumps(__REFRESHED_ID__),
            encoding="utf-8",
        )
    elif mode == "file-auth-unsafe-refresh":
        auth_path.write_text(json.dumps(refreshed_document) + "\\n", encoding="utf-8")
        auth_path.chmod(0o644)
    elif mode == "file-auth-missing-refresh":
        auth_path.unlink()
    else:
        auth_path.write_text(json.dumps(refreshed_document) + "\\n", encoding="utf-8")
    auth_observation = {
        "providers": sorted(auth_document["providers"]),
        "top_level": sorted(auth_document),
        "token_fields": sorted(auth_tokens),
        "mode": imported_auth_mode,
        "source_read_denied": writer_source_read_denied,
        "source_write_denied": writer_source_write_denied,
        "source_path_exposed": channel_observation["source_path_exposed"],
        "profile_bytes_exposed": channel_observation["profile_bytes_exposed"],
        "stdin_eof": channel_observation["stdin_eof"],
        "nonstandard_descriptors": channel_observation["nonstandard_descriptors"],
        "refresh_applied": True,
    }
    exposed_auth_values = [
        auth_tokens["access_token"],
        auth_tokens["refresh_token"],
        auth_tokens["id_token"],
        auth_tokens["account_id"],
    ]
    if mode != "file-auth-missing-refresh":
        exposed_auth_values.extend(
            (__REFRESHED_ACCESS__, __REFRESHED_REFRESH__, __REFRESHED_ID__)
        )
    print(" ".join(exposed_auth_values))
codex_records = []
if Path(__CODEX_LOG__).exists():
    codex_records = [
        json.loads(line)
        for line in Path(__CODEX_LOG__).read_text(encoding="utf-8").splitlines()
        if line
    ]
if mode in {"e2e", "file-auth-e2e"}:
    if not codex_records or codex_records[-1].get("phase") != "HERMES_READ_ONLY_GATES":
        raise SystemExit(46)
    try:
        os.kill(codex_records[-1]["pid"], 0)
    except ProcessLookupError:
        pass
    else:
        raise SystemExit(47)

with log_path.open("a", encoding="utf-8") as handle:
    handle.write(
        json.dumps(
            {
                "pid": os.getpid(),
                "arguments": arguments[:2] + ["<prompt>"] + arguments[3:],
                "probe_observation": probe_observation,
                "writer_provider_names": writer_provider_names,
                "auth_observation": auth_observation,
            }
        )
        + "\\n"
    )
session = home / "sessions"
session.mkdir(parents=True, exist_ok=True)
(session / "session.json").write_text("{}\\n", encoding="utf-8")

if mode == "file-auth-leak":
    (root / auth_tokens["access_token"]).write_text(
        auth_tokens["refresh_token"]
        + " "
        + auth_tokens["id_token"]
        + " "
        + __REFRESHED_ACCESS__
        + " "
        + __REFRESHED_REFRESH__
        + " "
        + __REFRESHED_ID__
        + "\\n",
        encoding="utf-8",
    )

if mode == "detached":
    try:
        child = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
            ],
            start_new_session=True,
        )
    except PermissionError:
        child = None
    if child is not None:
        child.kill()
        child.wait()
        raise SystemExit(45)
    (root / "detached-fork-denied.txt").write_text("denied\\n", encoding="utf-8")

if mode.endswith("signal-ignore"):
    (root / "signal-ignore-ready.txt").write_text("ready\\n", encoding="utf-8")
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True:
        time.sleep(1)

if mode == "relocate":
    (root / "relocation-ready.txt").write_text("ready\\n", encoding="utf-8")
    release = root / "relocation-release.txt"
    while not release.exists():
        time.sleep(0.02)

if mode == "snapshot-symlink":
    (root / "unsafe-verification-link").symlink_to(
        Path(__VERIFICATION_EXTERNAL__),
        target_is_directory=True,
    )

git_marker_text = (root / ".git").read_text(encoding="utf-8").strip()
linked_git_dir = Path(git_marker_text.removeprefix("gitdir: ")).resolve()
common_dir = (
    linked_git_dir
    / (linked_git_dir / "commondir").read_text(encoding="utf-8").strip()
).resolve()
protected_targets = [
    root / "AGENTS.md",
    root / ".codex/prompts/hermes-ticket-worker.md",
    root / "scripts/codex/run-ticket.sh",
    root / "docs/PRODUCT.md",
    root / "docs/tickets/T9999-hermes-fixture.md",
    linked_git_dir / "HEAD",
    linked_git_dir / "index",
    common_dir / "HEAD",
    common_dir / "index",
    common_dir / "logs/HEAD",
]
for worktree_metadata in (common_dir / "worktrees").glob("*"):
    sibling_marker = worktree_metadata / "gitdir"
    if sibling_marker.exists():
        sibling_git_marker = Path(sibling_marker.read_text(encoding="utf-8").strip())
        sibling_root = sibling_git_marker.parent.resolve()
        if sibling_root != root.resolve():
            protected_targets.append(sibling_root / "sibling-hermes-write.txt")
for protected_target in protected_targets:
    try:
        protected_target.parent.mkdir(parents=True, exist_ok=True)
        with protected_target.open("ab") as handle:
            handle.write(b"unsafe")
    except PermissionError:
        pass
    else:
        raise SystemExit(48)

if mode == "toolchain-path-injection":
    injected_tool = root / "unsafe-tool-bin/pnpm"
    injected_tool.write_text("#!/bin/sh\\nexit 99\\n", encoding="utf-8")
    injected_tool.chmod(0o755)

(root / "fake-hermes-write.txt").write_text("one controlled write\\n", encoding="utf-8")
print(
    "credential-output "
    + os.environ.get("OPENAI_API_KEY", "")
    + " "
    + os.environ.get("ANTHROPIC_API_KEY", "")
    + " api_"
    + "key=fixture-secret sk-"
    + "fixturesecret123456789 "
    + "x" * 140000
)
if mode.endswith("failure"):
    raise SystemExit(7)
""".replace("#!/usr/bin/python3", f"#!{sys.executable}")
                    .replace("__MODE__", repr(str(fake_mode)))
                    .replace("__WORKTREE__", repr(str(worktree_path)))
                    .replace("__CODEX_LOG__", repr(str(fake_codex_log)))
                    .replace("__AUTH_SOURCE__", repr(str(fixture_auth_source)))
                    .replace("__REFRESHED_ACCESS__", repr(refreshed_access_token))
                    .replace("__REFRESHED_REFRESH__", repr(refreshed_refresh_token))
                    .replace("__REFRESHED_ID__", repr(refreshed_id_token))
                    .replace(
                        "__VERIFICATION_EXTERNAL__",
                        repr(str(verification_external_target)),
                    ),
                    encoding="utf-8",
                )
                fake_hermes.chmod(0o755)
                compile_generated_python(fake_hermes, "Hermes executable fixture")

                fake_codex = fake_codex_bin / "codex"
                fake_codex.write_text(
                    """#!/usr/bin/python3
import json
import os
import subprocess
import sys
from pathlib import Path

arguments = sys.argv[1:]
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
    "HF_TOKEN",
    "HUGGINGFACEHUB_API_TOKEN",
)
if arguments == ["doctor-probe"]:
    visible = {name: os.environ[name] for name in provider_names if os.environ.get(name)}
    with Path(__DOCTOR_LOG__).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"visible": visible, "pid": os.getpid()}) + "\\n")
    print(" ".join(visible.values()))
    raise SystemExit(0)

invocation = sys.stdin.read()
phase = next(
    (
        name
        for name in (
            "HERMES_READ_ONLY_GATES",
            "HERMES_READ_ONLY_VERIFICATION",
            "HERMES_READ_ONLY_AUDIT",
            "HERMES_READ_ONLY_REVIEW",
            "CODEX_FULL",
        )
        if f"Phase: {name}" in invocation
    ),
    "UNKNOWN",
)
control = json.loads(Path(__CONTROL__).read_text(encoding="utf-8"))
with Path(__LOG__).open("a", encoding="utf-8") as handle:
    handle.write(
        json.dumps(
            {
                "phase": phase,
                "pid": os.getpid(),
                "arguments": arguments,
            }
        )
        + "\\n"
    )
output_path = Path(arguments[arguments.index("--output-last-message") + 1])
root = Path.cwd()
if phase.startswith("HERMES_") and any(os.environ.get(name) for name in provider_names):
    raise SystemExit(86)
if phase == "HERMES_READ_ONLY_REVIEW":
    phase_run_dir = output_path.parent
else:
    phase_run_dir = output_path.parents[2]
verification_shell = phase_run_dir / "verification-evidence.json"
verification_result = phase_run_dir / "phases/verification/result.json"
verification_evidence = str(verification_shell.relative_to(root))
verification_result_evidence = str(verification_result.relative_to(root))

validator_result = "GO"
validator_blockers = []
status = "READY_FOR_IMPLEMENTATION"
if control["mode"] == "blocked" and phase == "HERMES_READ_ONLY_GATES":
    validator_result = "BLOCKED"
    validator_blockers = ["fixture blocker"]
    status = "BLOCKED_VALIDATION"
if control["mode"] == "contradictory" and phase == "HERMES_READ_ONLY_GATES":
    validator_result = "BLOCKED"

if phase == "HERMES_READ_ONLY_GATES":
    try:
        (root / "codex-parent-write.txt").write_text("unsafe\\n", encoding="utf-8")
    except PermissionError:
        pass
    else:
        raise SystemExit(80)
    child_code = (
        "from pathlib import Path; import sys; "
        "p=Path(sys.argv[1]); "
        "\\ntry: p.write_text('unsafe\\\\n', encoding='utf-8')"
        "\\nexcept PermissionError: raise SystemExit(0)"
        "\\nraise SystemExit(81)"
    )
    child = subprocess.run(
        [sys.executable, "-I", "-c", child_code, str(root / "codex-spawned-writer.txt")],
        check=False,
    )
    if child.returncode != 0:
        raise SystemExit(82)
    git_dir = Path(
        subprocess.run(
            ["git", "rev-parse", "--absolute-git-dir"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    )
    common_dir = Path(
        subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    )
    for protected in (git_dir / "HEAD", git_dir / "index", common_dir / "packed-refs"):
        try:
            with protected.open("ab") as handle:
                handle.write(b"unsafe")
        except PermissionError:
            pass
        else:
            raise SystemExit(84)
    commands = (
        ["git", "update-ref", "refs/heads/fixture-escape", "HEAD"],
        ["git", "checkout", "-b", "fixture-escape"],
        ["git", "add", "codex-parent-write.txt"],
    )
    for command in commands:
        if subprocess.run(command, check=False, capture_output=True).returncode == 0:
            raise SystemExit(85)
if phase in ("HERMES_READ_ONLY_AUDIT", "HERMES_READ_ONLY_REVIEW"):
    prior_paths = (
        phase_run_dir / "phases/gate/result.json",
        phase_run_dir / "verification-evidence.json",
        phase_run_dir / "phases/verification/events.jsonl",
        phase_run_dir / "phases/verification/result.json",
    )
    for prior_path in prior_paths:
        try:
            with prior_path.open("ab") as handle:
                handle.write(b"unsafe")
        except PermissionError:
            pass
        else:
            raise SystemExit(87)

worker_result = "NOT_RUN" if phase == "HERMES_READ_ONLY_GATES" else "COMPLETE"
review_result = "PASS" if phase == "HERMES_READ_ONLY_REVIEW" else "NOT_RUN"
manual_required = phase == "HERMES_READ_ONLY_REVIEW"
post_phase = phase in (
    "HERMES_READ_ONLY_VERIFICATION",
    "HERMES_READ_ONLY_AUDIT",
    "HERMES_READ_ONLY_REVIEW",
)
commands = []
checks = []
acceptance = []
if post_phase:
    commands = [
        {
            "command": "pnpm verify",
            "result": "PASS",
            "exit_code": 0,
            "evidence": verification_evidence,
        }
    ]
    checks = [
        {
            "name": "pnpm verify",
            "status": "PASS",
            "evidence": verification_evidence,
        }
    ]
if phase in ("HERMES_READ_ONLY_AUDIT", "HERMES_READ_ONLY_REVIEW"):
    acceptance = [
        {
            "criterion": "The controlled fixture change is present and verified.",
            "status": "PASS",
            "evidence": verification_result_evidence,
        }
    ]

def changed_records():
    output = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        check=True,
        capture_output=True,
    ).stdout.decode().split("\\0")
    records = []
    index = 0
    while index < len(output):
        entry = output[index]
        index += 1
        if not entry:
            continue
        code = entry[:2]
        path = entry[3:]
        if "R" in code or "C" in code:
            path = output[index]
            index += 1
            change = "RENAMED"
        elif code == "??" or "A" in code:
            change = "ADDED"
        elif "D" in code:
            change = "DELETED"
        else:
            change = "MODIFIED"
        if not path.startswith(".codex-runs/"):
            records.append({"path": path, "change": change, "reason": "fixture"})
    return sorted(records, key=lambda item: item["path"])

result = {
    "ticket_id": "T9999",
    "ticket_path": "docs/tickets/T9999-hermes-fixture.md",
    "status": status
    if phase == "HERMES_READ_ONLY_GATES"
    else (
        "READY_FOR_MANUAL_VERIFICATION"
        if phase == "HERMES_READ_ONLY_REVIEW"
        else "PARTIAL"
    ),
    "summary": f"fixture {phase}",
    "validator": {
        "result": validator_result,
        "summary": "fixture validator",
        "blockers": validator_blockers,
    },
    "explorer": {
        "result": "GO",
        "summary": "fixture explorer",
        "plan": ["fixture plan"],
        "verification_map": ["pnpm verify"],
        "blockers": [],
    },
    "worker": {
        "backend": "HERMES",
        "result": worker_result,
        "summary": "fixture worker",
    },
    "changed_files": [] if phase == "HERMES_READ_ONLY_GATES" else changed_records(),
    "commands": commands,
    "checks": checks,
    "acceptance_criteria": acceptance,
    "review": {
        "result": review_result,
        "summary": "fixture review",
        "findings": [],
    },
    "manual_verification_required": manual_required,
    "next_action": "fixture next action",
}
mode = control["mode"]
if mode == "startup-failure" and phase == "HERMES_READ_ONLY_VERIFICATION":
    raise SystemExit(88)
if mode == "lingering-descendant" and phase == "HERMES_READ_ONLY_VERIFICATION":
    descendant = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(300)",
        ]
    )
    print(
        json.dumps(
            {
                "type": "fixture.lingering_pid",
                "pid": descendant.pid,
                "leader_pid": os.getpid(),
                "group_owner_pid": os.getpgid(0),
            }
        ),
        flush=True,
    )
if mode in ("phase-hup", "phase-int", "phase-term") and phase == "HERMES_READ_ONLY_VERIFICATION":
    print(json.dumps({"type": "fixture.phase_ready", "mode": mode}), flush=True)
    time.sleep(300)
if phase == "CODEX_FULL":
    result["status"] = "READY_FOR_MANUAL_VERIFICATION"
    result["worker"] = {
        "backend": "CODEX",
        "result": "COMPLETE",
        "summary": "fixture Codex worker",
    }
    result["review"] = {
        "result": "PASS",
        "summary": "fixture Codex review",
        "findings": [],
    }
    result["manual_verification_required"] = True
if mode == "verification-failed" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["status"] = "VERIFICATION_FAILED"
    result["commands"][0]["result"] = "FAIL"
    result["commands"][0]["exit_code"] = 1
if mode == "missing-checks" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["checks"] = []
if mode == "fabricated-checks" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["commands"][0]["command"] = "pnpm fabricated"
    result["checks"][0]["name"] = "pnpm fabricated"
if mode == "printf-command" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["commands"][0]["command"] = "printf 'pnpm verify'"
if mode == "invented-evidence" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["commands"][0]["evidence"] = "invented.log"
    result["checks"][0]["evidence"] = "invented.log"
if mode == "wrong-backend" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["worker"]["backend"] = "CODEX"
if mode == "wrong-ticket" and phase == "HERMES_READ_ONLY_VERIFICATION":
    result["ticket_id"] = "T0000"
if mode == "missing-audit" and phase == "HERMES_READ_ONLY_AUDIT":
    result["acceptance_criteria"] = []
if mode == "review-blocked" and phase == "HERMES_READ_ONLY_REVIEW":
    result["status"] = "REVIEW_BLOCKED"
    result["review"]["result"] = "BLOCKED"
    result["manual_verification_required"] = False
if mode == "review-findings" and phase == "HERMES_READ_ONLY_REVIEW":
    result["review"]["result"] = "PASS_WITH_NONBLOCKING_FINDINGS"
    result["review"]["findings"] = [
        {
            "severity": "SHOULD_FIX",
            "title": "fixture finding",
            "path": "fake-hermes-write.txt",
            "line": 1,
            "explanation": "fixture",
            "recommended_action": "fixture",
        }
    ]
if mode == "manual-false" and phase == "HERMES_READ_ONLY_REVIEW":
    result["manual_verification_required"] = False
if mode == "inconsistent-status" and phase == "HERMES_READ_ONLY_REVIEW":
    result["status"] = "PARTIAL"
if mode == "forged-pid" and phase == "HERMES_READ_ONLY_AUDIT":
    pid_path = output_path.parent / "supervisor.pid"
    pid_path.unlink()
    pid_path.write_text(str(control["unrelated_pid"]) + "\\n", encoding="ascii")
if post_phase:
    hermes_records = [
        json.loads(line)
        for line in (root / "fake-hermes-log.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    try:
        os.kill(hermes_records[-1]["pid"], 0)
    except ProcessLookupError:
        pass
    else:
        raise SystemExit(83)

if control["mode"] == "duplicate" and phase == "HERMES_READ_ONLY_GATES":
    output_path.write_text(
        '{"ticket_id":"T9999","ticket_id":"T0000"}\\n',
        encoding="utf-8",
    )
elif control["mode"] == "unknown" and phase == "HERMES_READ_ONLY_GATES":
    result["unknown"] = True
    output_path.write_text(json.dumps(result) + "\\n", encoding="utf-8")
else:
    output_path.write_text(json.dumps(result) + "\\n", encoding="utf-8")
print(json.dumps({"type": "thread.started"}), flush=True)
if mode == "redaction-interrupt" and phase == "HERMES_READ_ONLY_REVIEW":
    secret = os.environ.get("OPENAI_API_KEY", "")
    for counter in range(12000):
        print(
            json.dumps(
                {
                    "type": "fixture.evidence",
                    "counter": counter,
                    "payload": secret + ("x" * 4096),
                }
            ),
            flush=True,
        )
if not (mode == "missing-review-evidence" and phase == "HERMES_READ_ONLY_REVIEW"):
    print(json.dumps({"type": "turn.completed"}), flush=True)
""".replace("#!/usr/bin/python3", f"#!{sys.executable}")
                    .replace("__CONTROL__", repr(str(fake_codex_control)))
                    .replace("__LOG__", repr(str(fake_codex_log)))
                    .replace("__DOCTOR_LOG__", repr(str(doctor_probe_log))),
                    encoding="utf-8",
                )
                fake_codex.chmod(0o755)
                compile_generated_python(fake_codex, "Codex executable fixture")

                fake_pnpm = fake_tool_bin / "pnpm"
                fake_pnpm.write_text(
                    """#!/usr/bin/python3
import json
import os
import subprocess
import sys
from pathlib import Path

if sys.argv[1:] != ["verify"]:
    raise SystemExit(64)
mirror = Path.cwd().resolve()
original = Path(__WORKTREE__).resolve()
control = json.loads(Path(__CONTROL__).read_text(encoding="utf-8"))
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
if any(os.environ.get(name) for name in provider_names) or any(
    name.startswith(("CODEX_", "HERMES_")) for name in os.environ
):
    raise SystemExit(68)
git_config = Path(os.environ["GIT_CONFIG_GLOBAL"]).resolve()
if os.path.commonpath((str(mirror), str(git_config))) != str(mirror):
    raise SystemExit(69)
git_result = subprocess.run(
    ["/usr/bin/git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    check=False,
    capture_output=True,
    text=True,
)
if git_result.returncode != 0:
    print(git_result.stderr, file=sys.stderr, end="")
    raise SystemExit(67)
git_common = Path(git_result.stdout.strip()).resolve()
if os.path.commonpath((str(mirror), str(git_common))) != str(mirror):
    raise SystemExit(65)
git_status = subprocess.run(
    ["/usr/bin/git", "status", "--porcelain=v1", "--untracked-files=all"],
    check=True,
    capture_output=True,
    text=True,
).stdout
if ".verification-home" in git_status or ".verification-tmp" in git_status:
    raise SystemExit(70)
build_output = mirror / "dist/verification-build.txt"
build_output.parent.mkdir(parents=True)
build_output.write_text("built in mirror\\n", encoding="utf-8")
try:
    (original / "verification-original-write.txt").write_text("unsafe\\n", encoding="utf-8")
except PermissionError:
    original_denied = True
else:
    original_denied = False
escape = mirror / "verification-escape-link"
escape.symlink_to(original, target_is_directory=True)
try:
    (escape / "verification-symlink-write.txt").write_text("unsafe\\n", encoding="utf-8")
except PermissionError:
    symlink_denied = True
else:
    symlink_denied = False
if not original_denied or not symlink_denied or not build_output.is_file():
    raise SystemExit(66)
print("build-output-created")
print("isolated-git-repository")
print("original-write-denied")
print("symlink-escape-denied")
print("credential-free-verification")
print("runtime-files-hidden-from-worktree")
if control["mode"] == "verification-command-failed":
    raise SystemExit(9)
""".replace("#!/usr/bin/python3", f"#!{sys.executable}")
                    .replace("__WORKTREE__", repr(str(worktree_path)))
                    .replace("__CONTROL__", repr(str(fake_codex_control))),
                    encoding="utf-8",
                )
                fake_pnpm.chmod(0o755)
                compile_generated_python(fake_pnpm, "verification executable fixture")

                doctor_stub.write_text(
                    "#!/bin/sh\nset -eu\n"
                    + shlex.quote(str(fake_codex))
                    + " doctor-probe\n",
                    encoding="utf-8",
                )
                doctor_stub.chmod(0o755)

                def clean_product_fixtures():
                    for name in (
                        "codex-parent-write.txt",
                        "codex-spawned-writer.txt",
                        "detached-fork-denied.txt",
                        "fake-hermes-log.jsonl",
                        "fake-hermes-write.txt",
                        "relocation-ready.txt",
                        "relocation-release.txt",
                        "signal-ignore-ready.txt",
                        "sibling-hermes-write.txt",
                        "verification-original-write.txt",
                        "verification-symlink-write.txt",
                        "unsafe-verification-link",
                        "<x>",
                    ):
                        path = worktree_path / name
                        if path.exists() or path.is_symlink():
                            path.unlink()
                    fake_codex_log.unlink(missing_ok=True)
                    doctor_probe_log.unlink(missing_ok=True)
                    shutil.rmtree(worktree_path / "unsafe-tool-bin", ignore_errors=True)

                def wrapper_environment(**extra):
                    environment = credential_free_environment(
                        os.pathsep.join(
                            (
                                str(fake_codex_bin),
                                str(fake_hermes_bin),
                                str(fake_tool_bin),
                                FIXED_SYSTEM_PATH,
                            )
                        )
                    )
                    environment.update(extra)
                    return environment

                missing_run, missing_gate = prepare_run("missing")
                missing_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(missing_run),
                        str(missing_gate),
                    ],
                    cwd=worktree_path,
                    env=credential_free_environment(FIXED_SYSTEM_PATH),
                    check=False,
                    capture_output=True,
                    text=True,
                )
                check(
                    missing_result.returncode != 0
                    and "Hermes is unavailable" in missing_result.stderr,
                    "missing Hermes fails closed",
                )

                invalid_gates = {
                    "blocked": json.dumps(
                        {
                            "worker_backend": "HERMES",
                            "validator": "BLOCKED",
                            "explorer": "GO",
                        }
                    )
                    + "\n",
                    "duplicate": '{"worker_backend":"HERMES","validator":"GO","validator":"BLOCKED","explorer":"GO"}\n',
                    "unknown": json.dumps(
                        {
                            "worker_backend": "HERMES",
                            "validator": "GO",
                            "explorer": "GO",
                            "unknown": True,
                        }
                    )
                    + "\n",
                    "malformed": '{"worker_backend":"HERMES",\n',
                }
                clean_product_fixtures()
                for name, content in invalid_gates.items():
                    invalid_run, invalid_gate = prepare_run(
                        f"invalid-{name}", content
                    )
                    invalid_result = subprocess.run(
                        [
                            str(wrapper_path),
                            ticket_relative,
                            str(invalid_run),
                            str(invalid_gate),
                        ],
                        cwd=worktree_path,
                        env=wrapper_environment(),
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    check(
                        invalid_result.returncode != 0
                        and "exact approved Hermes contract"
                        in invalid_result.stderr,
                        f"{name} gate evidence stops Hermes",
                    )
                check(
                    not (worktree_path / "fake-hermes-log.jsonl").exists(),
                    "invalid gates start no Hermes implementation process",
                )

                incompatible_run, incompatible_gate = prepare_run("incompatible")
                fake_mode.write_text("incompatible\n", encoding="utf-8")
                incompatible_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(incompatible_run),
                        str(incompatible_gate),
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(),
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if "lacks required capability" not in incompatible_result.stderr:
                    print(
                        sanitized_process_error(incompatible_result.stderr),
                        file=sys.stderr,
                    )
                check(
                    incompatible_result.returncode != 0
                    and "lacks required capability" in incompatible_result.stderr,
                    "incompatible Hermes fails capability probing",
                )
                check(
                    not (incompatible_run / "hermes/home").exists(),
                    "capability failure removes the descriptor-held Hermes home",
                )

                clean_product_fixtures()
                success_run, success_gate = prepare_run("success")
                fake_mode.write_text("success\n", encoding="utf-8")
                short_secret = "fixture-short-secret"
                long_secret = f"prefix-{short_secret}-suffix"
                success_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(success_run),
                        str(success_gate),
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(
                        **{
                            "OPENAI_" + "API_KEY": short_secret,
                            "ANTHROPIC_" + "API_KEY": long_secret,
                        }
                    ),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                if success_result.returncode != 0:
                    print(
                        sanitized_process_error(
                            success_result.stderr,
                            (long_secret, short_secret),
                        ),
                        file=sys.stderr,
                    )
                success_output_path = success_run / "hermes/final-output.log"
                success_output = (
                    success_output_path.read_bytes()
                    if success_output_path.exists()
                    else b""
                )
                success_record = json.loads(
                    (worktree_path / "fake-hermes-log.jsonl")
                    .read_text(encoding="utf-8")
                    .splitlines()[0]
                )
                check(
                    success_result.returncode == 0,
                    "compatible Hermes completes one controlled writer run",
                )
                check(
                    (worktree_path / "fake-hermes-write.txt").exists()
                    and len(
                        (
                            worktree_path / "fake-hermes-log.jsonl"
                        ).read_text(encoding="utf-8").splitlines()
                    )
                    == 1,
                    "one Hermes implementation invocation occurs per run",
                )
                check(
                    not (success_run / "hermes/home").exists()
                    and not any(
                        "ticket-worker-prompt" in str(path)
                        for path in success_run.rglob("*")
                    ),
                    "successful Hermes execution removes home and persists no composed prompt",
                )
                check(
                    short_secret.encode() not in success_output
                    and long_secret.encode() not in success_output
                    and b"<x>" in success_output
                    and b"[output truncated" in success_output,
                    "Hermes output is bounded and exact provider values are redacted",
                )
                check(
                    success_record.get("auth_observation") is None,
                    "present user Hermes auth is never inferred without both selectors",
                )

                clean_product_fixtures()
                write_supported_auth()
                fake_mode.write_text("file-auth\n", encoding="utf-8")
                file_auth_run, file_auth_gate = prepare_run("file-auth-success")
                source_before = fixture_auth_source.read_bytes()
                source_identity_before = fixture_auth_source.stat()
                file_auth_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(file_auth_run),
                        str(file_auth_gate),
                        "user-hermes",
                        "openai-codex",
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(HOME=str(fixture_user_home)),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                if file_auth_result.returncode != 0:
                    print(
                        sanitized_process_error(
                            file_auth_result.stderr,
                            file_auth_values,
                        ),
                        file=sys.stderr,
                    )
                file_auth_records = (
                    [
                        json.loads(line)
                        for line in (
                            worktree_path / "fake-hermes-log.jsonl"
                        ).read_text(encoding="utf-8").splitlines()
                        if line
                    ]
                    if (worktree_path / "fake-hermes-log.jsonl").exists()
                    else []
                )
                file_auth_record = (
                    file_auth_records[0] if len(file_auth_records) == 1 else {}
                )
                probe_record = file_auth_record.get("probe_observation") or {}
                writer_auth_record = file_auth_record.get("auth_observation") or {}
                source_identity_after = fixture_auth_source.stat()
                retained_file_auth_bytes = b"".join(
                    path.read_bytes()
                    for path in file_auth_run.rglob("*")
                    if path.is_file()
                )
                worktree_file_auth_bytes = b"".join(
                    path.read_bytes()
                    for path in worktree_path.rglob("*")
                    if path.is_file()
                    and ".git" not in path.relative_to(worktree_path).parts
                    and ".codex-runs" not in path.relative_to(worktree_path).parts
                )
                probe_expectations = (
                    (file_auth_result.returncode == 0, "wrapper completes"),
                    (len(file_auth_records) == 1, "one writer record exists"),
                    (probe_record.get("visible_names") == [], "provider environment is empty"),
                    (
                        set(probe_record.get("preexisting_home_names") or ())
                        <= {"Library", "tmp"}
                        and "tmp" in probe_record.get("preexisting_home_names", ()),
                        "runtime home contains no auth or non-runtime configuration",
                    ),
                    (
                        probe_record.get("auth_present_before_probe_record") is False,
                        "ephemeral auth is absent",
                    ),
                    (
                        probe_record.get("source_path_exposed") is False,
                        "source path is absent from inherited channels",
                    ),
                    (
                        probe_record.get("profile_bytes_exposed") is False,
                        "profile bytes are absent from inherited channels",
                    ),
                    (probe_record.get("stdin_eof") is True, "standard input is EOF"),
                    (
                        probe_record.get("nonstandard_descriptors") == [],
                        "no nonstandard descriptors are inherited",
                    ),
                    (
                        probe_record.get("source_read_denied") is True,
                        "source reads are denied",
                    ),
                    (
                        probe_record.get("source_write_denied") is True,
                        "source writes are denied",
                    ),
                )
                for condition, expectation in probe_expectations:
                    check(
                        condition,
                        "file-auth capability probe " + expectation,
                    )
                check(
                    file_auth_record.get("writer_provider_names") == []
                    and writer_auth_record.get("providers") == ["openai-codex"]
                    and writer_auth_record.get("top_level")
                    == ["active_provider", "providers", "version"]
                    and writer_auth_record.get("token_fields")
                    == ["access_token", "account_id", "id_token", "refresh_token"]
                    and writer_auth_record.get("mode") == "0o600"
                    and writer_auth_record.get("source_read_denied") is True
                    and writer_auth_record.get("source_write_denied") is True
                    and writer_auth_record.get("source_path_exposed") is False
                    and writer_auth_record.get("profile_bytes_exposed") is False
                    and writer_auth_record.get("stdin_eof") is True
                    and writer_auth_record.get("nonstandard_descriptors") == []
                    and writer_auth_record.get("refresh_applied") is True,
                    "file-auth writer receives only a mode-0600 openai-codex store, EOF standard input, and no inherited profile descriptor, and may refresh only its ephemeral copy",
                )
                check(
                    fixture_auth_source.read_bytes() == source_before
                    and (
                        source_identity_after.st_dev,
                        source_identity_after.st_ino,
                    )
                    == (
                        source_identity_before.st_dev,
                        source_identity_before.st_ino,
                    )
                    and not (file_auth_run / "hermes/home").exists(),
                    "file-auth refresh preserves source inode and content while cleanup removes the ephemeral copy",
                )
                check(
                    str(fixture_auth_source) not in file_auth_result.stdout
                    and str(fixture_auth_source) not in file_auth_result.stderr
                    and str(fixture_auth_source).encode("utf-8")
                    not in retained_file_auth_bytes
                    and all(
                        value.encode("utf-8") not in file_auth_result.stdout.encode("utf-8")
                        and value.encode("utf-8") not in file_auth_result.stderr.encode("utf-8")
                        and value.encode("utf-8") not in retained_file_auth_bytes
                        and value.encode("utf-8") not in worktree_file_auth_bytes
                        for value in file_auth_values
                    ),
                    "file-auth access, refresh, id, account, unrelated-provider, and refreshed values leave no output, evidence, or repository bytes",
                )

                clean_product_fixtures()
                write_supported_auth()
                failure_source_before = fixture_auth_source.read_bytes()
                fake_mode.write_text("file-auth-failure\n", encoding="utf-8")
                file_auth_failure_run, file_auth_failure_gate = prepare_run(
                    "file-auth-failure"
                )
                file_auth_failure = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(file_auth_failure_run),
                        str(file_auth_failure_gate),
                        "user-hermes",
                        "openai-codex",
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(HOME=str(fixture_user_home)),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                failure_output_present, failure_output = optional_file_bytes(
                    file_auth_failure_run / "hermes/final-output.log"
                )
                check(
                    file_auth_failure.returncode == 7
                    and failure_output_present
                    and not (file_auth_failure_run / "hermes/home").exists()
                    and fixture_auth_source.read_bytes() == failure_source_before
                    and all(
                        value.encode("utf-8") not in failure_output
                        and value not in file_auth_failure.stdout
                        and value not in file_auth_failure.stderr
                        for value in file_auth_values
                    ),
                    "failed file-auth writer preserves the host source, redacts output, and purges its copied auth home",
                )

                post_validation_cases = (
                    (
                        "malformed-refresh",
                        "file-auth-malformed-refresh",
                        (*file_auth_values[:4], *file_auth_values[4:7]),
                    ),
                    (
                        "unsafe-refresh",
                        "file-auth-unsafe-refresh",
                        (*file_auth_values[:4], *file_auth_values[4:7]),
                    ),
                    (
                        "missing-refresh",
                        "file-auth-missing-refresh",
                        file_auth_values[:4],
                    ),
                )
                for case_name, case_mode, expected_scrubbed_values in post_validation_cases:
                    clean_product_fixtures()
                    write_supported_auth()
                    post_source_before = fixture_auth_source.read_bytes()
                    fake_mode.write_text(case_mode + "\n", encoding="utf-8")
                    post_run, post_gate = prepare_run(f"file-auth-{case_name}")
                    post_result = subprocess.run(
                        [
                            str(wrapper_path),
                            ticket_relative,
                            str(post_run),
                            str(post_gate),
                            "user-hermes",
                            "openai-codex",
                        ],
                        cwd=worktree_path,
                        env=wrapper_environment(HOME=str(fixture_user_home)),
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=20,
                    )
                    post_output_present, post_output = optional_file_bytes(
                        post_run / "hermes/final-output.log"
                    )
                    retained_post_bytes = b"".join(
                        path.read_bytes()
                        for path in post_run.rglob("*")
                        if path.is_file()
                    )
                    check(
                        post_result.returncode != 0
                        and post_output_present
                        and "failed post-run validation" in post_result.stderr
                        and not (post_run / "hermes/home").exists()
                        and fixture_auth_source.read_bytes() == post_source_before
                        and all(
                            value not in post_result.stdout
                            and value not in post_result.stderr
                            and value.encode("utf-8") not in post_output
                            and value.encode("utf-8") not in retained_post_bytes
                            for value in expected_scrubbed_values
                        ),
                        f"{case_name} blocks only after best-effort exact credential scrubbing and cleanup",
                    )

                clean_product_fixtures()
                write_supported_auth()
                fake_mode.write_text("file-auth-leak\n", encoding="utf-8")
                leak_run, leak_gate = prepare_run("file-auth-leak")
                leak_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(leak_run),
                        str(leak_gate),
                        "user-hermes",
                        "openai-codex",
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(HOME=str(fixture_user_home)),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                leak_run_bytes = b"".join(
                    path.read_bytes() for path in leak_run.rglob("*") if path.is_file()
                )
                leak_worktree_bytes = b"".join(
                    path.read_bytes()
                    for path in worktree_path.rglob("*")
                    if path.is_file()
                    and ".git" not in path.relative_to(worktree_path).parts
                    and ".codex-runs" not in path.relative_to(worktree_path).parts
                )
                check(
                    leak_result.returncode != 0
                    and "attempted to persist selected credentials"
                    in leak_result.stderr
                    and (worktree_path / "<x>").is_file()
                    and all(
                        value not in leak_result.stdout
                        and value not in leak_result.stderr
                        and value.encode("utf-8") not in leak_run_bytes
                        and value.encode("utf-8") not in leak_worktree_bytes
                        and not (worktree_path / value).exists()
                        for value in file_auth_values
                    ),
                    "file-auth credential output, evidence, content, and filename leak attempts are redacted and block the run",
                )

                def run_rejected_auth_source(name, *, home=None):
                    clean_product_fixtures()
                    fake_mode.write_text("file-auth-invalid\n", encoding="utf-8")
                    rejected_run, rejected_gate = prepare_run(f"auth-rejected-{name}")
                    result = subprocess.run(
                        [
                            str(wrapper_path),
                            ticket_relative,
                            str(rejected_run),
                            str(rejected_gate),
                            "user-hermes",
                            "openai-codex",
                        ],
                        cwd=worktree_path,
                        env=wrapper_environment(
                            HOME=str(home or fixture_user_home)
                        ),
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=20,
                    )
                    return result, rejected_run

                rejected_auth_cases = []
                symlink_target = temporary_path / "symlink-auth-target.json"
                symlink_target.write_text(
                    json.dumps(supported_auth_document()) + "\n",
                    encoding="utf-8",
                )
                symlink_target.chmod(0o600)
                fixture_auth_source.unlink()
                fixture_auth_source.symlink_to(symlink_target)
                rejected_auth_cases.append(
                    ("symlinked", *run_rejected_auth_source("symlinked"))
                )

                write_supported_auth()
                relocated_home = temporary_path / "relocated-user-home"
                relocated_home.symlink_to(fixture_user_home, target_is_directory=True)
                rejected_auth_cases.append(
                    (
                        "relocated",
                        *run_rejected_auth_source("relocated", home=relocated_home),
                    )
                )

                write_supported_auth()
                noncanonical_home = Path(
                    str(fixture_user_home).replace("/private/var/", "/var/", 1)
                )
                check(
                    noncanonical_home != fixture_user_home
                    and os.path.realpath(noncanonical_home) == str(fixture_user_home),
                    "file-auth fixture exercises the macOS /var canonical-path alias",
                )
                rejected_auth_cases.append(
                    (
                        "noncanonical",
                        *run_rejected_auth_source(
                            "noncanonical",
                            home=noncanonical_home,
                        ),
                    )
                )

                wrong_owner_home = Path("/private/tmp")
                wrong_owner_hermes_home = wrong_owner_home / ".hermes"
                wrong_owner_details = wrong_owner_home.stat()
                wrong_owner_fixture_available = (
                    os.path.realpath(wrong_owner_home) == str(wrong_owner_home)
                    and wrong_owner_details.st_uid != os.getuid()
                    and not wrong_owner_hermes_home.exists()
                    and not wrong_owner_hermes_home.is_symlink()
                )
                check(
                    wrong_owner_fixture_available,
                    "wrong-owner fixture presents a real mismatched st_uid through the macOS auth-source path",
                )
                if wrong_owner_fixture_available:
                    wrong_owner_hermes_home.mkdir(mode=0o700)
                    wrong_owner_auth_source = wrong_owner_hermes_home / "auth.json"
                    try:
                        wrong_owner_auth_source.write_text(
                            json.dumps(supported_auth_document()) + "\n",
                            encoding="utf-8",
                        )
                        wrong_owner_auth_source.chmod(0o600)
                        rejected_auth_cases.append(
                            (
                                "wrong-owner",
                                *run_rejected_auth_source(
                                    "wrong-owner",
                                    home=wrong_owner_home,
                                ),
                            )
                        )
                    finally:
                        wrong_owner_auth_source.unlink(missing_ok=True)
                        wrong_owner_hermes_home.rmdir()

                write_supported_auth()
                fixture_auth_source.chmod(0o644)
                rejected_auth_cases.append(
                    ("insecure-mode", *run_rejected_auth_source("insecure-mode"))
                )

                write_supported_auth()
                fixture_auth_source.write_bytes(b"x" * 262145)
                fixture_auth_source.chmod(0o600)
                rejected_auth_cases.append(
                    ("oversized", *run_rejected_auth_source("oversized"))
                )

                fixture_auth_source.write_text("{malformed\n", encoding="utf-8")
                fixture_auth_source.chmod(0o600)
                rejected_auth_cases.append(
                    ("malformed", *run_rejected_auth_source("malformed"))
                )

                fixture_auth_source.write_text(
                    '{"version":1,"version":1,"providers":{}}\n',
                    encoding="utf-8",
                )
                fixture_auth_source.chmod(0o600)
                rejected_auth_cases.append(
                    ("duplicate-key", *run_rejected_auth_source("duplicate-key"))
                )

                unsupported_document = supported_auth_document()
                unsupported_document["version"] = 2
                fixture_auth_source.write_text(
                    json.dumps(unsupported_document) + "\n",
                    encoding="utf-8",
                )
                fixture_auth_source.chmod(0o600)
                rejected_auth_cases.append(
                    (
                        "unsupported-schema",
                        *run_rejected_auth_source("unsupported-schema"),
                    )
                )

                missing_provider_document = supported_auth_document()
                del missing_provider_document["providers"]["openai-codex"]
                fixture_auth_source.write_text(
                    json.dumps(missing_provider_document) + "\n",
                    encoding="utf-8",
                )
                fixture_auth_source.chmod(0o600)
                rejected_auth_cases.append(
                    (
                        "missing-provider",
                        *run_rejected_auth_source("missing-provider"),
                    )
                )
                for name, result, rejected_run in rejected_auth_cases:
                    check(
                        result.returncode != 0
                        and "failed validation" in result.stderr
                        and not (
                            rejected_run
                            / "hermes/implementation-invocation.started"
                        ).exists()
                        and not (worktree_path / "fake-hermes-log.jsonl").exists(),
                        f"{name} file-auth source fails before the implementation marker and writer",
                    )
                write_supported_auth()

                clean_product_fixtures()
                fake_mode.write_text("probe-child\n", encoding="utf-8")
                probe_run, probe_gate = prepare_run("probe-child")
                probe_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(probe_run),
                        str(probe_gate),
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                check(
                    probe_result.returncode == 0,
                    "capability probe mechanically denies a signal-ignoring child",
                )

                clean_product_fixtures()
                fake_mode.write_text("detached\n", encoding="utf-8")
                detached_run, detached_gate = prepare_run("detached")
                detached_result = subprocess.run(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(detached_run),
                        str(detached_gate),
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                check(
                    detached_result.returncode == 0
                    and (worktree_path / "detached-fork-denied.txt").exists(),
                    "implementation containment denies detached process escape",
                )

                clean_product_fixtures()
                write_supported_auth()
                signal_source_before = fixture_auth_source.read_bytes()
                fake_mode.write_text("file-auth-signal-ignore\n", encoding="utf-8")
                signal_run, signal_gate = prepare_run("signal-ignore")
                interrupted = subprocess.Popen(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(signal_run),
                        str(signal_gate),
                        "user-hermes",
                        "openai-codex",
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(HOME=str(fixture_user_home)),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for _ in range(300):
                    if (worktree_path / "signal-ignore-ready.txt").exists():
                        break
                    if interrupted.poll() is not None:
                        break
                    time.sleep(0.02)
                interrupted.send_signal(signal.SIGTERM)
                signal_stdout, signal_stderr = interrupted.communicate(timeout=12)
                check(
                    interrupted.returncode == 143
                    and not (signal_run / "hermes/home").exists()
                    and fixture_auth_source.read_bytes() == signal_source_before
                    and all(
                        value not in signal_stdout and value not in signal_stderr
                        for value in file_auth_values
                    ),
                    "signal-ignoring file-auth Hermes is killed, redacted, and its copied auth home is cleaned",
                )

                clean_product_fixtures()
                fake_mode.write_text("relocate\n", encoding="utf-8")
                relocation_run, relocation_gate = prepare_run("relocate")
                external_target = temporary_path / "external-home-target"
                external_target.mkdir()
                external_sentinel = external_target / "must-survive.txt"
                external_sentinel.write_text("survive\n", encoding="utf-8")
                relocated_home = worktree_path / "relocated-hermes-home"
                relocation_process = subprocess.Popen(
                    [
                        str(wrapper_path),
                        ticket_relative,
                        str(relocation_run),
                        str(relocation_gate),
                    ],
                    cwd=worktree_path,
                    env=wrapper_environment(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                home_path = relocation_run / "hermes/home"
                for _ in range(300):
                    if (
                        (worktree_path / "relocation-ready.txt").exists()
                        and home_path.is_dir()
                    ):
                        break
                    if relocation_process.poll() is not None:
                        break
                    time.sleep(0.02)
                home_path.rename(relocated_home)
                home_path.symlink_to(external_target, target_is_directory=True)
                (worktree_path / "relocation-release.txt").write_text(
                    "release\n", encoding="utf-8"
                )
                relocation_process.communicate(timeout=20)
                check(
                    relocation_process.returncode != 0
                    and not home_path.exists()
                    and not home_path.is_symlink()
                    and not relocated_home.exists(),
                    "relocated Hermes home is purged by held descriptor and fails the run",
                )
                check(
                    external_sentinel.read_text(encoding="utf-8") == "survive\n",
                    "relocated-home cleanup never follows the replacement symlink",
                )

                clean_product_fixtures()
                fake_mode.write_text("e2e\n", encoding="utf-8")
                unrelated = subprocess.Popen(["/bin/sleep", "3600"])
                try:
                    def ticket_runs():
                        return stable_ticket_runs(worktree_path / ".codex-runs")

                    enumeration_run, _ = prepare_run("ephemeral-enumeration")
                    ephemeral_cache = (
                        enumeration_run / "hermes/home/Library/Caches/hermes"
                    )
                    for index in range(64):
                        cache_entry = ephemeral_cache / str(index)
                        cache_entry.mkdir(parents=True)
                        (cache_entry / "entry").write_text("cache\n", encoding="utf-8")
                    cleanup_ready = threading.Event()
                    cleanup_release = threading.Event()
                    cleanup_errors = []

                    def remove_ephemeral_home():
                        cleanup_ready.set()
                        cleanup_release.wait()
                        try:
                            shutil.rmtree(enumeration_run / "hermes/home")
                        except Exception as error:
                            cleanup_errors.append(error)

                    cleanup_thread = threading.Thread(target=remove_ephemeral_home)
                    cleanup_thread.start()
                    cleanup_ready.wait(timeout=2)
                    enumeration_observations = [enumeration_run in ticket_runs()]
                    cleanup_release.set()
                    while cleanup_thread.is_alive():
                        enumeration_observations.append(enumeration_run in ticket_runs())
                    cleanup_thread.join(timeout=2)
                    enumeration_observations.append(enumeration_run in ticket_runs())
                    check(
                        not cleanup_thread.is_alive()
                        and not cleanup_errors
                        and all(enumeration_observations)
                        and not (enumeration_run / "hermes/home").exists(),
                        "ticket-run enumeration ignores concurrent ephemeral-home cleanup while retaining stable metadata",
                    )

                    def execute_runner(mode, provider_secret=None, *, file_auth=False):
                        clean_product_fixtures()
                        fake_mode.write_text(
                            "snapshot-symlink\n"
                            if mode == "unsafe-snapshot-symlink"
                            else (
                                "toolchain-path-injection\n"
                                if mode == "toolchain-path-injection"
                                else (
                                    "file-auth-e2e\n"
                                    if file_auth
                                    else "e2e\n"
                                )
                            ),
                            encoding="utf-8",
                        )
                        fake_codex_control.write_text(
                            json.dumps(
                                {
                                    "mode": mode,
                                    "unrelated_pid": unrelated.pid,
                                }
                            )
                            + "\n",
                            encoding="utf-8",
                        )
                        before = ticket_runs()
                        environment = wrapper_environment()
                        arguments = [
                            str(runner_path),
                            "--worker-backend",
                            "hermes",
                        ]
                        if file_auth:
                            write_supported_auth()
                            environment["HOME"] = str(fixture_user_home)
                            arguments.extend(
                                (
                                    "--hermes-auth-source",
                                    "user-hermes",
                                    "--hermes-auth-provider",
                                    "openai-codex",
                                )
                            )
                        arguments.append(ticket_relative)
                        if mode == "toolchain-path-injection":
                            unsafe_tool_bin = worktree_path / "unsafe-tool-bin"
                            unsafe_tool_bin.mkdir()
                            shutil.copy2(fake_pnpm, unsafe_tool_bin / "pnpm")
                            environment["PATH"] = os.pathsep.join(
                                (str(unsafe_tool_bin), environment["PATH"])
                            )
                        if provider_secret is not None:
                            environment["OPENAI_API_KEY"] = provider_secret
                        result = subprocess.run(
                            arguments,
                            cwd=worktree_path,
                            env=environment,
                            check=False,
                            capture_output=True,
                            text=True,
                            timeout=120,
                        )
                        created = ticket_runs() - before
                        return (
                            result,
                            next(iter(created)) if len(created) == 1 else None,
                        )

                    selector_rejections = {
                        "source-only": [
                            "--worker-backend",
                            "hermes",
                            "--hermes-auth-source",
                            "user-hermes",
                            ticket_relative,
                        ],
                        "provider-only": [
                            "--worker-backend",
                            "hermes",
                            "--hermes-auth-provider",
                            "openai-codex",
                            ticket_relative,
                        ],
                        "unknown-source": [
                            "--worker-backend",
                            "hermes",
                            "--hermes-auth-source",
                            "unknown",
                            "--hermes-auth-provider",
                            "openai-codex",
                            ticket_relative,
                        ],
                        "unknown-provider": [
                            "--worker-backend",
                            "hermes",
                            "--hermes-auth-source",
                            "user-hermes",
                            "--hermes-auth-provider",
                            "unknown",
                            ticket_relative,
                        ],
                        "duplicate-source": [
                            "--worker-backend",
                            "hermes",
                            "--hermes-auth-source",
                            "user-hermes",
                            "--hermes-auth-source",
                            "user-hermes",
                            "--hermes-auth-provider",
                            "openai-codex",
                            ticket_relative,
                        ],
                        "codex-backend": [
                            "--hermes-auth-source",
                            "user-hermes",
                            "--hermes-auth-provider",
                            "openai-codex",
                            ticket_relative,
                        ],
                    }
                    for rejection_name, rejection_arguments in selector_rejections.items():
                        before_rejection = ticket_runs()
                        selector_result = subprocess.run(
                            [str(runner_path), *rejection_arguments],
                            cwd=worktree_path,
                            env=wrapper_environment(HOME=str(fixture_user_home)),
                            check=False,
                            capture_output=True,
                            text=True,
                            timeout=10,
                        )
                        check(
                            selector_result.returncode != 0
                            and ticket_runs() == before_rejection
                            and not (worktree_path / "fake-hermes-log.jsonl").exists(),
                            f"{rejection_name} Hermes file-auth selector combination fails before any run or writer",
                        )
                    autopilot_selector_result = subprocess.run(
                        [
                            str(worktree_path / "scripts/codex/autopilot.sh"),
                            "--hermes-auth-source",
                            "user-hermes",
                        ],
                        cwd=worktree_path,
                        env=wrapper_environment(HOME=str(fixture_user_home)),
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    check(
                        autopilot_selector_result.returncode != 0
                        and "usage:" in autopilot_selector_result.stderr,
                        "Codex-only autopilot rejects Hermes file-auth selectors",
                    )

                    clean_product_fixtures()
                    fake_codex_control.write_text(
                        json.dumps(
                            {
                                "mode": "default-codex",
                                "unrelated_pid": unrelated.pid,
                            }
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    before_default = ticket_runs()
                    default_environment = wrapper_environment()
                    default_environment["CODEX_HARNESS_CODEX_EXECUTABLE"] = "/usr/bin/false"
                    default_environment["CODEX_HARNESS_HERMES_EXECUTABLE"] = "/usr/bin/false"
                    default_result = subprocess.run(
                        [str(runner_path), ticket_relative],
                        cwd=worktree_path,
                        env=default_environment,
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    default_created = ticket_runs() - before_default
                    default_run = (
                        next(iter(default_created)) if len(default_created) == 1 else None
                    )
                    default_records = [
                        json.loads(line)
                        for line in fake_codex_log.read_text(encoding="utf-8").splitlines()
                        if line
                    ]
                    check(
                        default_result.returncode == 0
                        and default_run is not None
                        and [record["phase"] for record in default_records] == ["CODEX_FULL"]
                        and not (worktree_path / "fake-hermes-log.jsonl").exists(),
                        "default runner preserves the Codex-only path and never starts Hermes",
                    )

                    for rejected_mode in (
                        "blocked",
                        "contradictory",
                        "duplicate",
                        "unknown",
                    ):
                        rejected_result, rejected_run = execute_runner(
                            rejected_mode
                        )
                        check(
                            rejected_result.returncode != 0
                            and rejected_run is not None
                            and not (rejected_run / "hermes").exists(),
                            f"{rejected_mode} Codex gate output stops implementation",
                        )
                        check(
                            not (worktree_path / "fake-hermes-log.jsonl").exists(),
                            f"{rejected_mode} Codex gate starts no Hermes writer",
                        )

                    injected_result, injected_run = execute_runner(
                        "toolchain-path-injection"
                    )
                    check(
                        injected_result.returncode != 0
                        and injected_run is not None
                        and "bound executable changed"
                        in sanitized_process_error(injected_result.stderr)
                        and not (injected_run / "verification-evidence.json").exists(),
                        "Hermes cannot replace a repository-controlled PATH executable before checks",
                    )
                    check(
                        len(
                            (
                                worktree_path / "fake-hermes-log.jsonl"
                            ).read_text(encoding="utf-8").splitlines()
                        )
                        == 1,
                        "rejected PATH injection still starts exactly one Hermes writer",
                    )

                    for rejected_mode in (
                        "verification-failed",
                        "missing-checks",
                        "fabricated-checks",
                        "invented-evidence",
                        "printf-command",
                        "startup-failure",
                        "lingering-descendant",
                        "wrong-backend",
                        "wrong-ticket",
                        "missing-audit",
                        "review-blocked",
                        "review-findings",
                        "manual-false",
                        "inconsistent-status",
                        "missing-review-evidence",
                        "forged-pid",
                        "verification-command-failed",
                        "unsafe-snapshot-symlink",
                    ):
                        churn_stop = threading.Event()
                        churn_count = {"value": 0}

                        def churn_process_ids():
                            while not churn_stop.is_set():
                                subprocess.run(
                                    ["/usr/bin/true"],
                                    check=False,
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                )
                                churn_count["value"] += 1
                                time.sleep(0.01)

                        churn_thread = None
                        if rejected_mode == "lingering-descendant":
                            churn_thread = threading.Thread(target=churn_process_ids)
                            churn_thread.start()
                        try:
                            rejected_result, rejected_run = execute_runner(rejected_mode)
                        finally:
                            churn_stop.set()
                            if churn_thread is not None:
                                churn_thread.join(timeout=5)
                        retained = None
                        if rejected_run is not None and (rejected_run / "result.json").exists():
                            retained = json.loads(
                                (rejected_run / "result.json").read_text(encoding="utf-8")
                            )
                        rejection_ok = (
                            rejected_result.returncode != 0
                            and rejected_run is not None
                            and retained is not None
                            and retained["manual_verification_required"] is False
                            and "Next human action" not in rejected_result.stdout
                        )
                        if not rejection_ok:
                            print(
                                json.dumps(
                                    {
                                        "mode": rejected_mode,
                                        "returncode": rejected_result.returncode,
                                        "run": str(rejected_run) if rejected_run else None,
                                        "retained": retained,
                                        "stdout": rejected_result.stdout[-1000:],
                                        "stderr": rejected_result.stderr[-1000:],
                                    },
                                    sort_keys=True,
                                ),
                                file=sys.stderr,
                            )
                        check(
                            rejection_ok,
                            f"{rejected_mode} post evidence cannot open the manual gate",
                        )
                        check(
                            len(
                                (worktree_path / "fake-hermes-log.jsonl")
                                .read_text(encoding="utf-8")
                                .splitlines()
                            )
                            == 1,
                            f"{rejected_mode} post rejection starts exactly one writer",
                        )
                        check(
                            unrelated.poll() is None,
                            f"{rejected_mode} post rejection does not signal an unrelated PID",
                        )
                        if rejected_mode == "lingering-descendant":
                            verification_events_path = (
                                rejected_run / "phases/verification/events.jsonl"
                            )
                            if not verification_events_path.exists():
                                print(
                                    json.dumps(
                                        {
                                            "mode": rejected_mode,
                                            "retained": retained,
                                            "stderr": rejected_result.stderr[-2000:],
                                            "run_files": sorted(
                                                str(path.relative_to(rejected_run))
                                                for path in rejected_run.rglob("*")
                                            ),
                                        },
                                        sort_keys=True,
                                    ),
                                    file=sys.stderr,
                                )
                                check(
                                    False,
                                    "lingering-descendant reaches retained Codex phase evidence",
                                )
                                continue
                            lingering_records = [
                                json.loads(line)
                                for line in verification_events_path.read_text(
                                    encoding="utf-8"
                                ).splitlines()
                                if line
                                and json.loads(line).get("type")
                                == "fixture.lingering_pid"
                            ]
                            lingering_pid = lingering_records[-1]["pid"]
                            group_owner_pid = lingering_records[-1]["group_owner_pid"]
                            supervisor_pid = int(
                                (
                                    rejected_run
                                    / "phases/verification/supervisor.pid"
                                ).read_text(encoding="ascii")
                            )
                            try:
                                os.kill(lingering_pid, 0)
                            except ProcessLookupError:
                                lingering_alive = False
                            else:
                                lingering_alive = True
                            deadline = time.monotonic() + 2
                            while lingering_alive and time.monotonic() < deadline:
                                time.sleep(0.02)
                                try:
                                    os.kill(lingering_pid, 0)
                                except ProcessLookupError:
                                    lingering_alive = False
                            check(
                                not lingering_alive
                                and supervisor_pid == group_owner_pid
                                and churn_count["value"] > 0
                                and "retained group owner"
                                in (
                                    rejected_run
                                    / "phases/verification/progress.log"
                                ).read_text(encoding="utf-8"),
                                "retained group owner survives leader exit through TERM/KILL cleanup and PID churn",
                            )
                        if rejected_mode == "verification-command-failed":
                            failed_evidence = json.loads(
                                (rejected_run / "verification-evidence.json").read_text(
                                    encoding="utf-8"
                                )
                            )
                            failed_verification_ok = (
                                failed_evidence["commands"]
                                and failed_evidence["commands"][0]["command"]
                                == "pnpm verify"
                                and failed_evidence["commands"][0]["exit_code"] == 9
                                and failed_evidence["mirror_destroyed"] is True
                            )
                            check(
                                failed_verification_ok,
                                "failed writable verification retains exact evidence and destroys its mirror",
                            )

                    for phase_mode, phase_signal, expected_status in (
                        ("phase-hup", signal.SIGHUP, 129),
                        ("phase-int", signal.SIGINT, 130),
                        ("phase-term", signal.SIGTERM, 143),
                    ):
                        clean_product_fixtures()
                        fake_mode.write_text("e2e\n", encoding="utf-8")
                        fake_codex_control.write_text(
                            json.dumps(
                                {
                                    "mode": phase_mode,
                                    "unrelated_pid": unrelated.pid,
                                }
                            )
                            + "\n",
                            encoding="utf-8",
                        )
                        before_phase = ticket_runs()
                        interrupted_phase = subprocess.Popen(
                            [
                                str(runner_path),
                                "--worker-backend",
                                "hermes",
                                ticket_relative,
                            ],
                            cwd=worktree_path,
                            env=wrapper_environment(),
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                        )
                        deadline = time.monotonic() + 30
                        phase_events = None
                        while time.monotonic() < deadline:
                            created_phase_runs = ticket_runs() - before_phase
                            if len(created_phase_runs) == 1:
                                phase_run = next(iter(created_phase_runs))
                                phase_events = (
                                    phase_run / "phases/verification/events.jsonl"
                                )
                                if phase_events.exists() and "fixture.phase_ready" in phase_events.read_text(
                                    encoding="utf-8", errors="replace"
                                ):
                                    break
                            if interrupted_phase.poll() is not None:
                                break
                            time.sleep(0.02)
                        phase_ready = (
                            phase_events is not None
                            and phase_events.exists()
                            and "fixture.phase_ready"
                            in phase_events.read_text(encoding="utf-8", errors="replace")
                        )
                        if phase_ready:
                            interrupted_phase.send_signal(phase_signal)
                        _interrupted_stdout, _interrupted_stderr = (
                            interrupted_phase.communicate(timeout=45)
                        )
                        codex_pids = [
                            json.loads(line)["pid"]
                            for line in fake_codex_log.read_text(encoding="utf-8").splitlines()
                            if line
                        ]
                        live_codex = False
                        for codex_pid in codex_pids:
                            try:
                                os.kill(codex_pid, 0)
                            except ProcessLookupError:
                                continue
                            else:
                                live_codex = True
                                break
                        phase_signal_ok = (
                            phase_ready
                            and interrupted_phase.returncode == expected_status
                            and not live_codex
                            and unrelated.poll() is None
                        )
                        check(
                            phase_signal_ok,
                            f"{phase_signal.name} during direct Codex supervision terminates only its group",
                        )

                    clean_product_fixtures()
                    fake_codex_control.write_text(
                        json.dumps(
                            {
                                "mode": "redaction-interrupt",
                                "unrelated_pid": unrelated.pid,
                            }
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    before_redaction = ticket_runs()
                    redaction_secret = "fixture-redaction-secret-123456789"
                    redaction_environment = wrapper_environment()
                    redaction_environment["OPENAI_" + "API_KEY"] = redaction_secret
                    interrupted_runner = subprocess.Popen(
                        [
                            str(runner_path),
                            "--worker-backend",
                            "hermes",
                            ticket_relative,
                        ],
                        cwd=worktree_path,
                        env=redaction_environment,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                    )
                    redaction_run = None
                    redaction_active = False
                    deadline = time.monotonic() + 60
                    while time.monotonic() < deadline:
                        created = ticket_runs() - before_redaction
                        if len(created) == 1:
                            redaction_run = next(iter(created))
                            if (redaction_run / "redaction-active.txt").exists():
                                redaction_active = True
                                break
                        if interrupted_runner.poll() is not None:
                            break
                        time.sleep(0.01)
                    if redaction_active:
                        interrupted_runner.send_signal(signal.SIGTERM)
                    interrupted_stdout, interrupted_stderr = interrupted_runner.communicate(
                        timeout=90
                    )
                    retained_secret = False
                    if redaction_run is not None:
                        secret_bytes = redaction_secret.encode("utf-8")
                        for retained_path in redaction_run.rglob("*"):
                            if redaction_secret in str(retained_path.relative_to(redaction_run)):
                                retained_secret = True
                                break
                            if retained_path.is_file() and secret_bytes in retained_path.read_bytes():
                                retained_secret = True
                                break
                    process_records = []
                    for log_path in (fake_codex_log, worktree_path / "fake-hermes-log.jsonl"):
                        if log_path.exists():
                            process_records.extend(
                                json.loads(line)
                                for line in log_path.read_text(encoding="utf-8").splitlines()
                                if line
                            )
                    live_descendant = False
                    for record in process_records:
                        try:
                            os.kill(record["pid"], 0)
                        except ProcessLookupError:
                            continue
                        else:
                            live_descendant = True
                            break
                    check(
                        redaction_active
                        and interrupted_runner.returncode == 143
                        and not retained_secret
                        and redaction_secret not in interrupted_stdout
                        and redaction_secret not in interrupted_stderr,
                        "TERM during active redaction preserves no exact credential",
                    )
                    check(
                        not live_descendant,
                        "TERM during active redaction leaves no Codex or Hermes descendant",
                    )

                    doctor_secret = "fixture-doctor-secret-123456789"
                    successful_result, successful_run = execute_runner(
                        "success",
                        provider_secret=doctor_secret,
                        file_auth=True,
                    )
                    if successful_result.returncode != 0:
                        print(
                            sanitized_process_error(successful_result.stderr),
                            file=sys.stderr,
                        )
                    check(
                        successful_result.returncode == 0
                        and successful_run is not None,
                        "Hermes ticket runner completes every isolated phase",
                    )
                    toolchain_manifest = json.loads(
                        (successful_run / "toolchain.json").read_text(
                            encoding="utf-8"
                        )
                    )
                    toolchain_targets = {
                        entry["name"]: Path(entry["target"])
                        for entry in toolchain_manifest["entries"]
                    }
                    safe_path_parts = toolchain_manifest["safe_path"].split(
                        os.pathsep
                    )
                    canonical_codex_bin = fake_codex_bin.resolve()
                    canonical_hermes_bin = fake_hermes_bin.resolve()
                    canonical_tool_bin = fake_tool_bin.resolve()
                    canonical_toolchain_bin = (
                        successful_run / "toolchain/bin"
                    ).resolve()
                    check(
                        toolchain_targets["codex"].parent == canonical_codex_bin
                        and toolchain_targets["hermes"].parent
                        == canonical_hermes_bin
                        and toolchain_targets["pnpm"].parent
                        == canonical_tool_bin
                        and all(
                            target == target.resolve()
                            for target in toolchain_targets.values()
                        )
                        and safe_path_parts
                        == [
                            str(canonical_toolchain_bin),
                            *FIXED_SYSTEM_PATH.split(os.pathsep),
                        ]
                        and not {
                            str(fake_codex_bin),
                            str(fake_hermes_bin),
                            str(fake_tool_bin),
                            str(canonical_codex_bin),
                            str(canonical_hermes_bin),
                            str(canonical_tool_bin),
                        }.intersection(safe_path_parts)
                        and all(
                            path.is_file() and not path.is_symlink()
                            for path in (successful_run / "toolchain/bin").iterdir()
                        ),
                        "split Codex and pnpm locations resolve through one frozen non-caller PATH",
                    )
                    records = [
                        json.loads(line)
                        for line in fake_codex_log.read_text(
                            encoding="utf-8"
                        ).splitlines()
                        if line
                    ]
                    check(
                        [record["phase"] for record in records]
                        == [
                            "HERMES_READ_ONLY_GATES",
                            "HERMES_READ_ONLY_VERIFICATION",
                            "HERMES_READ_ONLY_AUDIT",
                            "HERMES_READ_ONLY_REVIEW",
                        ],
                        "Hermes runner uses four fresh non-writing Codex phases",
                    )
                    doctor_records = [
                        json.loads(line)
                        for line in doctor_probe_log.read_text(encoding="utf-8").splitlines()
                        if line
                    ]
                    retained_doctor_secret = any(
                        doctor_secret.encode("utf-8") in path.read_bytes()
                        for path in successful_run.rglob("*")
                        if path.is_file()
                    )
                    check(
                        len(doctor_records) == 1
                        and doctor_records[0].get("visible") == {}
                        and isinstance(doctor_records[0].get("pid"), int)
                        and doctor_secret not in successful_result.stdout
                        and doctor_secret not in successful_result.stderr
                        and not retained_doctor_secret,
                        "run-ticket doctor probe receives no provider credential live or in retained evidence",
                    )
                    check(
                        not (worktree_path / "codex-parent-write.txt").exists()
                        and not (
                            worktree_path / "codex-spawned-writer.txt"
                        ).exists(),
                        "Seatbelt denies parent and spawned-writer repository edits",
                    )
                    check(
                        unrelated.poll() is None,
                        "stale supervisor PID evidence cannot signal an unrelated process",
                    )
                    hermes_records = [
                        json.loads(line)
                        for line in (
                            worktree_path / "fake-hermes-log.jsonl"
                        ).read_text(encoding="utf-8").splitlines()
                        if line
                    ]
                    check(
                        len(hermes_records) == 1,
                        "shell-owned Hermes phase starts exactly one writer",
                    )
                    hermes_record = (
                        hermes_records[0] if len(hermes_records) == 1 else {}
                    )
                    check(
                        hermes_record.get("probe_observation", {}).get("visible_names")
                        == []
                        and hermes_record.get("probe_observation", {}).get(
                            "auth_present_before_probe_record"
                        )
                        is False
                        and hermes_record.get("probe_observation", {}).get(
                            "source_path_exposed"
                        )
                        is False
                        and hermes_record.get("probe_observation", {}).get(
                            "source_read_denied"
                        )
                        is True
                        and hermes_record.get("writer_provider_names") == []
                        and hermes_record.get("auth_observation", {}).get("providers")
                        == ["openai-codex"]
                        and "probe-credential-exfiltration"
                        not in successful_result.stdout
                        and "probe-credential-exfiltration"
                        not in successful_result.stderr,
                        "malicious help probe sees no provider credential or auth source while only the contained writer receives minimal file auth",
                    )
                    result = json.loads(
                        (successful_run / "result.json").read_text(
                            encoding="utf-8"
                        )
                    )
                    check(
                        result["status"] == "READY_FOR_MANUAL_VERIFICATION"
                        and result["worker"]["backend"] == "HERMES",
                        "post phase produces the final structured Hermes result",
                    )
                    check(
                        (successful_run / "phases/gate/result.json").exists()
                        and (successful_run / "phases/verification/events.jsonl").exists()
                        and (successful_run / "phases/audit/events.jsonl").exists()
                        and (successful_run / "phases/review/events.jsonl").exists()
                        and (successful_run / "hermes-gates.json").exists(),
                        "phase-specific gate, check, audit, and review evidence is retained",
                    )
                    verification_evidence = json.loads(
                        (successful_run / "verification-evidence.json").read_text(
                            encoding="utf-8"
                        )
                    )
                    verification_stdout = (
                        successful_run / "verification-commands/001.stdout.log"
                    ).read_text(encoding="utf-8")
                    check(
                        verification_evidence["mirror_destroyed"] is True
                        and len(
                            verification_evidence["implementation_binding_sha256"]
                        )
                        == 64
                        and verification_evidence["commands"][0]["command"]
                        == "pnpm verify"
                        and verification_evidence["commands"][0]["exit_code"] == 0
                        and "build-output-created" in verification_stdout
                        and "isolated-git-repository" in verification_stdout
                        and "original-write-denied" in verification_stdout
                        and "symlink-escape-denied" in verification_stdout
                        and "credential-free-verification" in verification_stdout
                        and "runtime-files-hidden-from-worktree" in verification_stdout
                        and not (
                            worktree_path / "verification-original-write.txt"
                        ).exists()
                        and not (
                            worktree_path / "verification-symlink-write.txt"
                        ).exists(),
                        "writable pnpm verification runs only in a destroyed bound mirror with isolated Git",
                    )
                    check(
                        not (successful_run / "hermes/home").exists(),
                        "end-to-end Hermes runner removes the ephemeral home",
                    )
                    check(
                        all(
                            path.read_bytes() == content
                            for path, content in immutable_fixture_bytes.items()
                        ),
                        "Hermes cannot alter controller prompts, product authority, ticket status, criteria, or checks",
                    )

                    second_result = subprocess.run(
                        [
                            str(wrapper_path),
                            ticket_relative,
                            str(successful_run),
                            str(successful_run / "hermes-gates.json"),
                            "user-hermes",
                            "openai-codex",
                        ],
                        cwd=worktree_path,
                        env=wrapper_environment(HOME=str(fixture_user_home)),
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=20,
                    )
                    check(
                        second_result.returncode != 0
                        and "already invoked" in second_result.stderr,
                        "completed run cannot start a second Hermes writer",
                    )
                    check(
                        len(
                            (
                                worktree_path / "fake-hermes-log.jsonl"
                            ).read_text(encoding="utf-8").splitlines()
                        )
                        == 1,
                        "second-writer refusal preserves the single implementation",
                    )
                finally:
                    unrelated.terminate()
                    unrelated.wait(timeout=5)
        finally:
            if worktree_result.returncode == 0:
                subprocess.run(
                    [
                        "git",
                        "-C",
                        str(ROOT),
                        "worktree",
                        "remove",
                        "--force",
                        str(worktree_path),
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
observer_path = ROOT / "scripts" / "codex" / "run-codex-observed.py"
with tempfile.TemporaryDirectory() as temporary_directory:
    temporary_path = Path(temporary_directory)
    input_path = temporary_path / "input.md"
    input_path.write_text("fixture\n", encoding="utf-8")

    fixture_events = [
        {"type": "thread.started", "thread_id": "fixture-thread"},
        {
            "type": "item.started",
            "item": {
                "id": "fixture-wait",
                "type": "collab_tool_call",
                "tool": "wait",
                "receiver_thread_ids": [],
                "status": "in_progress",
            },
        },
        {
            "type": "item.completed",
            "item": {
                "id": "fixture-message",
                "type": "agent_message",
                "text": json.dumps(
                    {
                        "status": "PARTIAL",
                        "summary": "Read-only agents are still running.",
                        "next_action": "Continue waiting.",
                    }
                ),
            },
        },
        {"type": "turn.completed", "usage": {}},
    ]
    fixture_producer = (
        "import json; "
        f"events={fixture_events!r}; "
        "[print(json.dumps(event), flush=True) for event in events]"
    )
    observed_events = temporary_path / "observed-events.jsonl"
    observed_stderr = temporary_path / "observed-stderr.log"
    observed_progress = temporary_path / "observed-progress.log"
    observed_result = subprocess.run(
        [
            sys.executable,
            str(observer_path),
            "--input",
            str(input_path),
            "--events",
            str(observed_events),
            "--stderr",
            str(observed_stderr),
            "--progress",
            str(observed_progress),
            "--",
            sys.executable,
            "-c",
            fixture_producer,
        ],
        check=False,
        timeout=5,
        capture_output=True,
        text=True,
    )
    progress_text = observed_progress.read_text(encoding="utf-8")
    check(observed_result.returncode == 0, "live event observer preserves a successful command exit")
    check(len(observed_events.read_text(encoding="utf-8").splitlines()) == len(fixture_events), "live event observer preserves complete JSONL evidence")
    check("Waiting for configured agent responses" in progress_text, "live event observer reports read-only gate waits")
    check("[PARTIAL] Read-only agents are still running" in progress_text, "live event observer renders structured phase updates")

    failed_events = temporary_path / "failed-events.jsonl"
    failed_stderr = temporary_path / "failed-stderr.log"
    failed_progress = temporary_path / "failed-progress.log"
    failed_result = subprocess.run(
        [
            sys.executable,
            str(observer_path),
            "--input",
            str(input_path),
            "--events",
            str(failed_events),
            "--stderr",
            str(failed_stderr),
            "--progress",
            str(failed_progress),
            "--",
            sys.executable,
            "-c",
            "raise SystemExit(7)",
        ],
        check=False,
        timeout=5,
        capture_output=True,
        text=True,
    )
    check(failed_result.returncode == 7, "live event observer preserves a failed command exit")
    check("Codex exited with status 7" in failed_progress.read_text(encoding="utf-8"), "live event observer records terminal failure progress")

with (ROOT / ".codex" / "schemas" / "retrospective-result.schema.json").open(encoding="utf-8") as handle:
    retrospective_schema = json.load(handle)
recommendation_properties = retrospective_schema["properties"]["recommendation"]["properties"]
check(recommendation_properties["product_scope_change"].get("const") is False, "retrospective proposals cannot request product-scope changes")
check(recommendation_properties["approval_status"].get("const") == "PENDING", "retrospective proposals cannot self-approve")

with (ROOT / ".codex" / "schemas" / "harness-improvement-result.schema.json").open(encoding="utf-8") as handle:
    improvement_schema = json.load(handle)
writer_count = improvement_schema["properties"]["writer_count"]
check(writer_count.get("minimum") == 0 and writer_count.get("maximum") == 1, "harness improvement schema permits at most one writer")

if FAILURES:
    print(f"Harness policy validation failed with {len(FAILURES)} finding(s).", file=sys.stderr)
    raise SystemExit(1)

print("Harness policy validation completed without blocking failures.")
