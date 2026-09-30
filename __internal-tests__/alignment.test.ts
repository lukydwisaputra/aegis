import * as path from 'path';
import { checkAlignment, formatReport } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');

const RULES = [
  'How to resolve (baseline: __internal-tests__/alignment/baseline.yaml; matrix: docs/superpowers/specs/*-audit-remediation-matrix.md):',
  '  1. "+ add or fix": fix the new violation in the prose first (then its contract block). Baselining a new key is allowed',
  '     only for an open or in-spec matrix item; give it that ID and call the new entry out in the PR description.',
  '  2. "- delete": a stale entry may be deleted only in the same commit as the prose/code change that fixed it.',
  '     Never edit a contract block alone to make an entry stale.',
  '  3. "x closed-id" / "? unknown id": the entry names a fixed/wontfix or missing matrix ID; fix the violation or re-own it.',
  '  Inspect: pnpm aegis align --rule <RULE>   (or: pnpm aegis align --json)',
].join('\n');

it('agent/skill/contract/doc alignment matches the ratchet baseline', () => {
  const report = checkAlignment(ROOT);
  if (!report.ratchet.ok) throw new Error('\n' + formatReport(report) + '\n\n' + RULES);
  expect(report.ratchet.ok).toBe(true);
});
