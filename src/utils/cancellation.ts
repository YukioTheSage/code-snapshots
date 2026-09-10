import * as vscode from 'vscode';

/**
 * Thrown by `throwIfCancelled`. Command handlers match on `isCancellationError`
 * rather than on the message, so the message is free to change.
 */
export class CancellationError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Cooperative cancellation: call this at every `await` boundary inside a
 * cancellable work function.
 *
 * This exists because registering a listener that throws does not work.
 * `token.onCancellationRequested(() => { throw ... })` discards the listener's
 * return value, so the throw lands in the event emitter's dispatch frame rather
 * than in the caller's control flow: the `withProgress` callback keeps running
 * to completion while the UI reports the operation as cancelled, and the
 * `catch` blocks that look for a cancellation message are unreachable.
 *
 * Prefer `isCancellationError` over matching the message text.
 */
export function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new CancellationError();
  }
}

/** True when `error` represents a user cancellation rather than a failure. */
export function isCancellationError(error: unknown): boolean {
  return error instanceof CancellationError;
}
