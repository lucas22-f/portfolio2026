import { Page } from '@playwright/test';

type ChatMock = {
  metadataVersion: string;
  metadataProtocolVersion?: string;
  contactEnabled?: boolean;
  contactOutcome?: string;
  stream?: string;
};

export const contactFormPart = {
  type: 'interview_contact_form',
  form_version: '1',
  submission_version: '1',
  intent: 'interview',
  fields: ['name', 'email', 'company', 'message'],
} as const;

export function sse(events: Array<{ type: string }>): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

export async function mockChatApi(page: Page, mock: ChatMock): Promise<void> {
  await page.route('**/api/v1/metadata', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        content_version: mock.metadataVersion,
        protocol_version: mock.metadataProtocolVersion ?? '5',
        ...(mock.contactEnabled
          ? { capabilities: { interview_contact_form: '1', contact_submission: '1' } }
          : {}),
      }),
    });
  });
  await page.route('**/api/v1/chat/stream', async (route) => {
    if (!mock.stream) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: mock.stream });
  });
  await page.route('**/api/v1/contact/submissions', async (route) => {
    await route.fulfill({
      status: mock.contactOutcome === 'accepted' ? 200 : 502,
      contentType: 'application/json',
      body: JSON.stringify({
        outcome: mock.contactOutcome ?? 'delivery_retryable',
        retryable: mock.contactOutcome !== 'accepted',
        request_id: 'mock-contact-request',
      }),
    });
  });
}
