import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertWritable, isWritable, PathGuardError } from '@qa/path-guard';

describe('@qa/path-guard — tests/qa developer-territory boundary', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pg-boundary-test-'));
    // Write a minimal aegis.config.json with testsDir pointing to the
    // nested target's tests/qa directory (testsDir resolves relative to
    // aegisRoot, i.e. `root`).
    fs.writeFileSync(
      path.join(root, 'aegis.config.json'),
      JSON.stringify({
        targetProjectRoot: './target',
        testsDir: './target/tests/qa',
        environments: {
          development: {},
          testing: {},
          staging: {},
          production: { readOnly: true },
        },
      })
    );
    // Create the QA namespace directory, nested inside the unique root
    fs.mkdirSync(path.join(root, 'target', 'tests', 'qa', 'specs', 'auth'), { recursive: true });
    // Create developer tests outside the QA namespace, also nested inside root
    fs.mkdirSync(path.join(root, 'target', 'tests', 'unit'), { recursive: true });
    fs.mkdirSync(path.join(root, 'target', 'tests', 'e2e'), { recursive: true });
  });

  afterEach(() => {
    // Clean up only the unique temp root — never its parent (os.tmpdir()).
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('when testsDir is ./target/tests/qa', () => {
    it('allows writes to files inside tests/qa namespace', () => {
      const qaPath = path.join(root, 'target', 'tests', 'qa', 'specs', 'auth', 'login.spec.ts');
      expect(isWritable(qaPath, root)).toBe(true);
    });

    it('blocks writes to files in tests/unit (outside tests/qa)', () => {
      const unitPath = path.join(root, 'target', 'tests', 'unit', 'button.test.ts');
      expect(isWritable(unitPath, root)).toBe(false);
    });

    it('throws PathGuardError when attempting to write to tests/e2e (outside tests/qa)', () => {
      const e2ePath = path.join(root, 'target', 'tests', 'e2e', 'legacy.spec.ts');
      expect(() => assertWritable(e2ePath, root)).toThrow(PathGuardError);
    });
  });
});
