#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { CodeLapseClient } from './client';
import { SnapshotCommands } from './commands/snapshot';
import { SearchCommands } from './commands/search';
import { WorkspaceCommands } from './commands/workspace';
import { UtilityCommands } from './commands/utility';
import { EnhancedSearchCommands } from './commands/enhanced-search';
import { AnalysisCommands } from './commands/analysis';
import { ChunkingCommands } from './commands/chunking';

const program = new Command();

async function main() {
  program
    .name('codelapse')
    .alias('cl')
    .description('CLI for CodeLapse VSCode extension - AI-friendly snapshot management')
    .version('1.0.0');

  // Global options
  program
    .option('--json', 'Output in JSON format (AI-friendly)')
    .option('--silent', 'Silent mode - no user prompts or status messages')
    .option('--verbose', 'Verbose output for debugging')
    .option('--timeout <ms>', 'Connection timeout in milliseconds', '5000');

  // Initialize client
  const client = new CodeLapseClient();

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
      const spinner = globalOpts.silent ? null : ora('Checking connection...').start();
      
      try {
        const status = await client.getStatus();
        
        if (spinner) spinner.succeed('Connected to CodeLapse extension');
        
        if (globalOpts.json) {
          console.log(JSON.stringify({
            success: true,
            connected: status.connected,
            workspace: status.workspace,
            totalSnapshots: status.totalSnapshots,
            currentSnapshot: status.currentSnapshot
          }));
        } else {
          console.log(chalk.green('✓ Connected to CodeLapse extension'));
          console.log(`Workspace: ${status.workspace || 'None'}`);
          console.log(`Total snapshots: ${status.totalSnapshots}`);
          console.log(`Current snapshot: ${status.currentSnapshot || 'None'}`);
        }
      } catch (error) {
        if (spinner) spinner.fail('Failed to connect');
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (globalOpts.json) {
          console.log(JSON.stringify({ success: false, error: errorMessage }));
        } else {
          console.error(chalk.red('✗ Failed to connect:'), errorMessage);
          console.log('\nTroubleshooting:');
          console.log('1. Make sure VSCode is running');
          console.log('2. Make sure the CodeLapse extension is installed and enabled');
          console.log('3. Open a workspace folder in VSCode');
        }
        process.exit(1);
      }
    });

  // Snapshot management commands
  const snapshotCommands = new SnapshotCommands(client);
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
    .option('--files <files>', 'Comma-separated file paths for selective snapshot')
    .action(snapshotCommands.create.bind(snapshotCommands));

  snapshotCmd
    .command('list')
    .alias('ls')
    .description('List all snapshots')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('-f, --favorites', 'Show only favorites')
    .option('-l, --limit <number>', 'Limit number of results')
    .option('--since <date>', 'Show snapshots since date (ISO string or relative like "1h", "2d")')
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
  const searchCommands = new SearchCommands(client);
  const searchCmd = program
    .command('search')
    .description('Semantic search commands');

  searchCmd
    .command('query <query>')
    .alias('q')
    .description('Search snapshots with natural language (enhanced with AI-optimized features)')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.65')
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('-m, --mode <mode>', 'Search mode: semantic, syntactic, behavioral, hybrid', 'semantic')
    .option('--no-explanations', 'Disable result explanations')
    .option('--no-relationships', 'Disable relationship information')
    .option('--no-quality', 'Disable quality metrics')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option('-r, --ranking <strategy>', 'Ranking strategy: relevance, quality, recency, usage', 'relevance')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option('--semantic-types <types>', 'Filter by semantic types (comma-separated)')
    .option('--patterns <patterns>', 'Filter by design patterns (comma-separated)')
    .option('--exclude-smells <smells>', 'Exclude code smells (comma-separated)')
    .option('--domains <domains>', 'Filter by business domains (comma-separated)')
    .option('--max-per-file <number>', 'Maximum results per file')
    .option('--no-diversify', 'Disable result diversification')
    .action(searchCommands.query.bind(searchCommands));

  searchCmd
    .command('behavioral <description>')
    .alias('b')
    .description('Search for code based on behavioral description')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.6')
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('--no-relationships', 'Disable relationship information')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option('--semantic-types <types>', 'Filter by semantic types (comma-separated)')
    .option('--patterns <patterns>', 'Filter by design patterns (comma-separated)')
    .option('--exclude-smells <smells>', 'Exclude code smells (comma-separated)')
    .option('--domains <domains>', 'Filter by business domains (comma-separated)')
    .action(searchCommands.behavioral.bind(searchCommands));

  searchCmd
    .command('pattern <pattern-type>')
    .alias('p')
    .description('Search for specific design patterns or code structures')
    .option('-l, --limit <number>', 'Limit results', '15')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.7')
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('-c, --context <lines>', 'Context radius in lines', '8')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option('--semantic-types <types>', 'Filter by semantic types (comma-separated)')
    .option('--exclude-smells <smells>', 'Exclude code smells (comma-separated)')
    .option('--domains <domains>', 'Filter by business domains (comma-separated)')
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
  const workspaceCommands = new WorkspaceCommands(client);
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
  const utilityCommands = new UtilityCommands(client);
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
  const enhancedSearchCommands = new EnhancedSearchCommands(client);
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
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .option('-m, --mode <mode>', 'Search mode: semantic, syntactic, behavioral, hybrid', 'semantic')
    .option('--no-explanations', 'Disable result explanations')
    .option('--no-relationships', 'Disable relationship information')
    .option('--no-quality', 'Disable quality metrics')
    .option('-c, --context <lines>', 'Context radius in lines', '5')
    .option('-r, --ranking <strategy>', 'Ranking strategy: relevance, quality, recency, usage', 'relevance')
    .option('--complexity-min <number>', 'Minimum complexity score')
    .option('--complexity-max <number>', 'Maximum complexity score')
    .option('--quality-min <number>', 'Minimum quality threshold')
    .option('--semantic-types <types>', 'Filter by semantic types (comma-separated)')
    .option('--patterns <patterns>', 'Filter by design patterns (comma-separated)')
    .option('--exclude-smells <smells>', 'Exclude code smells (comma-separated)')
    .option('--domains <domains>', 'Filter by business domains (comma-separated)')
    .option('--max-per-file <number>', 'Maximum results per file')
    .option('--no-diversify', 'Disable result diversification')
    .action(enhancedSearchCommands.enhanced.bind(enhancedSearchCommands));

  enhancedSearchCmd
    .command('behavioral <description>')
    .alias('b')
    .description('Search for code based on behavioral description')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.6')
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
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
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
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
  const analysisCommands = new AnalysisCommands(client);
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
    .option('-m, --metrics <metrics>', 'Specific metrics (comma-separated): readability,maintainability,complexity,documentation')
    .option('--no-recommendations', 'Disable recommendations')
    .option('--no-trends', 'Disable trend analysis')
    .option('--threshold <number>', 'Quality threshold (0-1)', '0.7')
    .action(analysisCommands.quality.bind(analysisCommands));

  analysisCmd
    .command('relationships <chunk-id>')
    .description('Analyze chunk relationships and dependencies')
    .option('--no-transitive', 'Disable transitive relationships')
    .option('-d, --depth <number>', 'Maximum relationship depth', '3')
    .option('--types <types>', 'Relationship types (comma-separated): calls,imports,extends,implements')
    .option('--no-strength', 'Disable relationship strength calculation')
    .action(analysisCommands.relationships.bind(analysisCommands));

  analysisCmd
    .command('batch <input-file>')
    .description('Execute multiple analysis operations from JSON file')
    .option('--no-parallel', 'Disable parallel processing')
    .option('--concurrency <number>', 'Maximum concurrent operations', '5')
    .action(analysisCommands.batch.bind(analysisCommands));

  // Enhanced chunking commands
  const chunkingCommands = new ChunkingCommands(client);
  const chunkingCmd = program
    .command('chunk')
    .alias('ch')
    .description('Enhanced code chunking commands');

  chunkingCmd
    .command('file <file-path>')
    .description('Chunk a specific file with enhanced strategies')
    .option('-s, --snapshot <id>', 'Snapshot ID (required)')
    .option('--strategy <strategy>', 'Chunking strategy: semantic, hierarchical, context-aware', 'semantic')
    .option('--max-size <number>', 'Maximum chunk size in lines', '1000')
    .option('--min-size <number>', 'Minimum chunk size in lines', '50')
    .option('--overlap <number>', 'Overlap between chunks in lines', '0')
    .option('--no-preserve-structure', 'Disable structure preservation')
    .option('--no-context', 'Disable context inclusion')
    .action(chunkingCommands.file.bind(chunkingCommands));

  chunkingCmd
    .command('snapshot <snapshot-id>')
    .description('Chunk all files in a snapshot')
    .option('--strategy <strategy>', 'Chunking strategy: semantic, hierarchical, context-aware', 'semantic')
    .option('--patterns <patterns>', 'File patterns to include (comma-separated)')
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
    .option('--patterns <patterns>', 'Filter by design patterns (comma-separated)')
    .option('--exclude-smells <smells>', 'Exclude code smells (comma-separated)')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Results per page', '50')
    .option('--sort <field>', 'Sort by field: startLine, endLine, quality, complexity', 'startLine')
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
    .option('--types <types>', 'Dependency types (comma-separated): imports,calls,extends,implements')
    .option('--no-strength', 'Disable relationship strength calculation')
    .action(chunkingCommands.dependencies.bind(chunkingCommands));

  // AI-friendly batch operations
  program
    .command('batch <file>')
    .description('Execute batch commands from JSON file (AI-friendly)')
    .action(async (file, options) => {
      try {
        const fs = await import('fs');
        const batchCommands = JSON.parse(fs.readFileSync(file, 'utf8'));
        
        const results = [];
        for (const cmd of batchCommands) {
          try {
            const result = await client.executeCommand(cmd);
            results.push({ success: true, command: cmd, result });
          } catch (error) {
            results.push({ success: false, command: cmd, error: error instanceof Error ? error.message : String(error) });
          }
        }
        
        console.log(JSON.stringify({ success: true, results }));
      } catch (error) {
        console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });

  // Event streaming for AI tools
  program
    .command('watch')
    .description('Watch for snapshot changes (real-time events)')
    .option('--events <events>', 'Event types to watch (comma-separated): changes,snapshots,workspace')
    .action(async (options) => {
      const globalOpts = program.opts();
      const eventTypes = options.events ? options.events.split(',') : ['changes', 'snapshots'];
      
      if (!globalOpts.silent) {
        console.log(chalk.blue('Watching for events... (Press Ctrl+C to stop)'));
      }
      
      await client.watchEvents(eventTypes, (event) => {
        if (globalOpts.json) {
          console.log(JSON.stringify({ type: 'event', event }));
        } else {
          console.log(chalk.yellow(`[${new Date().toISOString()}]`), event.type, event.data);
        }
      });
    });

  // JSON output for AI tools
  program
    .command('api <method>')
    .description('Direct API call (AI-friendly)')
    .option('-d, --data <json>', 'JSON data to send')
    .action(async (method, options) => {
      try {
        const data = options.data ? JSON.parse(options.data) : {};
        const result = await client.callApi(method, data);
        console.log(JSON.stringify({ success: true, result }));
      } catch (error) {
        console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });

  // Hook to disconnect client and exit process after command execution
  program.hook('postAction', async (thisCommand, actionCommand) => {
    const commandName = actionCommand.name();

    // For most commands, disconnect and exit gracefully.
    // The 'watch' command is long-running and should not cause an exit.
    if (commandName !== 'watch') {
      await client.disconnect();
      // Force exit if the process hasn't terminated after a short delay
      const exitTimeout = setTimeout(() => {
        process.exit(0);
      }, 500); // 500ms delay
      exitTimeout.unref(); // Allow the process to exit if it finishes before the timeout
    }
  });

  // Parse arguments
  await program.parseAsync();
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  const globalOpts = program.opts();
  if (!globalOpts.silent) {
    console.log('\n' + chalk.yellow('Shutting down...'));
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Run main function
main().catch((error) => {
  const globalOpts = program.opts();
  if (globalOpts.json) {
    console.log(JSON.stringify({ success: false, error: error.message }));
  } else {
    console.error(chalk.red('Fatal error:'), error.message);
  }
  process.exit(1);
}); 