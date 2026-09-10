/**
 * Global option handling for the CLI.
 *
 * Lives in its own module rather than inline in `cli.ts` because `cli.ts` is
 * excluded from coverage and cannot be imported (it runs `main()` on load).
 * The `--json` propagation bug survived precisely because the wiring was
 * unreachable from any test.
 */

import type { Command } from 'commander';

/**
 * Program-level options that every subcommand action should observe.
 *
 * Deliberately a fixed list rather than "every option on the program". A
 * program option whose long name matches a subcommand option *shadows* it:
 * Commander resolves `--x` to the first command in the chain declaring it, so
 * the subcommand's own value is never populated. Adding a global `--mode` was
 * measured to silently rewrite `search query --mode hybrid` to the subcommand
 * default, because `search query` declares its own `-m, --mode`.
 *
 * None of the four keys below collide with any subcommand option, which is what
 * makes them safe to propagate. If one is ever added to a subcommand, revisit
 * this list rather than assuming the local declaration will win.
 */
export const INHERITED_GLOBAL_OPTIONS = [
  'json',
  'silent',
  'verbose',
  'timeout',
] as const;

/**
 * Copy program-level global options down onto the command about to run.
 *
 * Commander parses parent and subcommand options independently: a subcommand
 * action receives only the options declared on *its own* command object, so
 * `options.json` was `undefined` in every handler and the documented
 * `codelapse git info --json` printed ANSI prose instead of JSON.
 *
 * `optsWithGlobals()` reads the correct values but would mean editing all 85
 * call sites, so the values are copied down instead. Registered as a
 * `preAction` hook it runs before each action, so handlers observe the globals
 * exactly as if they had been declared locally.
 *
 * `enablePositionalOptions()` is not an alternative: it would make a trailing
 * `--json` the subcommand's problem, and no subcommand declares it, so every
 * documented `codelapse <group> <cmd> --json` form would start failing with
 * "unknown option".
 *
 * @param thisCommand the command the hook was registered on (the program)
 * @param actionCommand the command whose action is about to run
 */
export function inheritGlobalOptions(
  thisCommand: Command,
  actionCommand: Command,
): void {
  const globals = thisCommand.opts();

  const inherited: Record<string, unknown> = {
    // Normalise the flags to real booleans: Commander leaves an unpassed
    // boolean option `undefined`, which is falsy but breaks `=== false`.
    json: globals.json === true,
    silent: globals.silent === true,
    verbose: globals.verbose === true,
    timeout: globals.timeout,
  };

  for (const key of INHERITED_GLOBAL_OPTIONS) {
    // Honour an explicit local value. Because the program's declaration
    // shadows any same-named subcommand option, a local value can only be
    // `cli` if the collision rules change, but honouring it is the safe
    // default: the user's local choice must not be discarded.
    if (actionCommand.getOptionValueSource(key) === 'cli') {
      continue;
    }
    actionCommand.setOptionValue(key, inherited[key]);
  }
}
