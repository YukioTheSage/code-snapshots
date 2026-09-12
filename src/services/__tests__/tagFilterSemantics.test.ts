import { TerminalApiService } from '../terminalApiService';

describe('tag filter semantics', () => {
  const snapshots = [
    {
      id: 'both',
      timestamp: 2,
      description: '',
      tags: ['auth', 'feature'],
      files: {},
    },
    { id: 'one', timestamp: 1, description: '', tags: ['auth'], files: {} },
  ];

  it('requires every requested tag, matching the tree view', async () => {
    const api = new TerminalApiService(
      { getSnapshots: () => snapshots } as never,
      {} as never,
    );

    const matches = await api.getSnapshots({ tags: ['auth', 'feature'] });

    // The tree view already answered this way (`filterTags.every`), so the IPC
    // path returning `one` as well made the same filter mean two things.
    expect(matches.map((s) => s.id)).toEqual(['both']);
  });
});
