import { setFailure, getFailure, resetFailure } from '../exitState';
import { printResult } from '../commands/output';

describe('exit state', () => {
  beforeEach(() => resetFailure());

  it('starts clean', () => {
    expect(getFailure()).toBe(false);
  });

  it('records failure', () => {
    setFailure();
    expect(getFailure()).toBe(true);
  });

  it('clears on reset', () => {
    setFailure();
    resetFailure();
    expect(getFailure()).toBe(false);
  });
});

describe('printResult', () => {
  beforeEach(() => {
    resetFailure();
  });

  // The setup file replaces `console.log` with a jest.fn(), so these assert on
  // that spy. `printResult` deliberately writes through `console.log` rather
  // than `process.stdout.write`: it keeps the output byte-identical to the calls
  // it replaces, which is what lets ~30 existing golden-output assertions stay
  // meaningful.
  const output = () =>
    (console.log as jest.Mock).mock.calls.map((c) => String(c[0])).join('');

  it('marks failure when the payload reports success false', () => {
    printResult({ success: false, error: 'boom' }, { json: true });
    expect(getFailure()).toBe(true);
  });

  it('stays clean when the payload reports success true', () => {
    printResult({ success: true, result: [] }, { json: true });
    expect(getFailure()).toBe(false);
  });

  it('emits only JSON on stdout when json is requested', () => {
    printResult({ success: true, result: [] }, { json: true });
    const written = output();
    expect(() => JSON.parse(written)).not.toThrow();
    // eslint-disable-next-line no-control-regex
    expect(written).not.toMatch(/\u001b\[/);
  });

  it('emits nothing when silent, but still records failure', () => {
    printResult({ success: false, error: 'boom' }, { silent: true });
    expect(output()).toBe('');
    expect(getFailure()).toBe(true);
  });

  it('still records failure when silent and json are both set', () => {
    printResult({ success: false, error: 'x' }, { silent: true, json: true });
    expect(getFailure()).toBe(true);
  });

  it('does not mark failure for a payload with no success field', () => {
    // Prose and plain values are not result envelopes, so they must not be read
    // as failures.
    printResult('some prose', {});
    expect(getFailure()).toBe(false);
  });

  it('does not mark failure for a success field that is merely falsy-but-absent', () => {
    printResult({ success: true }, {});
    expect(getFailure()).toBe(false);
    printResult({ other: 1 }, {});
    expect(getFailure()).toBe(false);
  });

  it('treats a nested success:false as data, not as the envelope', () => {
    // Only a top-level `success` is the envelope; a nested one belongs to the
    // payload and must not flip the exit code.
    printResult({ success: true, result: { success: false } }, { json: true });
    expect(getFailure()).toBe(false);
  });

  it('defaults to human output when json is not requested', () => {
    printResult({ success: true, count: 2 }, {});
    expect(output()).toContain('"count":2');
  });
});
