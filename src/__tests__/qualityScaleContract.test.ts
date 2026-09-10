import * as fs from 'fs';
import * as path from 'path';
import { SCORE_FIELDS } from '../services/qualityScale';

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

/**
 * A conversion call, as an opaque token. Stripping these from the line is what
 * makes one converted field on a line stop excusing an unconverted second one:
 * `toRatio(a.readabilityScore) + b.duplicationRisk` leaves a bare
 * `b.duplicationRisk` behind and is reported.
 */
const CONVERSION_CALL = /\b(?:to|from)Ratio\s*\((?:[^()]|\([^()]*\))*\)/g;

/**
 * A use of a 0-100 field that is still on the 0-100 scale. Every alternative is
 * anchored on the field reference itself, so the pattern only ever sees a
 * `.<field>` access and cannot match an unrelated line that happens to contain
 * `<` or `+`:
 *   - a comparison, or an assignment, of the field;
 *   - the field arithmetic'd against another field, with or without a receiver
 *     (`1 - duplicationRisk`, `a.f - b.f`, `x.f / x.g`), which is the shape of
 *     the inversion that `1 - 30` turns into `-29`;
 *   - a returned field.
 *
 * The comparison branch matches any operator, not just one followed by a digit.
 * The caller's `qualityThreshold` is a 0-1 value with no literal in sight, so a
 * digit-anchored pattern cannot see
 * `readabilityScore < criteria.qualityThreshold` -- the exact shape where the
 * caller's unit meets the metric's.
 *
 * Two exclusions, both for operands that are already on the same scale rather
 * than for operators: a `chunk.qualityMetrics.overallScore` right-hand operand
 * is a reduce accumulator over 0-100 scores (`cliConnectorService.ts`), and a
 * `metrics.<field>` one is a weighted sum whose weight is a 0-100 quantity
 * (`qualityMetricsCalculator.ts`). Neither is a unit mix.
 */
const UNCONVERTED_USE =
  /\.\w+\s*(?:[<>]=?|=(?!=))|\.\w+\s*[-+/]\s*\w*\.(?!quality[Mm]etrics\.)\w|[-+]\s*\w+\.(?!quality[Mm]etrics\.|metrics\.)\w+|\breturn\s+[\w.]*\.\w+/;

/**
 * Opt-out for a line that genuinely compares two values already on the same
 * scale. The marker goes on the line **before** the use, not after it: this is
 * a guard for `if (...)` conditions, and Prettier 2 relocates a trailing
 * comment off an `if` line into the block, which silently un-opts the line on
 * the next `prettier --write`.
 */
const SAME_UNIT_MARKER = '// quality-scale: same-unit';

/**
 * The lines of `lines` that use a 0-100 field in a comparison or arithmetic
 * without converting it, as 1-based line numbers.
 */
export function findUnconvertedUses(lines: string[]): number[] {
  const offenders: number[] = [];

  lines.forEach((line, index) => {
    // The conversion calls are removed first: a field that is wrapped is not a
    // use, and must not hide an unwrapped sibling on the same line.
    const code = line.replace(CONVERSION_CALL, '()');
    const field = SCORE_FIELDS.find((f) => code.includes(`.${f}`));
    if (!field) return;
    if (lines[index - 1]?.includes(SAME_UNIT_MARKER)) return;
    if (UNCONVERTED_USE.test(code)) {
      offenders.push(index + 1);
    }
  });

  return offenders;
}

describe('quality metric scale contract', () => {
  it('converts before using a 0-100 field in a comparison or arithmetic', () => {
    const offenders: string[] = [];

    for (const file of collectTsFiles(srcRoot)) {
      // qualityScale.ts defines the conversions; the type file declares them.
      if (/qualityScale\.ts$|types[\\/]enhancedChunking\.ts$/.test(file)) {
        continue;
      }

      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of findUnconvertedUses(lines)) {
        offenders.push(`${path.relative(srcRoot, file)}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  describe('the guard itself', () => {
    it('fires on an unconverted comparison against a non-literal', () => {
      expect(
        findUnconvertedUses([
          'if (result.qualityMetrics.readabilityScore < t) {',
        ]),
      ).toEqual([1]);
    });

    it('does not fire on a converted comparison against a non-literal', () => {
      expect(
        findUnconvertedUses([
          'if (toRatio(result.qualityMetrics.readabilityScore) < t) {',
        ]),
      ).toEqual([]);
    });

    it('does not fire when every field on the line is converted', () => {
      expect(
        findUnconvertedUses([
          'const r = toRatio(x.duplicationRisk) / toRatio(x.performanceRisk);',
        ]),
      ).toEqual([]);
    });

    it('fires on an unconverted division between two fields', () => {
      // Distinct receivers, because a *shared* `metrics.`-style right-hand
      // operand is the reduce-accumulator shape the pattern deliberately skips.
      expect(
        findUnconvertedUses([
          'const r = a.readabilityScore / b.readabilityScore;',
        ]),
      ).toEqual([1]);
    });

    it('fires on the second field when only the first is converted', () => {
      expect(
        findUnconvertedUses([
          'const r = toRatio(x.readabilityScore) + x.duplicationRisk;',
        ]),
      ).toEqual([1]);
    });

    it('honours a marker on the preceding line and not a trailing one', () => {
      expect(
        findUnconvertedUses([
          SAME_UNIT_MARKER,
          'if (x.securityRisk > 70) {',
          'if (x.performanceRisk > 70) { // quality-scale: same-unit',
        ]),
      ).toEqual([3]);
    });
  });
});
