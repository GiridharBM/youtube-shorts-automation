"""Shared helpers: config loading, paths, logging, subprocess wrapper."""
from __future__ import annotations

import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import time

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
STATE = ROOT / "state" / "used_topics.json"

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def die(msg: str, code: int = 1) -> None:
    print(f"::error::{msg}", flush=True)
    sys.exit(code)


def load_config() -> dict:
    """config.yaml, with env-var overrides for any scalar leaf.

    `voice.name` can be overridden with VOICE_NAME, `video.crf` with VIDEO_CRF,
    and so on. Handy for one-off `workflow_dispatch` runs.
    """
    with open(ROOT / "config.yaml", "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}

    def walk(node, prefix=""):
        for key, val in list(node.items()):
            name = f"{prefix}{key}".upper().replace(".", "_")
            if isinstance(val, dict):
                walk(val, f"{name}_")
            else:
                env = os.environ.get(name)
                if env not in (None, ""):
                    if isinstance(val, bool):
                        node[key] = env.strip().lower() in ("1", "true", "yes", "on")
                    elif isinstance(val, int) and not isinstance(val, bool):
                        node[key] = int(float(env))
                    elif isinstance(val, float):
                        node[key] = float(env)
                    else:
                        node[key] = env

    walk(cfg)
    return cfg


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text)


def run(cmd, *, cwd=None, env=None, capture=False, check=True, timeout=None) -> str:
    """Thin subprocess wrapper that always shows the command it ran."""
    printable = cmd if isinstance(cmd, str) else shlex.join(str(c) for c in cmd)
    log(f"$ {printable[:400]}")
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        shell=isinstance(cmd, str),
        capture_output=capture,
        text=True,
        timeout=timeout,
    )
    if check and proc.returncode != 0:
        if capture:
            sys.stderr.write((proc.stdout or "")[-4000:])
            sys.stderr.write((proc.stderr or "")[-4000:])
        die(f"command failed ({proc.returncode}): {printable[:200]}")
    return (proc.stdout or "") if capture else ""


def ffprobe_duration(path) -> float:
    out = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture=True,
    )
    return float(out.strip())


def has_filter(name: str) -> bool:
    """True if this ffmpeg build exposes the named filter."""
    import subprocess
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:  # noqa: BLE001
        return False
    return any(line.split()[1:2] == [name]
               for line in out.splitlines() if line.strip())


def read_json(path, default=None):
    p = pathlib.Path(path)
    if not p.exists():
        return default
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, data) -> None:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def token_set(text: str) -> set:
    stop = {"the", "a", "an", "of", "and", "is", "are", "to", "in", "on", "for",
            "why", "how", "what", "that", "this", "it", "its", "your", "you"}
    return {t for t in normalize(text).split() if t and t not in stop}
