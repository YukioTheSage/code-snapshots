import * as vscode from 'vscode';
import { OutputChannel } from './__mocks__/vscode';
import { initializeLogger, showOutputChannel } from '../logger';

/**
 * The output-channel reveal is a one-way UI side effect: in a headless run
 * nobody can read it, and the output editor it opens cannot be closed again by
 * any API the host offers, so it outlives the command that opened it and
 * changes the editor state of everything that runs afterwards. The integration
 * suite pins that end-to-end (`test/suite/extension.test.ts`, "diagnostics does
 * not open an output editor in a headless run"); these tests pin the guard
 * itself with no timing involved.
 */
describe('showOutputChannel honours the headless-run contract', () => {
  const INTERACTIVE = 'CODELAPSE_DISABLE_INTERACTIVE_UI';
  const CREDENTIALS = 'CODELAPSE_DISABLE_CREDENTIAL_PROMPTS';

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      [INTERACTIVE]: process.env[INTERACTIVE],
      [CREDENTIALS]: process.env[CREDENTIALS],
    };
    delete process.env[INTERACTIVE];
    delete process.env[CREDENTIALS];
    // The channel is module state, created on first initializeLogger call; the
    // mock hands out one shared stub, so clearing it is enough to make each
    // assertion below about this test's own call.
    initializeLogger({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    (OutputChannel.show as jest.Mock).mockClear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('reveals the channel in an interactive session', () => {
    showOutputChannel();
    expect(OutputChannel.show).toHaveBeenCalledTimes(1);
  });

  it('does not reveal the channel when interactive UI is disabled', () => {
    process.env[INTERACTIVE] = '1';
    showOutputChannel();
    expect(OutputChannel.show).not.toHaveBeenCalled();
  });

  it('does not reveal the channel when only credential prompts are disabled', () => {
    // The older variable is a headless switch too: a host started with it has
    // nobody to reveal anything to, and the reveal would outlive the command.
    process.env[CREDENTIALS] = '1';
    showOutputChannel();
    expect(OutputChannel.show).not.toHaveBeenCalled();
  });
});
