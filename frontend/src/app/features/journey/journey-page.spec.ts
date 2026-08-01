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
    let reveal: (() => void) | undefined;
    const originalObserver = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) {
        reveal = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }

      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve(): void {}
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    reveal?.();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.journey__step')?.classList).toContain(
      'is-visible',
    );
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
    window.IntersectionObserver = originalObserver;
  });
  it('renders the Brain-backed Helm progress state without allowing it to advance the journey', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const progress = page.querySelector<HTMLElement>('[data-testid="journey-progress"]')!;

    expect(progress.getAttribute('data-slot')).toBe('progress');
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(progress.getAttribute('aria-valuetext')).toBe('Introducción: 0% completado');

    progress.dispatchEvent(new Event('click'));
    progress.focus();
    fixture.detectChanges();

    expect(fixture.componentInstance.progress()).toBe(0);
    expect(fixture.componentInstance.assistantUnlocked()).toBe(false);
  });

  it('maps Continue-only journey states to 0, 25, 50, 75, and 100 percent', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const progress = () => page.querySelector<HTMLElement>('[data-testid="journey-progress"]')!;

    expect(fixture.componentInstance.progressPercent()).toBe(0);
    page.querySelector<HTMLButtonElement>('[data-testid="continue-intro"]')?.click();
    fixture.detectChanges();
    expect(progress().getAttribute('aria-valuenow')).toBe('25');
    expect(progress().getAttribute('aria-valuetext')).toContain('Trayectoria');

    page.querySelector<HTMLButtonElement>('[data-testid="continue-experience"]')?.click();
    fixture.detectChanges();
    expect(progress().getAttribute('aria-valuenow')).toBe('50');
    expect(progress().getAttribute('aria-valuetext')).toContain('Proyectos');

    page.querySelector<HTMLButtonElement>('[data-testid="continue-projects"]')?.click();
    fixture.detectChanges();
    expect(progress().getAttribute('aria-valuenow')).toBe('75');
    expect(progress().getAttribute('aria-valuetext')).toContain('Asistente listo');

    page.querySelector<HTMLButtonElement>('[data-testid="unlock-assistant"]')?.click();
    fixture.detectChanges();
    expect(progress().getAttribute('aria-valuenow')).toBe('100');
    expect(progress().getAttribute('aria-valuetext')).toContain('Asistente desbloqueado');
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
