/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression guard for global option propagation.
 *
 * Before this fix `options.json` was `undefined` inside every subcommand
 * action, because Commander parses parent and subcommand options
 * independently. Every documented `--json` invocation therefore printed ANSI
 * prose, and `README.md` / `API.md` claimed all commands supported it.
 *
 * These tests drive a real `Command` instance rather than a hand-rolled
 * stand-in, so they exercise the same Commander behaviour production does.
 */

import { Command } from 'commander';
import {
  INHERITED_GLOBAL_OPTIONS,
  inheritGlobalOptions,
} from '../globalOptions';

/** Build a program shaped like the real one, and capture the action options. */
function buildProgram(): {
  program: Command;
  captured: { options?: any };
} {
  const program = new Command();
  const captured: { options?: any } = {};

  program
    .name('codelapse')
    .exitOverride()
    .option('--json', 'Output in JSON format (AI-friendly)')
    .option('--silent', 'Silent mode - no user prompts or status messages')
    .option('--verbose', 'Verbose output for debugging')
    .option('--timeout <ms>', 'Connection timeout in milliseconds', '5000');

  program.hook('preAction', (thisCommand, actionCommand) => {
    inheritGlobalOptions(thisCommand, actionCommand);
  });

  // A nested group with a flag-bearing subcommand, like `git info`.
  const group = program.command('git');
  group
    .command('info')
    .option('-f, --files', 'Show file-level changes only', false)
    .action((options: any) => {
      captured.options = options;
    });

  // Mirrors `search query`, which declares its own `-m, --mode` for search
  // strategy -- deliberately NOT a global, because a program-level `--mode`
  // would shadow it. Guards against anyone reintroducing one.
  const search = program.command('search');
  search
    .command('query <query>')
    .option(
      '-m, --mode <mode>',
      'Search mode: semantic, syntactic, behavioral, hybrid',
      'semantic',
    )
    .action((_query: string, options: any) => {
      captured.options = options;
    });

  // Mirrors `chunk list`, whose own options must survive untouched.
  const chunk = program.command('chunk');
  chunk
    .command('list')
    .option('-l, --limit <number>', 'Results per page', '50')
    .action((options: any) => {
      captured.options = options;
    });

  return { program, captured };
}

describe('global option propagation', () => {
  const parse = async (argv: string[]) => {
    const { program, captured } = buildProgram();
    await program.parseAsync(argv, { from: 'user' });
    return captured.options;
  };

  it('populates options.json when --json follows the subcommand', async () => {
    const options = await parse(['git', 'info', '--json']);
    expect(options.json).toBe(true);
  });

  it('populates options.json when --json precedes the subcommand', async () => {
    const options = await parse(['--json', 'git', 'info']);
    expect(options.json).toBe(true);
  });

  it('leaves options.json false (not undefined) when omitted', async () => {
    const options = await parse(['git', 'info']);
    expect(options.json).toBe(false);
  });

  it('propagates --silent, --verbose and --timeout', async () => {
    const options = await parse([
      '--silent',
      '--verbose',
      '--timeout',
      '9000',
      'git',
      'info',
    ]);
    expect(options.silent).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.timeout).toBe('9000');
  });

  it('defaults --timeout to the program default', async () => {
    const options = await parse(['git', 'info']);
    expect(options.timeout).toBe('5000');
  });

  it('leaves unrelated subcommand options untouched', async () => {
    const options = await parse(['--json', 'chunk', 'list']);
    expect(options.limit).toBe('50');
    expect(options.json).toBe(true);
  });

  it('does not shadow a subcommand option that shares a global name', async () => {
    // This is the `--mode` trap: had `search query`'s `-m, --mode` been declared
    // on the program as well, Commander would have routed the user's value to
    // the program and left the action with the default.
    const options = await parse(['search', 'query', 'foo', '--mode', 'hybrid']);
    expect(options.mode).toBe('hybrid');
  });

  it('covers every inherited key', () => {
    // Guards against a key being declared on the program but silently not
    // propagated, which is exactly how `json` broke.
    expect([...INHERITED_GLOBAL_OPTIONS].sort()).toEqual([
      'json',
      'silent',
      'timeout',
      'verbose',
    ]);
  });
});

describe('program-level option shadowing', () => {
  it('a program option steals a same-named subcommand option', async () => {
    // Documents the Commander behaviour that makes a global `--mode`
    // impossible, so the constraint is pinned rather than remembered. If a
    // Commander upgrade ever changes this, this test fails loudly instead of
    // the CLI silently changing meaning.
    const program = new Command();
    let actionMode: unknown;
    program.name('x').exitOverride().option('--mode <mode>', 'client', 'auto');

    const search = program.command('search');
    search
      .command('query <query>')
      .option('-m, --mode <mode>', 'search mode', 'semantic')
      .action((_q: string, options: any) => {
        actionMode = options.mode;
      });

    await program.parseAsync(['--mode', 'standalone', 'search', 'query', 'f'], {
      from: 'user',
    });

    // The subcommand's own flag is unreachable: the program won.
    expect(program.opts().mode).toBe('standalone');
    expect(actionMode).toBe('semantic');
  });
});
