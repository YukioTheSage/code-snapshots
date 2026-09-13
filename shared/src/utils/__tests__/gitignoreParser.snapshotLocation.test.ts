import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitignoreParser } from '../gitignoreParser';

describe('GitignoreParser snapshot location normalisation', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-gitignore-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const patternsFor = (location?: string): string[] =>
    (location === undefined
      ? new GitignoreParser(root)
      : new GitignoreParser(root, location)
    ).getPatterns();

  it.each([
    ['.snapshots', '.snapshots'],
    ['.snapshots/', '.snapshots'],
    ['././.snapshots', '.snapshots'],
    ['\\.snapshots\\', '.snapshots'],
    ['  .snapshots  ', '.snapshots'],
    ['/', '.snapshots'],
    ['', '.snapshots'],
    ['custom/store/', 'custom/store'],
  ])('normalises %p to %p', (input, expected) => {
    const patterns = patternsFor(input);

    expect(patterns).toContain(`**/${expected}`);
    expect(patterns).toContain(`**/${expected}/**`);
  });

  it('uses the default location when none is configured', () => {
    expect(patternsFor()).toContain('**/.snapshots');
  });

  it('normalises a long internal slash run in linear time', () => {
    // The sink is the third member of the removed chain, `/\/+$/`. A LEADING
    // run never reaches it: `/^\/+/` strips `'/'.repeat(n)` and
    // `/^(?:\.\/)+/` strips `'./'.repeat(n)` before the sink runs at all, so
    // both of those shapes are flat against the old chain (measured: 0.3 ms
    // and 0.1 ms at n = 50 000) and cannot exercise the quadratic path. The
    // run has to survive both leading strips to reach the sink, which is what
    // the `x` prefix makes it do. Measured on the old chain this costs
    // 10.7 / 61.1 / 206.5 / 654.2 ms at n = 5 000 / 10 000 / 20 000 / 40 000 --
    // a quadrupling per doubling -- and 981 ms at n = 50 000.
    const internalRun = `x${'/'.repeat(50000)}.snapshots`;

    const started = Date.now();
    const patterns = patternsFor(internalRun);
    const elapsed = Date.now() - started;

    // Nothing strips an internal run, so the location survives verbatim.
    expect(patterns).toContain(`**/${internalRun}`);
    expect(elapsed).toBeLessThan(250);
  });
});
