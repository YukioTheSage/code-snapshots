import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..', '..');
const srcRoot = path.join(repoRoot, 'src');

interface Manifest {
  contributes: {
    commands: Array<{ command: string }>;
    configuration: { properties: Record<string, unknown> };
    menus: {
      commandPalette?: Array<{ command: string; when?: string }>;
      'view/item/context'?: Array<{ command: string; when?: string }>;
      'view/title'?: Array<{ command: string; when?: string }>;
    };
  };
}

function readManifest(): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  ) as Manifest;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !full.includes('__tests__')) {
      out.push(full);
    }
  }
  return out;
}

/** Command ids passed to `vscode.commands.registerCommand(...)`. */
function registeredCommandIds(): Set<string> {
  const ids = new Set<string>();
  const pattern = /registerCommand\(\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
  for (const file of collectTsFiles(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/** Keys passed as the first argument of a `.get(...)` call. */
function keysReadFromConfig(): Set<string> {
  const keys = new Set<string>();
  const pattern = /\.get(?:<[^>]*>)?\(\s*['"`]([A-Za-z0-9_.]+)['"`]/g;
  for (const file of collectTsFiles(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Sections read through a scoped `getConfiguration('vscode-snapshots.<x>')`.
 *
 * A key like `semanticSearch.chunkSize` is read as
 * `getConfiguration('vscode-snapshots.semanticSearch').get('chunkSize')`, so
 * matching the declared key against the `.get()` argument alone would report it
 * as unread.
 */
function scopedSectionNames(): Set<string> {
  const sections = new Set<string>();
  const pattern =
    /getConfiguration\(\s*['"`]vscode-snapshots\.([A-Za-z0-9_.]+)['"`]/g;
  for (const file of collectTsFiles(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      sections.add(match[1]);
    }
  }
  return sections;
}

describe('manifest consistency', () => {
  const manifest = readManifest();
  const contributed = manifest.contributes.commands.map((c) => c.command);
  const registered = registeredCommandIds();

  it('registers every contributed command', () => {
    const missing = contributed.filter((id) => !registered.has(id));
    // Contributed commands are palette-visible and error with "command not
    // found" if nothing registers them.
    expect(missing).toEqual([]);
  });

  it('contributes every registered user-facing command', () => {
    const internal = (id: string) => id.includes('.internal.');
    const missing = [...registered].filter(
      (id) => !contributed.includes(id) && !internal(id),
    );
    // A registered command that is not contributed cannot be discovered,
    // has no keybinding, and is unreachable from the UI.
    expect(missing.sort()).toEqual([]);
  });

  it('hides every tree-item command from the palette', () => {
    const menus = manifest.contributes.menus;
    const hiddenFromPalette = new Set(
      (menus.commandPalette ?? [])
        .filter((m) => m.when === 'false')
        .map((m) => m.command),
    );

    // These commands take an argument the palette cannot supply, so invoking
    // them from the palette silently does nothing. `when: false` is VS Code's
    // way of saying "not available here"; the view menus still list them.
    const requiresArgument = [
      'vscode-snapshots.restoreFromTree',
      'vscode-snapshots.compareWithCurrentFromTree',
      'vscode-snapshots.deleteFromTree',
      'vscode-snapshots.compareFileWithWorkspace',
      'vscode-snapshots.restoreFileFromSnapshot',
      'vscode-snapshots.showChangedFilesInSnapshot',
      'vscode-snapshots.toggleFavoriteStatus',
      'vscode-snapshots.editSnapshotTags',
      'vscode-snapshots.editSnapshotNotes',
      'vscode-snapshots.editTaskReference',
      'vscode-snapshots.editConfig',
    ];

    const paletteVisible = requiresArgument.filter(
      (id) => !hiddenFromPalette.has(id),
    );
    expect(paletteVisible).toEqual([]);

    // Hiding must not make them unreachable: each one either has a view menu
    // entry or is invoked programmatically / as a TreeItem.command.
    const viewMenus = new Set<string>([
      ...(menus['view/item/context'] ?? []).map((m) => m.command),
      ...(menus['view/title'] ?? []).map((m) => m.command),
    ]);
    const srcSource = collectTsFiles(srcRoot)
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    const unreachable = requiresArgument.filter(
      (id) => !viewMenus.has(id) && !srcSource.includes(`'${id}'`),
    );
    expect(unreachable).toEqual([]);
  });

  it('reads every declared setting, so none is decorative', () => {
    const properties = Object.keys(
      manifest.contributes.configuration.properties,
    );
    const readKeys = keysReadFromConfig();
    const sections = scopedSectionNames();

    // A declared setting that no `.get()` call mentions is inert no matter how
    // it is described, surfaced in the Settings tree, or documented. Matching
    // the whole key is not enough: a section-scoped read passes only the leaf.
    const unread = properties.filter((full) => {
      const key = full.replace(/^vscode-snapshots\./, '');
      if (readKeys.has(key)) {
        return false;
      }
      const parts = key.split('.');
      for (let i = 1; i < parts.length; i++) {
        const section = parts.slice(0, i).join('.');
        const suffix = parts.slice(i).join('.');
        if (sections.has(section) && readKeys.has(suffix)) {
          return false;
        }
      }
      return true;
    });

    expect(unread).toEqual([]);
  });
});
