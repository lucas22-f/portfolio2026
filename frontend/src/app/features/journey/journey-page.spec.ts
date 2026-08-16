import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ChatPage } from '../chat/chat-page';
import { JourneyPage } from './journey-page';

describe('JourneyPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JourneyPage],
      providers: [provideRouter([])],
    });
  });

  it('renders stable semantic sections while keeping the assistant locked', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelectorAll('section[id]')).toHaveLength(4);
    expect(page.querySelector('#intro h1')?.textContent).toContain('Un recorrido claro');
    expect(page.querySelector('#assistant')?.textContent).toContain('habilitar el chat');
    expect(page.querySelector('app-chat-page')).toBeNull();
  });

  it('uses Tailwind layout and touch-target utilities for the guided journey contract', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const main = page.querySelector('#main-content')!;
    const continueButton = page.querySelector('[data-testid="continue-intro"]')!;

    expect(main.classList.contains('grid')).toBe(false);
    expect(main.classList.contains('w-[min(100%_-_2rem,_72rem)]')).toBe(true);
    expect(main.classList.contains('sm:w-[min(100%_-_4rem,_72rem)]')).toBe(true);
    expect(continueButton.classList.contains('min-h-11')).toBe(true);
    expect(page.querySelector('#intro')?.classList.contains('h-svh')).toBe(true);
    expect(page.querySelector('#intro')?.classList.contains('overflow-y-auto')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('h-svh')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('overflow-y-auto')).toBe(false);
    expect(page.querySelector('#experience')?.classList.contains('overflow-hidden')).toBe(true);
  });

  it('renders a decorative SVG ribbon that stays out of the accessibility tree', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const sections = Array.from(page.querySelectorAll<HTMLElement>('section[id]'));

    expect(sections.every((section) => section.classList.contains('journey-section'))).toBe(true);
    const ribbon = page.querySelector<HTMLElement>('[data-testid="journey-ribbon"]');
    expect(ribbon?.getAttribute('aria-hidden')).toBe('true');
    expect(ribbon?.querySelector('svg')).not.toBeNull();
    const paths = ribbon?.querySelectorAll<SVGPathElement>('.journey-ribbon__lines path');
    expect(paths).toHaveLength(11);
    expect(paths?.[0].getAttribute('d')).toMatch(/^M \d+\.\d{2} \d+\.\d{2} L /);
    expect(ribbon?.querySelector('.journey-ribbon__leader')).toBeNull();
  });

  it('advances the ribbon alongside the guided navigation buttons', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.ribbonProgress()).toBe(0);
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 3);
  });

  it('maps scrolling inside a Journey section to the ribbon timeline', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const intro = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#intro')!;
    Object.defineProperties(intro, {
      clientHeight: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 2000 },
      scrollTop: { configurable: true, value: 500, writable: true },
    });

    intro.dispatchEvent(new Event('scroll'));

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 6);
  });

  it('keeps a button-driven ribbon target stable while the previous section still scrolls', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const intro = page.querySelector<HTMLElement>('#intro')!;
    Object.defineProperties(intro, {
      clientHeight: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 2000 },
      scrollTop: { configurable: true, value: 800, writable: true },
    });

    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    intro.dispatchEvent(new Event('scroll'));

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 3);
  });

  it('adds subtle ambient deformation without changing the ribbon target progress', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };

    const firstPhase = page.buildRibbonPaths(0.5, 0);
    const nextPhase = page.buildRibbonPaths(0.5, 0.5);

    expect(firstPhase[0]).not.toBe(nextPhase[0]);
  });

  it('keeps every thread on one shared continuous ribbon route', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };

    const threads = page.buildRibbonPaths(0.42, 0);
    const firstPoints = threads.map((path) => path.slice(2).split(' L ')[0]);

    expect(threads).toHaveLength(11);
    expect(new Set(firstPoints).size).toBe(11);
    expect(threads.every((path) => path.split(' L ').length > 40)).toBe(true);
  });

  it('builds distinct open wave arrangements without closing into geometric figures', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };

    const arrangements = [1 / 3, 2 / 3, 1].map((progress) => page.buildRibbonPaths(progress, 0)[5]);
    const endpointDistance = (path: string) => {
      const points = path.slice(2).split(' L ').map((point) => point.split(' ').map(Number));
      return Math.hypot(points.at(-1)![0] - points[0][0], points.at(-1)![1] - points[0][1]);
    };

    expect(new Set(arrangements).size).toBe(3);
    expect(arrangements.every((path) => endpointDistance(path) > 70)).toBe(true);
    expect(arrangements.every((path) => path.split(' L ').length > 80)).toBe(true);
  });

  it('fans the threads out at settled figures and regroups them while travelling', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };
    const separation = (paths: string[]) => {
      const point = (path: string) => path.slice(2).split(' L ')[30].split(' ').map(Number);
      const first = point(paths[0]);
      const last = point(paths.at(-1)!);
      return Math.hypot(last[0] - first[0], last[1] - first[1]);
    };

    expect(separation(page.buildRibbonPaths(1 / 3, 0))).toBeGreaterThan(
      separation(page.buildRibbonPaths(0.18, 0)),
    );
  });

  it('starts the shared ribbon as ordered horizontal strands before it curves', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };
    const paths = page.buildRibbonPaths(0, 0);
    const point = (path: string, index: number) => path.slice(2).split(' L ')[index].split(' ').map(Number);
    const startYs = paths.map((path) => point(path, 0)[1]);
    const horizontal = point(paths[5], 70);

    expect(new Set(startYs).size).toBe(11);
    expect(horizontal[0]).toBeGreaterThan(point(paths[5], 0)[0]);
  });

  it('keeps the tail tangent continuous while reverse navigation settles into Intro', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    const page = fixture.componentInstance as unknown as {
      buildRibbonPaths(progress: number, phase: number): string[];
    };
    const parse = (path: string) =>
      path.slice(2).split(' L ').map((point) => point.split(' ').map(Number));
    const maximumTurn = (path: string) => {
      const points = parse(path);
      return points.slice(1, -1).reduce((maximum, point, index) => {
        const previous = points[index];
        const next = points[index + 2];
        const incoming = [point[0] - previous[0], point[1] - previous[1]];
        const outgoing = [next[0] - point[0], next[1] - point[1]];
        const incomingLength = Math.hypot(...incoming);
        const outgoingLength = Math.hypot(...outgoing);
        const cosine =
          (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
          (incomingLength * outgoingLength);
        const turn = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
        return Math.max(maximum, turn);
      }, 0);
    };
    const reverseFrames = [0.14, 0.12, 0.1, 0.08, 0.06, 0.04, 0.02, 0].map((progress) =>
      page.buildRibbonPaths(progress, 0)[5],
    );
    const tails = reverseFrames.map((path) => parse(path)[0]);
    const tailSteps = tails.slice(1).map((tail, index) =>
      Math.hypot(tail[0] - tails[index][0], tail[1] - tails[index][1]),
    );

    expect(Math.max(...reverseFrames.map(maximumTurn))).toBeLessThan(12);
    expect(Math.max(...tailSteps)).toBeLessThan(4);
  });

  it('keeps every ribbon thread fully present when navigation changes stage', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const paths = (fixture.nativeElement as HTMLElement).querySelectorAll<SVGPathElement>('.journey-ribbon__lines path');

    fixture.componentInstance.advance(1);

    expect(paths).toHaveLength(11);
    expect(Array.from(paths).every((path) => path.getAttribute('pathLength') === null)).toBe(true);
  });

  it('groups the career narrative by profile, work, education, skills, and certifications', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[data-testid="profile-summary"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="experience-timeline"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="education-list"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="skills-list"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="certifications-list"]')).not.toBeNull();
  });

  it('presents projects through a manually controlled Spartan carousel', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const carousel = page.querySelector<HTMLElement>('[data-testid="projects-carousel"]')!;
    const previous = page.querySelector<HTMLButtonElement>('[data-testid="projects-previous"]')!;
    const next = page.querySelector<HTMLButtonElement>('[data-testid="projects-next"]')!;

    expect(carousel.tagName).toBe('HLM-CAROUSEL');
    expect(carousel.getAttribute('aria-label')).toBe('Proyectos destacados');
    expect(carousel.querySelectorAll('[hlmCarouselItem]')).toHaveLength(
      fixture.componentInstance.projectRecords.length,
    );
    expect(previous.type).toBe('button');
    expect(next.type).toBe('button');
    expect(page.querySelector('[data-testid="projects-position"]')).not.toBeNull();
  });

  it('moves through the journey in reading order before focusing the intentionally unlocked chat', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="unlock-assistant"]')).toBeNull();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-projects"]')?.click();
    fixture.detectChanges();

    const unlock = page.querySelector<HTMLButtonElement>('[data-testid="unlock-assistant"]');
    expect(unlock?.textContent).toContain('Abrir el chat');
    unlock?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(page.querySelector('app-chat-page')).not.toBeNull();
    expect(page.querySelectorAll('main')).toHaveLength(1);
    expect(page.querySelectorAll('#main-content')).toHaveLength(1);
    expect(page.querySelector('[data-testid="chat-heading"]')?.textContent).toContain(
      'Chat informativo',
    );
    expect(document.activeElement).toBe(page.querySelector('[data-testid="chat-heading"]'));
    expect(page.querySelector('#intro')).not.toBeNull();
    expect(page.querySelector('[data-testid="return-assistant"]')).not.toBeNull();
  });

  it('resets a completed journey with smooth scrolling and returns focus to the intro', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const intro = page.querySelector<HTMLElement>('#intro')!;
    const scrollCalls: ScrollIntoViewOptions[] = [];
    intro.scrollIntoView = (options?: ScrollIntoViewOptions) => {
      scrollCalls.push(options ?? {});
    };

    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-projects"]')?.click();
    fixture.detectChanges();

    const reset = page.querySelector<HTMLButtonElement>('[data-testid="reset-journey"]')!;
    expect(reset.type).toBe('button');
    expect(reset.tabIndex).toBe(0);

    reset.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.progress()).toBe(0);
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
    expect(scrollCalls.at(-1)).toEqual({ behavior: 'smooth', block: 'start' });
    expect(document.activeElement).toBe(page.querySelector('#journey-title'));
    expect(page.querySelector('[data-testid="reset-journey"]')).toBeNull();
  });

  it('keeps the reset control available after the assistant has been unlocked', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="continue-projects"]')?.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('[data-testid="unlock-assistant"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(page.querySelector('[data-testid="reset-journey"]')).not.toBeNull();
  });

  it('moves focus to the next narrative section after a Continue action', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')
      ?.click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('#experience-title'),
    );
  });

  it('keeps Continue keyboard-activatable and advances the guided journey in reading order', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const continueButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="continue-intro"]',
    )!;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    continueButton.dispatchEvent(enter);

    expect(continueButton.tagName).toBe('BUTTON');
    expect(continueButton.type).toBe('button');
    expect(continueButton.tabIndex).toBe(0);
    expect(enter.defaultPrevented).toBe(false);

    // JSDOM does not synthesize the browser's native Enter-to-click default action.
    continueButton.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.progress()).toBe(1);
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('#experience-title'),
    );
  });

  it('keeps initial fragment navigation in reading order but focuses later fragment navigation', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const heading = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '#projects-title',
    )!;
    const section = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#projects')!;
    let scrolled = false;
    section.scrollIntoView = () => {
      scrolled = true;
    };

    fixture.componentInstance.focusFragment('projects', true);

    expect(scrolled).toBe(true);
    expect(document.activeElement).not.toBe(heading);

    fixture.componentInstance.focusFragment('projects');

    expect(document.activeElement).toBe(heading);
  });

  it('reveals the assistant section without unlocking it when its scroll landmark enters the viewport', () => {
    const originalObserver = window.IntersectionObserver;
    class IntersectionObserverMock {
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      private readonly callback: IntersectionObserverCallback;
      disconnect(): void {}
      observe(_target: Element): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve(): void {}
      root = null;
      rootMargin = '';
      thresholds = [];

      reveal(target: Element): void {
        this.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    }
    window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const assistant = fixture.nativeElement.querySelector('#assistant') as Element;
    const observer = (fixture.componentInstance as unknown as { observer: IntersectionObserverMock }).observer;
    observer.reveal(assistant);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#assistant .opacity-100')).not.toBeNull();
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
    window.IntersectionObserver = originalObserver;
  });

  it('keeps a relocked deep section recoverable without advancing progress', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const intro = page.querySelector<HTMLElement>('#intro')!;
    let scrolled = false;
    intro.scrollIntoView = () => {
      scrolled = true;
    };

    page.querySelector<HTMLButtonElement>('[data-testid="return-intro"]')?.click();

    expect(scrolled).toBe(true);
    expect(document.activeElement).toBe(page.querySelector('#journey-title'));
    expect(fixture.componentInstance.progress()).toBe(0);
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
  });
  it('renders a fixed vertical progress rail whose dots reflect guided progress', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const progress = page.querySelector<HTMLElement>('[data-testid="journey-progress"]')!;

    expect(progress.tagName).toBe('NAV');
    expect(progress.querySelectorAll('ol > li > a')).toHaveLength(4);
    expect(progress.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('intro');
  });

  it('paints each completed step in the progress rail', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const activeStep = () =>
      page.querySelector<HTMLElement>('[data-testid="journey-progress"] [aria-current="step"]');

    expect(activeStep()?.getAttribute('data-step')).toBe('intro');
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    expect(activeStep()?.getAttribute('data-step')).toBe('experience');

    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    expect(activeStep()?.getAttribute('data-step')).toBe('projects');

    page.querySelector<HTMLButtonElement>('[data-testid="continue-projects"]')?.click();
    fixture.detectChanges();
    expect(activeStep()?.getAttribute('data-step')).toBe('assistant');
  });
});

describe('ChatPage', () => {
  it('does not focus its heading until an intentional entry request is made', () => {
    TestBed.configureTestingModule({ imports: [ChatPage] });
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();

    expect(document.activeElement).not.toBe(
      fixture.nativeElement.querySelector('[data-testid="chat-heading"]'),
    );
  });
});
