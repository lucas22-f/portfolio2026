import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

const JOURNEY_STEPS = [
  {
    heading: 'Conocé mi recorrido',
    body: 'Podés recorrer las secciones a tu ritmo o usar la navegación para ir directo a un tema.',
  },
  {
    heading: 'Explorá la evidencia',
    body: 'Cada sección reúne información publicada a partir de material revisado.',
  },
  {
    heading: 'Hacé tu consulta',
    body: 'Al final podés abrir el chat informativo para consultar sobre el recorrido profesional.',
  },
] as const;

@Component({
  selector: 'app-journey-page',
  imports: [RouterLink],
  styleUrl: './journey-page.css',
  template: `
    <main id="main-content" class="journey" tabindex="-1">
      <section class="journey__intro" aria-labelledby="journey-title">
        <p class="journey__eyebrow">Portfolio de Lucas Figueroa</p>
        <h1 id="journey-title">Un recorrido claro, sin atajos.</h1>
        <p class="journey__lead">Elegí cómo querés conocer el trabajo y la experiencia.</p>
        <a class="journey__direct-link" routerLink="/chat">Ir directamente al chat</a>
      </section>

      <section
        #journeyStep
        class="journey__step"
        [class.is-visible]="isVisible()"
        aria-labelledby="step-heading"
      >
        <p class="journey__status" aria-live="polite">
          Paso {{ currentStep() + 1 }} de {{ steps.length }}
        </p>
        <h2 id="step-heading">{{ steps[currentStep()].heading }}</h2>
        <p>{{ steps[currentStep()].body }}</p>

        @if (isComplete) {
          <a class="journey__action" routerLink="/chat">Abrir el chat</a>
        } @else {
          <button data-testid="journey-next" type="button" (click)="next()">Continuar</button>
        }
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JourneyPage implements AfterViewInit, OnDestroy {
  readonly steps = JOURNEY_STEPS;
  readonly currentStep = signal(0);
  readonly isVisible = signal(false);
  private readonly journeyStep = viewChild.required<ElementRef<HTMLElement>>('journeyStep');
  private observer: IntersectionObserver | undefined;

  get isComplete(): boolean {
    return this.currentStep() === this.steps.length - 1;
  }

  next(): void {
    this.currentStep.update((step) => Math.min(step + 1, this.steps.length - 1));
  }

  ngAfterViewInit(): void {
    if (!('IntersectionObserver' in window)) {
      this.isVisible.set(true);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.isVisible.set(true);
          this.observer?.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    this.observer.observe(this.journeyStep().nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
