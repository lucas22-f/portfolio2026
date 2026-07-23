import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { recordsByKind } from '../../core/content/portfolio-content';
import { PortfolioKind, ValidatedContentBundle } from '../../core/content/content-validator';
import { ProjectCard } from '../../shared/project-card/project-card';
import { RecordCard } from '../../shared/record-card/record-card';

interface PortfolioPageData {
  title: string;
  eyebrow: string;
  kind: PortfolioKind;
  content: ValidatedContentBundle;
}

@Component({
  selector: 'app-portfolio-page',
  imports: [ProjectCard, RecordCard],
  styleUrl: './portfolio-page.css',
  template: `
    <main class="portfolio-view">
      <header class="portfolio-view__header">
        <p class="portfolio-view__eyebrow">{{ data.eyebrow }}</p>
        <h1>{{ data.title }}</h1>
      </header>

      <section class="portfolio-view__records" [attr.aria-label]="data.title">
        @for (record of records; track record.id) {
          @if (record.kind === 'project') {
            <app-project-card [record]="record" />
          } @else {
            <app-record-card [record]="record" [eyebrow]="data.eyebrow" />
          }
        }
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioPage {
  private readonly route = inject(ActivatedRoute);

  readonly data = this.route.snapshot.data as PortfolioPageData;
  readonly records = recordsByKind(this.data.content, this.data.kind);
}
