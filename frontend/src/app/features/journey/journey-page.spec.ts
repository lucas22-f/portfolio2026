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
