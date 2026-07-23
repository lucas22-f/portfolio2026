import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-content-unavailable-page',
  template: `
    <main class="content-unavailable">
      <p class="content-unavailable__eyebrow">Portfolio</p>
      <h1>Contenido no disponible</h1>
      <p>No pude validar la información del portfolio. Intentá nuevamente más tarde.</p>
    </main>
  `,
  styles: `
    :host {
      display: block;
    }

    .content-unavailable {
      width: min(100% - 2rem, 42rem);
      margin-inline: auto;
      padding-block: clamp(4rem, 12vw, 8rem);
    }

    .content-unavailable__eyebrow {
      margin: 0 0 0.75rem;
      color: var(--color-accent);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      color: var(--color-ink);
      font-family: var(--font-display);
      font-size: clamp(2.5rem, 8vw, 4.5rem);
      letter-spacing: -0.05em;
      line-height: 0.98;
    }

    h1 + p {
      max-width: 38rem;
      margin: 1.5rem 0 0;
      line-height: 1.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentUnavailablePage {}
