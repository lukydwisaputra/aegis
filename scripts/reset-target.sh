#!/usr/bin/env bash
# Reset Aegis to point at a new target project.
#
# - Archives agent-memory/qa-*/lessons.json under archive/{old-project}-{timestamp}/
#   (via `git mv` when run inside a git repo, so the rename is staged rather than
#   left as an untracked delete+add).
# - Clears .aegis generated state (.counters.json, phase-*.md). Keeps pdf-text-cache.
# - Keeps knowledge/ and books/ (target-agnostic).
# - Updates aegis.config.json fields via jq.
# - Does NOT touch .claude/, .mcp.json, package.json, tsconfig.*, or framework code.
# - If run inside a git repo (and not --dry-run), commits exactly what it touched
#   (agent-memory/, the config backup, aegis.config.json) — scoped, never `-A`, so
#   any other in-progress changes in the tree are left untouched and uncommitted.
#
# Usage:
#   scripts/reset-target.sh \
#     --project-name "New Project" \
#     --dev-url "http://localhost:3000" \
#     --staging-url "https://stg.new.example.com" \
#     --prod-url "https://new.example.com" \
#     [--platform nextjs] \
#     [--entry-points /,/login,/dashboard] \
#     [--roles admin,user] \
#     [--target-root ..] \
#     [--tests-dir ../tests/qa] \
#     [--source-dirs ../apps,../packages,../services,../src] \
#     [--dry-run]
#
# Required: --project-name, --dev-url, --staging-url, --prod-url

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
PROJECT_NAME=""
DEV_URL=""
STAGING_URL=""
PROD_URL=""
PLATFORM="generic"
ENTRY_POINTS="/,/login,/dashboard"
ROLES="admin,user"
TARGET_ROOT=".."
TESTS_DIR="../tests/qa"
SOURCE_DIRS="../apps,../packages,../services,../src"
DRY_RUN=0

# ─── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name)   PROJECT_NAME="$2"; shift 2 ;;
    --dev-url)        DEV_URL="$2"; shift 2 ;;
    --staging-url)    STAGING_URL="$2"; shift 2 ;;
    --prod-url)       PROD_URL="$2"; shift 2 ;;
    --platform)       PLATFORM="$2"; shift 2 ;;
    --entry-points)   ENTRY_POINTS="$2"; shift 2 ;;
    --roles)          ROLES="$2"; shift 2 ;;
    --target-root)    TARGET_ROOT="$2"; shift 2 ;;
    --tests-dir)      TESTS_DIR="$2"; shift 2 ;;
    --source-dirs)    SOURCE_DIRS="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

for v in PROJECT_NAME DEV_URL STAGING_URL PROD_URL; do
  if [[ -z "${!v}" ]]; then
    echo "Error: --${v,,} is required (use ${v//_/-} in lowercase)" >&2
    echo "Run with --help for usage." >&2
    exit 2
  fi
done

# Locate repo root (script lives in scripts/)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONFIG="aegis.config.json"
if [[ ! -f "$CONFIG" ]]; then
  echo "Error: $CONFIG not found in $ROOT" >&2
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required" >&2; exit 1; }

# Detect whether ROOT is (in) a git work tree. Steps 1 and 3 use this to decide
# between `git mv`/`git add` (visible to git immediately, as a rename/change
# rather than a delete+add) and plain mv/cp (outside a repo, or --dry-run).
IN_GIT_REPO=0
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 && IN_GIT_REPO=1

# Resolve old project name from current config for archive label
OLD_PROJECT=$(jq -r '.dashboard.projectName // "unknown"' "$CONFIG" | tr ' /' '__')
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
ARCHIVE_DIR="agent-memory/archive/${OLD_PROJECT}-${TIMESTAMP}"

# Convert comma-lists to JSON arrays
to_json_array() {
  local IFS=','
  read -ra parts <<< "$1"
  printf '%s\n' "${parts[@]}" | jq -R . | jq -s .
}
ENTRY_POINTS_JSON=$(to_json_array "$ENTRY_POINTS")
ROLES_JSON=$(to_json_array "$ROLES")
SOURCE_DIRS_JSON=$(to_json_array "$SOURCE_DIRS")

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

# Move a tracked file. Inside a git repo this stages the move as a rename
# (`git mv`) instead of leaving a plain filesystem `mv` for git to notice later
# as an unstaged delete+add — the gap that let a prior reset run go uncommitted
# for days with 39 files showing as deleted.
move() {
  local src="$1" dest="$2"
  if [[ $IN_GIT_REPO -eq 1 ]]; then
    run "git -C \"$ROOT\" mv \"$src\" \"$dest\""
  else
    run "mv \"$src\" \"$dest\""
  fi
}

echo "──────────────────────────────────────────────────────────────"
echo " Aegis target reset"
echo "──────────────────────────────────────────────────────────────"
echo " Old project (from config) : $OLD_PROJECT"
echo " New project name          : $PROJECT_NAME"
echo " Platform                  : $PLATFORM"
echo " Target root               : $TARGET_ROOT"
echo " Tests dir                 : $TESTS_DIR"
echo " Source dirs               : $SOURCE_DIRS"
echo " Dev URL                   : $DEV_URL"
echo " Staging URL               : $STAGING_URL"
echo " Prod URL                  : $PROD_URL"
echo " Entry points              : $ENTRY_POINTS"
echo " Roles                     : $ROLES"
echo " Archive dir               : $ARCHIVE_DIR"
[[ $DRY_RUN -eq 1 ]] && echo " MODE                      : DRY RUN (no changes)"
echo "──────────────────────────────────────────────────────────────"
echo

# ─── 1. Archive agent-memory lessons.json ────────────────────────────────────
echo "[1/4] Archiving agent-memory lessons.json …"
LESSON_FILES=$(find agent-memory -mindepth 2 -maxdepth 2 -name 'lessons.json' -not -path 'agent-memory/archive/*' 2>/dev/null || true)
if [[ -n "$LESSON_FILES" ]]; then
  run "mkdir -p \"$ARCHIVE_DIR\""
  while IFS= read -r f; do
    rel="${f#agent-memory/}"
    dest_dir="$ARCHIVE_DIR/$(dirname "$rel")"
    run "mkdir -p \"$dest_dir\""
    move "$f" "$dest_dir/"
  done <<< "$LESSON_FILES"
  echo "  archived $(echo "$LESSON_FILES" | wc -l | tr -d ' ') lesson file(s)"
else
  echo "  no lessons.json files to archive"
fi
echo

# ─── 2. Clear .aegis generated state (keep pdf-text-cache) ───────────────────
echo "[2/4] Clearing .aegis generated state …"
if [[ -f .aegis/.counters.json ]]; then
  run "rm -f .aegis/.counters.json"
  echo "  removed .aegis/.counters.json"
fi
for f in .aegis/phase-*.md .aegis/target-profile.json; do
  [[ -f "$f" ]] || continue
  run "rm -f \"$f\""
  echo "  removed $f"
done
echo "  kept .aegis/pdf-text-cache/ (book ingestion cache)"
echo

# ─── 3. Update aegis.config.json ─────────────────────────────────────────────
echo "[3/4] Updating $CONFIG …"
BACKUP="${CONFIG}.bak.${TIMESTAMP}"
run "cp \"$CONFIG\" \"$BACKUP\""
echo "  backup written to $BACKUP"

if [[ $DRY_RUN -eq 0 ]]; then
  tmp=$(mktemp)
  jq \
    --arg targetRoot   "$TARGET_ROOT" \
    --arg testsDir     "$TESTS_DIR" \
    --argjson srcDirs  "$SOURCE_DIRS_JSON" \
    --arg platform     "$PLATFORM" \
    --arg devUrl       "$DEV_URL" \
    --arg stagingUrl   "$STAGING_URL" \
    --arg prodUrl      "$PROD_URL" \
    --argjson entries  "$ENTRY_POINTS_JSON" \
    --argjson roles    "$ROLES_JSON" \
    --arg projectName  "$PROJECT_NAME" \
    '
    .targetProjectRoot              = $targetRoot
    | .testsDir                     = $testsDir
    | .sourceDirs                   = $srcDirs
    | .target.platform              = $platform
    | .target.apps                  = []
    | .environments.development.url = $devUrl
    | .environments.staging.url     = $stagingUrl
    | .environments.production.url  = $prodUrl
    | .discovery.entryPoints        = $entries
    | .discovery.rolesToExplore     = $roles
    | .dashboard.projectName        = $projectName
    ' "$CONFIG" > "$tmp"
  mv "$tmp" "$CONFIG"
  echo "  config updated"
else
  echo "  [dry-run] would update fields: targetProjectRoot, testsDir, sourceDirs,"
  echo "           target.platform, target.apps, environments.{development,staging,production}.url,"
  echo "           discovery.entryPoints, discovery.rolesToExplore, dashboard.projectName"
fi
echo

# ─── 4. Commit the reset ──────────────────────────────────────────────────────
echo "[4/4] Committing the reset …"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "  [dry-run] would stage and commit: agent-memory/, $BACKUP, $CONFIG"
elif [[ $IN_GIT_REPO -eq 0 ]]; then
  echo "  not a git repo — skipping commit"
else
  # Scoped add: only what this script touches. Never -A — a user mid-edit on
  # something else must not have unrelated work swept into this commit.
  run "git -C \"$ROOT\" add agent-memory/ \"$BACKUP\" \"$CONFIG\""
  if git -C "$ROOT" diff --cached --quiet -- agent-memory/ "$BACKUP" "$CONFIG" 2>/dev/null; then
    echo "  nothing to commit (already clean)"
  else
    COMMIT_MSG="chore(reset-target): archive $OLD_PROJECT -> $PROJECT_NAME"
    # Don't let a commit failure (no configured git identity, a rejecting hook)
    # abort the script via set -e — the archive and config rewrite already
    # happened on disk either way, and the user needs the summary + next steps
    # printed regardless. The change is left staged for them to commit by hand.
    if git -C "$ROOT" commit -q -m "$COMMIT_MSG" 2>/tmp/reset-target-commit-err.$$; then
      echo "  committed: $COMMIT_MSG"
    else
      echo "  WARNING: commit failed — changes are staged but not committed:" >&2
      sed 's/^/    /' /tmp/reset-target-commit-err.$$ >&2
      echo "  run 'git commit -m \"$COMMIT_MSG\"' by hand once resolved" >&2
    fi
    rm -f /tmp/reset-target-commit-err.$$
  fi
  UNSTAGED_COUNT=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$UNSTAGED_COUNT" -gt 0 ]]; then
    echo "  note: $UNSTAGED_COUNT other change(s) remain in the working tree, left untouched"
  fi
fi
echo

# ─── Summary + next steps ─────────────────────────────────────────────────────
echo "Reminder: targetProjectRoot must point at ONE app repo, not a parent folder of many."
echo
echo "Next steps:"
echo "  1. Update secrets/*.env.* and test-data/credentials/*.env.local for the new target."
echo "  2. Run: pnpm qa-doctor   # interactive env check"
echo "  3. Run: pnpm qa-health   # confirm clean state"
[[ $IN_GIT_REPO -eq 1 && $DRY_RUN -eq 0 ]] && echo "  4. Run: git log -1 --stat   # review what was just committed"
echo
echo "To revert config only: mv $BACKUP $CONFIG"
