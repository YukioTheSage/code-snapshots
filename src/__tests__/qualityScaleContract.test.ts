import * as fs from 'fs';
import * as path from 'path';
import { SCORE_FIELDS } from '../services/qualityScale';

const srcRoot = path.join(__dirname, '..');

/**
 * The walk the guard's main assertion depends on. Exported so a self-test can
 * prove it finds files: `expect(offenders).toEqual([])` would pass just as
 * happily if this returned nothing.
 */
export function collectTsFiles(dir: string): string[] {
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
 * A use of a 0-100 field that is still on the 0-100 scale, in the five shapes
 * the alternatives below match. Every measurement quoted here was taken by
 * running `findUnconvertedUses` on the quoted line:
 *   - `\.\w+\s*(?:[<>]=?|=(?!=))` -- a comparison, or an assignment, of a
 *     field. The operator set is `<`, `<=`, `>`, `>=` and a bare `=`. It does
 *     **not** include `==`, `===`, `!=` or `!==`: `x.readabilityScore = 70` is
 *     reported and `if (x.readabilityScore === 70)` is not. The three real
 *     strict comparisons on these fields in `src/` are `undefined` and `0`
 *     tests, which are scale-invariant, so nothing is missed today; an `===`
 *     against a 0-1 literal would be.
 *   - `value:\s*[\w.]*\.` -- a `value:` payload holding a dotted path, which is
 *     how the readability metric reached
 *     `SearchResultExplanation.confidenceFactors` and where its siblings
 *     (`result.score`, `documentationRatio`) are both 0-1. Not anchored on the
 *     field: `value: result.score, // .readabilityScore` is reported, and the
 *     whole-line field gate below is the only thing tying this alternative to a
 *     metric.
 *   - `\.\w+\s*[-+/]\s*\w*\.(?!quality[Mm]etrics\.)\w` -- the field arithmetic'd
 *     against a receiver-qualified field, with an operand received through
 *     `qualityMetrics` skipped.
 *   - `[-+]\s*\w+\.(?!quality[Mm]etrics\.|metrics\.)\w+` -- the same arithmetic
 *     written prefix-first (`1 - duplicationRisk`, `sum + chunk.f`), which is
 *     the shape of the inversion `1 - 30` turns into `-29`.
 *   - `\breturn\s+[\w.]*\.\w+` -- a returned dotted expression. Not anchored on
 *     the field either: `return this.calculateQualityScore(
 *     metrics.readabilityScore);` is reported because of the callee, while the
 *     same call without `return` is not reported at all.
 *
 * The comparison branch deliberately does not require a digit after the
 * operator: the caller's `qualityThreshold` is a 0-1 value with no literal in
 * sight, so a digit-anchored pattern cannot see
 * `readabilityScore < criteria.qualityThreshold` -- the exact shape where the
 * caller's unit meets the metric's.
 *
 * Both lookaheads suppress on the right-hand operand's *receiver*, not on the
 * operator. `sum + chunk.qualityMetrics.overallScore`
 * (`cliConnectorService.ts:1402`, `:2871`) is quiet because the prefix branch
 * skips a `qualityMetrics`-received operand, and that is the only thing either
 * lookahead suppresses in this tree: removing it reports exactly those two
 * accumulator lines, while removing the prefix lookahead's `metrics\.`
 * alternative, or the infix branch's copy of the lookahead, leaves the offender
 * list unchanged (no line in `src/` reaches either). The inversion is
 * *reported*, not skipped -- `score += 1 - metrics.duplicationRisk` matches,
 * because the lookahead inspects what follows the receiver's dot and
 * `duplicationRisk` matches neither alternative -- and so is
 * `total + metrics.readabilityScore`, whose receiver is not skipped at all. The
 * weighted sums in `qualityMetricsCalculator.ts` are quiet only because `*` is
 * not in the arithmetic alternation.
 *
 * Known coverage boundary, stated rather than implied. The field gate below
 * requires a `.<field>` access somewhere on the line, so a receiver-less write
 * never reaches the pattern at all: `readabilityScore: 0.7,` in an object
 * literal is invisible, which is how `cliConnectorService.handleAnalyzeQuality`
 * returned `readability: 0.82` -- an alias not in `SCORE_FIELDS` either --
 * through the sweep this guard replaced. A receiver-qualified *copy* is
 * invisible too (`readabilityScore: metrics.readabilityScore,` matches no
 * alternative; `value:` has its own alternative for exactly that reason, object
 * literals do not), as are a compound assignment
 * (`score += metrics.readabilityScore`) and the `qualityMetrics`-received
 * accumulator when the other operand really is 0-1. It is a net, not a proof.
 */
const UNCONVERTED_USE =
  /\.\w+\s*(?:[<>]=?|=(?!=))|value:\s*[\w.]*\.|\.\w+\s*[-+/]\s*\w*\.(?!quality[Mm]etrics\.)\w|[-+]\s*\w+\.(?!quality[Mm]etrics\.|metrics\.)\w+|\breturn\s+[\w.]*\.\w+/;

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

    it('fires on a raw value: payload and not on a converted one', () => {
      // `generateResultExplanation` is one of the six sites Step 7 names, and
      // this is the only thing standing between it and a silent regression.
      expect(
        findUnconvertedUses(['value: result.qualityMetrics.readabilityScore,']),
      ).toEqual([1]);
      expect(
        findUnconvertedUses([
          'value: toRatio(result.qualityMetrics.readabilityScore),',
        ]),
      ).toEqual([]);
    });

    it('draws the coverage boundary at the receiver, not the operator', () => {
      // A `qualityMetrics`-received operand on the right-hand side is what the
      // lookahead skips -- that is the accumulator shape. A receiver named
      // `metrics` is not skipped, so the same inversion against it is reported.
      expect(
        findUnconvertedUses(['score += 1 - metrics.duplicationRisk;']),
      ).toEqual([1]);
      expect(
        findUnconvertedUses(['const v = total + metrics.readabilityScore;']),
      ).toEqual([1]);
      expect(
        findUnconvertedUses([
          '  (sum, chunk) => sum + chunk.qualityMetrics.overallScore,',
        ]),
      ).toEqual([]);
      // Outside the net entirely, because the field check needs a `.<field>`
      // access: a bare identifier is not a detection the guard ever makes.
      expect(findUnconvertedUses(['score += 1 - duplicationRisk;'])).toEqual(
        [],
      );
    });

    it('fires on the return alternative, which is anchored on the statement', () => {
      // The one test that keeps `\breturn\s+[\w.]*\.\w+` load-bearing. It is not
      // anchored on the field: the second line is reported because of
      // `return this.calculateQualityScore`, the callee, and the identical call
      // without `return` matches nothing at all.
      expect(findUnconvertedUses(['return metrics.readabilityScore;'])).toEqual(
        [1],
      );
      expect(
        findUnconvertedUses([
          'return this.calculateQualityScore(metrics.readabilityScore);',
        ]),
      ).toEqual([1]);
      expect(
        findUnconvertedUses([
          'const v = this.calculateQualityScore(metrics.readabilityScore);',
        ]),
      ).toEqual([]);
    });

    it('matches assignment and ordering operators, not equality', () => {
      // The comparison branch is `<`, `<=`, `>`, `>=` and a bare `=`. The
      // equality operators are *not* in it (measured), so this pins both
      // directions: dropping `=(?!=)` stops the assignment being reported, and
      // widening the branch to `==`/`===` starts reporting the equality lines.
      // The three real strict comparisons on these fields in `src/` are
      // `undefined` and `0` tests, which are scale-invariant.
      expect(findUnconvertedUses(['x.readabilityScore = 70;'])).toEqual([1]);
      expect(findUnconvertedUses(['if (x.readabilityScore >= 70) {'])).toEqual([
        1,
      ]);
      expect(findUnconvertedUses(['if (x.readabilityScore == 70) {'])).toEqual(
        [],
      );
      expect(findUnconvertedUses(['if (x.readabilityScore === 70) {'])).toEqual(
        [],
      );
      expect(findUnconvertedUses(['if (x.readabilityScore != 70) {'])).toEqual(
        [],
      );
      expect(findUnconvertedUses(['if (x.readabilityScore !== 70) {'])).toEqual(
        [],
      );
    });

    it('cannot see an object-literal write, receiver-less or copied', () => {
      // The largest hole, asserted rather than left implied: no alternative
      // matches a `field: <literal>` or `field: <dotted path>` write, so an
      // object literal is only ever caught when it is a `value:` payload. The
      // second line is the shape `cliConnectorService.handleAnalyzeQuality`
      // got through with -- an alias on the old scale, doubly invisible.
      expect(
        findUnconvertedUses(['            readabilityScore: 0.7,']),
      ).toEqual([]);
      expect(findUnconvertedUses(['            readability: 0.82,'])).toEqual(
        [],
      );
      expect(
        findUnconvertedUses([
          '            readabilityScore: metrics.readabilityScore,',
        ]),
      ).toEqual([]);
      expect(
        findUnconvertedUses(['value: result.qualityMetrics.readabilityScore,']),
      ).toEqual([1]);
    });

    it('walks the tree, so an empty offender list is not vacuous', () => {
      // The main assertion is `expect(offenders).toEqual([])`; a walk that
      // silently returned nothing would satisfy it, and this is what fails
      // instead.
      const files = collectTsFiles(srcRoot);
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain(
        path.join(srcRoot, 'services', 'resultManager.ts'),
      );
      expect(files).toContain(
        path.join(srcRoot, 'services', 'cliConnectorService.ts'),
      );
      expect(files.filter((file) => file.includes('__tests__'))).toEqual([]);
    });
  });
});
