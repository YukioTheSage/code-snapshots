import { execFileSync } from 'child_process';
import { GitIntegration } from '../gitIntegration';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

const execFileSyncMock = execFileSync as jest.MockedFunction<typeof execFileSync>;

function addCalls(): string[][] {
  return execFileSyncMock.mock.calls
    .filter(([file, args]) => file === 'git' && (args as string[])[0] === 'add')
    .map(([, args]) => args as string[]);
}

describe('GitIntegration.stageFiles', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('' as never);
  });

  it('chunks more paths than fit in one argv', () => {
    // Windows caps a command line near 32 KB, so spreading every path of a
    // large snapshot into one argv fails with E2BIG. 250 long paths is well
    // past that; the batch size must keep each invocation under it.
    const names = Array.from(
      { length: 250 },
      (_, i) => `f${String(i).padStart(3, '0')}-${'x'.repeat(60)}.txt`,
    );

    new GitIntegration('C:\\workspace').stageFiles(names);

    const batches = addCalls().map((args) => args.slice(2));
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    for (const batch of batches) {
      expect(batch.every((name) => names.includes(name))).toBe(true);
    }
  });

  it('returns no untracked paths when git cannot be run', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('spawn git EPERM');
    });

    expect(new GitIntegration('C:\\workspace').getUntrackedFiles()).toEqual([]);
  });

  it('parses git\'s untracked listing and drops blank lines', () => {
    execFileSyncMock.mockReturnValue('a.txt\nnested/b.txt\n\n' as never);

    expect(new GitIntegration('C:\\workspace').getUntrackedFiles()).toEqual([
      'a.txt',
      'nested/b.txt',
    ]);
  });
});