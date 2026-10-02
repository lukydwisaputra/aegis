import { bashWriteTargets, expandBraces } from '@qa/path-guard';

const CWD = '/repo/aegis';
const R = '/repo/aegis';
const run = (cmd: string) => bashWriteTargets(cmd, CWD, '/home/u', () => false);

describe('fix round 2 addendum', () => {
  it('a: expandBraces expands lists and ranges, bounded', () => {
    const all = expandBraces('tests/qa/specs/{x,..}/{y,..}/{z,..}/src/app.ts')!;
    expect(all).toHaveLength(8);
    expect(all).toContain('tests/qa/specs/../../../src/app.ts');
    expect(all).toContain('tests/qa/specs/x/y/z/src/app.ts');
    expect(expandBraces('{x,../gates}')).toEqual(['x', '../gates']);
    expect(expandBraces('f{1..3}')).toEqual(['f1', 'f2', 'f3']);
    expect(expandBraces('{a..c}')).toEqual(['a', 'b', 'c']);
    expect(expandBraces('a{b,c{d,e}}')).toEqual(['ab', 'acd', 'ace']);
    expect(expandBraces('plain')).toEqual(['plain']);
    expect(expandBraces('{a}')).toEqual(['{a}']);
    expect(expandBraces('{1..1000}')).toBeNull();
    expect(expandBraces('{1..20}{1..20}')).toBeNull();
  });

  it('a: unquoted brace and glob words are marked as patterns', () => {
    expect(run('rm src/*.ts').targets[0]).toMatchObject({ pattern: true });
    expect(run('touch a?').targets[0]).toMatchObject({ pattern: true });
    expect(run('touch f[12]').targets[0]).toMatchObject({ pattern: true });
    expect(run('touch tests/qa/specs/{x,..}/{y,..}/src/app.ts').targets[0]).toMatchObject({ pattern: true });
    expect(run('touch a{1..3}').targets[0]).toMatchObject({ pattern: true });
    expect(run('echo x > out/*.log').targets[0]).toMatchObject({ pattern: true });
  });

  it('a: quoted or plain words are not patterns', () => {
    expect(run('touch "a*" \'b?\' "{a,b}" plain').targets.map((t) => t.pattern)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('b: a command after a dynamic cd is flagged', () => {
    const cmds = run('cd "$D" && touch x').commands;
    expect(cmds[1]).toMatchObject({ cwdDynamic: true });
    expect(cmds[0]!.cwdDynamic).toBeUndefined();
    expect(run('cd a && touch x').commands.map((c) => c.cwdDynamic)).toEqual([undefined, undefined]);
  });

  it('c: git clean and git reset --hard are removals; unlink is a removal command', () => {
    expect(run('git clean -fd').targets[0]).toMatchObject({ via: 'git-rm', dynamic: true });
    expect(run('git reset --hard').targets[0]).toMatchObject({ via: 'git-rm', dynamic: true });
    expect(run('git stash').targets[0]).toMatchObject({ via: 'git' });
    expect(run('unlink a').targets).toMatchObject([{ path: `${R}/a`, via: 'unlink' }]);
  });

  it('e: assignments are reachable from every command', () => {
    expect(run('export AEGIS_AGENT=qa-x').commands[0]!.assigned).toEqual({ AEGIS_AGENT: 'qa-x' });
    expect(run('declare -x A=1 B="2"').commands[0]!.assigned).toEqual({ A: '1', B: '2' });
    expect(run('AEGIS_AGENT=qa-x').commands[0]!.assigned).toEqual({ AEGIS_AGENT: 'qa-x' });
    expect(run('A=1 env B=2 sudo C=3 pnpm aegis x').commands[0]!.assigned).toEqual({ A: '1', B: '2', C: '3' });
    expect(run('ls').commands[0]!.assigned).toEqual({});
    const inner = run("bash -c 'AEGIS_AGENT=qa-y pnpm aegis task list'").commands;
    expect(inner.some((c) => c.assigned.AEGIS_AGENT === 'qa-y')).toBe(true);
  });
});
