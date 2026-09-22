export type RibbonPoint = readonly [number, number];

export interface RibbonFrame {
  readonly threads: readonly (readonly RibbonPoint[])[];
}

export interface RibbonRenderQuality {
  readonly frameInterval: number;
  readonly sampleStride: number;
  readonly threadCount: number;
  readonly glow: boolean;
}

export const RIBBON_QUALITY_TIERS: readonly RibbonRenderQuality[] = [
  { frameInterval: 1000 / 60, sampleStride: 1, threadCount: 11, glow: true },
  { frameInterval: 1000 / 30, sampleStride: 1, threadCount: 11, glow: true },
  { frameInterval: 1000 / 30, sampleStride: 2, threadCount: 7, glow: true },
  { frameInterval: 1000 / 30, sampleStride: 3, threadCount: 5, glow: false },
];

const STAGES = [
  { center: [82, 49], radius: [15, 8], figure: 'compact' },
  { center: [50, 86], radius: [60, 43], figure: 'low-swell' },
  { center: [50, 57], radius: [60, 35], figure: 'diagonal-sweep' },
  { center: [55, 55], radius: [58, 34], figure: 'lateral-fold' },
] as const;

/** Pure, normalized geometry for the Journey's decorative Canvas ribbon. */
export class RibbonEngine {
  createFrame(progress: number, phase: number, quality: RibbonRenderQuality): RibbonFrame {
    const route = this.buildRoute(phase);
    const boundedProgress = Math.min(1, Math.max(0, progress));
    const head = this.headIndex(boundedProgress, route.anchors);
    const stageDistance = Math.abs(boundedProgress * 3 - Math.round(boundedProgress * 3));
    const settledExpansion = 1 - Math.min(1, stageDistance / 0.34);
    const visiblePointCount = Math.round(188 - settledExpansion * 76);
    const tail = Math.max(0, Math.floor(head) - visiblePointCount);
    const spine = route.points.slice(tail, Math.floor(head) + 1);
    const offset = (11 - quality.threadCount) / 2;
    return {
      threads: Array.from({ length: quality.threadCount }, (_, index) =>
        this.offsetThread(spine, index + offset, boundedProgress, quality.sampleStride),
      ),
    };
  }

  private buildRoute(phase: number): { points: RibbonPoint[]; anchors: number[] } {
    const points: RibbonPoint[] = [];
    const anchors: number[] = [];
    STAGES.forEach((stage, index) => {
      const loop = this.buildLoop(stage, phase + index * 0.16);
      if (index) points.push(...this.connector(points.at(-1)!, points.at(-2)!, loop[0], loop[1], phase));
      points.push(...loop);
      anchors.push(points.length - 1);
    });
    return { points, anchors };
  }

  private buildLoop(stage: (typeof STAGES)[number], phase: number): RibbonPoint[] {
    return Array.from({ length: 112 }, (_, index) => {
      const t = index / 111;
      const angle = Math.PI * 2 * t;
      const breathing = 1 + 0.035 * Math.sin(phase * 0.72);
      const [centerX, centerY] = stage.center;
      const [radiusX, radiusY] = stage.radius;
      if (stage.figure === 'low-swell') return [centerX + radiusX - radiusX * 2 * t, centerY - breathing * radiusY * 0.72 * Math.sin(Math.PI * t) + 3.2 * Math.sin(angle + phase * 0.14)];
      if (stage.figure === 'diagonal-sweep') return [centerX - radiusX + radiusX * 2 * t, centerY + radiusY * (1 - 2 * t) + breathing * 7.5 * Math.sin(angle + phase * 0.12)];
      if (stage.figure === 'lateral-fold') return [centerX + radiusX - radiusX * 2 * t + 22 * Math.sin(Math.PI * t), centerY - radiusY + radiusY * 2 * t + breathing * 7 * Math.sin(angle * 1.1 + phase * 0.1)];
      return [centerX - radiusX + radiusX * 2 * t, centerY + 0.75 * Math.sin(angle + phase * 0.22)];
    });
  }

  private connector(from: RibbonPoint, beforeFrom: RibbonPoint, to: RibbonPoint, afterTo: RibbonPoint, phase: number): RibbonPoint[] {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const handle = Math.min(42, Math.max(14, distance * 0.34));
    const normalize = (point: RibbonPoint): RibbonPoint => {
      const length = Math.max(0.001, Math.hypot(point[0], point[1]));
      return [point[0] / length, point[1] / length];
    };
    const fromDirection = normalize([from[0] - beforeFrom[0], from[1] - beforeFrom[1]]);
    const toDirection = normalize([afterTo[0] - to[0], afterTo[1] - to[1]]);
    const normal: RibbonPoint = [-(to[1] - from[1]) / Math.max(0.001, distance), (to[0] - from[0]) / Math.max(0.001, distance)];
    return Array.from({ length: 94 }, (_, index) => {
      const t = (index + 1) / 95;
      const inverse = 1 - t;
      const bow = Math.sin(Math.PI * t) ** 2 * (1.5 + 0.5 * Math.sin(phase));
      return [
        inverse ** 3 * from[0] + 3 * inverse ** 2 * t * (from[0] + fromDirection[0] * handle) + 3 * inverse * t ** 2 * (to[0] - toDirection[0] * handle) + t ** 3 * to[0] + normal[0] * bow,
        inverse ** 3 * from[1] + 3 * inverse ** 2 * t * (from[1] + fromDirection[1] * handle) + 3 * inverse * t ** 2 * (to[1] - toDirection[1] * handle) + t ** 3 * to[1] + normal[1] * bow,
      ];
    });
  }

  private headIndex(progress: number, anchors: number[]): number {
    const stageProgress = progress * (anchors.length - 1);
    const stage = Math.min(anchors.length - 2, Math.floor(stageProgress));
    return anchors[stage] + (anchors[stage + 1] - anchors[stage]) * (stageProgress - stage);
  }

  private offsetThread(points: readonly RibbonPoint[], thread: number, progress: number, stride: number): RibbonPoint[] {
    const stageDistance = Math.abs(progress * 3 - Math.round(progress * 3));
    const expansion = 1 - Math.min(1, stageDistance / 0.34);
    const settledHalfSpread = [4.5, 9.5, 11, 10][Math.min(3, Math.round(progress * 3))];
    return points.filter((_, index) => index % stride === 0 || index === points.length - 1).map((point, index, sampled) => {
      const previous = sampled[Math.max(0, index - 1)];
      const next = sampled[Math.min(sampled.length - 1, index + 1)];
      const length = Math.max(0.001, Math.hypot(next[0] - previous[0], next[1] - previous[1]));
      const fan = 0.28 + 0.72 * Math.sin(Math.PI * index / Math.max(1, sampled.length - 1));
      const offset = ((thread - 5) / 5) * (3.25 + expansion * (settledHalfSpread - 3.25) * fan);
      return [point[0] - ((next[1] - previous[1]) / length) * offset, point[1] + ((next[0] - previous[0]) / length) * offset];
    });
  }
}
