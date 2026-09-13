import {
  throwIfCancelled,
  isCancellationError,
  CancellationError,
} from '../utils/cancellation';

function token(cancelled: boolean) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as any;
}

describe('throwIfCancelled', () => {
  it('returns normally when the token is not cancelled', () => {
    expect(() => throwIfCancelled(token(false))).not.toThrow();
  });

  it('throws a CancellationError when the token is cancelled', () => {
    expect(() => throwIfCancelled(token(true))).toThrow(CancellationError);
  });

  it('throws an error whose message the command handlers can match', () => {
    try {
      throwIfCancelled(token(true));
      throw new Error('expected throwIfCancelled to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CancellationError);
      expect((error as Error).message).toBe('Operation cancelled');
    }
  });

  it('is recognisable by name, for logs', () => {
    expect(new CancellationError().name).toBe('CancellationError');
  });

  it('is detectable without matching the message text', () => {
    // The point of isCancellationError: handlers must not depend on prose.
    expect(isCancellationError(new CancellationError())).toBe(true);
    expect(isCancellationError(new CancellationError('anything at all'))).toBe(
      true,
    );
    expect(isCancellationError(new Error('Operation cancelled'))).toBe(false);
    expect(isCancellationError(undefined)).toBe(false);
    expect(isCancellationError('Operation cancelled')).toBe(false);
  });

  it('propagates out of a withProgress-style callback instead of being swallowed', async () => {
    // Models the real failure: the old code threw from inside an
    // onCancellationRequested listener, whose return value is discarded, so the
    // work continued. A throw at an await boundary propagates normally.
    let reachedAfterCheck = false;

    const work = async () => {
      await Promise.resolve();
      throwIfCancelled(token(true));
      reachedAfterCheck = true;
      return 'completed';
    };

    await expect(work()).rejects.toBeInstanceOf(CancellationError);
    expect(reachedAfterCheck).toBe(false);
  });

  it('lets work run to completion when not cancelled', async () => {
    let reachedEnd = false;
    const work = async () => {
      await Promise.resolve();
      throwIfCancelled(token(false));
      reachedEnd = true;
      return 'completed';
    };

    await expect(work()).resolves.toBe('completed');
    expect(reachedEnd).toBe(true);
  });
});
