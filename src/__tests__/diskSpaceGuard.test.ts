import { promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertSufficientDiskSpace,
  getFreeDiskBytes,
  resetDiskSpaceWarningForTesting,
} from '../security/limits';

describe('getFreeDiskBytes', () => {
  beforeEach(() => {
    resetDiskSpaceWarningForTesting();
  });

  it('reports a positive free-space figure on this runtime', async () => {
    const dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-disk-'),
    );
    try {
      const free = await getFreeDiskBytes(dir);
      expect(free).not.toBeNull();
      expect(free as number).toBeGreaterThan(0);
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null instead of throwing when statfs is unavailable', async () => {
    const original = (fsPromises as any).statfs;
    // Simulate a Node 16 host, where fsPromises.statfs does not exist.
    delete (fsPromises as any).statfs;
    try {
      const dir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), 'codelapse-disk-'),
      );
      try {
        await expect(getFreeDiskBytes(dir)).resolves.toBeNull();
      } finally {
        await fsPromises.rm(dir, { recursive: true, force: true });
      }
    } finally {
      (fsPromises as any).statfs = original;
    }
  });

  it('returns null when statfs reports values it cannot interpret', async () => {
    const original = (fsPromises as any).statfs;
    (fsPromises as any).statfs = async () => ({ bavail: {}, bsize: {} });
    try {
      await expect(getFreeDiskBytes(os.tmpdir())).resolves.toBeNull();
    } finally {
      (fsPromises as any).statfs = original;
    }
  });

  it('accepts bigint figures, as Node reports them on some platforms', async () => {
    const original = (fsPromises as any).statfs;
    (fsPromises as any).statfs = async () => ({
      bavail: BigInt(10),
      bsize: BigInt(512),
    });
    try {
      await expect(getFreeDiskBytes(os.tmpdir())).resolves.toBe(5120);
    } finally {
      (fsPromises as any).statfs = original;
    }
  });
});

describe('assertSufficientDiskSpace', () => {
  beforeEach(() => {
    resetDiskSpaceWarningForTesting();
  });

  it('does not throw when free space cannot be determined', async () => {
    const original = (fsPromises as any).statfs;
    delete (fsPromises as any).statfs;
    try {
      const dir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), 'codelapse-disk-'),
      );
      try {
        // The bug: this rejected with 'Disk space check requires Node.js 18+',
        // so every write path failed on a host that merely could not report
        // free space.
        await expect(
          assertSufficientDiskSpace(path.join(dir, 'out.json')),
        ).resolves.toBeUndefined();
      } finally {
        await fsPromises.rm(dir, { recursive: true, force: true });
      }
    } finally {
      (fsPromises as any).statfs = original;
    }
  });

  it('still throws when free space is known to be insufficient', async () => {
    const dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-disk-'),
    );
    try {
      await expect(
        assertSufficientDiskSpace(
          path.join(dir, 'out.json'),
          Number.MAX_SAFE_INTEGER,
        ),
      ).rejects.toThrow(/Insufficient free disk space/);
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it('walks up to an existing ancestor for the free-space probe', async () => {
    const dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-disk-'),
    );
    try {
      await expect(
        assertSufficientDiskSpace(
          path.join(dir, 'does', 'not', 'exist', 'out.json'),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves for every configured minimum, not just the default', async () => {
    const dir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'codelapse-disk-'),
    );
    try {
      await expect(
        assertSufficientDiskSpace(path.join(dir, 'out.json'), 1),
      ).resolves.toBeUndefined();
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the skip is reported once rather than per write', () => {
  it('warns on the first call and stays quiet afterwards', async () => {
    const original = (fsPromises as any).statfs;
    delete (fsPromises as any).statfs;
    resetDiskSpaceWarningForTesting();

    // Reach the logger through the module's own import so the assertion is
    // about what the guard emits, not about console noise.
    const logger = require('../logger');
    const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => {});

    try {
      const dir = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), 'codelapse-disk-'),
      );
      try {
        await assertSufficientDiskSpace(path.join(dir, 'a.json'));
        await assertSufficientDiskSpace(path.join(dir, 'b.json'));
        await assertSufficientDiskSpace(path.join(dir, 'c.json'));
      } finally {
        await fsPromises.rm(dir, { recursive: true, force: true });
      }
    } finally {
      (fsPromises as any).statfs = original;
    }

    const warnings = logSpy.mock.calls.filter((call) =>
      String(call[0]).includes('disk-space pre-checks are skipped'),
    );
    expect(warnings).toHaveLength(1);
    logSpy.mockRestore();
  });
});
