import { SnapshotTreeDataProvider } from '../treeView';

describe('auto-snapshot classification', () => {
  const provider = Object.create(
    SnapshotTreeDataProvider.prototype,
  ) as SnapshotTreeDataProvider;
  const isAuto = (snapshot: unknown) =>
    (provider as any).isAutoSnapshot(snapshot);

  it('classifies by tag', () => {
    expect(isAuto({ tags: ['auto'] })).toBe(true);
    expect(isAuto({ tags: ['release'] })).toBe(false);
  });

  it('does not misfile a manual snapshot whose description mentions auto-snapshot', () => {
    // The exact string a developer writes when fixing the auto-snapshot feature.
    expect(
      isAuto({ tags: [], description: 'Fix auto-snapshot rule bug' }),
    ).toBe(false);
  });

  it('treats a snapshot with no tags and no description as manual', () => {
    expect(isAuto({})).toBe(false);
  });
});