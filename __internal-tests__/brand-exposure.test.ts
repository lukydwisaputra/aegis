import { STAKEHOLDER_FORBIDDEN_PATTERNS, checkBrandExposure } from '@qa/contracts';

describe('@qa/contracts — brand exposure', () => {
  describe('STAKEHOLDER_FORBIDDEN_PATTERNS', () => {
    it('is a non-empty array of RegExp', () => {
      expect(Array.isArray(STAKEHOLDER_FORBIDDEN_PATTERNS)).toBe(true);
      expect(STAKEHOLDER_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
      STAKEHOLDER_FORBIDDEN_PATTERNS.forEach((p) => expect(p).toBeInstanceOf(RegExp));
    });

    it('includes a pattern matching "aegis" case-insensitively', () => {
      const hits = STAKEHOLDER_FORBIDDEN_PATTERNS.filter((p) => p.test('Aegis') || p.test('aegis'));
      expect(hits.length).toBeGreaterThan(0);
    });
  });

  describe('checkBrandExposure()', () => {
    it('returns null for clean stakeholder text', () => {
      expect(checkBrandExposure('The QA team found 3 defects in the login flow.')).toBeNull();
    });

    it('returns a RegExp when "aegis" appears in text', () => {
      expect(checkBrandExposure('Bug found by aegis automated scanner')).toBeInstanceOf(RegExp);
    });

    it('returns a RegExp when an internal agent name appears', () => {
      expect(checkBrandExposure('Reviewed by qa-orchestrator')).toBeInstanceOf(RegExp);
      expect(checkBrandExposure('Written by qa-test-designer')).toBeInstanceOf(RegExp);
    });

    it('returns a RegExp when events.jsonl is referenced', () => {
      expect(checkBrandExposure('See events.jsonl for details')).toBeInstanceOf(RegExp);
    });

    it('returns a RegExp when agent-memory path is referenced', () => {
      expect(checkBrandExposure('Stored in agent-memory/qa-planner/lessons.json')).toBeInstanceOf(RegExp);
    });

    it('returns null for text that contains "QA team" but no forbidden strings', () => {
      expect(checkBrandExposure('Reported by the QA team on 2026-05-25.')).toBeNull();
    });
  });
});
