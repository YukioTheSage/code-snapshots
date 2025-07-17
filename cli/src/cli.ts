#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { CodeLapseClient } from './client';
import { SnapshotCommands } from './commands/snapshot';
import { SearchCommands } from './commands/search';
import { WorkspaceCommands } from './commands/workspace';
import { UtilityCommands } from './commands/utility';

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
    .description('Search snapshots with natural language')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.65')
    .option('--snapshots <ids>', 'Search specific snapshots (comma-separated IDs)')
    .option('--languages <langs>', 'Filter by languages (comma-separated)')
    .action(searchCommands.query.bind(searchCommands));

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