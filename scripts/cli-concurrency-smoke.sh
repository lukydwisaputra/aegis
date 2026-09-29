#!/usr/bin/env bash
# Multi-process smoke test: claim cap enforcement + hash-chain integrity under concurrent appends.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEGIS="$REPO/apps/cli/dist/index.js"
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
grep -q '"ok": true' "$TMP/verify.out" || fail "integrity ok != true"
grep -q '"chainedLines": 8' "$TMP/verify.out" || fail "chainedLines != 8"
if grep -q 'pendingTail' "$TMP/verify.out" && ! grep -q '"pendingTail": false' "$TMP/verify.out"; then fail "pendingTail present"; fi

if [ "$FAIL" = 0 ]; then echo "PASS"; else echo "FAIL"; exit 1; fi
