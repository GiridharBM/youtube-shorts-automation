#!/usr/bin/env python3
"""ONE-TIME, RUN LOCALLY. Mints the YouTube refresh token for CI.

  1. console.cloud.google.com -> new project -> enable "YouTube Data API v3"
  2. OAuth consent screen: External. Add yourself under "Test users".
     Then PUBLISH the app (Publishing status -> In production). If you leave
     it in "Testing", Google expires the refresh token after 7 days and the
     workflow will start failing silently next week.
  3. Credentials -> Create credentials -> OAuth client ID -> Desktop app.
     Download the JSON as client_secret.json next to this script.
  4. python3 scripts/get_refresh_token.py
  5. Copy the three printed values into GitHub repo secrets.

Scope is youtube.upload only — this token cannot read or delete anything.
"""
from __future__ import annotations

import json
import pathlib
import sys

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def main() -> None:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        sys.exit("pip install google-auth-oauthlib first")

    here = pathlib.Path(__file__).resolve().parent
    candidates = sorted(here.glob("client_secret*.json")) + \
        sorted(here.parent.glob("client_secret*.json"))
    if not candidates:
        sys.exit("put your OAuth desktop-app client_secret*.json next to this script")
    secret = candidates[0]
    print(f"using {secret}")

    flow = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent",
                                  access_type="offline", include_granted_scopes="true")
    if not creds.refresh_token:
        sys.exit("Google did not return a refresh token. Revoke the app at "
                 "myaccount.google.com/permissions and try again.")

    data = json.loads(secret.read_text())
    inst = data.get("installed") or data.get("web") or {}
    print("\n" + "=" * 68)
    print("Add these as GitHub repository secrets "
          "(Settings -> Secrets and variables -> Actions):\n")
    print(f"YT_CLIENT_ID     = {inst.get('client_id', '')}")
    print(f"YT_CLIENT_SECRET = {inst.get('client_secret', '')}")
    print(f"YT_REFRESH_TOKEN = {creds.refresh_token}")
    print("=" * 68)
    print("\nKeep these out of git. client_secret*.json is already gitignored.")


if __name__ == "__main__":
    main()
