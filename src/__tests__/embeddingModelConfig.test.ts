import { EmbeddingService } from '../services/embeddingService';
import * as vscode from 'vscode';

function withConfig(values: Record<string, unknown>) {
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    update: jest.fn(),
  });
}

describe('EmbeddingService model configuration', () => {
  it('reads the model id from configuration', () => {
    withConfig({ 'embedding.model': 'some-future-model' });
    const service = new EmbeddingService({} as never);
    expect(service.getModelId()).toBe('some-future-model');
  });

  it('falls back to a current model id, not the retired one', () => {
    withConfig({});
    const service = new EmbeddingService({} as never);
    expect(service.getModelId()).toBe('gemini-embedding-2');
    // The retired experimental id must not appear anywhere as a default.
    expect(service.getModelId()).not.toBe('gemini-embedding-exp-03-07');
  });

  it('re-reads configuration on every call so a change needs no reload', () => {
    withConfig({ 'embedding.model': 'first' });
    const service = new EmbeddingService({} as never);
    expect(service.getModelId()).toBe('first');

    withConfig({ 'embedding.model': 'second' });
    expect(service.getModelId()).toBe('second');
  });

  it('reads the output dimension from configuration', () => {
    withConfig({ 'embedding.dimension': 1536 });
    const service = new EmbeddingService({} as never);
    expect(service.getDimension()).toBe(1536);
  });

  it('defaults the dimension to 3072', () => {
    withConfig({});
    const service = new EmbeddingService({} as never);
    expect(service.getDimension()).toBe(3072);
  });

  it('rejects a non-numeric or non-positive configured dimension', () => {
    // A bad value here would reach the API as outputDimensionality and
    // either be rejected or silently produce vectors the index cannot store.
    withConfig({ 'embedding.dimension': Number.NaN });
    expect(new EmbeddingService({} as never).getDimension()).toBe(3072);

    withConfig({ 'embedding.dimension': 0 });
    expect(new EmbeddingService({} as never).getDimension()).toBe(3072);

    withConfig({ 'embedding.dimension': -5 });
    expect(new EmbeddingService({} as never).getDimension()).toBe(3072);
  });
});
