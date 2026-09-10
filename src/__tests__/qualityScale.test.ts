import {
  SCORE_MAX,
  toRatio,
  fromRatio,
  DEFAULT_QUALITY_METRICS,
} from '../services/qualityScale';

describe('qualityScale', () => {
  it('converts between the documented score scale and the ratio scale', () => {
    expect(SCORE_MAX).toBe(100);
    expect(toRatio(70)).toBeCloseTo(0.7);
    expect(toRatio(0)).toBe(0);
    expect(toRatio(100)).toBe(1);
    expect(fromRatio(0.7)).toBeCloseTo(70);
  });

  it('clamps rather than propagating an out-of-range value', () => {
    // A producer that has not been converted yet must not dominate a weighted
    // sum or invert a risk term; it is clamped and the guard test in
    // qualityScaleContract.test.ts is what reports it.
    expect(toRatio(140)).toBe(1);
    expect(toRatio(-20)).toBe(0);
    expect(fromRatio(3)).toBe(100);
    expect(fromRatio(-1)).toBe(0);
  });

  it('supplies defaults that are inside the documented contract', () => {
    expect(DEFAULT_QUALITY_METRICS.readabilityScore).toBe(70);
    expect(DEFAULT_QUALITY_METRICS.duplicationRisk).toBe(30);
    expect(DEFAULT_QUALITY_METRICS.performanceRisk).toBe(20);
    expect(DEFAULT_QUALITY_METRICS.securityRisk).toBe(15);
    expect(DEFAULT_QUALITY_METRICS.overallScore).toBe(70);
    expect(DEFAULT_QUALITY_METRICS.maintainabilityScore).toBe(75);
    // documentationRatio is the one ratio field, and stays a ratio.
    expect(DEFAULT_QUALITY_METRICS.documentationRatio).toBe(0.5);
  });
});
