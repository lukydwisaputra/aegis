import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertWritable, assertEnvSafe, assertAegisOwnership, PathGuardError } from '@qa/path-guard';

let aegisRoot: string;

beforeEach(() => {
  aegisRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pg-test-'));
  // Write a minimal aegis.config.json with production marked read-only
  fs.writeFileSync(path.join(aegisRoot, 'aegis.config.json'), JSON.stringify({
    environments: {
      production: { readOnly: true },
      staging: { readOnly: false },
    },
  }));
  // Create writable dirs
  fs.mkdirSync(path.join(aegisRoot, 'runs', 'RUN-20260525-001'), { recursive: true });
  fs.mkdirSync(path.join(aegisRoot, 'agent-memory', 'qa-orchestrator'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(aegisRoot, { recursive: true, force: true });
});

describe('@qa/path-guard', () => {
  describe('assertWritable()', () => {
    it('passes for absolute paths inside runs/', () => {
      const p = path.join(aegisRoot, 'runs', 'RUN-20260525-001', 'plan.json');
      expect(() => assertWritable(p, aegisRoot)).not.toThrow();
    });

    it('passes for absolute paths inside agent-memory/', () => {
      const p = path.join(aegisRoot, 'agent-memory', 'qa-orchestrator', 'lessons.json');
      expect(() => assertWritable(p, aegisRoot)).not.toThrow();
    });

    it('throws PathGuardError for absolute paths outside aegis', () => {
      expect(() => assertWritable('/etc/passwd', aegisRoot)).toThrow(PathGuardError);
    });

    it('throws PathGuardError for paths targeting node_modules', () => {
      const p = path.join(aegisRoot, 'node_modules', 'some-pkg', 'index.js');
      expect(() => assertWritable(p, aegisRoot)).toThrow(PathGuardError);
    });
  });

  describe('assertEnvSafe()', () => {
    it('passes for staging env with mutating operations', () => {
      expect(() => assertEnvSafe('staging', { mutates: true }, aegisRoot)).not.toThrow();
    });

    it('passes for production env with read-only operations', () => {
      expect(() => assertEnvSafe('production', { mutates: false }, aegisRoot)).not.toThrow();
    });

    it('throws PathGuardError for production env (readOnly: true) with mutating operations', () => {
      expect(() => assertEnvSafe('production', { mutates: true }, aegisRoot)).toThrow(PathGuardError);
    });
  });

  describe('assertAegisOwnership()', () => {
    it('passes for a qa- prefixed agent writing inside aegisRoot', () => {
      const p = path.join(aegisRoot, 'runs', 'RUN-20260525-001', 'plan.json');
      expect(() => assertAegisOwnership('qa-test-designer', p, aegisRoot)).not.toThrow();
    });

    it('passes for qa-orchestrator accessing agent-memory inside aegisRoot', () => {
      const p = path.join(aegisRoot, 'agent-memory', 'qa-orchestrator', 'lessons.json');
      expect(() => assertAegisOwnership('qa-orchestrator', p, aegisRoot)).not.toThrow();
    });

    it('throws PathGuardError for non-qa agent writing inside aegisRoot', () => {
      const p = path.join(aegisRoot, 'runs', 'x.json');
      expect(() => assertAegisOwnership('non-qa-agent', p, aegisRoot)).toThrow(PathGuardError);
    });

    it('throws PathGuardError for agent without qa- prefix writing inside aegisRoot', () => {
      const p = path.join(aegisRoot, 'runs', 'data.json');
      expect(() => assertAegisOwnership('external-runner', p, aegisRoot)).toThrow(PathGuardError);
    });

    it('does not throw for non-qa agent writing outside aegisRoot', () => {
      expect(() =>
        assertAegisOwnership('non-qa-agent', '/tmp/some-other-path/file.json', aegisRoot)
      ).not.toThrow();
    });
  });
});
