import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import type { BaseCommandOptions, ExportConfigOptions } from '../types/options';
import { printResult } from './output';
import { setFailure } from '../exitState';

export interface ConfigSettings {
  snapshotLocation: string;
  maxSnapshots: number;
  /** Maximum bytes the snapshot store may occupy (0 = no limit) */
  maxSnapshotStoreBytes: number;
  autoSnapshotInterval: number;
  loggingEnabled: boolean;
  verboseLogging: boolean;
  git: {
    addCommitInfo: boolean;
    commitFromSnapshotEnabled: boolean;
    autoSnapshotBeforeOperation: boolean;
  };
  autoSnapshot: {
    rules: Array<{
      pattern: string;
      intervalMinutes: number;
    }>;
  };
  showOnlyChangedFiles: boolean;
  ux: {
    showWelcomeOnStartup: boolean;
    showKeyboardShortcutHints: boolean;
    useAnimations: boolean;
    confirmRestoreOperations: boolean;
  };
  semanticSearch: {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    autoIndex: boolean;
  };
}

export class ConfigCommands {
  constructor(private client: UnifiedClient) {}

  async get(key?: string, options: BaseCommandOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('getConfig', { key });

      if (options.json) {
        printResult(
          {
            success: true,
            config: result.config,
            key: key || 'all',
          },
          options,
        );
      } else {
        if (key) {
          // Show specific key
          const value = result.config;
          console.log(chalk.blue(`Configuration: ${key}`));
          console.log(chalk.green(JSON.stringify(value, null, 2)));
        } else {
          // Show all configuration
          this.displayConfig(result.config);
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
          chalk.red('✗ Failed to get configuration:'),
          errorMessage,
        );
      }
    }
  }

  async set(
    key: string,
    value: string,
    options: BaseCommandOptions = {},
  ): Promise<void> {
    // Parse the value based on expected types
    let parsedValue: unknown = value;

    try {
      // Try to parse as JSON first (for objects/arrays/booleans/numbers)
      if (
        value.startsWith('{') ||
        value.startsWith('[') ||
        value === 'true' ||
        value === 'false' ||
        !isNaN(Number(value))
      ) {
        parsedValue = JSON.parse(value);
      }
    } catch (e) {
      // Keep as string if JSON parsing fails
      parsedValue = value;
    }

    try {
      const result = await this.client.callApi('setConfig', {
        key,
        value: parsedValue,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            key,
            value: result.value,
            warning: result.warning,
            message: 'Configuration updated successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Configuration updated successfully'));
        console.log(
          `${chalk.cyan(key)}: ${chalk.yellow(JSON.stringify(result.value))}`,
        );
        if (result.warning) {
          console.log(chalk.yellow(`⚠ ${result.warning}`));
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
          chalk.red('✗ Failed to set configuration:'),
          errorMessage,
        );
      }
    }
  }

  async reset(key?: string, options: BaseCommandOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('resetConfig', { key });

      if (options.json) {
        printResult(
          {
            success: true,
            key: key || 'all',
            resetValues: result.resetValues,
            message: key
              ? `Configuration key "${key}" reset to default`
              : 'All configuration reset to defaults',
          },
          options,
        );
      } else {
        const message = key
          ? `Configuration key "${key}" reset to default`
          : 'All configuration reset to defaults';
        console.log(chalk.green(`✓ ${message}`));

        if (key) {
          console.log(
            `${chalk.cyan(key)}: ${chalk.yellow(
              JSON.stringify(result.resetValues),
            )}`,
          );
        } else {
          console.log(chalk.blue('Reset values:'));
          this.displayConfig(result.resetValues);
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
          chalk.red('✗ Failed to reset configuration:'),
          errorMessage,
        );
      }
    }
  }

  async list(options: BaseCommandOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('getConfigSchema', {});

      if (options.json) {
        printResult(
          {
            success: true,
            schema: result.schema || {},
            availableKeys: result.availableKeys || [],
          },
          options,
        );
      } else {
        console.log(chalk.blue('Available Configuration Keys:'));
        console.log('');

        const schema = result.schema || {};
        const keys = Object.keys(schema);

        if (keys.length === 0) {
          console.log(chalk.yellow('No configuration schema available'));
          return;
        }

        keys.sort().forEach((key) => {
          const config = schema[key];
          console.log(`${chalk.cyan(key)}`);
          console.log(`  ${chalk.gray('Type:')} ${config.type}`);
          console.log(
            `  ${chalk.gray('Default:')} ${chalk.yellow(
              JSON.stringify(config.default),
            )}`,
          );
          console.log(`  ${chalk.gray('Description:')} ${config.description}`);
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
          chalk.red('✗ Failed to list configuration:'),
          errorMessage,
        );
      }
    }
  }

  async validate(options: BaseCommandOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('validateConfig', {});

      if (options.json) {
        printResult(
          {
            success: true,
            isValid: result.isValid,
            errors: result.errors || [],
            warnings: result.warnings || [],
          },
          options,
        );
      } else {
        if (result.isValid) {
          console.log(chalk.green('✓ Configuration is valid'));
        } else {
          console.log(chalk.red('✗ Configuration has errors'));
        }

        if (result.errors && result.errors.length > 0) {
          console.log(chalk.red('\nErrors:'));
          result.errors.forEach((error: string) => {
            console.log(`  ${chalk.red('•')} ${error}`);
          });
        }

        if (result.warnings && result.warnings.length > 0) {
          console.log(chalk.yellow('\nWarnings:'));
          result.warnings.forEach((warning: string) => {
            console.log(`  ${chalk.yellow('•')} ${warning}`);
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
          chalk.red('✗ Failed to validate configuration:'),
          errorMessage,
        );
      }
    }
  }

  async export(
    filePath: string,
    options: ExportConfigOptions = {},
  ): Promise<void> {
    const format = options.format || 'json';

    try {
      const result = await this.client.callApi('exportConfig', {
        format,
        filePath,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            filePath: result.filePath,
            format,
            message:
              'Configuration exported successfully (sensitive values redacted)',
          },
          options,
        );
      } else {
        console.log(
          chalk.green(
            '✓ Configuration exported successfully (sensitive values redacted)',
          ),
        );
        console.log(`File: ${chalk.cyan(result.filePath)}`);
        console.log(`Format: ${chalk.yellow(format)}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to export configuration:'),
          errorMessage,
        );
      }
    }
  }

  async import(
    filePath: string,
    options: BaseCommandOptions & { merge?: boolean } = {},
  ): Promise<void> {
    const merge = !!options.merge;

    try {
      const result = await this.client.callApi('importConfig', {
        filePath,
        merge,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            filePath,
            merge,
            importedKeys: result.importedKeys || [],
            message: 'Configuration imported successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Configuration imported successfully'));
        console.log(`File: ${chalk.cyan(filePath)}`);
        console.log(`Mode: ${merge ? 'merge' : 'replace'}`);

        if (result.importedKeys && result.importedKeys.length > 0) {
          console.log(
            `Imported keys: ${result.importedKeys
              .map((key: string) => chalk.cyan(key))
              .join(', ')}`,
          );
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
          chalk.red('✗ Failed to import configuration:'),
          errorMessage,
        );
      }
    }
  }

  private displayConfig(config: Record<string, unknown>, indent = 0): void {
    const spaces = '  '.repeat(indent);

    Object.keys(config).forEach((key) => {
      const value = config[key];

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        console.log(`${spaces}${chalk.cyan(key)}:`);
        this.displayConfig(value as Record<string, unknown>, indent + 1);
      } else {
        const displayValue = Array.isArray(value)
          ? `[${value.length} items]`
          : JSON.stringify(value);
        console.log(
          `${spaces}${chalk.cyan(key)}: ${chalk.yellow(displayValue)}`,
        );
      }
    });
  }
}
