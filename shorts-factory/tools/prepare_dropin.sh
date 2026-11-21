#!/usr/bin/env bash
# Copy this project into a checkout of another repo, as a self-contained
# subdirectory, with the workflow rewritten to match.
#
#   ./tools/prepare_dropin.sh /path/to/their-repo-checkout [subdir]
#
# Everything lands in <repo>/<subdir>/ (default: shorts-factory) and the
# workflow at <repo>/.github/workflows/shorts-factory.yml. Nothing at their
# repo root is touched, so README.md, scripts/ and .gitignore cannot collide.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: prepare_dropin.sh /path/to/their-repo [subdir]}"
SUB="${2:-shorts-factory}"

[ -d "$TARGET/.git" ] || { echo "error: $TARGET is not a git checkout"; exit 1; }

echo "source : $HERE"
echo "target : $TARGET/$SUB"

rm -rf "${TARGET:?}/${SUB:?}"
mkdir -p "$TARGET/$SUB" "$TARGET/.github/workflows"

for item in README.md config.yaml requirements.txt run_local.sh .gitignore \
            scripts tools web state assets; do
  cp -R "$HERE/$item" "$TARGET/$SUB/"
done

# strip anything that is a local build artefact, not source
rm -rf "$TARGET/$SUB/scripts/__pycache__" "$TARGET/$SUB/build" "$TARGET/$SUB/.venv"
find "$TARGET/$SUB/web/data" -type f ! -name '.gitkeep' -delete 2>/dev/null || true
touch "$TARGET/$SUB/web/data/.gitkeep"

python3 - "$HERE/.github/workflows/shorts.yml" \
           "$TARGET/.github/workflows/shorts-factory.yml" "$SUB" <<'PY'
import pathlib, re, sys
src, dst, sub = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
s = src.read_text()

s = s.replace("name: Shorts factory\n", "name: Shorts factory (animated)\n")

# Manual-only in someone else's repo. A daily cron that uploads to their
# channel is not something to switch on for them — they enable it when ready.
s = re.sub(
    r"\n  schedule:\n(?:(?:    #[^\n]*|    - cron:[^\n]*)\n)+",
    "\n  # Manual only until you choose otherwise. Uncomment to run daily;\n"
    "  # GitHub's scheduler can fire 10-30 minutes late, so keep it to ~2/day.\n"
    "  # schedule:\n"
    "  #   - cron: \"0 13 * * *\"\n",
    s, count=1)
assert "# schedule:" in s, "could not disable the cron"

# every `run:` step executes inside the subdirectory
s = s.replace("permissions:\n  contents: write",
              f"defaults:\n  run:\n    working-directory: {sub}\n\npermissions:\n  contents: write")

# `uses:` steps ignore working-directory, so their paths must be explicit
s = s.replace('          python-version: "3.11"\n          cache: pip',
              f'          python-version: "3.11"\n          cache: pip\n'
              f'          cache-dependency-path: {sub}/requirements.txt')
s = s.replace("hashFiles('config.yaml')", f"hashFiles('{sub}/config.yaml')")
for p in ("build/final.mp4", "build/script.json", "build/review/sheet.jpg"):
    s = s.replace(f"            {p}", f"            {sub}/{p}")
s = s.replace("-- state/used_topics.json", f"-- {sub}/state/used_topics.json")
s = s.replace("git add state/used_topics.json", f"git add {sub}/state/used_topics.json")

dst.write_text(s)
PY

echo
echo "done. review and commit:"
echo "  cd $TARGET"
echo "  git switch -c add-animated-shorts-factory"
echo "  git add $SUB .github/workflows/shorts-factory.yml"
echo "  git commit -m 'Add animated shorts-factory pipeline'"
echo "  git push -u origin add-animated-shorts-factory"
