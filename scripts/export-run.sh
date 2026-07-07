#!/usr/bin/env bash
# Export QA run(s) into the collector repo (testing-reports) and regenerate its index.
#
# Copies a run folder verbatim into projects/<name>/runs/<runId>/, regenerates
# the markdown index + manifest, then git commit + push.
#
# Usage:
#   scripts/export-run.sh --project <name> --run RUN-YYYYMMDD-NNN
#   scripts/export-run.sh --project <name> --source /path/to/aegis/runs --all
#   scripts/export-run.sh --project <name> --run RUN-... --target /path/to/collector --no-push
#
# Flags:
#   --project <name>   Collector sub-folder under projects/ (required)
#   --run <RUN-ID>     Export a single run (mutually exclusive with --all)
#   --all              Export every RUN-* in --source (backfill)
#   --source <dir>     Runs dir to read from (default: ./runs)
#   --target <dir>     Collector repo path (default: aegis.config.json#collector.path)
#   --no-push          Commit locally, skip git push
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEGIS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$AEGIS_ROOT/aegis.config.json"

PROJECT="" RUN="" ALL=0 SOURCE="" TARGET="" PUSH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --run) RUN="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --no-push) PUSH=0; shift ;;
    *) echo "export-run: unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PROJECT" ]] || { echo "export-run: --project <name> required" >&2; exit 1; }
[[ "$PROJECT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "export-run: --project must be a simple name (no / or ..)" >&2; exit 1; }
if [[ "$ALL" -eq 1 && -n "$RUN" ]] || [[ "$ALL" -eq 0 && -z "$RUN" ]]; then
  echo "export-run: provide exactly one of --run or --all" >&2; exit 1
fi
if [[ -n "$RUN" ]]; then
  [[ "$RUN" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "export-run: --run must be a simple name (no / or ..)" >&2; exit 1; }
fi

SOURCE="${SOURCE:-$AEGIS_ROOT/runs}"
if [[ -z "$TARGET" ]]; then
  TARGET="$(jq -r '.collector.path // empty' "$CONFIG")"
  [[ -n "$TARGET" ]] || { echo "export-run: collector.path missing in config and no --target" >&2; exit 1; }
fi
REMOTE="$(jq -r '.collector.remote // empty' "$CONFIG")"

# Init collector repo if needed.
if [[ ! -d "$TARGET/.git" ]]; then
  echo "export-run: initializing collector repo at $TARGET"
  mkdir -p "$TARGET"
  git -C "$TARGET" init -q
  [[ -n "$REMOTE" ]] && git -C "$TARGET" remote add origin "$REMOTE"
  printf '.DS_Store\nThumbs.db\n' > "$TARGET/.gitignore"
fi

# Build the list of runs to copy.
RUNS=()
if [[ "$ALL" -eq 1 ]]; then
  while IFS= read -r d; do RUNS+=("$d"); done < <(find "$SOURCE" -maxdepth 1 -type d -name 'RUN-*' | sort)
  [[ "${#RUNS[@]}" -gt 0 ]] || { echo "export-run: no RUN-* dirs under $SOURCE" >&2; exit 1; }
else
  RUNS=("$SOURCE/$RUN")
fi

copied=0
for src in "${RUNS[@]}"; do
  id="$(basename "$src")"
  if [[ ! -d "$src" ]]; then
    echo "WARN: $id source directory not found, skipping" >&2; continue
  fi
  if [[ ! -f "$src/run.json" ]]; then
    echo "WARN: $id has no run.json, skipping" >&2; continue
  fi
  dest="$TARGET/projects/$PROJECT/runs/$id"
  if [[ -d "$dest" ]]; then echo "WARN: overwriting $id"; rm -rf "$dest"; fi
  mkdir -p "$dest"
  rsync -a --delete "$src/" "$dest/"
  copied=$((copied + 1))
  echo "export-run: copied $PROJECT/$id"
done
[[ "$copied" -gt 0 ]] || { echo "export-run: nothing copied" >&2; exit 1; }

# Regenerate index.
( cd "$AEGIS_ROOT" && npx --no-install tsx scripts/gen-index.ts --target="$TARGET" )

# Commit + push.
git -C "$TARGET" add -A
if [[ "$ALL" -eq 1 ]]; then
  msg="chore(collector): backfill $PROJECT ($copied runs)"
else
  msg="chore(collector): export $PROJECT/$RUN"
fi
git -C "$TARGET" commit -q -m "$msg" || echo "export-run: nothing to commit"
if [[ "$PUSH" -eq 1 && -n "$REMOTE" ]]; then
  git -C "$TARGET" push -u origin HEAD
else
  echo "export-run: skipped push"
fi
echo "export-run: done ($copied run(s))"
