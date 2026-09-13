import { EmbeddingService } from '../embeddingService';
import { buildChunkId, CodeChunk } from '../codeChunker';

/**
 * The failure `@google/genai` 0.10.0 produces for an HTTP 429.
 *
 * `throwErrorIfNotOK` (node_modules/@google/genai/dist/node/index.js) turns
 * every non-ok response into a `ClientError` whose message reads
 * `got status: <status> <statusText>. <json body>`.
 * Probed against the installed 0.10.0: the thrown object is an `Error` named
 * `ClientError` with no status field at all — its own properties are only
 * `stack,message,cause,name` — and `ClientError` is not exported from the
 * package. The status code exists only in the message.
 */
function providerHttpError(
  status: number,
  statusText: string,
  body = `{"error":{"code":${status},"message":"failed"}}`,
): Error {
  const error = new Error(`got status: ${status} ${statusText}. ${body}`);
  error.name = 'ClientError';
  return error;
}

/**
 * `buildChunkId` emits `${snapshotId}_${path}_${startLine}-${endLine}_${sha1}`,
 * so a chunk that starts on source line 429 carries those digits into the id
 * that the empty-vector guard interpolates into its message.
 */
const chunkOnLine429: CodeChunk = {
  id: 'snap-1_src-parser.ts_429-431_0f9e8d7c6b5a',
  content: 'export function parse(input: string): Node {',
  filePath: 'src/parser.ts',
  startLine: 429,
  endLine: 431,
  snapshotId: 'snap-1',
  metadata: { language: 'typescript' },
};

const chunk: CodeChunk = {
  id: 'snap-1_src-parser.ts_12-14_a1b2c3d4e5f6',
  content: 'export function parse(input: string): Node {',
  filePath: 'src/parser.ts',
  startLine: 12,
  endLine: 14,
  snapshotId: 'snap-1',
  metadata: { language: 'typescript' },
};

interface EmbeddingServiceInternals {
  aiClient: unknown;
  delay: (ms: number) => Promise<void>;
}

function serviceWith(embedContent: jest.Mock): {
  service: EmbeddingService;
  delay: jest.SpyInstance<Promise<void>, [number]>;
} {
  const service = new EmbeddingService({} as never);
  (service as unknown as EmbeddingServiceInternals).aiClient = {
    models: { embedContent },
  };
  // The backoff is 10s plus 20s of real time. Spying on the delay keeps the
  // retry decision under test while the test itself never sleeps.
  const delay = jest
    .spyOn(service as unknown as EmbeddingServiceInternals, 'delay')
    .mockResolvedValue(undefined);
  return { service, delay };
}

describe('EmbeddingService retry classification', () => {
  it('throws an empty-vector response immediately when the chunk id contains 429', async () => {
    const embedContent = jest.fn().mockResolvedValue({ embeddings: [] });
    const { service, delay } = serviceWith(embedContent);

    // The historical shape, kept verbatim from the bug report: `buildChunkId`
    // emits `<startLine>-<endLine>`, so a chunk starting on source line 429
    // carries "429" in its id, and at HEAD the substring check read that as a
    // rate limit and paid 10s + 20s of backoff to rethrow the same
    // deterministic error it already had.
    //
    // This is the COINCIDENCE pin, not the fence pin: here the digits sit
    // between `_` and `-`, and `_` is a word character, so the kept token
    // match alone would not retry this id either. The fence is pinned by the
    // `buildChunkId` case below.
    await expect(service.embedCodeChunk(chunkOnLine429)).rejects.toThrow(
      'empty vector for chunk snap-1_src-parser.ts_429-431_0f9e8d7c6b5a',
    );

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  // The FENCE pin. `buildChunkId` preserves `-` and `.` from the path and
  // replaces every other separator with `_`, so a path position such as
  // `src/test-429-case.ts` yields an id whose digits are surrounded by
  // non-word characters: the kept `/\b429\b/` token match alone WOULD read it
  // as a rate limit, and only the `EmbeddingResponseError` exclusion inside
  // `isProviderRateLimitError` keeps this deterministic failure from being
  // retried. Delete that exclusion and this test fails while every other test
  // in this file stays green.
  it.each(['src/test-429-case.ts', 'src/v1.429.js'])(
    'does not retry an empty-vector response for a chunk id built from %s',
    async (filePath) => {
      const fenceChunk: CodeChunk = {
        ...chunk,
        filePath,
        id: buildChunkId('snap-1', filePath, 12, 14, chunk.content),
      };
      // The premise of this test: the id's digits are a token the message-only
      // match accepts on its own, so the type is the only thing protecting it.
      expect(fenceChunk.id).toMatch(/\b429\b/);

      const embedContent = jest.fn().mockResolvedValue({ embeddings: [] });
      const { service, delay } = serviceWith(embedContent);

      await expect(service.embedCodeChunk(fenceChunk)).rejects.toThrow(
        `empty vector for chunk ${fenceChunk.id}`,
      );

      expect(embedContent).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    },
  );

  it('does not retry an empty vector for the search query', async () => {
    const embedContent = jest
      .fn()
      .mockResolvedValue({ embeddings: [{ values: [] }] });
    const { service, delay } = serviceWith(embedContent);

    await expect(service.embedSearchQuery('find the parser')).rejects.toThrow(
      /empty vector/,
    );

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('still retries a genuine provider rate limit the configured number of times', async () => {
    const embedContent = jest
      .fn()
      .mockRejectedValueOnce(providerHttpError(429, 'Too Many Requests'))
      .mockRejectedValueOnce(providerHttpError(429, 'Too Many Requests'))
      .mockResolvedValueOnce({ embeddings: [{ values: [0.5, 0.25] }] });
    const { service, delay } = serviceWith(embedContent);

    await expect(service.embedCodeChunk(chunk)).resolves.toEqual([0.5, 0.25]);

    // Two failures, two retries: RETRY_BACKOFF_BASE_MS (10s) times the attempt
    // number, and the third attempt is the one that succeeds.
    expect(embedContent).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([[10000], [20000]]);
  });

  it('still retries a genuine provider rate limit on the search-query loop', async () => {
    const embedContent = jest
      .fn()
      .mockRejectedValueOnce(providerHttpError(429, 'Too Many Requests'))
      .mockResolvedValueOnce({ embeddings: [{ values: [0.1, 0.2] }] });
    const { service, delay } = serviceWith(embedContent);

    await expect(service.embedSearchQuery('find the parser')).resolves.toEqual([
      0.1, 0.2,
    ]);

    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls).toEqual([[10000]]);
  });

  it('does not retry a provider failure that is not a rate limit', async () => {
    const embedContent = jest
      .fn()
      .mockRejectedValue(providerHttpError(403, 'Forbidden'));
    const { service, delay } = serviceWith(embedContent);

    await expect(service.embedCodeChunk(chunk)).rejects.toThrow(
      /Failed to embed code chunk/,
    );

    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not read 429 inside a longer number in a provider message as a rate limit', async () => {
    const embedContent = jest
      .fn()
      .mockRejectedValue(
        providerHttpError(
          500,
          'Internal Server Error',
          '{"error":{"code":500,"message":"upstream timed out after 14290 ms"}}',
        ),
      );
    const { service, delay } = serviceWith(embedContent);

    await expect(service.embedCodeChunk(chunk)).rejects.toThrow(
      /Failed to embed code chunk/,
    );

    // "14290" contains "429", which the old substring check read as a status.
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
