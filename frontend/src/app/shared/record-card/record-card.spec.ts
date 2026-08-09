import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PortfolioRecord } from '../../core/content/content-validator';
import { RecordCard } from './record-card';

const record: PortfolioRecord = {
  id: 'experience-1',
  kind: 'experience',
  title: 'Frontend engineer',
  claims: [{ claim_id: 'claim-1', text: 'Built accessible interfaces.', provenance_id: 'cv-1' }],
  tags: [],
  aliases: [],
  provenance: ['cv-1'],
};

describe('RecordCard', () => {
  let fixture: ComponentFixture<RecordCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RecordCard] }).compileComponents();
    fixture = TestBed.createComponent(RecordCard);
  });

  it('uses a nested heading level under the journey section heading', () => {
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('eyebrow', 'Experience');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h3')?.textContent?.trim()).toBe('Frontend engineer');
  });
});
