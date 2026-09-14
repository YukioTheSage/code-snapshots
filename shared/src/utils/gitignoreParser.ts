import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

/** The store location used when the caller does not configure one. */
const DEFAULT_SNAPSHOT_LOCATION = '.snapshots';

/**
 * Normalises a configured snapshot location into the form the ignore patterns
 * are written in: forward slashes, no leading `./` and no trailing `/`.
 *
 * `snapshotLocation` is a user setting, so `.snapshots`, `.snapshots/` and
 * `.\.snapshots\` all name the same directory and must all be excluded.
 *
 * Written by slicing rather than with the previous `/^(?:\.\/)+/`, `/^\/+/`,
 * `/\/+$/` chain. The last of those is quadratic on a run of slashes -- for
 * each start position it consumed the whole run, failed `$` and gave every
 * slash back -- and the setting it runs on is user input (CodeQL
 * js/polynomial-redos). Each bookend is now one linear pass.
 */
function normalizeSnapshotLocation(snapshotLocation: string): string {
  let normalized = (snapshotLocation ?? '').trim().replace(/\\/g, '/');

  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  let start = 0;
  while (start < normalized.length && normalized[start] === '/') {
    start += 1;
  }

  let end = normalized.length;
  while (end > start && normalized[end - 1] === '/') {
    end -= 1;
  }

  return normalized.slice(start, end) || DEFAULT_SNAPSHOT_LOCATION;
}

/**
 * Simple .gitignore parser to determine if a file should be ignored
 * Standalone version without VS Code dependencies
 */
export class GitignoreParser {
  private patterns: string[] = [];
  private negatedPatterns: string[] = [];
  private workspaceRoot: string;
  private snapshotLocation: string;

  constructor(
    workspaceRoot: string,
    snapshotLocation: string = DEFAULT_SNAPSHOT_LOCATION,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.snapshotLocation = normalizeSnapshotLocation(snapshotLocation);
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
    // The store location is pushed bare here and with `/**` suffixes further
    // down: the bare form covers the directory itself, the suffixed forms cover
    // its contents, which is what callers matching file paths need.
    this.patterns.push(this.snapshotLocation);
    this.patterns.push('node_modules');
    this.patterns.push('.git');

    // CLI byproducts. These are written by the tool itself, so capturing them
    // pollutes every snapshot of the same tree: `.vscode/codelapse.json` is
    // CLI configuration, `.snapshotignore` is the ignore file itself, and
    // `*.backup-<timestamp>` files are created by restore operations.
    this.patterns.push('.snapshotignore');
    this.patterns.push('.vscode/codelapse.json');
    this.patterns.push('**/.vscode/codelapse.json');
    this.patterns.push('*.backup-*');
    this.patterns.push('**/*.backup-*');
    this.patterns.push('*.codelapse-tmp*');
    this.patterns.push('**/*.codelapse-tmp*');

    // Contents of the snapshot directory, for callers that check file paths
    // rather than pruning the directory during a walk.
    //
    // Derived from the CONFIGURED location rather than hardcoded: `shouldIgnore`
    // matches file paths through `matchPattern`, so the bare name above only
    // matches the directory itself, and a hardcoded `.snapshots` excluded
    // nothing for a caller whose store lives elsewhere. The store's own
    // `index.json` and payload files were therefore captured into every
    // snapshot of that workspace.
    this.patterns.push(`**/${this.snapshotLocation}`);
    this.patterns.push(`**/${this.snapshotLocation}/**`);
    if (this.snapshotLocation !== DEFAULT_SNAPSHOT_LOCATION) {
      // Root-anchored contents form, plus the default location itself.
      //
      // The default location keeps its exclusions: every caller has them today,
      // and dropping them would let a store left behind at `.snapshots` start
      // being captured -- and then deleted by a restore, which is the failure
      // this change is fixing. When the location IS the default this branch does
      // not run at all, so every existing caller sees the pattern set it already
      // sees.
      this.patterns.push(`${this.snapshotLocation}/**`);
      this.patterns.push(`**/${DEFAULT_SNAPSHOT_LOCATION}`);
      this.patterns.push(`**/${DEFAULT_SNAPSHOT_LOCATION}/**`);
    }

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
   * Check if a file path should be ignored
   * @param filePath Absolute or relative path to check
   * @returns true if the file should be ignored
   */
  public shouldIgnore(filePath: string): boolean {
    // Get relative path from workspace root
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(this.workspaceRoot, filePath)
      : filePath;

    // Normalize path separators to forward slashes for consistent matching
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Check if any negated pattern matches (these files should NOT be ignored)
    for (const pattern of this.negatedPatterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return false;
      }
    }

    // Check if any positive pattern matches (these files SHOULD be ignored)
    for (const pattern of this.patterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a path matches a gitignore pattern
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert gitignore pattern to minimatch compatible pattern
    let globPattern = pattern;

    // Handle leading slash (anchored to root)
    if (globPattern.startsWith('/')) {
      globPattern = globPattern.substring(1);
    } else if (!globPattern.includes('/')) {
      // No slashes - match anywhere
      globPattern = `**/${globPattern}`;
    }

    // Handle trailing slash (directory only)
    if (globPattern.endsWith('/')) {
      globPattern = `${globPattern}**`;
    }

    // Use minimatch for pattern matching
    return minimatch(filePath, globPattern, {
      dot: true,
      matchBase: true,
    });
  }

  /**
   * Converts a single gitignore pattern to a glob pattern.
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

    return globPattern;
  }

  /**
   * Generates a combined glob pattern string for excluding files based on positive ignore rules.
   * @returns A string suitable for glob pattern matching.
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
   * @returns An array of glob pattern strings.
   */
  public getNegatedGlobs(): string[] {
    return this.negatedPatterns
      .map((p) => this.convertGitignorePatternToGlob(p))
      .filter((p) => p !== '');
  }

  /**
   * Get all ignore patterns
   */
  public getPatterns(): string[] {
    return [...this.patterns];
  }

  /**
   * Get all negated patterns
   */
  public getNegatedPatterns(): string[] {
    return [...this.negatedPatterns];
  }
}
