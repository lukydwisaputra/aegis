import { Command } from 'commander';
import { buildProgram } from '../../apps/cli/src/program';
import { CLI_USAGE } from '../../packages/@qa/run-state/src/hook-context';
import { messagingCommand } from '../../apps/cli/src/commands/messaging';

describe('aegis messaging (NEW-07)', () => {
  it('registers the five subcommands', () => {
    const messaging = buildProgram().commands.find((c) => c.name() === 'messaging')!;
    expect(messaging.commands.map((c) => c.name()).sort()).toEqual(['check', 'exec', 'fetch-contract', 'plan', 'scan-secrets']);
  });

  it('init and reconfigure offer --messaging with the adapter ids, and no --email', () => {
    const p = buildProgram();
    for (const name of ['init', 'reconfigure']) {
      const cmd = p.commands.find((c) => c.name() === name)!;
      expect(cmd.options.map((o) => o.long)).not.toContain('--email');
      expect(cmd.options.find((o) => o.long === '--messaging')!.argChoices).toEqual(['commshub']);
    }
  });

  it('exec takes everything after -- as the command, flags included, and leaves --run to aegis', async () => {
    const messaging = messagingCommand();
    const exec = messaging.commands.find((c: Command) => c.name() === 'exec')!;
    // Replace the action (a later .action() wins): only the parse of the operands is under test.
    exec.action(() => undefined);
    const root = new Command().addCommand(messaging);
    await root.parseAsync(
      ['messaging', 'exec', '--run', 'RUN-1', '--', 'npx', 'playwright', 'test', 'tests/qa/messaging', '--reporter=line'],
      { from: 'user' }
    );
    expect(exec.processedArgs).toEqual([['npx', 'playwright', 'test', 'tests/qa/messaging', '--reporter=line']]);
    expect(exec.opts()).toEqual({ run: 'RUN-1' });
  });

  it('every messaging cheat-sheet line (H4 CLI_USAGE) parses against the CLI', async () => {
    const lines = Object.entries(CLI_USAGE).filter(([id]) => id.startsWith('messaging.'));
    expect(lines.map(([id]) => id).sort()).toEqual(['messaging.check', 'messaging.exec', 'messaging.fetch-contract', 'messaging.plan', 'messaging.scan-secrets']);
    for (const [id, syntax] of lines) {
      const argv = syntax
        .replace(/[[\]]/g, '')
        .replace('<paths...>', 'a b')
        .replace('<command...>', 'node -v')
        .replace('<id>', 'RUN-20261006-001')
        .split(/\s+/);
      const program = buildProgram();
      const sub = program.commands.find((c) => c.name() === 'messaging')!.commands.find((c) => c.name() === id.split('.')[1])!;
      let ran = 0;
      sub.action(() => { ran += 1; });
      await expect(program.parseAsync(argv, { from: 'user' })).resolves.toBeDefined();
      expect({ id, ran }).toEqual({ id, ran: 1 });
    }
  });
});
