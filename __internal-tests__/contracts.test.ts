import { ZodError } from 'zod';
import {
  DefectSchema,
  LessonEntrySchema,
  ThresholdConfigSchema,
} from '@qa/contracts';

describe('@qa/contracts — Zod schemas', () => {
  describe('DefectSchema', () => {
    const validDefect = {
      id: 'BG-AUTH-001',
      runId: 'RUN-001',
      title: 'Login fails with valid credentials on Safari',
      severity: 'high',
      status: 'open',
      stepsToReproduce: ['Open Safari', 'Navigate to /login', 'Enter valid creds', 'Click submit'],
      expectedResult: 'User is redirected to dashboard',
      actualResult: 'Error toast: "Invalid credentials"',
      environment: 'staging',
      createdAt: '2026-05-24T00:00:00.000Z',
    };

    it('parses a valid defect object successfully', () => {
      expect(() => DefectSchema.parse(validDefect)).not.toThrow();
    });

    it('throws ZodError when required field "title" is missing', () => {
      const { title, ...noTitle } = validDefect;
      expect(() => DefectSchema.parse(noTitle)).toThrow(ZodError);
    });

    it('throws ZodError when required field "severity" is missing', () => {
      const { severity, ...noSeverity } = validDefect;
      expect(() => DefectSchema.parse(noSeverity)).toThrow(ZodError);
    });

    it('throws ZodError for invalid severity code', () => {
      expect(() =>
        DefectSchema.parse({ ...validDefect, severity: 'catastrophic' })
      ).toThrow(ZodError);
    });

    it('throws ZodError for invalid status value', () => {
      expect(() =>
        DefectSchema.parse({ ...validDefect, status: 'deleted' })
      ).toThrow(ZodError);
    });
  });

  describe('LessonEntrySchema', () => {
    const validLesson = {
      id: 'LESSON-001',
      rootCause: 'Missing null check causes crash on empty response',
      correctiveRule: 'Always guard against null responses in API handlers',
      hitCount: 1,
      createdAt: '2026-05-24T00:00:00.000Z',
      lastHitAt: '2026-05-24T00:00:00.000Z',
    };

    it('parses a valid lesson entry successfully', () => {
      expect(() => LessonEntrySchema.parse(validLesson)).not.toThrow();
    });

    it('throws ZodError when correctiveRule does not start with uppercase', () => {
      expect(() =>
        LessonEntrySchema.parse({ ...validLesson, correctiveRule: 'always guard — lowercase start' })
      ).toThrow(ZodError);
    });

    it('throws ZodError when hitCount is negative', () => {
      expect(() =>
        LessonEntrySchema.parse({ ...validLesson, hitCount: -1 })
      ).toThrow(ZodError);
    });
  });

  describe('ThresholdConfigSchema', () => {
    const validThresholds = {
      passRate: { warn: 0.85, fail: 0.75 },
      defectDensity: { warn: 5, fail: 10 },
      blockerCount: { warn: 1, fail: 3 },
    };

    it('parses a valid threshold config successfully', () => {
      expect(() => ThresholdConfigSchema.parse(validThresholds)).not.toThrow();
    });

    it('throws ZodError when passRate.fail exceeds passRate.warn', () => {
      expect(() =>
        ThresholdConfigSchema.parse({
          ...validThresholds,
          passRate: { warn: 0.75, fail: 0.85 }, // fail > warn is invalid
        })
      ).toThrow(ZodError);
    });

    it('throws ZodError when threshold values are out of range (passRate > 1)', () => {
      expect(() =>
        ThresholdConfigSchema.parse({
          ...validThresholds,
          passRate: { warn: 1.5, fail: 0.75 },
        })
      ).toThrow(ZodError);
    });
  });
});
