import { assertWritable, assertEnvSafe, assertAegisOwnership, PathGuardError } from '@qa/path-guard';

describe('@qa/path-guard', () => {
  describe('assertWritable()', () => {
    it('passes for paths inside the runs/ sandbox', () => {
      expect(() => assertWritable('runs/RUN-001/plan.json')).not.toThrow();
    });

    it('passes for paths inside aegis/runs/', () => {
      expect(() => assertWritable('aegis/runs/RUN-002/report.json')).not.toThrow();
    });

    it('throws PathGuardError for paths escaping via ../', () => {
      expect(() => assertWritable('../apps/web/src/index.ts')).toThrow(PathGuardError);
    });

    it('throws PathGuardError for absolute paths outside aegis', () => {
      expect(() => assertWritable('/etc/passwd')).toThrow(PathGuardError);
    });

    it('throws PathGuardError for paths targeting node_modules', () => {
      expect(() => assertWritable('node_modules/some-pkg/index.js')).toThrow(PathGuardError);
    });
  });

  describe('assertEnvSafe()', () => {
    it('passes for non-production env with mutating operations', () => {
      expect(() => assertEnvSafe('staging', { mutates: true })).not.toThrow();
    });

    it('passes for production env with read-only operations', () => {
      expect(() => assertEnvSafe('production', { mutates: false })).not.toThrow();
    });

    it('throws PathGuardError for production env with mutating operations', () => {
      expect(() => assertEnvSafe('production', { mutates: true })).toThrow(PathGuardError);
    });

    it('throws PathGuardError for prod env alias with mutating operations', () => {
      expect(() => assertEnvSafe('prod', { mutates: true })).toThrow(PathGuardError);
    });
  });

  describe('assertAegisOwnership()', () => {
    it('passes for a qa- prefixed agent writing inside aegis/', () => {
      expect(() =>
        assertAegisOwnership('qa-test-designer', 'aegis/runs/x.json')
      ).not.toThrow();
    });

    it('passes for qa-orchestrator accessing aegis/agent-memory/', () => {
      expect(() =>
        assertAegisOwnership('qa-orchestrator', 'aegis/agent-memory/qa-orchestrator/lessons.json')
      ).not.toThrow();
    });

    it('throws PathGuardError for non-qa agents accessing aegis/', () => {
      expect(() =>
        assertAegisOwnership('non-qa-agent', 'aegis/runs/x.json')
      ).toThrow(PathGuardError);
    });

    it('throws PathGuardError for agents without qa- prefix', () => {
      expect(() =>
        assertAegisOwnership('external-runner', 'aegis/runs/data.json')
      ).toThrow(PathGuardError);
    });
  });
});
