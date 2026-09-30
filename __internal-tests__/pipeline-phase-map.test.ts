import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { GATE_AFTER, PHASE_IDS } from '@qa/contracts';

const pipeline = parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'pipeline.yaml'), 'utf8')) as {
  phases: { id: string; gateAfter?: string }[];
  sources: { cli: string[] };
};

it('pipeline.yaml phases and gate positions mirror the canonical map (spec §3.1, §3.2)', () => {
  expect(pipeline.phases.map((p) => p.id)).toEqual([...PHASE_IDS]);
  expect(Object.fromEntries(pipeline.phases.filter((p) => p.gateAfter).map((p) => [p.gateAfter!, p.id]))).toEqual(GATE_AFTER);
  expect(pipeline.sources.cli).toEqual(expect.arrayContaining(['{run}/gates/**', '{run}/intake/**']));
});
