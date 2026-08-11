const createMediaQueryList = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
  addListener: () => undefined,
  removeListener: () => undefined,
});

if (!window.matchMedia) {
  window.matchMedia = createMediaQueryList;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    constructor(_callback: ResizeObserverCallback) {}

    disconnect(): void {}
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
  } as typeof ResizeObserver;
}
