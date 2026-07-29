import { Page } from '@playwright/test';

type ChatMock = {
  metadataVersion: string;
  stream?: string;
};

export function ndjson(events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

export async function mockChatApi(page: Page, mock: ChatMock): Promise<void> {
  await page.route('**/api/v1/metadata', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ content_version: mock.metadataVersion }),
    });
  });
  await page.route('**/api/v1/chat/stream', async (route) => {
    if (!mock.stream) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: mock.stream });
  });
}
