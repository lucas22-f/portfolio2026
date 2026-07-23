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

  it('offers a direct mobile-safe chat route alongside the progressive journey', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const directLink = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a'),
    ).find((link) => link.textContent?.includes('Ir directamente al chat'));

    expect(directLink?.getAttribute('href')).toBe('/chat');
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Paso 1 de',
    );
  });

  it('moves through the journey in reading order before exposing its terminal chat action', () => {
    const fixture = TestBed.createComponent(JourneyPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const nextButton = page.querySelector<HTMLButtonElement>('button[data-testid="journey-next"]');
    nextButton?.click();
    fixture.detectChanges();
    nextButton?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Abrir el chat');
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Paso 3 de',
    );
  });

  it('reveals guided progress when its scroll landmark enters the viewport', () => {
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
    window.IntersectionObserver = originalObserver;
  });
});

describe('ChatPage', () => {
  it('focuses its heading after terminal journey navigation', () => {
    TestBed.configureTestingModule({ imports: [ChatPage] });
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-testid="chat-heading"]'),
    );
  });
});
