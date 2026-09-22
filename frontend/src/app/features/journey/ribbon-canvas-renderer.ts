import { RibbonEngine, RibbonRenderQuality, RIBBON_QUALITY_TIERS } from './ribbon-engine';

const MISSED_FRAME_LIMIT = 45;
const STABLE_FRAME_LIMIT = 180;

export class AdaptiveRibbonQuality {
  private tier = 0;
  private missedFrames = 0;
  private stableFrames = 0;

  get quality(): RibbonRenderQuality { return RIBBON_QUALITY_TIERS[this.tier]; }

  report(frameElapsed: number, drawCost: number): RibbonRenderQuality {
    const missed = frameElapsed > this.quality.frameInterval * 1.5 || drawCost > this.quality.frameInterval * 0.7;
    this.missedFrames = missed ? this.missedFrames + 1 : 0;
    this.stableFrames = missed ? 0 : this.stableFrames + 1;
    if (this.missedFrames >= MISSED_FRAME_LIMIT && this.tier < RIBBON_QUALITY_TIERS.length - 1) {
      this.tier += 1;
      this.missedFrames = 0;
      this.stableFrames = 0;
    } else if (this.stableFrames >= STABLE_FRAME_LIMIT && this.tier > 0) {
      this.tier -= 1;
      this.stableFrames = 0;
    }
    return this.quality;
  }
}

export const easeRibbonProgress = (current: number, target: number, elapsed: number): number =>
  Math.abs(target - current) < 0.002 ? target : current + (target - current) * Math.min(0.08, Math.max(0.018, elapsed / 700));

/** Owns the Canvas lifecycle; no Angular state is updated while it animates. */
export class RibbonCanvasRenderer {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly quality = new AdaptiveRibbonQuality();
  private resizeObserver: ResizeObserver | undefined;
  private animationFrame: number | undefined;
  private target = 0;
  private displayed = 0;
  private lastFrame = 0;
  private reducedMotion = false;
  private paused = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly engine = new RibbonEngine()) {
    this.context = canvas.getContext('2d');
  }

  get available(): boolean { return this.context !== null; }
  get displayedProgress(): number { return this.displayed; }
  get currentQuality(): RibbonRenderQuality { return this.quality.quality; }

  start(progress: number, reducedMotion: boolean): boolean {
    if (!this.context) {
      this.canvas.parentElement?.classList.add('journey-ribbon--fallback');
      return false;
    }
    this.target = progress;
    this.displayed = reducedMotion ? 0.58 : progress;
    this.reducedMotion = reducedMotion;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    if (!reducedMotion && !document.hidden) this.animationFrame = requestAnimationFrame(this.animate);
    return true;
  }

  setTarget(progress: number): void {
    this.target = Math.min(1, Math.max(0, progress));
    if (this.reducedMotion) this.draw(0);
  }

  destroy(): void {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    this.paused = document.hidden;
    if (this.paused && this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    if (!this.paused && !this.reducedMotion) {
      this.lastFrame = 0;
      this.animationFrame = requestAnimationFrame(this.animate);
    }
  };

  private readonly animate = (time: number): void => {
    if (this.paused || this.reducedMotion) return;
    const elapsed = this.lastFrame ? time - this.lastFrame : this.quality.quality.frameInterval;
    if (elapsed >= this.quality.quality.frameInterval) {
      const started = performance.now();
      this.displayed = easeRibbonProgress(this.displayed, this.target, elapsed);
      this.draw(time / 2300);
      this.quality.report(elapsed, performance.now() - started);
      this.lastFrame = time;
    }
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private resize(): void {
    if (!this.context) return;
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || window.innerWidth);
    const height = Math.max(1, bounds.height || window.innerHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.draw(0);
  }

  private draw(phase: number): void {
    if (!this.context) return;
    const width = this.canvas.width / Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const height = this.canvas.height / Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const dpr = this.canvas.width / width;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.context.clearRect(0, 0, width, height);
    this.context.save();
    this.context.scale(width / 100, height / 100);
    this.context.lineCap = 'round';
    this.context.lineJoin = 'round';
    this.context.lineWidth = 0.14;
    if (this.quality.quality.glow) { this.context.shadowBlur = 0.55; this.context.shadowColor = 'rgb(62 224 173 / 0.72)'; }
    const threads = this.engine.createFrame(this.displayed, phase, this.quality.quality).threads;
    threads.forEach((thread, index) => {
      this.context!.beginPath();
      thread.forEach(([x, y], point) => point ? this.context!.lineTo(x, y) : this.context!.moveTo(x, y));
      const distance = Math.abs(index - (threads.length - 1) / 2) / Math.max(1, (threads.length - 1) / 2);
      this.context!.strokeStyle = `rgb(62 224 173 / ${0.96 - distance * 0.66})`;
      this.context!.stroke();
    });
    this.context.restore();
  }
}
