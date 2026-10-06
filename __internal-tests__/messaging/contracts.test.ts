import {
  AegisEventUnionSchema, DEFAULT_ENVIRONMENT_SPECIALISTS, MESSAGING_PROVIDERS, MessagingProfileSchema,
  SPECIALISTS, TEST_ROUTING, TargetProfileSchema, TestTechniqueSchema, routeTestCase,
} from '@qa/contracts';
import { CLI_RECORDED_TYPES } from '@qa/run-state';
import { PROFILE } from '../helpers/pipeline';

describe('messaging vocabulary (NEW-07)', () => {
  it('replaces the email specialist and technique', () => {
    expect(SPECIALISTS).not.toHaveProperty('email');
    expect(SPECIALISTS.messaging).toEqual({ agent: 'qa-messaging-specialist', mutates: true });
    expect(TestTechniqueSchema.options).toContain('Messaging');
    expect(TestTechniqueSchema.options).not.toContain('Email');
    expect(TEST_ROUTING.byTechnique).toMatchObject({ Messaging: 'qa-messaging-specialist' });
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Messaging'] })).toEqual(['qa-ui-specialist', 'qa-messaging-specialist']);
  });

  it('forbids messaging everywhere but development by default', () => {
    expect(DEFAULT_ENVIRONMENT_SPECIALISTS.production.forbiddenSpecialists).toContain('messaging');
    for (const env of ['testing', 'staging'] as const) {
      expect((DEFAULT_ENVIRONMENT_SPECIALISTS[env] as { forbiddenSpecialists?: readonly string[] }).forbiddenSpecialists).toEqual(['messaging']);
    }
    expect(DEFAULT_ENVIRONMENT_SPECIALISTS.development).not.toHaveProperty('forbiddenSpecialists');
  });

  it('the profile carries the messaging flag and provider names, strictly', () => {
    expect(MESSAGING_PROVIDERS).toEqual(['commshub', 'direct-mail', 'none']);
    expect(TargetProfileSchema.safeParse(PROFILE).success).toBe(true);
    expect(TargetProfileSchema.safeParse({ ...PROFILE, hasEmailFlows: false }).success).toBe(false);
    expect(MessagingProfileSchema.safeParse({ provider: 'commshub', baseUrlEnv: 'X_URL', tokenEnv: 'X_KEY' }).success).toBe(true);
    expect(MessagingProfileSchema.safeParse({ provider: 'mailgun', baseUrlEnv: null, tokenEnv: null }).success).toBe(false);
    expect(MessagingProfileSchema.safeParse({ provider: 'none', baseUrlEnv: null, tokenEnv: null, extra: 1 }).success).toBe(false);
  });

  it('declares the two messaging events; the CLI records the contract fetch itself', () => {
    const base = { ts: '2026-10-06T00:00:00.000Z', runId: 'RUN-20261006-001' };
    expect(AegisEventUnionSchema.safeParse({ ...base, type: 'messaging.contract-fetched', adapter: 'commshub', sha: 'abc' }).success).toBe(true);
    expect(AegisEventUnionSchema.safeParse({ ...base, type: 'messaging.live-preflight', adapter: 'commshub', simulated: true }).success).toBe(true);
    expect(CLI_RECORDED_TYPES.has('messaging.contract-fetched')).toBe(true);
    expect(CLI_RECORDED_TYPES.has('messaging.live-preflight')).toBe(false);
  });
});
