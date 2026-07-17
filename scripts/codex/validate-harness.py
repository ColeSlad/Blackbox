#!/usr/bin/env python3

import json
import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FAILURES = []


def check(condition, message):
    if condition:
        print(f"[PASS] {message}")
    else:
        print(f"[FAIL] {message}", file=sys.stderr)
        FAILURES.append(message)


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


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

for filename, agent_name in read_only_agents.items():
    path = ROOT / ".codex" / "agents" / f"{filename}.toml"
    with path.open("rb") as handle:
        config = tomllib.load(handle)
    instructions = config.get("developer_instructions", "").lower()
    check(config.get("name") == agent_name, f"{agent_name} has the expected identity")
    check(config.get("sandbox_mode") == "read-only", f"{agent_name} is sandboxed read-only")
    check("edit" in instructions and ("never" in instructions or "without" in instructions), f"{agent_name} explicitly forbids edits")

for filename, agent_name in writer_agents.items():
    path = ROOT / ".codex" / "agents" / f"{filename}.toml"
    with path.open("rb") as handle:
        config = tomllib.load(handle)
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
check(run_ticket.find('STATUS=$(ticket_status') < run_ticket.find("codex -a never exec"), "ticket status validation precedes implementation")

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
