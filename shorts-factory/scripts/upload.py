#!/usr/bin/env python3
"""Resumable upload of build/final.mp4 to YouTube via the Data API v3.

Auth is a long-lived refresh token held in GitHub secrets, exchanged for an
access token on every run. Nothing interactive happens here — see
scripts/get_refresh_token.py for the one-time local step that mints it.

Quota note: one upload costs 1600 units of the default 10,000/day, so ~6
uploads per day per project, whatever your schedule says.

Output: build/upload.json, and an appended entry in state/used_topics.json
"""
from __future__ import annotations

import datetime as dt
import os
import pathlib
import random
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (BUILD, STATE, die, ffprobe_duration, load_config, log,
                    read_json, write_json)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
RETRYABLE = {500, 502, 503, 504}


def service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    cid = os.environ.get("YT_CLIENT_ID")
    secret = os.environ.get("YT_CLIENT_SECRET")
    refresh = os.environ.get("YT_REFRESH_TOKEN")
    missing = [n for n, v in
               (("YT_CLIENT_ID", cid), ("YT_CLIENT_SECRET", secret),
                ("YT_REFRESH_TOKEN", refresh)) if not v]
    if missing:
        die("missing secret(s): " + ", ".join(missing)
            + " — run scripts/get_refresh_token.py locally, then add them as "
              "repository secrets.")

    creds = Credentials(
        token=None,
        refresh_token=refresh,
        client_id=cid,
        client_secret=secret,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES,
    )
    try:
        creds.refresh(Request())
    except Exception as exc:  # noqa: BLE001
        die("could not refresh the YouTube token. If your Google Cloud OAuth "
            "consent screen is still in 'Testing', refresh tokens expire after "
            f"7 days — publish the app and re-mint it. Details: {exc}")
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def body(script: dict, cfg: dict) -> dict:
    desc = str(script.get("description", "")).strip()
    if "#shorts" not in desc.lower():
        desc += "\n\n#Shorts"
    tags = [str(t)[:30] for t in (script.get("tags") or [])][:15]
    return {
        "snippet": {
            "title": str(script["title"])[:100],
            "description": desc[:4900],
            "tags": tags,
            "categoryId": str(cfg["youtube"]["category_id"]),
            "defaultLanguage": cfg["channel"]["language"],
            "defaultAudioLanguage": cfg["channel"]["language"],
        },
        "status": {
            "privacyStatus": cfg["youtube"]["privacy"],
            "selfDeclaredMadeForKids": bool(cfg["youtube"]["made_for_kids"]),
            "madeForKids": bool(cfg["youtube"]["made_for_kids"]),
        },
    }


def upload(yt, video: pathlib.Path, payload: dict) -> str:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    media = MediaFileUpload(str(video), chunksize=4 * 1024 * 1024,
                            resumable=True, mimetype="video/mp4")
    request = yt.videos().insert(part="snippet,status", body=payload, media_body=media)

    response, errors = None, 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                log(f"  uploading… {int(status.progress() * 100)}%")
        except HttpError as exc:
            if exc.resp.status in RETRYABLE:
                errors += 1
                if errors > 6:
                    die(f"gave up after {errors} retryable errors: {exc}")
                nap = min(60, 2 ** errors) + random.random()
                log(f"  transient {exc.resp.status}, retrying in {nap:.1f}s")
                time.sleep(nap)
                continue
            if exc.resp.status == 403 and "quota" in str(exc).lower():
                die("YouTube API quota exhausted for today (an upload costs "
                    "1600 of 10,000 units). Reduce the schedule or request more.")
            die(f"upload failed: {exc}")
        except (ConnectionError, OSError) as exc:
            errors += 1
            if errors > 6:
                die(f"network kept failing: {exc}")
            time.sleep(min(60, 2 ** errors))
    return response["id"]


def main() -> None:
    cfg = load_config()
    video = BUILD / "final.mp4"
    if not video.exists():
        die("build/final.mp4 missing — run render.py first")
    script = read_json(BUILD / "script.json") or die("build/script.json missing")

    dur = ffprobe_duration(video)
    if dur > 180:
        die(f"video is {dur:.1f}s — YouTube will not treat it as a Short")

    if os.environ.get("DRY_RUN", "").strip().lower() in ("1", "true", "yes"):
        log(f"DRY_RUN set — not uploading. Would publish {script['title']!r} "
            f"as {cfg['youtube']['privacy']} ({dur:.1f}s)")
        return

    payload = body(script, cfg)
    log(f"uploading {video.name} ({video.stat().st_size / 1e6:.1f} MB, {dur:.1f}s) "
        f"as {payload['status']['privacyStatus']}")
    video_id = upload(service(), video, payload)
    url = f"https://www.youtube.com/shorts/{video_id}"
    log(f"published: {url}")

    write_json(BUILD / "upload.json", {
        "video_id": video_id, "url": url,
        "title": payload["snippet"]["title"],
        "privacy": payload["status"]["privacyStatus"],
        "duration": round(dur, 2),
    })

    ledger = read_json(STATE, {"topics": []}) or {"topics": []}
    ledger.setdefault("topics", []).append({
        "topic": script.get("topic", ""),
        "title": payload["snippet"]["title"],
        "video_id": video_id,
        "url": url,
        "published_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    })
    write_json(STATE, ledger)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### Published\n\n**{payload['snippet']['title']}**\n\n"
                     f"- {url}\n- {dur:.1f}s, {video.stat().st_size / 1e6:.1f} MB\n"
                     f"- visibility: `{payload['status']['privacyStatus']}`\n")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"video_id={video_id}\nurl={url}\n")


if __name__ == "__main__":
    main()
