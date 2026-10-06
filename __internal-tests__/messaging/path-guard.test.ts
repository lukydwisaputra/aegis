import { roleOf, roleWritable } from '@qa/path-guard';

const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261006-001' };
describe('messaging roles (NEW-07)', () => {
  it('the specialist writes its specs, not the vendored helper or the CLI-written run files', () => {
    expect(roleOf('qa-email-specialist')).toBeUndefined();
    expect(roleOf('qa-messaging-specialist')).toMatchObject({ kind: 'specialist', spv: 'qa-messaging-specialist-spv', mutatesEnvIn: 'any' });
    expect(roleOf('qa-messaging-specialist-spv')).toMatchObject({ kind: 'spv', writes: [] });
    expect(roleWritable('qa-messaging-specialist', '/r/tests/qa/messaging/otp.messaging.spec.ts', p)).toBe(true);
    expect(roleWritable('qa-messaging-specialist', '/r/tests/qa/support/messaging.ts', p)).toBe(false);
    expect(roleWritable('qa-messaging-specialist', '/r/aegis/runs/RUN-20261006-001/messaging/plan.json', p)).toBe(false);
  });
});
