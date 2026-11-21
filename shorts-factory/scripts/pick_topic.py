#!/usr/bin/env python3
"""Ask opencode for the next Short: topic, title, description, tags, beats.

opencode is the only "AI API" in this pipeline. It is driven headlessly via
`opencode run`, which prints the model's answer to stdout. We ask for strict
JSON, strip any terminal noise, brace-match the object out of the output and
validate it. Anything malformed is retried.

Output: build/script.json
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (BUILD, STATE, die, load_config, log, read_json, strip_ansi,
                    token_set, write_json)

PROMPT = """You are the writer for a faceless YouTube Shorts channel.

NICHE: {niche}
AUDIENCE: {audience}
TONE: {tone}
LANGUAGE: {language}

Pick ONE topic in this niche and write the full script for a single vertical
short-form video.

Hard rules:
- Do NOT reuse or rephrase any of these already-published topics:
{used}
- Narration must total about {target_words} words across exactly {beats} beats.
- Beat 1 is the hook: it must land in under 12 words and create an open loop.
  No greetings, no "in this video", no "welcome back", no channel name.
- Every factual claim must be true and checkable. If you are not certain a
  number is right, leave the number out and describe it qualitatively instead.
- Write for the ear: short sentences, concrete nouns, present tense, no lists
  read aloud, no emoji anywhere in the narration.
- The last beat ends on a thought that makes a rewatch feel worth it. Do not
  say "like and subscribe".
- "overlay" is 2-5 words of BIG on-screen text for that beat. It is not the
  narration. It must be punchy and readable at a glance.
- "visual" is a short noun phrase naming the concrete object/scene for that
  beat, used to pick artwork. No camera directions.

Return ONE JSON object and nothing else. No markdown fence, no commentary.
Schema:
{{
  "topic": "short slug-like description of the subject, max 10 words",
  "title": "YouTube title, max {max_title} chars, ends with #Shorts",
  "description": "2-3 sentence description, then 3-5 hashtags on a new line",
  "tags": ["8-12 lowercase youtube tags"],
  "beats": [
    {{"text": "narration for this beat",
      "overlay": "BIG ON SCREEN TEXT",
      "visual": "concrete scene or object"}}
  ]
}}
"""


def opencode_binary() -> str:
    exe = shutil.which("opencode")
    if not exe:
        die("`opencode` is not on PATH. Install it with: "
            "curl -fsSL https://opencode.ai/install | bash")
    return exe


def extract_json(text: str) -> str | None:
    """Pull the first balanced {...} out of noisy CLI output."""
    text = strip_ansi(text)
    # Drop a markdown fence if the model added one anyway.
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        return fence.group(1)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        start = text.find("{", start + 1)
    return None


def ask_opencode(prompt: str, cfg: dict) -> str:
    exe = opencode_binary()
    cmd = [exe, "run"]
    model = (cfg["opencode"].get("model") or "").strip()
    if model:
        cmd += ["--model", model]
    extra = (cfg["opencode"].get("extra_args") or "").strip()
    if extra:
        cmd += extra.split()
    cmd.append(prompt)

    # Run in an empty throwaway dir: opencode is a coding agent, and we do not
    # want it reading or touching the repo while it is just writing copy.
    with tempfile.TemporaryDirectory(prefix="oc-") as tmp:
        log(f"$ opencode run (model={model or 'default'}) in {tmp}")
        proc = subprocess.run(
            cmd, cwd=tmp, capture_output=True, text=True, timeout=600,
            env={**os.environ, "NO_COLOR": "1", "CI": "1"},
        )
    if proc.returncode != 0:
        sys.stderr.write((proc.stdout or "")[-3000:])
        sys.stderr.write((proc.stderr or "")[-3000:])
        die(f"opencode exited {proc.returncode}")
    return proc.stdout or ""


def validate(data: dict, cfg: dict, used: list[str]) -> list[str]:
    problems: list[str] = []
    for key in ("topic", "title", "description", "tags", "beats"):
        if not data.get(key):
            problems.append(f"missing `{key}`")
    if problems:
        return problems

    want = int(cfg["script"]["beats"])
    beats = data["beats"]
    if not isinstance(beats, list) or not (want - 1 <= len(beats) <= want + 1):
        problems.append(f"need ~{want} beats, got {len(beats) if isinstance(beats, list) else '?'}")
    else:
        for i, b in enumerate(beats):
            if not isinstance(b, dict) or not b.get("text"):
                problems.append(f"beat {i} has no text")
            if not str(b.get("overlay", "")).strip():
                b["overlay"] = " ".join(str(b.get("text", "")).split()[:3]).upper()
            if not str(b.get("visual", "")).strip():
                b["visual"] = data["topic"]

    words = sum(len(str(b.get("text", "")).split()) for b in beats if isinstance(b, dict))
    if not (0.6 * cfg["script"]["target_words"] <= words <= 1.6 * cfg["script"]["target_words"]):
        problems.append(f"narration is {words} words, target {cfg['script']['target_words']}")

    title = str(data["title"])
    if len(title) > int(cfg["script"]["max_title_chars"]) + 10:
        problems.append(f"title too long ({len(title)} chars)")

    # Reject anything that overlaps too much with what we already published.
    new = token_set(data["topic"])
    for old in used:
        prev = token_set(old)
        if prev and new and len(new & prev) / len(new | prev) > 0.55:
            problems.append(f"topic too close to published topic: {old!r}")
            break
    return problems


def main() -> None:
    cfg = load_config()
    BUILD.mkdir(parents=True, exist_ok=True)

    ledger = read_json(STATE, {"topics": []}) or {"topics": []}
    used = [t["topic"] if isinstance(t, dict) else str(t) for t in ledger.get("topics", [])]
    recent = used[-40:]

    forced = (os.environ.get("FORCE_TOPIC") or "").strip()
    used_block = "\n".join(f"  - {t}" for t in recent) or "  - (nothing yet)"
    prompt = PROMPT.format(
        niche=forced or cfg["channel"]["niche"],
        audience=cfg["channel"]["audience"],
        tone=cfg["channel"]["tone"],
        language=cfg["channel"]["language"],
        used=used_block,
        beats=cfg["script"]["beats"],
        target_words=cfg["script"]["target_words"],
        max_title=cfg["script"]["max_title_chars"],
    )
    if forced:
        prompt += f"\nThe topic MUST be exactly this: {forced}\n"

    attempts = int(cfg["opencode"].get("attempts", 3))
    last: list[str] = []
    for attempt in range(1, attempts + 1):
        log(f"asking opencode for a script (attempt {attempt}/{attempts})")
        raw = ask_opencode(prompt if attempt == 1 else
                           prompt + "\nYour previous answer was rejected because: "
                           + "; ".join(last) + "\nFix it and return JSON only.", cfg)
        blob = extract_json(raw)
        if not blob:
            last = ["no JSON object found in the output"]
            log("  -> no JSON in output, retrying")
            continue
        try:
            data = json.loads(blob)
        except Exception as exc:  # noqa: BLE001
            last = [f"JSON did not parse: {exc}"]
            log(f"  -> {last[0]}")
            continue

        last = validate(data, cfg, recent)
        if last:
            log("  -> rejected: " + "; ".join(last))
            continue

        data["beats"] = [b for b in data["beats"] if str(b.get("text", "")).strip()]
        if "#shorts" not in data["title"].lower():
            data["title"] = data["title"].rstrip() + " #Shorts"
        data["narration"] = " ".join(b["text"].strip() for b in data["beats"])
        write_json(BUILD / "script.json", data)
        log(f"topic: {data['topic']}")
        log(f"title: {data['title']}")
        log(f"beats: {len(data['beats'])}, words: {len(data['narration'].split())}")
        # Make the title available to later workflow steps.
        summary = os.environ.get("GITHUB_OUTPUT")
        if summary:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write(f"topic={data['topic']}\n")
                fh.write(f"title={data['title']}\n")
        return

    die("opencode never returned a usable script: " + "; ".join(last))


if __name__ == "__main__":
    main()
