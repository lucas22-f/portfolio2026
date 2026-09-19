import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ChatClient } from './chat-client';
import { InterviewContactFormComponent } from './interview-contact-form';

const part = {
  type: 'interview_contact_form',
  form_version: '1',
  submission_version: '1',
  intent: 'interview',
  fields: ['name', 'email', 'company', 'message'],
} as const;

async function setup(outcome = 'accepted') {
  const submitContact = vi.fn().mockResolvedValue({
    outcome,
    retryable: outcome === 'delivery_retryable',
    request_id: 'safe-id',
  });
  await TestBed.configureTestingModule({
    imports: [InterviewContactFormComponent],
    providers: [{ provide: ChatClient, useValue: { submitContact } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(InterviewContactFormComponent);
  fixture.componentRef.setInput('part', part);
  fixture.detectChanges();
  return { fixture, submitContact };
}

describe('InterviewContactFormComponent', () => {
  it('starts closed, opens only on confirmation, and moves focus to the heading', async () => {
    const { fixture } = await setup();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('form')).toBeNull();
    page.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(page.querySelector('form')).not.toBeNull();
    expect(document.activeElement).toBe(page.querySelector('h4[tabindex="-1"]'));
    expect(page.querySelectorAll('label')).toHaveLength(4);
    expect(page.textContent).toContain('autorizás');
  });

  it('declines without opening or submitting', async () => {
    const { fixture, submitContact } = await setup();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.state()).toBe('closed');
    expect(submitContact).not.toHaveBeenCalled();
  });

  it('blocks an invalid draft and focuses the first invalid field', async () => {
    const { fixture, submitContact } = await setup();
    fixture.componentInstance.open();
    fixture.detectChanges();
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.state()).toBe('validation-error');
    expect(submitContact).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('contact-name');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
  });

  it('preserves and explicitly discards a dirty draft', async () => {
    const { fixture } = await setup();
    fixture.componentInstance.open();
    fixture.componentInstance.draft.name = 'Ada';
    fixture.componentInstance.close();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('borrador guardado');
    fixture.componentInstance.open();
    expect(fixture.componentInstance.draft.name).toBe('Ada');
    fixture.componentInstance.close();
    fixture.componentInstance.discard();
    expect(fixture.componentInstance.draft.name).toBe('');
  });

  it('submits once while pending and enters a focused success state', async () => {
    let resolve!: (value: object) => void;
    const pending = new Promise((done) => (resolve = done));
    const { fixture, submitContact } = await setup();
    submitContact.mockReturnValue(pending);
    fixture.componentInstance.open();
    fixture.componentInstance.draft = {
      name: 'Ada',
      email: 'ada@example.com',
      company: '',
      message: 'Interview request',
    };
    const first = fixture.componentInstance.submit();
    const second = fixture.componentInstance.submit();
    expect(submitContact).toHaveBeenCalledTimes(1);
    resolve({ outcome: 'accepted', retryable: false, request_id: 'safe-id' });
    await Promise.resolve();
    fixture.detectChanges();
    await Promise.all([first, second]);
    await new Promise((done) => setTimeout(done));
    await fixture.whenStable();
    expect(fixture.componentInstance.state()).toBe('success');
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]'),
    );
  });

  it.each([
    ['duplicate_accepted', 'duplicate'],
    ['delivery_retryable', 'retryable-failure'],
    ['delivery_uncertain', 'uncertain'],
    ['delivery_unavailable', 'unavailable'],
  ] as const)('maps %s to %s without rendering submitted values', async (outcome, expected) => {
    const { fixture } = await setup(outcome);
    fixture.componentInstance.open();
    fixture.componentInstance.draft = {
      name: 'Sensitive Person',
      email: 'sensitive@example.com',
      company: '',
      message: 'Sensitive message',
    };
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(fixture.componentInstance.state()).toBe(expected);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'sensitive@example.com',
    );
  });

  it('keeps actions touch-sized and uses a narrow-safe layout contract', async () => {
    const { fixture } = await setup();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect([...buttons].every((button) => button.className.includes('min-h-11'))).toBe(true);
    expect(fixture.componentInstance.dirty()).toBe(false);
  });
});
