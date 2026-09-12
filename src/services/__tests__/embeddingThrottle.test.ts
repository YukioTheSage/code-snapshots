/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmbeddingService } from '../embeddingService';

describe('embedding throttle', () => {
  it('does not delay a successful search-query embedding', async () => {
    const service = new EmbeddingService({} as never);
    const delay = jest
      .spyOn(service as any, 'delay')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'ensureInitialized').mockResolvedValue({
      models: {
        embedContent: jest.fn().mockResolvedValue({
          embeddings: [{ values: [0.1, 0.2] }],
        }),
      },
    });

    const started = Date.now();
    await service.embedSearchQuery('find the parser');

    // A fixed five-second sleep per call was the dominant cost of every search.
    expect(delay).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still backs off on a 429', async () => {
    const service = new EmbeddingService({} as never);
    const delay = jest
      .spyOn(service as any, 'delay')
      .mockResolvedValue(undefined);
    const embedContent = jest
      .fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValue({ embeddings: [{ values: [0.1] }] });
    jest.spyOn(service as any, 'ensureInitialized').mockResolvedValue({
      models: { embedContent },
    });

    await service.embedSearchQuery('find the parser');

    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith((service as any).RETRY_BACKOFF_BASE_MS);
  });
});
