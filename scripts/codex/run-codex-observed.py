#!/usr/bin/env python3

import argparse
import json
import os
import signal
import subprocess
import sys
from pathlib import Path


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Run a Codex command while preserving JSONL and streaming concise progress."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--events", required=True)
    parser.add_argument("--stderr", required=True)
    parser.add_argument("--progress", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    if arguments.command[:1] == ["--"]:
        arguments.command = arguments.command[1:]
    if not arguments.command:
        parser.error("a command is required after --")
    return arguments


def terminate_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def message_progress(text):
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return str(text).strip().replace("\n", " ")[:500]
    if not isinstance(payload, dict):
        return str(payload)[:500]
    status = payload.get("status") or payload.get("result") or "UPDATE"
    summary = str(payload.get("summary") or "").strip().replace("\n", " ")
    next_action = str(payload.get("next_action") or "").strip().replace("\n", " ")
    parts = [f"[{status}]", summary]
    if next_action:
        parts.append(f"Next: {next_action}")
    return " ".join(part for part in parts if part)[:1000]


def event_progress(line):
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return None
    event_type = event.get("type")
    if event_type == "thread.started":
        return "Codex ticket session started."
    if event_type == "turn.completed":
        return "Codex ticket session completed."
    item = event.get("item")
    if not isinstance(item, dict):
        return None
    item_type = item.get("type")
    if item_type == "agent_message" and event_type == "item.completed":
        return message_progress(item.get("text"))
    if item_type == "collab_tool_call" and item.get("tool") == "wait" and event_type == "item.started":
        return "Waiting for configured agent responses; no implementation writer runs during read-only gates."
    if item_type == "command_execution" and event_type == "item.started":
        command = str(item.get("command") or "").strip().replace("\n", " ")
        return f"Command: {command[:500]}"
    if item_type == "command_execution" and event_type == "item.completed" and item.get("exit_code") not in (None, 0):
        return f"Command failed with exit status {item.get('exit_code')}."
    return None


def emit_progress(message, progress_handle):
    rendered = f"[codex-run] {message}\n"
    progress_handle.write(rendered)
    progress_handle.flush()
    sys.stderr.write(rendered)
    sys.stderr.flush()


def main():
    arguments = parse_arguments()
    input_path = Path(arguments.input)
    event_path = Path(arguments.events)
    stderr_path = Path(arguments.stderr)
    progress_path = Path(arguments.progress)

    with (
        input_path.open(encoding="utf-8") as input_handle,
        event_path.open("w", encoding="utf-8") as event_handle,
        stderr_path.open("w", encoding="utf-8") as stderr_handle,
        progress_path.open("w", encoding="utf-8") as progress_handle,
    ):
        process = subprocess.Popen(
            arguments.command,
            stdin=input_handle,
            stdout=subprocess.PIPE,
            stderr=stderr_handle,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        assert process.stdout is not None
        try:
            for line in process.stdout:
                event_handle.write(line)
                event_handle.flush()
                progress = event_progress(line)
                if progress:
                    emit_progress(progress, progress_handle)
        except KeyboardInterrupt:
            emit_progress("Interrupted by the user; terminating the Codex process group.", progress_handle)
            terminate_process_group(process)
            return 130
        return_code = process.wait()
        if return_code != 0:
            emit_progress(f"Codex exited with status {return_code}.", progress_handle)
        return return_code


if __name__ == "__main__":
    raise SystemExit(main())
