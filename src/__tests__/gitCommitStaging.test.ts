import { stageAndCommit } from '../commands';

describe('stageAndCommit', () => {
  it('asks git to commit all changes rather than calling add([])', async () => {
    const repo = {
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    // No `as any`: the double must satisfy the real parameter type, which
    // is the whole point of widening it to CommitOptions.
    await stageAndCommit(repo, 'message');

    // The bug: repo.add([]) is a no-op because it becomes `git add --`
    // with no pathspecs.
    expect(repo.add).not.toHaveBeenCalled();
    expect(repo.commit).toHaveBeenCalledWith('message', { all: true });
  });

  it('propagates a commit failure', async () => {
    const repo = {
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockRejectedValue(new Error('nothing to commit')),
    };

    await expect(stageAndCommit(repo, 'message')).rejects.toThrow(
      'nothing to commit',
    );
  });

  it('accepts a repository double with no add method at all', async () => {
    // `add` is deliberately absent: the contract is that staging happens through
    // commit, so a caller must not need `add` to exist.
    const repo = { commit: jest.fn().mockResolvedValue(undefined) };

    await expect(stageAndCommit(repo, 'message')).resolves.toBeUndefined();
    expect(repo.commit).toHaveBeenCalledWith('message', { all: true });
  });

  it('passes the message through unchanged, including empty-ish text', async () => {
    const repo = { commit: jest.fn().mockResolvedValue(undefined) };
    const message = 'Snapshot: "quoted" & special $chars';

    await stageAndCommit(repo, message);

    expect(repo.commit).toHaveBeenCalledWith(message, { all: true });
  });
});
