import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import type {
  AddRuleOptions,
  BaseCommandOptions,
  UpdateRuleOptions,
} from '../types/options';
import { printResult } from './output';
import { setFailure } from '../exitState';

export interface AutoSnapshotRule {
  id?: string;
  pattern: string;
  intervalMinutes: number;
  enabled?: boolean;
  description?: string;
  tags?: string[];
}

export class RulesCommands {
  constructor(private client: UnifiedClient) {}

  async list(options: BaseCommandOptions): Promise<void> {
    try {
      const result = await this.client.callApi('getAutoSnapshotRules', {});

      if (options.json) {
        printResult(
          {
            success: true,
            rules: result.rules || [],
            totalRules: result.rules?.length || 0,
          },
          options,
        );
      } else {
        const rules = result.rules || [];

        if (rules.length === 0) {
          console.log(chalk.yellow('No auto-snapshot rules configured'));
          return;
        }

        console.log(chalk.blue(`Auto-Snapshot Rules (${rules.length}):`));
        console.log('');

        rules.forEach((rule: AutoSnapshotRule, index: number) => {
          const status =
            rule.enabled !== false
              ? chalk.green('✓ Enabled')
              : chalk.red('✗ Disabled');
          console.log(
            `${chalk.cyan((index + 1).toString().padStart(2, ' '))}. ${status}`,
          );
          console.log(`    Pattern: ${chalk.yellow(rule.pattern)}`);
          console.log(
            `    Interval: ${chalk.magenta(rule.intervalMinutes)} minutes`,
          );
          if (rule.description) {
            console.log(`    Description: ${rule.description}`);
          }
          if (rule.tags && rule.tags.length > 0) {
            console.log(
              `    Tags: ${rule.tags.map((tag) => chalk.blue(tag)).join(', ')}`,
            );
          }
          console.log('');
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to list auto-snapshot rules:'),
          errorMessage,
        );
      }
    }
  }

  async add(
    pattern: string,
    interval: string,
    options: AddRuleOptions,
  ): Promise<void> {
    const rule: AutoSnapshotRule = {
      pattern,
      intervalMinutes: parseInt(interval),
      enabled: !options.disabled,
      description: options.description,
      tags: options.tags
        ? options.tags.split(',').map((t: string) => t.trim())
        : undefined,
    };

    if (isNaN(rule.intervalMinutes) || rule.intervalMinutes < 1) {
      const errorMessage = 'Invalid interval. Must be a number greater than 0.';
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(chalk.red('✗ ' + errorMessage));
      }
      return;
    }

    try {
      const result = await this.client.callApi('addAutoSnapshotRule', { rule });

      if (options.json) {
        printResult(
          {
            success: true,
            rule: result.rule,
            message: 'Auto-snapshot rule added successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Auto-snapshot rule added successfully'));
        console.log(`Pattern: ${chalk.yellow(rule.pattern)}`);
        console.log(`Interval: ${chalk.magenta(rule.intervalMinutes)} minutes`);
        console.log(
          `Status: ${
            rule.enabled ? chalk.green('Enabled') : chalk.red('Disabled')
          }`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to add auto-snapshot rule:'),
          errorMessage,
        );
      }
    }
  }

  async update(ruleId: string, options: UpdateRuleOptions): Promise<void> {
    const updates: Partial<AutoSnapshotRule> = {};

    if (options.pattern) updates.pattern = options.pattern;
    if (options.interval)
      updates.intervalMinutes = parseInt(String(options.interval));
    if (options.description !== undefined)
      updates.description = options.description;
    if (options.tags !== undefined) {
      updates.tags = options.tags
        ? options.tags.split(',').map((t: string) => t.trim())
        : [];
    }
    if (options.enabled !== undefined) updates.enabled = options.enabled;
    if (options.disabled !== undefined) updates.enabled = !options.disabled;

    if (
      updates.intervalMinutes &&
      (isNaN(updates.intervalMinutes) || updates.intervalMinutes < 1)
    ) {
      const errorMessage = 'Invalid interval. Must be a number greater than 0.';
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(chalk.red('✗ ' + errorMessage));
      }
      return;
    }

    try {
      const result = await this.client.callApi('updateAutoSnapshotRule', {
        ruleId,
        updates,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            rule: result.rule,
            message: 'Auto-snapshot rule updated successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Auto-snapshot rule updated successfully'));
        const rule = result.rule;
        console.log(`Pattern: ${chalk.yellow(rule.pattern)}`);
        console.log(`Interval: ${chalk.magenta(rule.intervalMinutes)} minutes`);
        console.log(
          `Status: ${
            rule.enabled ? chalk.green('Enabled') : chalk.red('Disabled')
          }`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to update auto-snapshot rule:'),
          errorMessage,
        );
      }
    }
  }

  async remove(ruleId: string, options: BaseCommandOptions): Promise<void> {
    try {
      await this.client.callApi('removeAutoSnapshotRule', {
        ruleId,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            ruleId,
            message: 'Auto-snapshot rule removed successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Auto-snapshot rule removed successfully'));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to remove auto-snapshot rule:'),
          errorMessage,
        );
      }
    }
  }

  async toggle(ruleId: string, options: BaseCommandOptions): Promise<void> {
    try {
      const result = await this.client.callApi('toggleAutoSnapshotRule', {
        ruleId,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            ruleId,
            enabled: result.rule.enabled,
            message: `Auto-snapshot rule ${
              result.rule.enabled ? 'enabled' : 'disabled'
            }`,
          },
          options,
        );
      } else {
        const status = result.rule.enabled
          ? chalk.green('enabled')
          : chalk.red('disabled');
        console.log(chalk.green(`✓ Auto-snapshot rule ${status}`));
        console.log(`Pattern: ${chalk.yellow(result.rule.pattern)}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to toggle auto-snapshot rule:'),
          errorMessage,
        );
      }
    }
  }

  async test(
    pattern: string,
    options: BaseCommandOptions & { path?: string },
  ): Promise<void> {
    const opts = {
      pattern,
      testPath: options.path || process.cwd(),
    };

    try {
      const result = await this.client.callApi('testAutoSnapshotRule', opts);

      if (options.json) {
        printResult(
          {
            success: true,
            pattern,
            matches: result.matches || [],
            totalMatches: result.matches?.length || 0,
          },
          options,
        );
      } else {
        console.log(chalk.blue(`Testing pattern: ${chalk.yellow(pattern)}`));
        console.log(`Test path: ${opts.testPath}`);
        console.log('');

        const matches = result.matches || [];
        if (matches.length === 0) {
          console.log(chalk.yellow('No files match this pattern'));
        } else {
          console.log(chalk.green(`Found ${matches.length} matching files:`));
          matches.forEach((file: string) => {
            console.log(`  ${chalk.cyan(file)}`);
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to test auto-snapshot rule:'),
          errorMessage,
        );
      }
    }
  }
}
