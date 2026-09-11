#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { join } from 'path';
import { UnifiedClient as CodeLapseClient } from './unifiedClient';
import { inheritGlobalOptions, parseTimeout } from './globalOptions';
import { getFailure, setFailure } from './exitState';
import { printResult } from './commands/output';
import { runApiCall } from './commands/api';
import { batchExecute } from './commands/batch';
import { SnapshotCommands } from './commands/snapshot';
import { SearchCommands } from './commands/search';
import { WorkspaceCommands } from './commands/workspace';
import { UtilityCommands } from './commands/utility';
import { EnhancedSearchCommands } from './commands/enhanced-search';
import { AnalysisCommands } from './commands/analysis';
import { ChunkingCommands } from './commands/chunking';
import { GitCommands } from './commands/git';
import { ConfigCommands } from './commands/config';
import { DiagnosticsCommands } from './commands/diagnostics';
import { FilesCommands } from './commands/files';
import { FilterCommands } from './commands/filter';
import { RulesCommands } from './commands/rules';
const program = new Command();
let programBuilt = false;

/**
 * Build the command tree.
 *
 * Exported and separated from `main()` so the command surface can be inspected
 * by tests. `cli.ts` cannot be imported for its side effects -- it used to run
 * `main()` (and therefore `parseAsync()`) at module load -- and because
 * `collectCoverageFrom` excludes this file, no test could reach the wiring.
 * That is how 33 implemented subcommands went unregistered, `--json` never
 * reached a handler, and every `--no-x` flag silently did nothing.
 *
 * Idempotent: repeated calls return the same program rather than registering
 * each command a second time.
 */
export function buildProgram(): Command {
  if (programBuilt) {
    return program;
  }
  programBuilt = true;

  program
    .name('codelapse')
    .alias('cl')
    .description(
      'CLI for CodeLapse VSCode extension - AI-friendly snapshot management',
    )
    .version(
      // Read from package.json rather than hardcoding: the literal here said
      // 1.0.0 while package.json said 2.0.0, so `codelapse --version`
      // (documented at cli/README.md:131) reported the wrong number.
      //
      // Read via fs rather than `require` so it resolves relative to the
      // compiled output (dist/cli.js -> ../package.json); a `require` here also
      // trips @typescript-eslint/no-var-requires.
      (
        JSON.parse(
          readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
        ) as { version: string }
      ).version,
    );

  // Global options
  //
  // NOTE: a global `--mode` is deliberately absent even though `cli/API.md`
  // documents one. Commander resolves an option to the first command in the
  // chain declaring it, so a program-level `--mode` would *shadow* the
  // `-m, --mode` that `search query` and `search-enhanced query` declare for
  // search strategy, silently resetting it to the default. Verified by probe.
  // Selecting a client mode is therefore not reachable from the CLI at all:
  // `UnifiedClient` defaults to 'auto'.
  program
    .option('--json', 'Output in JSON format (AI-friendly)')
    .option('--silent', 'Silent mode - no user prompts or status messages')
    .option('--verbose', 'Verbose output for debugging')
    .option('--timeout <ms>', 'Connection timeout in milliseconds', '5000');

  // Copies the globals above down onto each command before its action runs, so
  // `options.json` is populated inside subcommand handlers. See
  // `globalOptions.ts` for why Commander does not do this for us.
  program.hook('preAction', inheritGlobalOptions);

  // Lazily created and initialised. The client was previously constructed and
  // initialised here, before the command tree existed and before parseAsync()
  // had decided which command was even being run. In standalone mode that made
  // `--help` and `--version` perform a full snapshot-store scan first, printing
  // one "Snapshot file not found" warning per unreadable snapshot.
  //
  // Those warnings go to stderr, so JSON on stdout stayed parseable, but they
  // made `codelapse --help` slow and noisy for no reason.
  //
  // Initialisation is still required before any real command runs, because it
  // selects standalone vs IPC and constructs the standalone handler. So it is
  // memoised rather than skipped: the first command that needs the client pays
  // for it, exactly once.
  let clientInstance: CodeLapseClient | undefined;
  let clientReady: Promise<CodeLapseClient> | undefined;

  const getClientReady = (): Promise<CodeLapseClient> => {
    if (!clientInstance) {
      // Read after parsing, not at module load: `--verbose` is only populated
      // once Commander has parsed argv.
      const opts = program.opts() as { verbose?: boolean; timeout?: string };
      // Mode is always 'auto' (standalone first, IPC fallback) because the CLI
      // exposes no way to override it. See the note on the global options above.
      // `timeout` was previously parsed and dropped here, so `--timeout` never
      // reached the IPC client and had no effect at all.
      clientInstance = new CodeLapseClient(
        'auto',
        opts.verbose === true,
        parseTimeout(opts.timeout),
      );
    }
    if (!clientReady) {
      clientReady = clientInstance.initialize().then(() => clientInstance!);
    }
    return clientReady;
  };

  /**
   * A lazily-resolving stand-in for the client.
   *
   * Every property access returns a function that initialises on first use and
   * then delegates. Command classes can therefore be constructed safely before
   * `parseAsync()`, which is what makes `--help`, `--version` and
   * `--mode` validation possible without touching the filesystem.
   */
  const getClient = (): CodeLapseClient =>
    new Proxy({} as CodeLapseClient, {
      get(_target, property) {
        if (property === 'then') {
          // Never look thenable: awaiting the proxy directly would recurse.
          return undefined;
        }
        return (...args: unknown[]) =>
          getClientReady().then((real) => {
            const member = (real as unknown as Record<string, unknown>)[
              property as string
            ];
            if (typeof member !== 'function') {
              return member;
            }
            return (member as (...a: unknown[]) => unknown).apply(real, args);
          });
      },
    });

  // Global error handling
  process.on('uncaughtException', (error) => {
    if (program.opts().json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(chalk.red('Error:'), error.message);
    }
    process.exit(1);
  });

  // Connection status command
  program
    .command('status')
    .description('Check connection to CodeLapse extension')
    .action(async (options) => {
      const globalOpts = program.opts();
      const spinner = globalOpts.silent
        ? null
        : ora('Checking connection...').start();

      try {
        const client = getClient();
        const status = await client.getStatus();

        // `getClient()` is a proxy whose members resolve asynchronously, so
        // these must be awaited: an un-awaited call is a truthy Promise, which
        // claimed standalone mode even over IPC and serialised as `{}`.
        const activeMode = await client.getActiveMode();

        // Standalone mode talks to .snapshots/ directly -- claiming the VS Code
        // extension is connected there is simply false, and it sent anyone
        // debugging a missing extension down the wrong path.
        const connectedMessage =
          activeMode === 'standalone'
            ? 'Connected (standalone mode)'
            : 'Connected to CodeLapse extension';

        if (spinner) spinner.succeed(connectedMessage);

        if (globalOpts.json) {
          console.log(
            JSON.stringify({
              success: true,
              connected: status.connected,
              mode: activeMode,
              workspace: status.workspace,
              totalSnapshots: status.totalSnapshots,
              currentSnapshot: status.currentSnapshot,
            }),
          );
        } else {
          console.log(chalk.green('✓ ' + connectedMessage));
          console.log(`Workspace: ${status.workspace || 'None'}`);
          console.log(`Total snapshots: ${status.totalSnapshots}`);
          console.log(`Current snapshot: ${status.currentSnapshot || 'None'}`);
        }
      } catch (error) {
        if (spinner) spinner.fail('Failed to connect');

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (globalOpts.json) {
          printResult({ success: false, error: errorMessage }, globalOpts);
        } else {
          console.error(chalk.red('✗ Failed to connect:'), errorMessage);
          console.log('\nTroubleshooting:');
          console.log('1. Make sure VSCode is running');
          console.log(
            '2. Make sure the CodeLapse extension is installed and enabled',
          );
          console.log('3. Open a workspace folder in VSCode');
          // Record the failure without exiting here: the post-action hook
          // chooses the code, so the client still disconnects and stdio flushes.
          setFailure();
        }
      }
    });

  // Snapshot management commands
  const snapshotCommands = new SnapshotCommands(getClient());
  const snapshotCmd = program
    .command('snapshot')
    .alias('snap')
    .description('Snapshot management commands');

  snapshotCmd
    .command('create [description]')
    .alias('new')
    .description('Create a new snapshot')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('-n, --notes <notes>', 'Snapshot notes')
    .option('-r, --task-ref <ref>', 'Task reference')
    .option('-f, --favorite', 'Mark as favorite')
    .option('-s, --selective', 'Selective snapshot (choose files)')
    .option(
      '--files <files>',
      'Comma-separated file paths for selective snapshot',
    )
    .action(snapshotCommands.create.bind(snapshotCommands));

  snapshotCmd
    .command('list')
    .alias('ls')
    .description('List all snapshots')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('-f, --favorites', 'Show only favorites')
    .option('-l, --limit <number>', 'Limit number of results')
    .option(
      '--since <date>',
      'Show snapshots since date (ISO string or relative like "1h", "2d")',
    )
    .action(snapshotCommands.list.bind(snapshotCommands));

  snapshotCmd
    .command('show <id>')
    .description('Show snapshot details')
    .option('--files', 'Show file changes')
    .option('--content <file>', 'Show content of specific file')
    .action(snapshotCommands.show.bind(snapshotCommands));

  snapshotCmd
    .command('restore <id>')
    .description('Restore a snapshot')
    .option('--backup', 'Create backup snapshot before restore')
    .option('--files <files>', 'Restore only specific files (comma-separated)')
    .option('-y, --yes', 'Skip confirmation')
    .action(snapshotCommands.restore.bind(snapshotCommands));

  snapshotCmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete a snapshot')
    .option('-y, --yes', 'Skip confirmation')
    .action(snapshotCommands.delete.bind(snapshotCommands));

  snapshotCmd
    .command('compare <id1> <id2>')
    .alias('diff')
    .description('Compare two snapshots')
    .option('--files', 'Show file-level changes only')
    .action(snapshotCommands.compare.bind(snapshotCommands));

  snapshotCmd
    .command('navigate <direction>')
    .alias('nav')
    .description('Navigate to previous/next snapshot')
    .action(snapshotCommands.navigate.bind(snapshotCommands));

  // Search commands
  const searchCommands = new SearchCommands(getClient());
  const searchCmd = program
    .command('search')
    .description('Semantic search commands');

  searchCmd
    .command('query <query>')
    .alias('q')
    .description(
      'Search snapshots with natural language (enhanced with AI-optimized features)',
    )
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.65')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option(
      '-m, --mode <mode>',
      'Search mode: semantic, syntactic, behavioral, hybrid',
      'semantic',
    )
    .option('--no-explanations', 'Disable result explanations')
    .option('--no-relationships', 'Disable relationship information')
    .option('--no-quality', 'Disable quality metrics')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option(
      '-r, --ranking <strategy>',
      'Ranking strategy: relevance, quality, recency, usage',
      'relevance',
    )
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option(
      '--semantic-types <types>',
      'Filter by semantic types (comma-separated)',
    )
    .option(
      '--patterns <patterns>',
      'Filter by design patterns (comma-separated)',
    )
    .option(
      '--exclude-smells <smells>',
      'Exclude code smells (comma-separated)',
    )
    .option(
      '--domains <domains>',
      'Filter by business domains (comma-separated)',
    )
    .option('--max-per-file <number>', 'Maximum results per file')
    .option('--no-diversify', 'Disable result diversification')
    .action(searchCommands.query.bind(searchCommands));

  searchCmd
    .command('behavioral <description>')
    .alias('b')
    .description('Search for code based on behavioral description')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.6')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('--no-relationships', 'Disable relationship information')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option(
      '--semantic-types <types>',
      'Filter by semantic types (comma-separated)',
    )
    .option(
      '--patterns <patterns>',
      'Filter by design patterns (comma-separated)',
    )
    .option(
      '--exclude-smells <smells>',
      'Exclude code smells (comma-separated)',
    )
    .option(
      '--domains <domains>',
      'Filter by business domains (comma-separated)',
    )
    .action(searchCommands.behavioral.bind(searchCommands));

  searchCmd
    .command('pattern <pattern-type>')
    .alias('p')
    .description('Search for specific design patterns or code structures')
    .option('-l, --limit <number>', 'Limit results', '15')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.7')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('-c, --context <lines>', 'Context radius in lines', '8')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option(
      '--semantic-types <types>',
      'Filter by semantic types (comma-separated)',
    )
    .option(
      '--exclude-smells <smells>',
      'Exclude code smells (comma-separated)',
    )
    .option(
      '--domains <domains>',
      'Filter by business domains (comma-separated)',
    )
    .action(searchCommands.pattern.bind(searchCommands));

  searchCmd
    .command('batch <queries-file>')
    .description('Execute multiple search queries from JSON file')
    .option('--no-parallel', 'Disable parallel processing')
    .option('--concurrency <number>', 'Maximum concurrent queries', '3')
    .action(searchCommands.batch.bind(searchCommands));

  searchCmd
    .command('index')
    .description('Index snapshots for semantic search')
    .option('--all', 'Index all snapshots')
    .action(searchCommands.index.bind(searchCommands));

  // Workspace commands
  const workspaceCommands = new WorkspaceCommands(getClient());
  const workspaceCmd = program
    .command('workspace')
    .alias('ws')
    .description('Workspace information commands');

  workspaceCmd
    .command('info')
    .description('Show workspace information')
    .action(workspaceCommands.info.bind(workspaceCommands));

  workspaceCmd
    .command('state')
    .description('Show current workspace state')
    .action(workspaceCommands.state.bind(workspaceCommands));

  workspaceCmd
    .command('files')
    .description('List workspace files')
    .option('--changed', 'Show only changed files')
    .action(workspaceCommands.files.bind(workspaceCommands));

  // Utility commands
  const utilityCommands = new UtilityCommands(getClient());
  const utilityCmd = program
    .command('utility')
    .alias('util')
    .description('Utility commands');

  utilityCmd
    .command('validate <id>')
    .description('Validate a snapshot')
    .action(utilityCommands.validate.bind(utilityCommands));

  utilityCmd
    .command('export <id>')
    .description('Export a snapshot')
    .option('-f, --format <format>', 'Export format (json|zip)', 'json')
    .option('-o, --output <path>', 'Output path')
    .action(utilityCommands.export.bind(utilityCommands));

  // Enhanced search commands for AI agents
  const enhancedSearchCommands = new EnhancedSearchCommands(getClient());
  const enhancedSearchCmd = program
    .command('search-enhanced')
    .alias('se')
    .description('Enhanced semantic search commands for AI agents');

  enhancedSearchCmd
    .command('query <query>')
    .alias('q')
    .description('Enhanced semantic search with AI-optimized features')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.65')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option(
      '-m, --mode <mode>',
      'Search mode: semantic, syntactic, behavioral, hybrid',
      'semantic',
    )
    .option('--no-explanations', 'Disable result explanations')
    .option('--no-relationships', 'Disable relationship information')
    .option('--no-quality', 'Disable quality metrics')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option(
      '-r, --ranking <strategy>',
      'Ranking strategy: relevance, quality, recency, usage',
      'relevance',
    )
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option(
      '--semantic-types <types>',
      'Filter by semantic types (comma-separated)',
    )
    .option(
      '--patterns <patterns>',
      'Filter by design patterns (comma-separated)',
    )
    .option(
      '--exclude-smells <smells>',
      'Exclude code smells (comma-separated)',
    )
    .option(
      '--domains <domains>',
      'Filter by business domains (comma-separated)',
    )
    .option('--max-per-file <number>', 'Maximum results per file')
    .option('--no-diversify', 'Disable result diversification')
    .action(enhancedSearchCommands.enhanced.bind(enhancedSearchCommands));

  enhancedSearchCmd
    .command('behavioral <description>')
    .alias('b')
    .description('Search for code based on behavioral description')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.6')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('--no-relationships', 'Disable relationship information')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .action(enhancedSearchCommands.behavioral.bind(enhancedSearchCommands));

  enhancedSearchCmd
    .command('pattern <pattern-type>')
    .alias('p')
    .description('Search for specific design patterns or code structures')
    .option('-l, --limit <number>', 'Limit results', '15')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.7')
    .option(
      '--snapshots <ids>',
      'Search specific snapshots (comma-separated IDs)',
    )
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('-c, --context <lines>', 'Context radius in lines', '8')
    .action(enhancedSearchCommands.pattern.bind(enhancedSearchCommands));

  enhancedSearchCmd
    .command('batch <queries-file>')
    .description('Execute multiple search queries from JSON file')
    .option('--no-parallel', 'Disable parallel processing')
    .option('--concurrency <number>', 'Maximum concurrent queries', '3')
    .action(enhancedSearchCommands.batch.bind(enhancedSearchCommands));

  // Code analysis commands
  const analysisCommands = new AnalysisCommands(getClient());
  const analysisCmd = program
    .command('analyze')
    .alias('an')
    .description('Code analysis commands for AI agents');

  analysisCmd
    .command('chunk <chunk-id>')
    .description('Analyze a specific code chunk')
    .option('-s, --snapshot <id>', 'Snapshot ID (required)')
    .option('-t, --type <type>', 'Analysis type: full, quick, quality', 'full')
    .option('--no-relationships', 'Disable relationship analysis')
    .option('--no-quality', 'Disable quality metrics')
    .option('--no-context', 'Disable context information')
    .action(analysisCommands.chunk.bind(analysisCommands));

  analysisCmd
    .command('file <file-path>')
    .description('Analyze a complete file')
    .option('-s, --snapshot <id>', 'Snapshot ID (required)')
    .option('-t, --type <type>', 'Analysis type: full, quick, quality', 'full')
    .option('--no-chunks', 'Disable chunk information')
    .option('--no-metrics', 'Disable file metrics')
    .option('--no-suggestions', 'Disable improvement suggestions')
    .action(analysisCommands.file.bind(analysisCommands));

  analysisCmd
    .command('quality <target>')
    .description('Analyze code quality metrics')
    .option('-s, --snapshot <id>', 'Snapshot ID (required)')
    .option(
      '-m, --metrics <metrics>',
      'Specific metrics (comma-separated): readability,maintainability,complexity,documentation',
    )
    .option('--no-recommendations', 'Disable recommendations')
    .option('--no-trends', 'Disable trend analysis')
    .option('--threshold <number>', 'Quality threshold (0-1)', '0.7')
    .action(analysisCommands.quality.bind(analysisCommands));

  analysisCmd
    .command('relationships <chunk-id>')
    .description('Analyze chunk relationships and dependencies')
    .option('--no-transitive', 'Disable transitive relationships')
    .option('-d, --depth <number>', 'Maximum relationship depth', '3')
    .option(
      '--types <types>',
      'Relationship types (comma-separated): calls,imports,extends,implements',
    )
    .option('--no-strength', 'Disable relationship strength calculation')
    .action(analysisCommands.relationships.bind(analysisCommands));

  analysisCmd
    .command('batch <input-file>')
    .description('Execute multiple analysis operations from JSON file')
    .option('--no-parallel', 'Disable parallel processing')
    .option('--concurrency <number>', 'Maximum concurrent operations', '5')
    .action(analysisCommands.batch.bind(analysisCommands));

  // Enhanced chunking commands
  const chunkingCommands = new ChunkingCommands(getClient());
  const chunkingCmd = program
    .command('chunk')
    .alias('ch')
    .description('Enhanced code chunking commands');

  chunkingCmd
    .command('file <file-path>')
    .description('Chunk a specific file with enhanced strategies')
    .option('-s, --snapshot <id>', 'Snapshot ID (required)')
    .option(
      '--strategy <strategy>',
      'Chunking strategy: semantic, hierarchical, context-aware',
      'semantic',
    )
    .option('--max-size <number>', 'Maximum chunk size in lines', '1000')
    .option('--min-size <number>', 'Minimum chunk size in lines', '50')
    .option('--overlap <number>', 'Overlap between chunks in lines', '0')
    .option('--no-preserve-structure', 'Disable structure preservation')
    .option('--no-context', 'Disable context inclusion')
    .action(chunkingCommands.file.bind(chunkingCommands));

  chunkingCmd
    .command('snapshot <snapshot-id>')
    .description('Chunk all files in a snapshot')
    .option(
      '--strategy <strategy>',
      'Chunking strategy: semantic, hierarchical, context-aware',
      'semantic',
    )
    .option(
      '--patterns <patterns>',
      'File patterns to include (comma-separated)',
    )
    .option('--max-size <number>', 'Maximum chunk size in lines', '1000')
    .option('--min-size <number>', 'Minimum chunk size in lines', '50')
    .option('--overlap <number>', 'Overlap between chunks in lines', '0')
    .option('--no-preserve-structure', 'Disable structure preservation')
    .option('--no-context', 'Disable context inclusion')
    .option('--no-exclude-binary', 'Include binary files')
    .option('--exclude-tests', 'Exclude test files')
    .action(chunkingCommands.snapshot.bind(chunkingCommands));

  chunkingCmd
    .command('list <snapshot-id>')
    .description('List chunks in a snapshot with filtering')
    .option('-f, --file <file-path>', 'Filter by specific file')
    .option('--types <types>', 'Filter by semantic types (comma-separated)')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option(
      '--patterns <patterns>',
      'Filter by design patterns (comma-separated)',
    )
    .option(
      '--exclude-smells <smells>',
      'Exclude code smells (comma-separated)',
    )
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Results per page', '50')
    .option(
      '--sort <field>',
      'Sort by field: startLine, endLine, quality, complexity',
      'startLine',
    )
    .option('--order <order>', 'Sort order: asc, desc', 'asc')
    .action(chunkingCommands.list.bind(chunkingCommands));

  chunkingCmd
    .command('metadata <chunk-id>')
    .description('Get detailed metadata for a chunk')
    .option('--no-relationships', 'Disable relationship information')
    .option('--no-quality', 'Disable quality metrics')
    .option('--no-context', 'Disable context information')
    .option('--context-radius <number>', 'Context radius in lines', '5')
    .action(chunkingCommands.metadata.bind(chunkingCommands));

  chunkingCmd
    .command('context <chunk-id>')
    .description('Get contextual information for a chunk')
    .option('-r, --radius <number>', 'Context radius in lines', '5')
    .option('--no-file-context', 'Disable file context')
    .option('--no-architectural', 'Disable architectural context')
    .option('--no-business', 'Disable business context')
    .action(chunkingCommands.context.bind(chunkingCommands));

  chunkingCmd
    .command('dependencies <chunk-id>')
    .description('Get chunk dependencies and relationships')
    .option('--no-transitive', 'Disable transitive dependencies')
    .option('-d, --depth <number>', 'Maximum dependency depth', '3')
    .option(
      '--types <types>',
      'Dependency types (comma-separated): imports,calls,extends,implements',
    )
    .option('--no-strength', 'Disable relationship strength calculation')
    .action(chunkingCommands.dependencies.bind(chunkingCommands));

  // Configuration commands
  const configCommands = new ConfigCommands(getClient());
  const configCmd = program
    .command('config')
    .alias('cfg')
    .description('Configuration management commands');

  configCmd
    .command('get [key]')
    .description('Get configuration value(s)')
    .action(configCommands.get.bind(configCommands));

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(configCommands.set.bind(configCommands));

  configCmd
    .command('reset [key]')
    .description('Reset configuration to defaults')
    .action(configCommands.reset.bind(configCommands));

  configCmd
    .command('list')
    .description('List available configuration keys')
    .action(configCommands.list.bind(configCommands));

  configCmd
    .command('validate')
    .description('Validate current configuration')
    .action(configCommands.validate.bind(configCommands));

  configCmd
    .command('export <file-path>')
    .description('Export configuration to file')
    .option('-f, --format <format>', 'Export format: json, yaml', 'json')
    .action(configCommands.export.bind(configCommands));

  configCmd
    .command('import <file-path>')
    .description('Import configuration from file')
    .option('--merge', 'Merge with existing config instead of replacing')
    .action(configCommands.import.bind(configCommands));

  // File-level snapshot operations
  const filesCommands = new FilesCommands(getClient());
  const filesCmd = program
    .command('files')
    .description('File-level snapshot operations');

  filesCmd
    .command('list <snapshot-id>')
    .alias('ls')
    .description('List files in a snapshot')
    .option('--changed-only', 'Show only changed files')
    .option('--content', 'Include file content preview')
    .option('--pattern <pattern>', 'Filter files by pattern')
    .option('--sort-by <field>', 'Sort by: path, size, modified', 'path')
    .option('--sort-order <order>', 'Sort order: asc, desc', 'asc')
    .action(filesCommands.list.bind(filesCommands));

  filesCmd
    .command('show <snapshot-id> <file-path>')
    .description('Show file content from a snapshot')
    // `--no-*` flags populate the positive key with `false`, which is what the
    // handler now reads. Declaring them as `--no-content` is what API.md
    // documents; the handler previously looked for a `noContent` key that
    // Commander never sets, so every one of these was a silent no-op.
    .option('--no-content', 'Skip file content')
    .option('--no-metadata', 'Skip file metadata')
    .option('--no-syntax', 'Skip syntax highlighting')
    .option('--no-line-numbers', 'Skip line numbers')
    .option('--context <lines>', 'Context lines around changes')
    .action(filesCommands.show.bind(filesCommands));

  filesCmd
    .command('compare <id1> <id2> <file-path>')
    .alias('diff')
    .description('Compare a file between two snapshots')
    .option('-c, --context <lines>', 'Context lines for diff', '3')
    .option('--ignore-whitespace', 'Ignore whitespace changes')
    .option('--side-by-side', 'Side-by-side diff format')
    .action(filesCommands.compare.bind(filesCommands));

  filesCmd
    .command('restore <snapshot-id> <file-path>')
    .description('Restore a single file from a snapshot')
    .option('--to <path>', 'Restore to a different path')
    .option('--no-backup', 'Skip creating a backup')
    .option('-f, --force', 'Force restore without confirmation')
    .action(filesCommands.restore.bind(filesCommands));

  filesCmd
    .command('history <file-path>')
    .description('Show file history across snapshots')
    .option('-l, --limit <number>', 'Limit results', '50')
    .option('--since <time>', 'Show history since time')
    .option('--content', 'Include content changes')
    .option('--sort-order <order>', 'Sort order: asc, desc', 'desc')
    .action(filesCommands.history.bind(filesCommands));

  filesCmd
    .command('export <snapshot-id> <file-path> <output-path>')
    .description('Export a file from a snapshot')
    .option('--format <format>', 'Export format: original, json', 'original')
    .option('--metadata', 'Include metadata in export')
    .action(filesCommands.export.bind(filesCommands));

  // Filter and manage snapshots
  const filterCommands = new FilterCommands(getClient());
  const filterCmd = program
    .command('filter')
    .alias('f')
    .description('Filter and manage snapshots');

  filterCmd
    .command('favorites')
    .alias('fav')
    .description('Show favorite snapshots')
    .option('-l, --limit <number>', 'Limit results')
    .option('--offset <number>', 'Offset for pagination')
    .action(filterCommands.favorites.bind(filterCommands));

  filterCmd
    .command('tags <tags>')
    .description('Filter snapshots by tags')
    .option('-l, --limit <number>', 'Limit results')
    .option('--offset <number>', 'Offset for pagination')
    .action(filterCommands.byTags.bind(filterCommands));

  filterCmd
    .command('date <range>')
    .description('Filter snapshots by date')
    .option('-l, --limit <number>', 'Limit results')
    .option('--offset <number>', 'Offset for pagination')
    .action(filterCommands.byDate.bind(filterCommands));

  filterCmd
    .command('file <file-path>')
    .description('Filter snapshots by file path')
    .option('-l, --limit <number>', 'Limit results')
    .option('--offset <number>', 'Offset for pagination')
    .action(filterCommands.byFile.bind(filterCommands));

  filterCmd
    .command('favorite <snapshot-id>')
    .description('Toggle favorite status of a snapshot')
    .action(filterCommands.toggleFavorite.bind(filterCommands));

  filterCmd
    .command('edit-tags <snapshot-id> <tags>')
    .description('Edit snapshot tags')
    .action(filterCommands.editTags.bind(filterCommands));

  filterCmd
    .command('edit-notes <snapshot-id> <notes>')
    .description('Edit snapshot notes')
    .action(filterCommands.editNotes.bind(filterCommands));

  filterCmd
    .command('edit-task <snapshot-id> <task-ref>')
    .description('Edit snapshot task reference')
    .action(filterCommands.editTaskRef.bind(filterCommands));

  // Auto-snapshot rules
  const rulesCommands = new RulesCommands(getClient());
  const rulesCmd = program
    .command('rules')
    .alias('r')
    .description('Auto-snapshot rules management');

  rulesCmd
    .command('list')
    .alias('ls')
    .description('List auto-snapshot rules')
    .action(rulesCommands.list.bind(rulesCommands));

  rulesCmd
    .command('add <pattern> <interval>')
    .description('Add an auto-snapshot rule (interval in minutes)')
    .option('-d, --description <desc>', 'Rule description')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('--disabled', 'Create the rule in a disabled state')
    .action(rulesCommands.add.bind(rulesCommands));

  rulesCmd
    .command('update <rule-id>')
    .description('Update an auto-snapshot rule')
    .option('-p, --pattern <pattern>', 'New pattern')
    .option('-i, --interval <minutes>', 'New interval')
    .option('-d, --description <desc>', 'New description')
    .option('-t, --tags <tags>', 'New tags (comma-separated)')
    // The handler reads `options.enabled` and `options.disabled` and treats
    // each as a boolean toggle, so both are declared as plain flags.
    .option('--enabled', 'Enable the rule')
    .option('--disabled', 'Disable the rule')
    .action(rulesCommands.update.bind(rulesCommands));

  rulesCmd
    .command('remove <rule-id>')
    .alias('rm')
    .description('Remove an auto-snapshot rule')
    .action(rulesCommands.remove.bind(rulesCommands));

  rulesCmd
    .command('toggle <rule-id>')
    .description('Toggle an auto-snapshot rule enabled/disabled')
    .action(rulesCommands.toggle.bind(rulesCommands));

  rulesCmd
    .command('test <pattern>')
    .description('Test an auto-snapshot rule pattern against files')
    .option('--path <path>', 'Test path (defaults to the current directory)')
    .action(rulesCommands.test.bind(rulesCommands));

  // Diagnostics and logging
  const diagnosticsCommands = new DiagnosticsCommands(getClient());
  const diagnosticsCmd = program
    .command('diagnostics')
    .alias('diag')
    .description('Diagnostics and logging commands');

  diagnosticsCmd
    .command('run')
    .description('Run comprehensive diagnostics')
    .option('--no-system', 'Skip system information')
    .option('--no-snapshots', 'Skip snapshot checks')
    .option('--no-git', 'Skip Git checks')
    .option('--no-config', 'Skip configuration checks')
    .action(diagnosticsCommands.run.bind(diagnosticsCommands));

  diagnosticsCmd
    .command('system')
    .description('Show system information')
    .action(diagnosticsCommands.system.bind(diagnosticsCommands));

  diagnosticsCmd
    .command('logs')
    .description('Show extension logs')
    .option('-l, --lines <number>', 'Number of log lines', '100')
    .option('--level <level>', 'Log level filter: error, warn, info, debug')
    .option('--since <time>', 'Show logs since time (e.g. 1h, 2d)')
    .option('-f, --follow', 'Follow log output in real-time')
    .action(diagnosticsCommands.logs.bind(diagnosticsCommands));

  diagnosticsCmd
    .command('clear-logs')
    .description('Clear extension logs')
    .option('--older-than <time>', 'Clear logs older than time')
    .option('--level <level>', 'Clear only a specific log level')
    .action(diagnosticsCommands.clearLogs.bind(diagnosticsCommands));

  diagnosticsCmd
    .command('health')
    .description('Run health check')
    .option('--no-performance', 'Skip performance checks')
    .option('--no-connectivity', 'Skip connectivity checks')
    .option('--no-storage', 'Skip storage checks')
    .action(diagnosticsCommands.health.bind(diagnosticsCommands));

  diagnosticsCmd
    .command('performance')
    .description('Show performance metrics')
    .option('--no-history', 'Skip performance history')
    .option('--time-range <range>', 'Time range: 1h, 6h, 1d', '1h')
    .action(diagnosticsCommands.performance.bind(diagnosticsCommands));

  // AI-friendly batch operations
  program
    .command('batch <file>')
    .description('Execute batch commands from JSON file (AI-friendly)')
    .action(async (file, options) => {
      // The file read and the validation both live inside the try, so a missing
      // file, malformed JSON or a disallowed method all report a failure payload
      // and exit 1 rather than throwing a stack trace.
      try {
        const fs = await import('fs');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

        const results = await batchExecute(raw, await getClientReady());
        const failed = results.filter((r) => !r.success).length;

        // `success` reflects whether every command succeeded. It previously said
        // `true` unconditionally, so a batch in which every command failed still
        // reported success.
        printResult(
          { success: failed === 0, total: results.length, failed, results },
          options,
        );
      } catch (error) {
        printResult(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          options,
        );
      }
    });

  // Git commands
  const gitCommands = new GitCommands(getClient());
  const gitCmd = program
    .command('git')
    .alias('g')
    .description('Git integration commands');

  gitCmd
    .command('commit <snapshot-id>')
    .description('Create a Git commit from a snapshot')
    .option(
      '-m, --message <message>',
      'Commit message (auto-generated if omitted)',
    )
    .option('-b, --branch <name>', 'Create a new branch for the commit')
    .option('-u, --include-untracked', 'Include untracked files', false)
    .option('-p, --push', 'Push commit to remote', false)
    .action(gitCommands.createCommit.bind(gitCommands));

  gitCmd
    .command('auto-commit <operation>')
    .description('Create an auto-snapshot before a Git operation')
    .option('-d, --description <desc>', 'Snapshot description')
    .option('-u, --include-untracked', 'Include untracked files', false)
    .action(gitCommands.autoSnapshotBeforeOperation.bind(gitCommands));

  gitCmd
    .command('info')
    .description('Get current Git repository information')
    .action(gitCommands.getBranchInfo.bind(gitCommands));

  gitCmd
    .command('branches')
    .description('List available Git branches')
    .action(gitCommands.listBranches.bind(gitCommands));

  gitCmd
    .command('branch <name>')
    .description('Create a new Git branch')
    .option('-c, --checkout', 'Switch to branch after creating', false)
    .action(gitCommands.createBranch.bind(gitCommands));

  gitCmd
    .command('checkout <name>')
    .description('Switch to an existing Git branch')
    .action(gitCommands.switchBranch.bind(gitCommands));

  gitCmd
    .command('delete-branch <name>')
    .description('Delete a Git branch')
    .option('-f, --force', 'Force delete branch', false)
    .action(gitCommands.deleteBranch.bind(gitCommands));

  gitCmd
    .command('compare <snapshot-id> <commit-hash>')
    .description('Compare a snapshot with a Git commit')
    .option('-f, --files', 'Show file-level changes only', false)
    .action(gitCommands.compareWithCommit.bind(gitCommands));

  // Event streaming for AI tools
  program
    .command('watch')
    .description('Watch for snapshot changes (real-time events)')
    .option(
      '--events <events>',
      'Event types to watch (comma-separated): changes,snapshots,workspace',
    )
    .action(async (options) => {
      const globalOpts = program.opts();
      const eventTypes = options.events
        ? options.events.split(',')
        : ['changes', 'snapshots'];

      if (!globalOpts.silent) {
        console.log(
          chalk.blue('Watching for events... (Press Ctrl+C to stop)'),
        );
      }

      await getClient().watchEvents(eventTypes, (event) => {
        if (globalOpts.json) {
          console.log(JSON.stringify({ type: 'event', event }));
        } else {
          console.log(
            chalk.yellow(`[${new Date().toISOString()}]`),
            event.type,
            event.data,
          );
        }
      });
    });

  // JSON output for AI tools
  program
    .command('api <method>')
    .description('Direct API call (AI-friendly)')
    .option('-d, --data <json>', 'JSON data to send')
    .action(async (method, options) => {
      // Behaviour lives in commands/api so it is testable; see the note there
      // about why the failure flag matters (exit code 1, not 0).
      await runApiCall(method, options.data, getClient());
    });

  // Hook to disconnect client and exit process after command execution
  program.hook('postAction', async (thisCommand, actionCommand) => {
    const commandName = actionCommand.name();

    // For most commands, disconnect and exit gracefully.
    // The 'watch' command is long-running and should not cause an exit.
    if (commandName !== 'watch') {
      await clientInstance?.disconnect();

      // `process.exitCode` rather than a forced `process.exit`, so the process
      // exits on its own with the right status and stdio flushes first.
      //
      // The previous implementation scheduled `process.exit(0)` on an *unref'd*
      // timer. That never ran: unref'd timers do not hold the event loop open,
      // so the loop drained and the process exited naturally with the default
      // code 0 -- which is why reading the failure flag alone was not enough.
      process.exitCode = getFailure() ? 1 : 0;

      // Safety net. If a stray handle keeps the loop alive the process would
      // otherwise hang a CI job, so force the same code after a delay. This one
      // is deliberately *not* unref'd, so it actually fires.
      setTimeout(() => process.exit(getFailure() ? 1 : 0), 500);
    }
  });

  return program;
}

async function main(): Promise<void> {
  const built = buildProgram();

  // Handle shutdown gracefully. Registered here rather than at module scope so
  // that importing this module from a test installs no process listeners.
  process.on('SIGINT', () => {
    const globalOpts = built.opts();
    if (!globalOpts.silent) {
      console.log('\n' + chalk.yellow('Shutting down...'));
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });

  // Parse arguments
  await built.parseAsync();
}

// Only run when executed as the entry point. Without this guard, importing the
// module in a test would parse the test runner's argv and exit the process.
if (require.main === module) {
  main().catch((error) => {
    const globalOpts = program.opts();
    if (globalOpts.json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(chalk.red('Fatal error:'), error.message);
    }
    process.exit(1);
  });
}
