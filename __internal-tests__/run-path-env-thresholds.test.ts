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

  it('C3: development is configured with a url, a mutating flag and its allowed specialists', () => {
    const dev = cfg.environments.development;
    expect(typeof dev.url).toBe('string');
    expect(typeof dev.mutating).toBe('boolean');
    expect(Array.isArray(dev.allowedSpecialists)).toBe(true);
  });

  it('C3: specialist and SPV use the {env} placeholder (never {stage}) and no gates.{ path', () => {
    for (const f of [SPECIALIST, SPV]) {
      const text = read(f);
      expect(text).toMatch(/thresholds\.yaml#\{env\}\.performance/);
      expect(text).toMatch(/thresholds\.yaml#\{env\}\.load/);
      expect(text).not.toContain('{stage}');
      expect(text).not.toMatch(/\bgates\.\{/);
    }
  });

  it('C1: k6 thresholds come from {env}.load, Lighthouse and web vitals from {env}.performance', () => {
    const spec = read(SPECIALIST);
    expect(spec).toMatch(/k6[^\n]*thresholds\.yaml#\{env\}\.load/);
    expect(spec).not.toMatch(/k6[^\n]*thresholds\.yaml#\{env\}\.performance/);
    expect(read(SPV)).toMatch(/k6[^\n]*`thresholds\.yaml#\{env\}\.load`/);
  });

  it('C1: development and testing define load with the same keys as staging', () => {
    const keys = Object.keys(thresholds.staging.load).sort();
    for (const env of ['development', 'testing']) {
      expect(thresholds[env].load).toBeDefined();
      expect(Object.keys(thresholds[env].load).sort()).toEqual(keys);
    }
  });

  it('C2/C3: no non-positive threshold in development; the Lighthouse score is 50 for an unbundled dev build', () => {
    const walk = (v: unknown, at: string): string[] =>
      typeof v === 'number' ? (v > 0 ? [] : [at]) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => walk(x, `${at}.${k}`)) : [];
    expect(walk(thresholds.development, 'development')).toEqual([]);
    expect(thresholds.development.performance.score).toBe(50);
    expect(read('thresholds.yaml')).toMatch(/score:\s+50\s+#[^\n]*measured against an unbundled dev build/);
  });

  it('C4: the specialist contract reads environments.{env}.mutating, not the absent readOnly key', () => {
    const spec = read(SPECIALIST);
    expect(spec).not.toMatch(/readOnly/);
    expect(spec).toContain('aegis.config.json#environments.{env}.mutating');
  });

  it('development.performance has every key the other environments define', () => {
    const keys = Object.keys(thresholds.testing.performance).sort();
    expect(Object.keys(thresholds.development.performance).sort()).toEqual(keys);
    for (const k of keys) expect(typeof thresholds.development.performance[k]).toBe('number');
  });
});
