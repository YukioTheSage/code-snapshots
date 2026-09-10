import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import type {
  BaseCommandOptions,
  GitCommitOptions,
  GitAutoSnapshotOptions,
  GitCompareOptions,
} from '../types/options';

export class GitCommands {
  constructor(private client: UnifiedClient) {}

  async createCommit(
    snapshotId: string,
    options: GitCommitOptions,
  ): Promise<void> {
    const opts = {
      snapshotId,
      commitMessage: options.message,
      includeUntracked: !!options.includeUntracked,
      createBranch: options.branch,
      push: !!options.push,
    };

    try {
      const result = await this.client.callApi(
        'createGitCommitFromSnapshot',
        opts,
      );

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            commitHash: result.commitHash,
            branch: result.branch,
            message: result.message,
          }),
        );
      } else {
        console.log(chalk.green('✓ Git commit created successfully'));
        console.log(`Commit hash: ${result.commitHash}`);
        console.log(`Branch: ${result.branch}`);
        console.log(`Message: ${result.message}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to create Git commit:'),
          errorMessage,
        );
      }
    }
  }

  async autoSnapshotBeforeOperation(
    operation: string,
    options: GitAutoSnapshotOptions,
  ): Promise<void> {
    const opts = {
      operation,
      description: options.description || `Auto-snapshot before ${operation}`,
      includeUntracked: !!options.includeUntracked,
    };

    try {
      const result = await this.client.callApi(
        'autoSnapshotBeforeGitOperation',
        opts,
      );

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            operation,
            snapshot: result.snapshot,
            message: `Auto-snapshot created before ${operation}`,
          }),
        );
      } else {
        console.log(chalk.green(`✓ Auto-snapshot created before ${operation}`));
        console.log(`Snapshot ID: ${result.snapshot.id}`);
        console.log(`Description: ${result.snapshot.description}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red(`✗ Failed to create auto-snapshot before ${operation}:`),
          errorMessage,
        );
      }
    }
  }

  async getBranchInfo(options: BaseCommandOptions): Promise<void> {
    try {
      const result = await this.client.callApi('getGitBranchInfo', {});

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            currentBranch: result.currentBranch,
            commitHash: result.commitHash,
            remoteUrl: result.remoteUrl,
            hasChanges: result.hasChanges,
            branches: result.branches,
          }),
        );
      } else {
        console.log(chalk.blue('Git Repository Information:'));
        console.log(`Current branch: ${chalk.green(result.currentBranch)}`);
        console.log(`Commit hash: ${result.commitHash}`);
        console.log(`Remote URL: ${result.remoteUrl}`);
        console.log(
          `Has changes: ${
            result.hasChanges ? chalk.yellow('Yes') : chalk.green('No')
          }`,
        );

        if (result.branches && result.branches.length > 0) {
          console.log('\nAvailable branches:');
          result.branches.forEach((branch: string) => {
            console.log(
              `  ${
                branch === result.currentBranch
                  ? chalk.green('* ' + branch)
                  : '  ' + branch
              }`,
            );
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to get Git information:'),
          errorMessage,
        );
      }
    }
  }

  async listBranches(options: BaseCommandOptions): Promise<void> {
    try {
      const result = await this.client.callApi('listBranches', {});
      const branchInfo = await this.client.callApi('getGitBranchInfo', {});

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            currentBranch: branchInfo.currentBranch,
            branches: result.branches,
          }),
        );
      } else {
        console.log(chalk.blue('Branches:'));
        for (const branch of result.branches) {
          if (branch === branchInfo.currentBranch) {
            console.log(chalk.green(`  * ${branch}`));
          } else {
            console.log(`    ${branch}`);
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to list branches:'), errorMessage);
      }
    }
  }

  async createBranch(
    name: string,
    options: BaseCommandOptions & { checkout?: boolean },
  ): Promise<void> {
    try {
      await this.client.callApi('createBranch', {
        name,
        checkout: !!options.checkout,
      });

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            branch: name,
            checkout: !!options.checkout,
          }),
        );
      } else {
        if (options.checkout) {
          console.log(
            chalk.green(`✓ Created and switched to branch '${name}'`),
          );
        } else {
          console.log(chalk.green(`✓ Created branch '${name}'`));
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to create branch:'), errorMessage);
      }
    }
  }

  async switchBranch(name: string, options: BaseCommandOptions): Promise<void> {
    try {
      await this.client.callApi('switchBranch', { name });

      if (options.json) {
        console.log(JSON.stringify({ success: true, branch: name }));
      } else {
        console.log(chalk.green(`✓ Switched to branch '${name}'`));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to switch branch:'), errorMessage);
      }
    }
  }

  async deleteBranch(
    name: string,
    options: BaseCommandOptions & { force?: boolean },
  ): Promise<void> {
    try {
      await this.client.callApi('deleteBranch', {
        name,
        force: !!options.force,
      });

      if (options.json) {
        console.log(
          JSON.stringify({ success: true, branch: name, deleted: true }),
        );
      } else {
        console.log(chalk.green(`✓ Deleted branch '${name}'`));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to delete branch:'), errorMessage);
      }
    }
  }

  async compareWithCommit(
    snapshotId: string,
    commitHash: string,
    options: GitCompareOptions,
  ): Promise<void> {
    const opts = {
      snapshotId,
      commitHash,
      includeFileList: !!options.files,
    };

    try {
      const result = await this.client.callApi(
        'compareSnapshotWithGitCommit',
        opts,
      );

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            commitHash,
            differences: result.differences,
            fileChanges: result.fileChanges,
          }),
        );
      } else {
        console.log(
          chalk.blue(
            `Comparing snapshot ${snapshotId} with commit ${commitHash}:`,
          ),
        );

        if (result.differences && result.differences.length > 0) {
          console.log('\nDifferences found:');
          result.differences.forEach((diff: Record<string, unknown>) => {
            console.log(`${chalk.yellow(diff.file)}: ${diff.changeType}`);
            if (diff.linesAdded || diff.linesRemoved) {
              console.log(
                `  +${diff.linesAdded || 0} -${diff.linesRemoved || 0}`,
              );
            }
          });
        } else {
          console.log(chalk.green('✓ No differences found'));
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to compare with Git commit:'),
          errorMessage,
        );
      }
    }
  }
}
