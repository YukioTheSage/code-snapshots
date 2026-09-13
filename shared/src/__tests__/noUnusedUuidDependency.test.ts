import * as fs from 'fs';
import * as path from 'path';

/**
 * `uuid` was declared by `cli/package.json` and `shared/package.json` and
 * imported by nothing. It carried GHSA-w5hq-g745-h8pq -- every version below
 * 11.1.1, so every release the `^9.0.0` range allowed, with no patch inside the
 * range -- which is why the declaration, not the version, is what this pins.
 * An unused dependency is a Dependabot alert with no upside.
 */
describe('uuid is not declared where nothing imports it', () => {
  const readManifest = (relativePath: string): Record<string, any> =>
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', '..', relativePath),
        'utf8',
      ),
    ) as Record<string, any>;

  const declaredNames = (manifest: Record<string, any>): string[] => [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];

  it.each(['cli/package.json', 'shared/package.json'])(
    'does not declare uuid in %s',
    (manifestPath) => {
      expect(declaredNames(readManifest(manifestPath))).not.toContain('uuid');
    },
  );

  it('does not declare @types/uuid in shared/package.json', () => {
    expect(declaredNames(readManifest('shared/package.json'))).not.toContain(
      '@types/uuid',
    );
  });
});
