import * as fs from 'fs';
import * as path from 'path';

const srcRoot = path.join(__dirname, '..');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !full.includes('__tests__')) {
      out.push(full);
    }
  }
  return out;
}

/** 0-100 fields, as declared in the QualityMetrics contract. */
const SCORE_FIELDS = [
  'overallScore',
  'readabilityScore',
  'testCoverage',
  'duplicationRisk',
  'performanceRisk',
  'securityRisk',
  'maintainabilityScore',
  'styleComplianceScore',
];

/**
 * A comparison against a literal, or an arithmetic use, of a 0-100 field.
 * `value:` and `score:` assignments are included because that is how the
 * readability metric reached the explanation payload.
 */
const UNCONVERTED_USE =
  /[<>]=?\s*\d|=\s*\d|value:\s*[\w.]*\.|-\s*metrics\.|\+\s*metrics\./;

describe('quality metric scale contract', () => {
  it('converts before using a 0-100 field in a comparison or arithmetic', () => {
    const offenders: string[] = [];

    for (const file of collectTsFiles(srcRoot)) {
      // qualityScale.ts defines the conversions; the type file declares them.
      if (/qualityScale\.ts$|types[\\/]enhancedChunking\.ts$/.test(file)) {
        continue;
      }

      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const field = SCORE_FIELDS.find((f) => line.includes(`.${f}`));
        if (!field) return;
        // `// same-unit` opts a line out, for a site that genuinely combines
        // two values already on the same scale.
        if (line.includes('toRatio(') || line.includes('// same-unit')) return;
        if (UNCONVERTED_USE.test(line)) {
          offenders.push(`${path.relative(srcRoot, file)}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
