import {
  assertAllowedApiMethod,
  parseAndValidateBatchCommands,
} from '../apiAllowlist';

describe('apiAllowlist', () => {
  it('accepts allowlisted API method', () => {
    expect(() => assertAllowedApiMethod('getStatus')).not.toThrow();
  });

  it('rejects disallowed API method', () => {
    expect(() => assertAllowedApiMethod('notAllowedMethod')).toThrow(
      'not allowed',
    );
  });

  it('parses valid batch commands', () => {
    const commands = parseAndValidateBatchCommands([
      { method: 'getStatus', data: {} },
      { method: 'getSnapshots', data: { filter: {} } },
    ]);
    expect(commands).toEqual([
      { method: 'getStatus', data: {} },
      { method: 'getSnapshots', data: { filter: {} } },
    ]);
  });

  it('rejects malformed batch command data', () => {
    expect(() =>
      parseAndValidateBatchCommands([
        { method: 'getStatus', data: 'invalid-data' },
      ]),
    ).toThrow('invalid "data"');
  });

  it('rejects unknown method in batch', () => {
    expect(() =>
      parseAndValidateBatchCommands([{ method: 'rm -rf /', data: {} }]),
    ).toThrow('not allowed');
  });
});
