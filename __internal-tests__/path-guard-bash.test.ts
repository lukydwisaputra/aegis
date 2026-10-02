import { bashWriteTargets, parseBash } from '@qa/path-guard';

const CWD = '/repo/aegis';
const paths = (cmd: string) => bashWriteTargets(cmd, CWD, '/home/u').targets.map((t) => t.path);

describe('bashWriteTargets: what a command writes', () => {
  it.each([
    ['echo hi > out.txt', ['/repo/aegis/out.txt']],
    ['cat a >> b.log', ['/repo/aegis/b.log']],
    ['printf x >| y', ['/repo/aegis/y']],
    ['echo x &> both.log', ['/repo/aegis/both.log']],
    ['node build.js 2>&1 | tee -a build.log', ['/repo/aegis/build.log']],
    ['ls > /dev/null 2> errs.txt', ['/dev/null', '/repo/aegis/errs.txt']],
    ['cp -r src dest/', ['/repo/aegis/dest']],
    ['cp -t target/ a b', ['/repo/aegis/target']],
    ['mv a b c/', ['/repo/aegis/a', '/repo/aegis/b', '/repo/aegis/c']],
    ['rm -rf runs/RUN-20261002-001/events.jsonl', ['/repo/aegis/runs/RUN-20261002-001/events.jsonl']],
    ['mkdir -p -m 755 sandbox/x', ['/repo/aegis/sandbox/x']],
    ['truncate -s 0 f.txt', ['/repo/aegis/f.txt']],
    ["sed -i '' 's/a/b/' file.ts", ['/repo/aegis/file.ts']],
    ["sed -i.bak -e 's/a/b/' f1 f2", ['/repo/aegis/f1', '/repo/aegis/f2']],
    ["sed 's/a/b/' file.ts", []],
    ['rsync -a --exclude .git --exclude=/aegis/ src/ sandbox/copy/', ['/repo/aegis/sandbox/copy']],
    ['ln -s target link', ['/repo/aegis/link']],
    ['dd if=/dev/zero of=big.bin bs=1 count=1', ['/repo/aegis/big.bin']],
    ['curl -sS -o out.json https://example.com', ['/repo/aegis/out.json']],
    ['wget -O page.html https://example.com', ['/repo/aegis/page.html']],
    ['touch ~/x', ['/home/u/x']],
    ['cd /tmp && touch x', ['/tmp/x']],
    ['cd sandbox/a; echo hi > out.txt', ['/repo/aegis/sandbox/a/out.txt']],
    ['bash -c "echo x > inner.txt"', ['/repo/aegis/inner.txt']],
    ['sudo rm -f /etc/x', ['/etc/x']],
    ['env FOO=1 touch y', ['/repo/aegis/y']],
    ['echo hi > "my dir/out file.txt"', ['/repo/aegis/my dir/out file.txt']],
    ['git commit -m "a > b"', []],
    ['echo done # > not-a-file', []],
    ['grep -r foo . | wc -l', []],
  ])('%s', (cmd, expected) => {
    expect(paths(cmd)).toEqual(expected);
  });

  it('marks a target that is not a literal path as dynamic, with its raw text', () => {
    const [t] = bashWriteTargets('echo $(date) > "$OUT/log.txt"', CWD).targets;
    expect(t).toMatchObject({ path: '$OUT/log.txt', dynamic: true });
  });

  it('attaches heredoc and echo bodies to the redirect target', () => {
    const cmd = "cat <<'EOF' > runs/RUN-20261002-001/cases/TC-AUTH-001.md\nWritten by the QA team\n$NOT_EXPANDED\nEOF\necho next > n.txt";
    expect(bashWriteTargets(cmd, CWD).targets).toEqual([
      { path: '/repo/aegis/runs/RUN-20261002-001/cases/TC-AUTH-001.md', dynamic: false, content: 'Written by the QA team\n$NOT_EXPANDED' },
      { path: '/repo/aegis/n.txt', dynamic: false, content: 'next' },
    ]);
    expect(bashWriteTargets('cat > a.json <<-EOF\n\t{}\n\tEOF', CWD).targets).toEqual([{ path: '/repo/aegis/a.json', dynamic: false, content: '\t{}' }]);
  });
});

describe('parseBash: commands and their prefixes', () => {
  it('splits pipelines and lists, and keeps leading assignments as env', () => {
    const cmds = parseBash(`echo '{"a":1}' | AEGIS_AGENT=qa-ui-specialist pnpm aegis work-report submit --file /dev/stdin && echo ok`);
    expect(cmds.map((c) => c.argv.map((w) => w.value).join(' '))).toEqual([
      'echo {"a":1}',
      'pnpm aegis work-report submit --file /dev/stdin',
      'echo ok',
    ]);
    expect(cmds[1]!.env).toEqual({ AEGIS_AGENT: 'qa-ui-specialist' });
  });

  it('keeps a quoted or dynamic assignment value', () => {
    expect(parseBash('AEGIS_AGENT="qa-x" pnpm aegis task list')[0]!.env).toEqual({ AEGIS_AGENT: 'qa-x' });
    expect(parseBash('AEGIS_AGENT=$WHO pnpm aegis task list')[0]!.env).toEqual({ AEGIS_AGENT: '$WHO' });
  });
});

describe('bashWriteTargets: pinned forms and robustness', () => {
  it.each([
    ['echo x 1> one.txt', ['/repo/aegis/one.txt']],
    ['echo x 2>> two.txt', ['/repo/aegis/two.txt']],
    ['echo x >out.txt', ['/repo/aegis/out.txt']],
    ['echo x | tee t.txt', ['/repo/aegis/t.txt']],
    ['install -m 644 a.txt dest/b.txt', ['/repo/aegis/dest/b.txt']],
    ["perl -pi -e 's/a/b/' f.pl g.pl", ['/repo/aegis/f.pl', '/repo/aegis/g.pl']],
    ["perl -i.bak -pe 's/a/b/' f.pl", ['/repo/aegis/f.pl']],
    ["perl -e 'print 1' f.pl", []],
    ['touch a; touch b | touch c && touch d', ['/repo/aegis/a', '/repo/aegis/b', '/repo/aegis/c', '/repo/aegis/d']],
    ['cd sandbox && cd a && touch z', ['/repo/aegis/sandbox/a/z']],
    ['(cd sandbox && touch z); touch y', ['/repo/aegis/sandbox/z', '/repo/aegis/y']],
    ["touch 'a b' \"c d\" e\\ f", ['/repo/aegis/a b', '/repo/aegis/c d', '/repo/aegis/e f']],
  ])('%s', (cmd, expected) => {
    expect(paths(cmd)).toEqual(expected);
  });

  it('never throws on odd input', () => {
    const odd = ['', ' ', '\n\n', '>', '>>', '>|', '&>', '2>', '(', ')', '((', '))', '"', "'", '`', '$(', '${', '$((', '<<', '<<EOF', '<<-', '<<<', '\\', 'a \\', '|', '||', '&&', ';;', '# x', 'cd', 'cd >', 'tee', 'sed -i', 'dd of=', 'cp', 'bash -c', 'bash -c "', 'bash -c "bash -c \\"bash -c x\\""', 'echo $', 'echo "$', 'x=', '=', '9999999999>x', '\u0000', '\u{1F600} > \u{1F600}', 'cat <<E\nbody'];
    for (const s of odd) expect(() => bashWriteTargets(s, CWD, '/h')).not.toThrow();
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = ['>', '<', '|', '&', ';', '(', ')', '"', "'", '`', '$', '{', '}', '\\', '\n', ' ', 'a', 'b', '1', '2', '=', '#', '-', 'i', 'cd ', 'tee ', 'sed ', 'EOF', '<<', 'bash -c '];
    for (let n = 0; n < 3000; n++) {
      let s = '';
      for (let k = Math.floor(rnd() * 30); k > 0; k--) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => bashWriteTargets(s, CWD, '/h')).not.toThrow();
    }
  });
});
