import * as fs from 'fs';
import * as path from 'path';

describe('shared build output', () => {
  it('excludes test sources from the compiler input', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'tsconfig.json'), 'utf8'),
    ) as { exclude: string[] };
    const excludesTests = config.exclude.some(
      (pattern) => pattern.includes('__tests__') || pattern.includes('*.test.ts'),
    );
    expect(excludesTests).toBe(true);
  });
});
