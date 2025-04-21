import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Simple .gitignore parser to determine if a file should be ignored
 */
export class GitignoreParser {
  private patterns: string[] = [];
  private negatedPatterns: string[] = [];
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.loadGitignore();
  }

  /**
   * Load and parse .gitignore file
   */
  private loadGitignore(): void {
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');

    // Also check for a .snapshotignore file which would have priority
    const snapshotignorePath = path.join(this.workspaceRoot, '.snapshotignore');

    let gitignoreContent = '';

    // First check for .snapshotignore
    if (fs.existsSync(snapshotignorePath)) {
      try {
        gitignoreContent = fs.readFileSync(snapshotignorePath, 'utf8');
      } catch (error) {
        console.warn('Error reading .snapshotignore file:', error);
      }
    }
    // Then check for .gitignore if no .snapshotignore was found or it was empty
    else if (fs.existsSync(gitignorePath) && gitignoreContent === '') {
      try {
        gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      } catch (error) {
        console.warn('Error reading .gitignore file:', error);
      }
    }

    // Add default patterns (always ignore these directories)
    const config = vscode.workspace.getConfiguration('vscode-snapshots');
    const snapshotLocationRelative = config.get<string>(
      'snapshotLocation',
      '.snapshots',
    );

    // Add critical always-ignored directories
    this.patterns.push(snapshotLocationRelative);
    this.patterns.push('node_modules');
    this.patterns.push('.git');

    // Explicitly handle virtual environments
    this.patterns.push('venv');
    this.patterns.push('venv/');
    this.patterns.push('/venv');
    this.patterns.push('/venv/');
    this.patterns.push('**/venv/**');
    this.patterns.push('.venv');
    this.patterns.push('.venv/');
    this.patterns.push('/.venv');
    this.patterns.push('/.venv/');
    this.patterns.push('**/.venv/**');

    // Process gitignore content
    if (gitignoreContent) {
      const lines = gitignoreContent.split(/\r?\n/);

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#')) {
          continue;
        }

        // Check for negated patterns
        if (trimmedLine.startsWith('!')) {
          this.negatedPatterns.push(trimmedLine.substring(1));
        } else {
          this.patterns.push(trimmedLine);
        }
      }
    }
  }

  /**
   * Converts a single gitignore pattern to a glob pattern suitable for vscode.workspace.findFiles.
   * Handles basic cases, might need refinement for complex gitignore syntax.
   * @param pattern A single gitignore pattern string.
   * @returns A glob pattern string.
   */
  private convertGitignorePatternToGlob(pattern: string): string {
    let globPattern = pattern;

    // 1. Remove trailing spaces unless they are escaped
    if (!globPattern.endsWith('\\ ')) {
      globPattern = globPattern.trimEnd();
    } else {
      globPattern = globPattern.replace(/\\ /g, ' '); // Unescape for glob
    }

    // 2. Handle leading/trailing slashes and '**'
    if (globPattern.startsWith('/')) {
      // Anchored to root - remove leading slash for glob relative to root
      globPattern = globPattern.substring(1);
    } else if (!globPattern.includes('/')) {
      // No slashes - match anywhere, prepend '**/'
      globPattern = `**/${globPattern}`;
    }

    if (globPattern.endsWith('/')) {
      // Directory match - append '**' to match contents
      globPattern = `${globPattern}**`;
    }

    // Note: This basic conversion doesn't handle all gitignore nuances like character ranges [],
    // escaped characters, or complex '**' interactions perfectly. It covers common cases.
    // `vscode.workspace.findFiles` uses minimatch, so standard glob syntax applies.
    return globPattern;
  }

  /**
   * Generates a combined glob pattern string for excluding files based on positive ignore rules.
   * @returns A string suitable for the `exclude` parameter of `vscode.workspace.findFiles`.
   */
  public getExcludeGlobPattern(): string {
    if (this.patterns.length === 0) {
      return ''; // No patterns to exclude
    }

    const globPatterns = this.patterns
      .map((p) => this.convertGitignorePatternToGlob(p))
      .filter((p) => p !== ''); // Filter out empty results

    if (globPatterns.length === 0) {
      return '';
    }

    // Combine into a single pattern using brace expansion
    return `{${globPatterns.join(',')}}`;
  }

  /**
   * Generates an array of glob patterns for re-including files based on negated ignore rules.
   * @returns An array of glob pattern strings suitable for the `include` parameter of `vscode.workspace.findFiles`.
   */
  public getNegatedGlobs(): string[] {
    return this.negatedPatterns
      .map((p) => this.convertGitignorePatternToGlob(p)) // Convert the pattern part (without '!')
      .filter((p) => p !== ''); // Filter out empty results
  }

  // Removed shouldIgnore, matchPattern, simplePatternMatch, convertGitignoreToRegex
}
