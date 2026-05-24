import { STAKEHOLDER_FORBIDDEN_PATTERNS, checkBrandExposure } from '@qa/contracts';

describe('@qa/contracts — brand exposure rules', () => {
  describe('STAKEHOLDER_FORBIDDEN_PATTERNS', () => {
    it('is defined and is an array', () => {
      expect(Array.isArray(STAKEHOLDER_FORBIDDEN_PATTERNS)).toBe(true);
      expect(STAKEHOLDER_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
    });

    it('includes a pattern that matches "aegis"', () => {
      const matchesAegis = STAKEHOLDER_FORBIDDEN_PATTERNS.some((pattern: RegExp | string) => {
        if (pattern instanceof RegExp) return pattern.test('aegis');
        return new RegExp(pattern, 'i').test('aegis');
      });
      expect(matchesAegis).toBe(true);
    });

    it('includes a pattern that matches "Aegis" (case-insensitive)', () => {
      const matchesAegis = STAKEHOLDER_FORBIDDEN_PATTERNS.some((pattern: RegExp | string) => {
        if (pattern instanceof RegExp) return pattern.test('Aegis');
        return new RegExp(pattern, 'i').test('Aegis');
      });
      expect(matchesAegis).toBe(true);
    });
  });

  describe('checkBrandExposure()', () => {
    it('fails the brand check when defect JSON contains "aegis"', () => {
      const defect = {
        id: 'BG-001',
        title: 'Bug found by aegis automated scanner',
        description: 'The aegis framework detected an issue',
        severity: 'medium',
      };
      const result = checkBrandExposure(defect);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('fails the brand check when brand string appears in nested fields', () => {
      const defect = {
        id: 'BG-002',
        title: 'UI regression',
        description: 'Normal description',
        metadata: { source: 'Aegis QA Framework' },
      };
      const result = checkBrandExposure(defect);
      expect(result.passed).toBe(false);
    });

    it('passes the brand check for a defect JSON without brand strings', () => {
      const defect = {
        id: 'BG-003',
        title: 'Login button unresponsive on mobile',
        description: 'Tapping the login button on iOS 17 has no effect',
        severity: 'high',
        steps: ['Open app', 'Navigate to login', 'Tap login button'],
      };
      const result = checkBrandExposure(defect);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
