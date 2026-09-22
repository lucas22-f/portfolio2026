import { RibbonEngine, RIBBON_QUALITY_TIERS } from './ribbon-engine';

describe('RibbonEngine', () => {
  const engine = new RibbonEngine();

  it('creates eleven continuous, fanned threads at full quality', () => {
    const frame = engine.createFrame(1 / 3, 0, RIBBON_QUALITY_TIERS[0]);

    expect(frame.threads).toHaveLength(11);
    expect(frame.threads.every((thread) => thread.length > 80)).toBe(true);
    expect(new Set(frame.threads.map((thread) => thread[0][1])).size).toBe(11);
  });

  it('keeps an open route while changing stages and phase', () => {
    const first = engine.createFrame(2 / 3, 0, RIBBON_QUALITY_TIERS[0]).threads[5];
    const deformed = engine.createFrame(2 / 3, 0.5, RIBBON_QUALITY_TIERS[0]).threads[5];
    const distance = Math.hypot(first.at(-1)![0] - first[0][0], first.at(-1)![1] - first[0][1]);

    expect(distance).toBeGreaterThan(70);
    expect(deformed).not.toEqual(first);
  });
});
