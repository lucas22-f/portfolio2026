import { mapJourneyRibbonProgress } from './journey-ribbon-progress';

describe('mapJourneyRibbonProgress', () => {
  it('composes a section index with its normalized local scroll progress', () => {
    expect(mapJourneyRibbonProgress(0, 0, 4)).toBe(0);
    expect(mapJourneyRibbonProgress(0, 0.5, 4)).toBeCloseTo(1 / 6);
    expect(mapJourneyRibbonProgress(2, 0.25, 4)).toBeCloseTo(0.75);
    expect(mapJourneyRibbonProgress(3, 1, 4)).toBe(1);
  });

  it('clamps local progress and treats non-finite values as the section start', () => {
    expect(mapJourneyRibbonProgress(1, -0.5, 4)).toBeCloseTo(1 / 3);
    expect(mapJourneyRibbonProgress(1, 1.5, 4)).toBeCloseTo(2 / 3);
    expect(mapJourneyRibbonProgress(0, Number.NaN, 4)).toBe(0);
  });

  it('returns a finite start position when no timeline interval exists', () => {
    expect(mapJourneyRibbonProgress(0, Number.NaN, 1)).toBe(0);
    expect(mapJourneyRibbonProgress(-1, 0.5, 4)).toBe(0);
    expect(mapJourneyRibbonProgress(4, 0.5, 4)).toBe(0);
  });
});
