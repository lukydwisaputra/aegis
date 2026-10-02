import { bashWriteTargets } from '@qa/path-guard';

const CWD = '/repo/aegis';
const R = '/repo/aegis';
const targets = (cmd: string, exists: (p: string) => boolean = () => false) => bashWriteTargets(cmd, CWD, '/home/u', exists).targets;
const paths = (cmd: string, exists?: (p: string) => boolean) => targets(cmd, exists).map((t) => t.path);

describe('fix round 2', () => {
  it('1 cd -- takes the next word', () => {
    expect(paths('cd -- ../src && touch f')).toEqual(['/repo/src/f']);
    expect(paths('cd -P -- sandbox && touch f')).toEqual([`${R}/sandbox/f`]);
  });

  it('2 heredoc delimiter with embedded quotes', () => {
    expect(paths('cat <<E"O"F > f\nbody\nEOF\ntouch g')).toEqual([`${R}/f`, `${R}/g`]);
    expect(paths("cat <<'E'O\\F > f\nbody\nEOF\ntouch g")).toEqual([`${R}/f`, `${R}/g`]);
  });

  it('2 an unterminated heredoc does not swallow the rest', () => {
    expect(paths('cat <<EOF > f\ntouch g')).toEqual([`${R}/f`, `${R}/g`]);
  });

  it('3 pipeline stages are subshell scopes for cd', () => {
    expect(paths('cd sandbox | cat; touch x')).toEqual([`${R}/x`]);
    expect(paths('echo a | (cd b; cat) | cat; touch x')).toEqual([`${R}/x`]);
  });

  it('3 popd pops the pushd stack', () => {
    expect(paths('pushd a; pushd b; popd; touch x')).toEqual([`${R}/a/x`]);
    expect(paths('pushd a; popd; touch x')).toEqual([`${R}/x`]);
    expect(paths('popd; touch x')).toEqual([`${R}/x`]);
  });

  it('4 git checkout . is a dynamic write in the cwd', () => {
    expect(targets('git checkout .')).toEqual([{ path: R, dynamic: true, content: null, via: 'git' }]);
    expect(targets('git -C sub checkout main .')).toMatchObject([{ path: `${R}/sub`, dynamic: true, via: 'git' }]);
  });

  it('4 git checkout <ref> <path> without -- needs an existing file', () => {
    expect(paths('git checkout main f.txt', (p) => p === `${R}/f.txt`)).toEqual([`${R}/f.txt`]);
    expect(paths('git checkout main', () => false)).toEqual([]);
    expect(paths('git checkout main f.txt', () => false)).toEqual([]);
  });

  it('4 git rm and git mv', () => {
    expect(targets('git rm -r a b')).toMatchObject([{ path: `${R}/a`, via: 'git' }, { path: `${R}/b`, via: 'git' }]);
    expect(paths('git mv src dst')).toEqual([`${R}/src`, `${R}/dst`]);
    expect(paths('git -C sub rm -f -- a')).toEqual([`${R}/sub/a`]);
  });

  it('5 ANSI-C escapes are decoded', () => {
    expect(paths("touch $'a\\x41\\101\\n\\t\\\\b'")).toEqual([`${R}/aAA\n\t\\b`]);
    expect(paths("touch $'it\\'s'")).toEqual([`${R}/it's`]);
    expect(paths("touch $'\\x2e\\x2e/x'")).toEqual(['/repo/x']);
  });

  it('6 a heredoc marker inside $( ) takes its own body', () => {
    const t = targets("echo $(cat <<EOF\nnested\nEOF\n) > a\ncat <<'X' > b\nreal\nX");
    expect(t.map((x) => x.path)).toEqual([`${R}/a`, `${R}/b`]);
    expect(t[1]!.content).toBe('real');
  });
});
