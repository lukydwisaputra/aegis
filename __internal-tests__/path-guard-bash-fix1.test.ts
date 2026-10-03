import { bashWriteTargets, parseBash, unwrap } from '@qa/path-guard';

const CWD = '/repo/aegis';
const R = '/repo/aegis';
const paths = (cmd: string) => bashWriteTargets(cmd, CWD, '/home/u').targets.map((t) => t.path);
const targets = (cmd: string) => bashWriteTargets(cmd, CWD, '/home/u').targets;

describe('fix round 1: important', () => {
  it.each([
    ['I1 for/do', 'for f in a b; do cp x runs/R/cases/; done', [`${R}/runs/R/cases`]],
    ['I1 if/then', 'if true; then rm runs/R/run.json; fi', [`${R}/runs/R/run.json`]],
    ['I1 brace group', '{ cd sandbox; echo hi > out.txt; }', [`${R}/sandbox/out.txt`]],
    ['I1 while/not', 'while ! true; do touch w; done', [`${R}/w`]],
    ['I1 else', 'if false; then :; else touch e; fi', [`${R}/e`]],
    ['I4 siblings', '(cd a && touch x); (touch y)', [`${R}/a/x`, `${R}/y`]],
    ['I4 nested', '(cd a; (cd b; touch x); touch y); touch z', [`${R}/a/b/x`, `${R}/a/y`, `${R}/z`]],
    ['I5 ansi-c', "touch $'a b' $'c\\'d'", [`${R}/a b`, `${R}/c'd`]],
    ['I5 ansi-c body not a redirect', "echo $'x > y' > z", [`${R}/z`]],
  ])('%s', (_n, cmd, expected) => {
    expect(paths(cmd)).toEqual(expected);
  });

  it('I1 unwrap strips a reserved word and merges later assignments', () => {
    const u = unwrap(parseBash('then FOO=1 rm x')[0]!);
    expect(u.argv.map((w) => w.value)).toEqual(['rm', 'x']);
    expect(u.env).toEqual({ FOO: '1' });
  });

  it('I2 tee gets the heredoc body', () => {
    const [t] = targets("tee runs/R/cases/TC.md <<'EOF'\nAegis was here\nEOF");
    expect(t).toMatchObject({ path: `${R}/runs/R/cases/TC.md`, via: 'tee', content: 'Aegis was here' });
  });

  it('I2 tee gets the previous pipeline stage content', () => {
    expect(targets('echo "Aegis" | tee runs/R/cases/x.md')[0]).toMatchObject({ via: 'tee', content: 'Aegis' });
    expect(targets("cat <<'EOF' | tee f\nbody\nEOF")[0]).toMatchObject({ via: 'tee', content: 'body' });
    expect(targets('ls | tee f')[0]).toMatchObject({ via: 'tee', content: null });
  });

  it('I3 a dynamic cd makes later relative targets dynamic', () => {
    expect(targets('cd "$D" && touch x')).toEqual([{ path: '$D/x', dynamic: true, content: null, via: 'touch' }]);
    expect(targets('cd $D; touch /abs/x; touch ~/h')).toMatchObject([{ path: '/abs/x', dynamic: false }, { path: '/home/u/h', dynamic: false }]);
    expect(targets('cd - && touch x')).toMatchObject([{ path: '-/x', dynamic: true }]);
  });

  it('I3 bare cd and cd ~ go home', () => {
    expect(paths('cd && touch x')).toEqual(['/home/u/x']);
    expect(paths('cd ~ && touch x')).toEqual(['/home/u/x']);
    expect(paths('cd ~/w && touch x')).toEqual(['/home/u/w/x']);
  });
});

describe('fix round 1: minor', () => {
  it.each([
    ['heredoc delimiter with dash', 'cat <<EOF-JSON > f\nbody\nEOF-JSON', [`${R}/f`]],
    ['heredoc backslash delimiter', 'cat <<\\EOF > f\n$X\nEOF\ntouch g', [`${R}/f`, `${R}/g`]],
    ['marker inside quotes is not a heredoc', 'echo "<<EOF" > a; touch b', [`${R}/a`, `${R}/b`]],
    ['marker inside dynamic word', 'echo "$(x) <<EOF" > a\ntouch b', [`${R}/a`, `${R}/b`]],
    ['two heredocs in one command', 'cat <<A <<B > f\na\nA\nb\nB\ntouch z', [`${R}/f`, `${R}/z`]],
    ['sudo -u', 'sudo -u x rm y', [`${R}/y`]],
    ['nice -n', 'nice -n 10 rm y', [`${R}/y`]],
    ['env -i', 'env -i touch y', [`${R}/y`]],
    ['timeout', 'timeout 5 touch y', [`${R}/y`]],
    ['curl cluster', 'curl -sSLo out u', [`${R}/out`]],
    ['wget cluster', 'wget -qO out u', [`${R}/out`]],
    ['sed attached -e', "sed -i -e's/a/b/' f", [`${R}/f`]],
    ['perl -0pi', "perl -0pi -e 's/a/b/' f", [`${R}/f`]],
    ['BSD sed -i .bak', "sed -i .bak 's/a/b/' f", [`${R}/f`]],
    ['sed -i.bak attached', "sed -i.bak 's/a/b/' f", [`${R}/f`]],
    ['>&file', 'ls >&all.log', [`${R}/all.log`]],
    ['>& file', 'ls >& all.log', [`${R}/all.log`]],
    ['>&2 is a dup', 'ls >&2', []],
    ['2>& 1 is a dup', 'ls > x 2>&1', [`${R}/x`]],
    ['install -d', 'install -d d1 d2', [`${R}/d1`, `${R}/d2`]],
    ['ln -s one operand', 'ln -s ../a/b', [`${R}/b`]],
    ['bare ~', 'touch ~', ['/home/u']],
    ['pushd', 'pushd sandbox && touch x', [`${R}/sandbox/x`]],
    ['git checkout --', 'git checkout -- a b', [`${R}/a`, `${R}/b`]],
    ['git checkout ref --', 'git -C sub checkout main -- f', [`${R}/sub/f`]],
    ['git restore', 'git restore a', [`${R}/a`]],
    ['git restore --staged is index-only', 'git restore --staged a', []],
    ['git branch checkout', 'git checkout main', []],
    ['git status', 'git status', []],
    ['git reset without --hard', 'git reset x', []],
    ['git stash list', 'git stash list', []],
    ['git clean dry run', 'git clean -n', []],
  ])('%s', (_n, cmd, expected) => {
    expect(paths(cmd)).toEqual(expected);
  });

  it.each(['git clean -fd', 'git reset --hard', 'git stash', 'git apply p.diff', 'git -C sub stash push'])('%s is a dynamic write in its cwd', (cmd) => {
    const [t] = targets(cmd);
    // Task 9 B1: plain clean and reset --hard have their own vias (they never touch ignored files such as runs/).
    expect(t).toMatchObject({ dynamic: true, via: cmd.includes('clean') ? 'git-clean' : cmd.includes('reset') ? 'git-reset' : 'git' });
    expect(t!.path).toBe(cmd.includes('-C sub') ? `${R}/sub` : R);
    expect(targets(cmd)).toHaveLength(1);
  });
});
