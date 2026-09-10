/**
 * Guards the CLI command surface.
 *
 * `cli.ts` used to run `main()` on import and was excluded from coverage, so
 * nothing could inspect the wiring. The consequences were real:
 *
 *  - 33 implemented subcommands across five command classes were never
 *    registered, so `codelapse config list` failed with "unknown command".
 *  - Every `--no-x` flag was a silent no-op: the handlers read `options.noX`,
 *    which Commander never sets.
 *  - `--json` never reached a subcommand action at all.
 *
 * These tests assert the surface directly, so a command class that stops being
 * wired up, or a negatable flag declared under a name no handler reads, fails
 * here rather than in a user's terminal.
 */

import type { Command } from 'commander';
import { buildProgram } from '../cli';

/** Commander injects a `help` subcommand into every command that has children. */
function subcommands(group: Command): string[] {
  return group.commands
    .map((c) => c.name())
    .filter((name) => name !== 'help')
    .sort();
}

function find(parent: Command, name: string): Command | undefined {
  return parent.commands.find(
    (c) => c.name() === name || c.aliases().includes(name),
  );
}

/** Resolve "files show" against the built program. */
function findPath(path: string): Command {
  const parts = path.split(' ');
  let current: Command | undefined = program;
  for (const part of parts) {
    current = current ? find(current, part) : undefined;
    if (!current) {
      throw new Error(`No such command: ${path}`);
    }
  }
  return current;
}

let program: Command;

beforeAll(() => {
  program = buildProgram();
});

describe('top-level command groups', () => {
  it('registers every command group', () => {
    expect(subcommands(program)).toEqual([
      'analyze',
      'api',
      'batch',
      'chunk',
      'config',
      'diagnostics',
      'files',
      'filter',
      'git',
      'rules',
      'search',
      'search-enhanced',
      'snapshot',
      'status',
      'utility',
      'watch',
      'workspace',
    ]);
  });

  it.each([
    ['snapshot', 'snap'],
    ['search-enhanced', 'se'],
    ['analyze', 'an'],
    ['chunk', 'ch'],
    ['workspace', 'ws'],
    ['utility', 'util'],
    ['git', 'g'],
    ['config', 'cfg'],
    ['filter', 'f'],
    ['rules', 'r'],
    ['diagnostics', 'diag'],
  ])('%s has alias %s', (name, alias) => {
    expect(find(program, name)?.aliases()).toContain(alias);
  });
});

describe('subcommands of the previously unregistered groups', () => {
  // These five classes were fully implemented but never imported by cli.ts.
  it.each([
    ['config', ['export', 'get', 'import', 'list', 'reset', 'set', 'validate']],
    ['files', ['compare', 'export', 'history', 'list', 'restore', 'show']],
    [
      'filter',
      [
        'date',
        'edit-notes',
        'edit-tags',
        'edit-task',
        'favorite',
        'favorites',
        'file',
        'tags',
      ],
    ],
    ['rules', ['add', 'list', 'remove', 'test', 'toggle', 'update']],
    [
      'diagnostics',
      ['clear-logs', 'health', 'logs', 'performance', 'run', 'system'],
    ],
  ])('%s registers all of its subcommands', (group, expected) => {
    expect(subcommands(findPath(group))).toEqual(expected);
  });

  it.each([
    ['files list', 'ls'],
    ['files compare', 'diff'],
    ['filter favorites', 'fav'],
    ['rules list', 'ls'],
    ['rules remove', 'rm'],
  ])('%s has alias %s', (path, alias) => {
    expect(findPath(path).aliases()).toContain(alias);
  });
});

describe('negatable flags', () => {
  /**
   * Commander maps `--no-x` to `options.x === false`. A handler that reads
   * `options.noX` therefore always sees `undefined`, and `!undefined` is
   * `true`, so the flag silently does nothing. These assertions pin the
   * attribute name each handler actually reads.
   */
  it.each([
    ['files show', ['content', 'metadata', 'syntax', 'lineNumbers']],
    ['files restore', ['backup']],
    ['diagnostics run', ['system', 'snapshots', 'git', 'config']],
    ['diagnostics health', ['performance', 'connectivity', 'storage']],
    ['diagnostics performance', ['history']],
  ])(
    '%s exposes positive attribute names for its --no-* flags',
    (path, names) => {
      const attrs = findPath(path)
        .options.filter((o) => o.negate)
        .map((o) => o.attributeName());

      expect(attrs.sort()).toEqual([...names].sort());
    },
  );

  it('declares no option whose attribute name starts with "no"', () => {
    // The bug class: any `--no-x` read as `noX`.
    const offenders: string[] = [];

    const walk = (cmd: Command, prefix: string) => {
      for (const option of cmd.options) {
        const attr = option.attributeName();
        if (/^no[A-Z]/.test(attr)) {
          offenders.push(`${prefix} ${option.flags} -> ${attr}`);
        }
      }
      for (const child of cmd.commands) {
        if (child.name() !== 'help') {
          walk(child, `${prefix} ${child.name()}`.trim());
        }
      }
    };

    walk(program, '');
    expect(offenders).toEqual([]);
  });
});

describe('global options', () => {
  it('declares the four documented globals and no client --mode', () => {
    // `--mode` must not be global: a program-level option shadows a same-named
    // subcommand option, which would break `search query --mode <strategy>`.
    const longs = program.options.map((o) => o.long);

    // `--help` is not in `options` -- Commander tracks it separately.
    expect(longs.sort()).toEqual([
      '--json',
      '--silent',
      '--timeout',
      '--verbose',
      '--version',
    ]);
    expect(longs).not.toContain('--mode');
  });

  it('does not redeclare the globals on any subcommand', () => {
    // The globals are inherited via the preAction hook; a per-command copy
    // would shadow them and reintroduce the divergence entirely.
    const offenders: string[] = [];
    const globals = ['--json', '--silent', '--verbose', '--timeout'];

    const walk = (cmd: Command, prefix: string) => {
      for (const option of cmd.options) {
        if (option.long && globals.includes(option.long)) {
          offenders.push(`${prefix} redeclares ${option.long}`);
        }
      }
      for (const child of cmd.commands) {
        if (child.name() !== 'help') {
          walk(child, `${prefix} ${child.name()}`.trim());
        }
      }
    };

    // Skip the program's own options -- those *are* the globals.
    for (const child of program.commands) {
      if (child.name() !== 'help') {
        walk(child, child.name());
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('command documentation', () => {
  it('gives every command a description', () => {
    // `codelapse --help` lists all of these; an empty one reads as a bug.
    const missing: string[] = [];
    const walk = (cmd: Command, prefix: string) => {
      for (const child of cmd.commands) {
        if (child.name() === 'help') {
          continue;
        }
        const path = `${prefix} ${child.name()}`.trim();
        if (!child.description()) {
          missing.push(path);
        }
        walk(child, path);
      }
    };
    walk(program, '');
    expect(missing).toEqual([]);
  });
});
