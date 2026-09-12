import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliConnectorService } from '../cliConnectorService';
import * as vscode from 'vscode';

jest.mock('vscode');

describe('connection file permissions', () => {
  it('writes the token file owner-only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-perm-'));
    let service: CliConnectorService | undefined;

    try {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: root } },
      ];
      service = new CliConnectorService(
        {} as never,
        {
          extension: { packageJSON: { version: '0.9.5' } },
          subscriptions: [],
        } as never,
        undefined,
        null,
      );
      (service as any).authToken = 'deadbeef';
      (service as any).socketPath = path.join(root, 'pipe');

      // `import * as fs` is a getter-only namespace; patch the CommonJS module
      // the service's namespace reads from instead.
      const fsActual = require('fs') as typeof fs;
      const originalWriteFileSync = fsActual.writeFileSync;
      const calls: Array<{ file: string; options: unknown }> = [];
      (fsActual as any).writeFileSync = (
        file: string,
        data: string,
        options?: unknown,
      ) => {
        calls.push({ file: String(file), options });
        return (originalWriteFileSync as any)(file, data, options);
      };

      try {
        (service as any).createConnectionFile();
      } finally {
        (fsActual as any).writeFileSync = originalWriteFileSync;
      }

      const file = path.join(root, '.vscode', 'codelapse-connection.json');
      expect(fs.existsSync(file)).toBe(true);
      expect(calls).toHaveLength(1);

      // Windows ignores mode bits at the OS level but Node still receives the
      // owner-only mode, and the POSIX branch below asserts the actual mode.
      expect(calls[0].options).toEqual(
        expect.objectContaining({ encoding: 'utf8', mode: 0o600 }),
      );

      if (process.platform !== 'win32') {
        expect(fs.statSync(file).mode & 0o077).toBe(0);
      }
    } finally {
      service?.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});