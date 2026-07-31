import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { PortfolioRecord } from '../../core/content/content-validator';

@Component({
  selector: 'app-project-card',
  styleUrl: './project-card.css',
  template: `
    <article class="project-card">
      <header>
        <p class="project-card__eyebrow">Proyecto</p>
        <h2>{{ record().title }}</h2>
      </header>

      <p class="project-card__summary">{{ record().project?.summary }}</p>

      <div class="project-card__evidence" data-testid="project-evidence">
        <p>Datos revisados</p>
        <ul class="project-card__tech" data-testid="project-tech" aria-label="Tecnologias">
          @for (tag of record().tags; track tag) {
            <li>{{ tag }}</li>
          }
        </ul>
      </div>

      @if (record().project?.links; as links) {
        <nav aria-label="Enlaces del proyecto">
          @for (link of links; track link.url) {
            <a [href]="link.url" rel="noreferrer">{{ link.label }}</a>
          }
        </nav>
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCard {
  readonly record = input.required<PortfolioRecord>();
}
