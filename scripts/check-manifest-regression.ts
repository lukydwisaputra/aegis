/**
 * Compare a pre-regeneration manifest snapshot against the freshly generated one
 * and fail if any run's published metric regressed.
 *
 * Why this exists: gen-index resolves metrics from whichever shape a run's closure
 * document happens to use, and renders an unresolvable field as an em dash rather
 * than throwing. That degradation is deliberate — a new run with an unrecognized
 * shape should still be indexable — but it makes a schema mismatch look exactly
 * like "this run has no data". Because export-run.sh regenerates, commits, and
 * pushes in one unattended pass, a mismatch would silently replace real numbers
 * with dashes on the shared remote and still exit 0.
 *
 * A regression is: a field that held a concrete value now holds the dash. New runs
 * appearing, dashes filling in with real values, and numerically-equal
 * reformatting (100.0 -> 100) are all fine.
 *
 * Usage: tsx scripts/check-manifest-regression.ts --before=<snapshot.json> --after=<manifest.json>
 * Exit 0 = no regression. Exit 1 = regression, with a per-field report on stderr.
 */
import { readFileSync } from 'node:fs';

const DASH = '—';
const FIELDS = ['passed', 'failed', 'blocked', 'passRate', 'defects'] as const;

type Row = Record<string, string>;

function argVal(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

/** Index rows by project+runId so added/removed runs don't shift the comparison. */
function indexRows(manifestPath: string): Map<string, Row> {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const out = new Map<string, Row>();
  for (const p of raw.projects ?? []) {
    for (const r of p.runs ?? []) out.set(`${p.name}/${r.runId}`, r);
  }
  return out;
}

/** Treat "100.0" and "100" as equal — JSON.parse cannot preserve a trailing zero. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

const beforePath = argVal('--before');
const afterPath = argVal('--after');
if (!beforePath || !afterPath) {
  console.error('check-manifest-regression: --before=<file> and --after=<file> required');
  process.exit(2);
}

// A missing/unparseable snapshot means there is no prior state to protect (first
// export into a fresh collector). Pass rather than block.
let before: Map<string, Row>;
try {
  before = indexRows(beforePath);
} catch {
  console.log('check-manifest-regression: no readable prior manifest — nothing to compare');
  process.exit(0);
}

const after = indexRows(afterPath);
const regressions: string[] = [];
const dropped: string[] = [];

for (const [key, oldRow] of before) {
  const newRow = after.get(key);
  if (!newRow) {
    dropped.push(`  ${key}: row disappeared from the manifest`);
    continue;
  }
  for (const f of FIELDS) {
    const oldVal = String(oldRow[f] ?? DASH);
    const newVal = String(newRow[f] ?? DASH);
    if (sameValue(oldVal, newVal)) continue;
    if (oldVal !== DASH && newVal === DASH) {
      regressions.push(`  ${key} ${f}: ${oldVal} -> ${DASH} (value lost)`);
    } else if (oldVal !== DASH) {
      // Both concrete but different. Could be a legitimate re-triage or a resolver
      // reading a different field than the one that was published. Not provable
      // here, so report it and let a human decide.
      regressions.push(`  ${key} ${f}: ${oldVal} -> ${newVal} (value changed)`);
    }
  }
}

if (dropped.length || regressions.length) {
  console.error('check-manifest-regression: refusing to publish — the regenerated manifest loses data.\n');
  if (dropped.length) console.error('Rows dropped:\n' + dropped.join('\n') + '\n');
  if (regressions.length) console.error('Fields changed or lost:\n' + regressions.join('\n') + '\n');
  console.error(
    'A "value lost" line means gen-index could not resolve that run\'s closure shape.\n' +
      'Add a resolver in scripts/gen-index.ts (see resolveMetrics) so the field reads\n' +
      'from the shape that run actually uses. A "value changed" line needs a human to\n' +
      'confirm which reading is correct before publishing.\n\n' +
      'The run files are already copied; only the index publish was stopped. Re-run the\n' +
      'export once resolved, or commit by hand if the change is intended.',
  );
  process.exit(1);
}

console.log(`check-manifest-regression: OK (${before.size} prior row(s) preserved, ${after.size} total)`);
