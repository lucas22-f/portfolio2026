import { AdaptiveRibbonQuality, easeRibbonProgress, RibbonCanvasRenderer } from './ribbon-canvas-renderer';

describe('RibbonCanvasRenderer', () => {
  it('degrades after sustained missed budgets and recovers only after sustained stability', () => {
    const quality = new AdaptiveRibbonQuality();
    for (let index = 0; index < 45; index += 1) quality.report(30, 20);
    expect(quality.quality.frameInterval).toBeCloseTo(1000 / 30);
    for (let index = 0; index < 180; index += 1) quality.report(16, 1);
    expect(quality.quality.frameInterval).toBeCloseTo(1000 / 60);
  });

  it('eases displayed progress instead of teleporting to the target', () => {
    const next = easeRibbonProgress(0, 1, 16);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('uses DPR-sized backing storage and renders a static state for reduced motion', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ width: 120, height: 80 }) });
    const context = {
      setTransform: () => undefined, clearRect: () => undefined, save: () => undefined, scale: () => undefined,
      restore: () => undefined, beginPath: () => undefined, lineTo: () => undefined, moveTo: () => undefined, stroke: () => undefined,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    const renderer = new RibbonCanvasRenderer(canvas);

    expect(renderer.start(0, true)).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([240, 160]);
    expect(requestFrame).not.toHaveBeenCalled();
    renderer.destroy();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
  });

  it('activates the static decorative fallback when Canvas 2D is unavailable', () => {
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    wrapper.append(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    expect(new RibbonCanvasRenderer(canvas).start(0, false)).toBe(false);
    expect(wrapper.classList.contains('journey-ribbon--fallback')).toBe(true);
  });

  it('pauses and resumes animation work with document visibility changes', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    const renderer = new RibbonCanvasRenderer(canvas) as unknown as { onVisibilityChange(): void; paused: boolean };
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    renderer.onVisibilityChange();
    expect(renderer.paused).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    renderer.onVisibilityChange();
    expect(renderer.paused).toBe(false);
  });
});
