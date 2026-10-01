import { AdaptiveRibbonQuality, easeRibbonProgress, RibbonCanvasRenderer } from './ribbon-canvas-renderer';

const createCanvasContext = (): CanvasRenderingContext2D => ({
  setTransform: () => undefined, clearRect: () => undefined, save: () => undefined, scale: () => undefined,
  restore: () => undefined, beginPath: () => undefined, lineTo: () => undefined, moveTo: () => undefined, stroke: () => undefined,
} as unknown as CanvasRenderingContext2D);

describe('RibbonCanvasRenderer', () => {
  afterEach(() => vi.restoreAllMocks());

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
    renderer.setTarget(0.8);
    expect(requestFrame).not.toHaveBeenCalled();
    renderer.destroy();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
  });

  it('settles mobile animation, resumes for retargeting, and preserves phase on resize', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(createCanvasContext());
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ width: 120, height: 80 }) });
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return requestFrame.mock.calls.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const renderer = new RibbonCanvasRenderer(canvas);
    const draw = vi.spyOn(renderer as unknown as { draw(phase: number): void }, 'draw');

    expect(renderer.start(0, false)).toBe(true);
    expect(requestFrame).not.toHaveBeenCalled();
    renderer.setTarget(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    renderer.setTarget(0.75);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    let time = 16;
    let frames = 0;
    while (frame && frames < 600) {
      const nextFrame = frame;
      frame = undefined;
      nextFrame(time);
      time += 16;
      frames += 1;
    }
    expect(frame).toBeUndefined();
    expect(renderer.displayedProgress).toBe(0.75);
    const settledRequestCount = requestFrame.mock.calls.length;

    const settledPhase = draw.mock.calls.at(-1)?.[0];
    (renderer as unknown as { resize(): void }).resize();
    expect(draw.mock.calls.at(-1)?.[0]).toBe(settledPhase);
    expect(requestFrame).toHaveBeenCalledTimes(settledRequestCount);
    renderer.destroy();
    expect(cancelFrame).not.toHaveBeenCalled();
    window.matchMedia = originalMatchMedia;
  });

  it('continues scheduling animation frames on desktop after reaching its target', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(createCanvasContext());
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return requestFrame.mock.calls.length;
    });
    const renderer = new RibbonCanvasRenderer(canvas);

    expect(renderer.start(0, false)).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    frame?.(16);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    renderer.destroy();
    window.matchMedia = originalMatchMedia;
  });

  it('resumes a pending mobile transition once when document visibility returns', () => {
    const originalMatchMedia = window.matchMedia;
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(createCanvasContext());
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const renderer = new RibbonCanvasRenderer(canvas);

    renderer.start(0, false);
    renderer.setTarget(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(requestFrame).toHaveBeenCalledTimes(2);

    renderer.destroy();
    window.matchMedia = originalMatchMedia;
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
    else Reflect.deleteProperty(document, 'hidden');
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
