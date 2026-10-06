import { Command } from 'commander';
import { buildProgram } from '../../apps/cli/src/program';
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
});
