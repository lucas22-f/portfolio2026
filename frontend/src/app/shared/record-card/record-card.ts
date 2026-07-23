import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { PortfolioRecord } from '../../core/content/content-validator';

@Component({
  selector: 'app-record-card',
  styleUrl: './record-card.css',
  template: `
    <article class="record-card">
      <header>
        <p class="record-card__eyebrow">{{ eyebrow() }}</p>
        <h2>{{ record().title }}</h2>
      </header>

      <ul class="record-card__claims">
        @for (claim of record().claims; track claim.claim_id) {
          <li>{{ claim.text }}</li>
        }
      </ul>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordCard {
  readonly record = input.required<PortfolioRecord>();
  readonly eyebrow = input.required<string>();
}
