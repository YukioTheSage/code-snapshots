/**
 * Regression guard for standalone-mode workspace detection (BUG-1).
 *
 * `isStandaloneModeAvailable()` used to check only the *current* directory for
 * project indicators, while the handler's own root search walked up to ten
 * parent levels. Running the CLI from any subdirectory of a project therefore
 * reported "standalone not available", fell back to IPC, and died with
 * "IPC mode not available - extension not running" -- even though the
 * standalone handler initialized fine and found the project root.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findWorkspaceRootFrom,
  isStandaloneModeAvailable,
} from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

describe('findWorkspaceRootFrom', () => {
  let tmpRoot: string;
  let nested: string;

  beforeEach(() => {
    useRealFileSystem();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-root-'));
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    nested = path.join(tmpRoot, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds the project root by walking up from a nested directory', () => {
    expect(findWorkspaceRootFrom(nested)).toBe(tmpRoot);
  });

  it('stops at the nearest indicator', () => {
    fs.writeFileSync(path.join(nested, 'tsconfig.json'), '{}');
    expect(findWorkspaceRootFrom(nested)).toBe(nested);
  });

  it('accepts .vscode as an indicator, like the handler root search does', () => {
    fs.mkdirSync(path.join(nested, '.vscode'), { recursive: true });
    expect(findWorkspaceRootFrom(nested)).toBe(nested);
  });
});

describe('isStandaloneModeAvailable', () => {
  let tmpRoot: string;
  let nested: string;
  let previousCwd: string;

  beforeEach(() => {
    useRealFileSystem();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-avail-'));
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    nested = path.join(tmpRoot, 'deep', 'deeper');
    fs.mkdirSync(nested, { recursive: true });
    previousCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('is available from a nested directory inside a project (BUG-1 regression)', () => {
    process.chdir(nested);
    expect(isStandaloneModeAvailable()).toBe(true);
  });

  it('is available from the project root itself', () => {
    process.chdir(tmpRoot);
    expect(isStandaloneModeAvailable()).toBe(true);
  });
});
