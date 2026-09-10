import { QualityMetrics } from '../types/enhancedChunking';

/**
 * The one place the quality-metric scale is defined.
 *
 * `QualityMetrics` mixes two units on purpose, and the interface documents
 * which is which: scores and risks are 0-100, ratios are 0-1. That is a
 * reasonable API -- "readability 82" and "documentation ratio 0.4" both read
 * naturally -- but nothing enforced it, so two separate places manufactured
 * metrics on a 0-1 scale for 0-100 fields and every comparison was written
 * against the 0-1 reading. It worked only because the mistakes cancelled:
 * `1 - duplicationRisk` evaluated `1 - 0.3` where the contract says `1 - 30`.
 *
 * Every conversion between the two units goes through this module, so a
 * comparison's unit is visible at the call site instead of inferred.
 */
export const SCORE_MAX = 100;

/** Score/risk fields, on the 0-100 scale documented in `QualityMetrics`. */
export const SCORE_FIELDS = [
  'overallScore',
  'readabilityScore',
  'testCoverage',
  'duplicationRisk',
  'performanceRisk',
  'securityRisk',
  'maintainabilityScore',
  'styleComplianceScore',
] as const;

/** Ratio fields, on the 0-1 scale documented in `QualityMetrics`. */
export const RATIO_FIELDS = ['documentationRatio'] as const;

/** 0-100 -> 0-1. Clamped, so an unconverted producer cannot invert a risk term. */
export function toRatio(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score / SCORE_MAX));
}

/** 0-1 -> 0-100. Clamped. */
export function fromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(SCORE_MAX, ratio * SCORE_MAX));
}

/**
 * Default metrics for a result that carries none.
 *
 * The search path produces no quality metrics at all -- `SemanticSearchResult`
 * has no such field -- so this constant is what every result is ranked with
 * today, which is why the quality criterion contributes the same number to
 * every composite score. Making the metrics real requires the search path to
 * compute them, which is a behaviour change this plan does not make; see
 * docs/KNOWN_ISSUES.md.
 */
export const DEFAULT_QUALITY_METRICS: QualityMetrics = {
  overallScore: 70,
  readabilityScore: 70,
  testCoverage: undefined,
  documentationRatio: 0.5,
  duplicationRisk: 30,
  performanceRisk: 20,
  securityRisk: 15,
  maintainabilityScore: 75,
  technicalDebt: {
    estimatedFixTime: 2,
    severity: 'low',
    categories: [],
    issues: [],
  },
  styleComplianceScore: 80,
};
