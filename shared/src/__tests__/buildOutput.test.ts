import * as fs from 'fs';
import * as path from 'path';

describe('shared build output', () => {
  it('excludes test sources from the compiler input', () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', 'tsconfig.json'),
        'utf8',
      ),
    ) as { exclude: string[] };
    // One pattern per shape the package means to keep out of the build: a
    // __tests__ directory, a .test.ts file and a .spec.ts file. Extra
    // excludes are not a failure; each shape's presence is what is pinned.
    const covers = (shape: string): boolean =>
      config.exclude.some((pattern) => pattern.includes(shape));
    expect(covers('__tests__')).toBe(true);
    expect(covers('*.test.ts')).toBe(true);
    expect(covers('*.spec.ts')).toBe(true);
  });
});
