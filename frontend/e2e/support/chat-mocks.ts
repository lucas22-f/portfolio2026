import { Page } from '@playwright/test';

type ChatMock = {
  metadataVersion: string;
  metadataProtocolVersion?: string;
  stream?: string;
};

export function sse(events: Array<{ type: string }>): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

export async function mockChatApi(page: Page, mock: ChatMock): Promise<void> {
  await page.route('**/api/v1/metadata', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        content_version: mock.metadataVersion,
        protocol_version: mock.metadataProtocolVersion ?? '3',
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
}
