import { parse } from 'yaml';
import * as fs from 'fs';
import * as path from 'path';

// Run-path fixes, task 1 (AUD-057 partial, AUD-090): the environment source and the performance thresholds path.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

const SPECIALIST = '.claude/agents/tier2-specialist/qa-performance-specialist.md';
const SPV = '.claude/agents/spv/qa-performance-specialist-spv.md';

describe('qa-start environment source', () => {
  const skill = read('.claude/skills/qa-start/SKILL.md');
  it('no longer names config/environments.yaml', () => {
    expect(skill).not.toContain('config/environments.yaml');
  });
  it('resolves the environment from aegis.config.json#environments', () => {
    expect(skill).toContain('aegis.config.json#environments');
    expect(skill).toMatch(/mutating/);
    expect(skill).toMatch(/allowedSpecialists/);
  });
});

describe('performance thresholds path', () => {
  const thresholds = parse(read('thresholds.yaml')) as Record<string, any>;
  const cfg = JSON.parse(read('aegis.config.json'));

  it('specialist and SPV name the same path, with no gates. prefix', () => {
    for (const f of [SPECIALIST, SPV]) {
      const text = read(f);
      expect(text).not.toMatch(/thresholds\.yaml[#.]gates\./);
      expect(text).toMatch(/thresholds\.yaml#\{(env|stage)\}\.performance/);
    }
  });

  it('every configured environment that runs performance has a parsed block', () => {
    expect(thresholds.development.performance).toBeDefined();
    for (const env of ['testing', 'staging', 'production']) expect(thresholds[env].performance).toBeDefined();
    expect(Object.keys(cfg.environments)).toContain('development');
  });

  it('development.performance has every key the other environments define', () => {
    const keys = Object.keys(thresholds.testing.performance).sort();
    expect(Object.keys(thresholds.development.performance).sort()).toEqual(keys);
    for (const k of keys) expect(typeof thresholds.development.performance[k]).toBe('number');
  });
});
