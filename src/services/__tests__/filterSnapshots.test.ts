import { TerminalApiService } from '../terminalApiService';

describe('TerminalApiService.filterSnapshots', () => {
  const snapshots = [
    {
      id: 'a',
      timestamp: 100,
      description: 'add parser',
      notes: 'handles CRLF',
      tags: ['release'],
      isFavorite: false,
      files: {},
    },
    {
      id: 'b',
      timestamp: 200,
      description: 'unrelated',
      tags: ['release', 'v1'],
      isFavorite: true,
      files: {},
    },
  ];

  function service() {
    const manager = {
      getSnapshots: () => snapshots,
      updateSnapshotContext: jest.fn().mockResolvedValue(true),
    };
    return {
      manager,
      api: new TerminalApiService(manager as never, {} as never),
    };
  }

  it('filters by favourites with both counts, like the standalone path', async () => {
    const { api } = service();

    const result = await api.filterSnapshots({ favorites: true });

    expect(result.snapshots.map((s) => s.id)).toEqual(['b']);
    expect(result.totalCount).toBe(2);
    expect(result.filteredCount).toBe(1);
  });

  it('searches description and notes case-insensitively', async () => {
    const { api } = service();

    await expect(
      api.filterSnapshots({ searchText: 'PARSER' }).then((r) => r.filteredCount),
    ).resolves.toBe(1);
    await expect(
      api.filterSnapshots({ searchText: 'crlf' }).then((r) => r.filteredCount),
    ).resolves.toBe(1);
  });

  it('edits metadata through the extension context updater', async () => {
    const { api, manager } = service();
    manager.updateSnapshotContext.mockResolvedValue(true);

    await api.editSnapshotTags('a', ['release', 'v1']);
    await api.editSnapshotNotes('a', 'reviewed');
    await api.editTaskReference('a', 'ISSUE-42');
    await api.toggleFavoriteStatus('a', true);

    expect(manager.updateSnapshotContext.mock.calls).toEqual([
      ['a', { tags: ['release', 'v1'] }],
      ['a', { notes: 'reviewed' }],
      ['a', { taskReference: 'ISSUE-42' }],
      ['a', { isFavorite: true }],
    ]);
  });
});