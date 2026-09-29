#!/usr/bin/env bash
# Multi-process smoke test: claim cap enforcement + hash-chain integrity under concurrent appends.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEGIS="$REPO/apps/cli/dist/index.js"
if [ ! -f "$AEGIS" ]; then
  echo "FAIL: $AEGIS missing; build first: pnpm --filter './packages/@qa/**' --filter @aegis-qa/cli run build"
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0
fail() { echo "FAIL: $*"; FAIL=1; }

cp "$REPO/aegis.config.json" "$TMP/"
node -e '
const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.parallelism=c.parallelism||{};c.parallelism.maxSpecialists=2;fs.writeFileSync(p,JSON.stringify(c,null,2));' "$TMP/aegis.config.json"
cd "$TMP"

AEGIS_AGENT=owner node "$AEGIS" run create --env development --module AUTH >/dev/null
for t in T-A T-B T-C T-D; do
  AEGIS_AGENT=qa-test-executor node "$AEGIS" task add --id "$t" --title "task $t" >/dev/null
done

# 4 parallel claims by 4 specialists, cap = 2
agents=(qa-ui-specialist qa-api-specialist qa-database-specialist qa-security-specialist)
tasks=(T-A T-B T-C T-D)
pids=()
for i in 0 1 2 3; do
  ( set +e; AEGIS_AGENT="${agents[$i]}" node "$AEGIS" task claim --task "${tasks[$i]}" >"$TMP/claim$i.out" 2>"$TMP/claim$i.err"; echo $? >"$TMP/claim$i.rc" ) &
  pids+=($!)
done
wait "${pids[@]}"
ok=0; capped=0
for i in 0 1 2 3; do
  rc=$(cat "$TMP/claim$i.rc")
  echo "claim ${agents[$i]} rc=$rc $(cat "$TMP/claim$i.err" | head -c 200)"
  if [ "$rc" = 0 ]; then ok=$((ok+1))
  elif [ "$rc" = 2 ] && grep -q '"error":"cap-reached"' "$TMP/claim$i.err"; then capped=$((capped+1))
  fi
done
[ "$ok" = 2 ] && [ "$capped" = 2 ] || fail "claims: expected 2 ok + 2 cap-reached, got ok=$ok cap-reached=$capped"

# 5 parallel event appends
pids=()
for i in 1 2 3 4 5; do
  ( set +e; AEGIS_AGENT=qa-orchestrator node "$AEGIS" event append --type run.phase.started --json '{"phase":"scan"}' >"$TMP/ev$i.out" 2>"$TMP/ev$i.err"; echo $? >"$TMP/ev$i.rc" ) &
  pids+=($!)
done
wait "${pids[@]}"
for i in 1 2 3 4 5; do
  [ "$(cat "$TMP/ev$i.rc")" = 0 ] || fail "event append $i rc=$(cat "$TMP/ev$i.rc") $(cat "$TMP/ev$i.err")"
done

set +e
AEGIS_AGENT=owner node "$AEGIS" integrity verify >"$TMP/verify.out" 2>"$TMP/verify.err"
vrc=$?
set -e
cat "$TMP/verify.out"
[ "$vrc" = 0 ] || fail "integrity verify rc=$vrc $(cat "$TMP/verify.err")"
node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
if(r.ok!==true||r.chainedLines!==8||r.pendingTail!==false){console.error("bad report",JSON.stringify(r));process.exit(1)}' "$TMP/verify.out" \
  || fail "integrity report: expected ok=true chainedLines=8 pendingTail=false"

# exit-code contract (all refusals; none append to the log)
expect_refusal() { # <label> <code> <agent-or-empty> args...
  local label="$1" code="$2" agent="$3"; shift 3
  local rc=0
  if [ -n "$agent" ]; then err=$(AEGIS_AGENT="$agent" node "$AEGIS" "$@" 2>&1 >/dev/null) || rc=$?
  else err=$(env -u AEGIS_AGENT node "$AEGIS" "$@" 2>&1 >/dev/null) || rc=$?; fi
  echo "contract $label rc=$rc $err" | head -c 300; echo
  if [ "$rc" != 2 ] || ! grep -q "\"error\":\"$code\"" <<<"$err"; then fail "contract $label: expected exit 2 + $code"; fi
}
err=""
expect_refusal "owner-claim" caller-forbidden owner task claim --task T-A
expect_refusal "no-agent" caller-unknown "" run status
expect_refusal "undeclared-field" invalid-input qa-orchestrator event append --type run.phase.started --json '{"phase":"scan","phaes":"y"}'
grep -q "undeclared field" <<<"$err" || fail "contract undeclared-field: expected the bus refusal"
expect_refusal "forged-run-created" invalid-input qa-orchestrator event append --type run.created --json '{"profile":"full","environment":"development","modules":["AUTH"]}'
grep -q "recorded by the CLI" <<<"$err" || fail "contract forged-run-created: expected the reserved-type refusal"
expect_refusal "bad-module" invalid-input qa-test-designer id next --kind TC --module au-th
expect_refusal "claim-traversal" invalid-input qa-ui-specialist task claim --task ../evil

# overwrite detection: a log replaced by a hand-written line must not verify (and blocks the run)
RUN_ID="$(tr -d '[:space:]' < "$TMP/runs/.active")"
printf '%s\n' '{"type":"run.created","ts":"2026-09-29T00:00:00.000Z","runId":"'"$RUN_ID"'","profile":"full","environment":"development","modules":["AUTH"]}' \
  > "$TMP/runs/$RUN_ID/events.jsonl"
set +e
AEGIS_AGENT=owner node "$AEGIS" integrity verify >"$TMP/tamper.out" 2>"$TMP/tamper.err"
trc=$?
set -e
echo "overwrite verify rc=$trc $(head -c 300 "$TMP/tamper.out" | tr -d '\n')"
[ "$trc" = 2 ] || fail "overwrite: expected integrity verify exit 2, got $trc $(cat "$TMP/tamper.err")"
node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
if(r.ok!==false){console.error("bad report",JSON.stringify(r));process.exit(1)}' "$TMP/tamper.out" \
  || fail "overwrite: expected \"ok\": false"

if [ "$FAIL" = 0 ]; then echo "PASS"; else echo "FAIL"; exit 1; fi
