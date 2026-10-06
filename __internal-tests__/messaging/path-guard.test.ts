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

describe('dynamic Bash targets and the messaging CLI-only directory (PR #18 item 5)', () => {
  const { decide } = require('@qa/path-guard');
  const ROOT = '/r/aegis';
  const RUN = 'RUN-20261006-001';
  const ctx = {
    aegisRoot: ROOT, targetRoot: '/r', testsDir: '/r/tests/qa', runDir: `${ROOT}/runs/${RUN}`, activeRunId: RUN,
    environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
  };
  const bash = (command: string) =>
    ({ tool_name: 'Bash', tool_input: { command }, cwd: ROOT, agent_type: 'qa-messaging-specialist', agent_id: 'a1' });

  it("the specialist's own {testsDir}/messaging/ spec through a variable is not taken for a CLI-only run file", () => {
    const r = decide(bash('cat > "$QA_TESTS/messaging/x.messaging.spec.ts" <<\'EOF\'\ntest()\nEOF'), ctx, {});
    expect(r.reason ?? '').not.toMatch(/CLI-only/);
    expect(r).toMatchObject({ allow: true });
  });
  it('a run directory variable or a runs/<id>/messaging/ path is still denied', () => {
    expect(decide(bash('cat > "$RUN_DIR/messaging/plan.json" <<\'EOF\'\n{}\nEOF'), ctx, {})).toMatchObject({ allow: false, reason: expect.stringMatching(/CLI-only run file/) });
    expect(decide(bash('cat > "${AEGIS_RUN}/messaging/plan.json" < /dev/null'), ctx, {})).toMatchObject({ allow: false, reason: expect.stringMatching(/CLI-only run file/) });
    expect(decide(bash('echo > runs/RUN-1/messaging/x'), ctx, {})).toMatchObject({ allow: false });
    expect(decide(bash('echo > "runs/$ID/messaging/x"'), ctx, {})).toMatchObject({ allow: false, reason: expect.stringMatching(/CLI-only run file/) });
  });
});
