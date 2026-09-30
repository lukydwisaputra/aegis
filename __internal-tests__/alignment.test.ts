import * as path from 'path';
import { checkAlignment, formatReport } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');

it('agent/skill/contract/doc alignment matches the ratchet baseline', () => {
  const report = checkAlignment(ROOT);
  if (!report.ratchet.ok) throw new Error('\n' + formatReport(report) + '\n\nUpdate __internal-tests__/alignment/baseline.yaml (delete fixed keys; new violations must be fixed, not baselined, unless they belong to an open matrix item).');
  expect(report.ratchet.ok).toBe(true);
});
