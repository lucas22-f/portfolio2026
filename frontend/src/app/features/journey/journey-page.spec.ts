import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { onScroll } from 'animejs';
import { vi } from 'vitest';

import { ChatPage } from '../chat/chat-page';
import { JourneyPage } from './journey-page';

vi.mock('animejs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('animejs')>();
  return { ...actual, onScroll: vi.fn() };
});

type ScrollObserverOptions = NonNullable<Parameters<typeof onScroll>[0]>;

const scrollObservers: Array<{
  progress: number;
  target: HTMLElement;
  refresh: ReturnType<typeof vi.fn>;
  revert: ReturnType<typeof vi.fn>;
}> = [];

function optionsForSection(section: HTMLElement): ScrollObserverOptions {
  const call = vi.mocked(onScroll).mock.calls.find(([options]) => options?.container === section);
  const options = call?.[0];
  if (!options) throw new Error(`No Anime.js scroll observer was created for #${section.id}.`);
  return options;
}

function emitScrollProgress(section: HTMLElement, progress: number): void {
  optionsForSection(section).onUpdate?.({ progress } as ReturnType<typeof onScroll>);
}

async function waitForScrollObservers(): Promise<void> {
  await vi.waitFor(() => expect(vi.mocked(onScroll).mock.calls).toHaveLength(4));
}

describe('JourneyPage', () => {
  beforeEach(() => {
    scrollObservers.length = 0;
    vi.mocked(onScroll).mockReset();
    vi.mocked(onScroll).mockImplementation((options) => {
      const observer = {
        progress: 0,
        target: options?.target as HTMLElement,
        refresh: vi.fn(),
        revert: vi.fn(),
      };
      scrollObservers.push(observer);
      return observer as unknown as ReturnType<typeof onScroll>;
    });
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
    expect(main.classList.contains('w-[min(100%-2rem,72rem)]')).toBe(true);
    expect(main.classList.contains('sm:w-[min(100%-4rem,72rem)]')).toBe(true);
    expect(continueButton.classList.contains('min-h-11')).toBe(true);
    expect(page.querySelector('#intro')?.classList.contains('h-svh')).toBe(true);
    expect(page.querySelector('#intro')?.classList.contains('overflow-y-auto')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('h-svh')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('overflow-y-auto')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('overscroll-contain')).toBe(true);
    expect(page.querySelector('#experience')?.classList.contains('sm:overflow-hidden')).toBe(true);
    expect(page.querySelector('#assistant')?.classList.contains('overflow-y-auto')).toBe(true);
    expect(page.querySelector('#assistant')?.classList.contains('overscroll-contain')).toBe(true);
    expect(page.querySelector('#assistant')?.classList.contains('sm:overflow-hidden')).toBe(true);
  });

  it('shows the mobile continue instruction and emphasizes each guided CTA', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    const instructionCount = () =>
      Array.from(page.querySelectorAll<HTMLElement>('p')).filter(
        (item) => item.textContent?.trim() === 'Presioná el botón para continuar el recorrido.',
      ).length;
    const expectEmphasizedTouchTarget = (testId: string) => {
      const button = page.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
      expect(button.classList.contains('border-2')).toBe(true);
      expect(button.classList.contains('shadow-md')).toBe(true);
      expect(button.classList.contains('min-h-11')).toBe(true);
    };

    expect(instructionCount()).toBe(1);
    expectEmphasizedTouchTarget('continue-intro');
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    expect(instructionCount()).toBe(2);
    expectEmphasizedTouchTarget('continue-experience');
    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    expect(instructionCount()).toBe(3);
    expectEmphasizedTouchTarget('continue-projects');
  });

  it('renders a decorative Canvas ribbon without an SVG path binding loop', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const sections = Array.from(page.querySelectorAll<HTMLElement>('section[id]'));

    expect(sections.every((section) => section.classList.contains('journey-section'))).toBe(true);
    const ribbon = page.querySelector<HTMLElement>('[data-testid="journey-ribbon"]');
    expect(ribbon?.getAttribute('aria-hidden')).toBe('true');
    expect(ribbon?.querySelector('canvas[aria-hidden="true"]')).not.toBeNull();
    expect(ribbon?.querySelector('svg')).toBeNull();
    expect(ribbon?.querySelectorAll('path')).toHaveLength(0);
  });

  it('advances the ribbon alongside the guided navigation buttons', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.ribbonProgress()).toBe(0);
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 3);
  });

  it('maps scrolling inside a Journey section to the ribbon timeline', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    await waitForScrollObservers();
    const intro = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#intro')!;

    emitScrollProgress(intro, 0.5);

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 6);
  });

  it('creates one synchronous Anime.js observer per stable section extent and reverts them on destroy', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    await waitForScrollObservers();
    const page = fixture.nativeElement as HTMLElement;
    const sections = Array.from(page.querySelectorAll<HTMLElement>('.journey-section'));

    expect(vi.mocked(onScroll).mock.calls).toHaveLength(4);
    sections.forEach((section) => {
      const options = optionsForSection(section);
      expect(options.target).toBe(section.querySelector('[data-journey-scroll-target]'));
      expect(options.sync).toBe(true);
      expect(options.enter).toBe('start start');
      expect(options.leave).toBe('end end');
    });

    fixture.destroy();

    expect(scrollObservers).toHaveLength(4);
    scrollObservers.forEach(({ revert }) => expect(revert).toHaveBeenCalledOnce());
  });

  it('does not create scroll observers if the component is destroyed before Anime.js loads', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    fixture.destroy();

    await import('animejs');

    expect(vi.mocked(onScroll)).not.toHaveBeenCalled();
  });

  it('refreshes the stable assistant extent after the locked content is replaced by chat', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    await waitForScrollObservers();
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

    expect(scrollObservers[3]?.refresh).toHaveBeenCalledOnce();
  });

  it('keeps a button-driven ribbon target stable while the previous section scrolls', async () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    await waitForScrollObservers();
    const page = fixture.nativeElement as HTMLElement;
    const intro = page.querySelector<HTMLElement>('#intro')!;

    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    emitScrollProgress(intro, 0.8);

    expect(fixture.componentInstance.ribbonProgress()).toBeCloseTo(1 / 3);
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
    expect(fixture.componentInstance.projectCarouselOptions.duration).toBe(20);
    expect(
      fixture.componentInstance.projectCarouselOptions.breakpoints['(prefers-reduced-motion: reduce)'].duration,
    ).toBe(0);
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

  it('uses automatic fragment scrolling when reduced motion is requested', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true }) as MediaQueryList);
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const projects = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#projects')!;
    const scrollIntoView = vi.fn();
    projects.scrollIntoView = scrollIntoView;

    fixture.componentInstance.focusFragment('projects');

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    fixture.destroy();
    window.matchMedia = originalMatchMedia;
  });

  it('returns from the chat composer to intro and ends the active chat session', async () => {
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
    page.querySelector<HTMLButtonElement>('[data-testid="unlock-assistant"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const returnToIntro = page.querySelector<HTMLButtonElement>('[data-testid="reset-journey"]')!;
    expect(returnToIntro.textContent).toContain('Volver al inicio');
    expect(returnToIntro.closest('[data-testid="compatibility-gate"]')).not.toBeNull();
    expect(page.querySelector('#assistant > [data-testid="reset-journey"]')).toBeNull();
    expect(page.querySelector('app-chat-page')).not.toBeNull();

    returnToIntro.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.progress()).toBe(0);
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
    expect(page.querySelector('app-chat-page')).toBeNull();
    expect(scrollCalls.at(-1)).toEqual({ behavior: 'smooth', block: 'start' });
    expect(document.activeElement).toBe(page.querySelector('#journey-title'));
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
