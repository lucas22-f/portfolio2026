import { expect, test } from '@playwright/test';

import { mockChatApi, ndjson } from './support/chat-mocks';

const CONTENT_VERSION = '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c';

test('keeps classic navigation and the guided journey keyboard-accessible', async ({ page }) => {
  await mockChatApi(page, { metadataVersion: CONTENT_VERSION });
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeFocused();
  await page.getByRole('link', { name: 'Proyectos', exact: true }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
  await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);

  await page.goto('/');
  await page.getByTestId('journey-next').press('Enter');
  await page.getByTestId('journey-next').press('Enter');
  await page.getByRole('link', { name: 'Abrir el chat' }).press('Enter');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId('chat-heading')).toBeFocused();
});

test('renders a mocked grounded answer with its source and project card', async ({ page }) => {
  await mockChatApi(page, {
    metadataVersion: CONTENT_VERSION,
    stream: ndjson([
      { type: 'start', request_id: 'grounded', sequence: 1, content_version: CONTENT_VERSION },
      {
        type: 'part',
        request_id: 'grounded',
        sequence: 2,
        part: {
          type: 'text',
          text: 'Lucas implementó sistemas RAG sobre Fury.',
          record_ids: ['project-rag-fury'],
          claim_ids: ['project-rag-fury-claim'],
        },
      },
      {
        type: 'part',
        request_id: 'grounded',
        sequence: 3,
        part: { type: 'source', record_id: 'project-rag-fury', label: 'CV, página 1' },
      },
      {
        type: 'part',
        request_id: 'grounded',
        sequence: 4,
        part: {
          type: 'project-card',
          record_id: 'project-rag-fury',
          title: 'Sistemas RAG sobre Fury',
          summary: 'Fuentes de conocimiento dinámicas y actualizadas.',
          links: [],
        },
      },
      {
        type: 'done',
        request_id: 'grounded',
        sequence: 5,
        content_version: CONTENT_VERSION,
        model: 'mock-model',
        usage: { total_tokens: 12 },
      },
    ]),
  });

  await page.goto('/chat');
  await page.getByLabel('Tu consulta').fill('¿Qué proyectos de RAG realizó?');
  await page.getByRole('button', { name: 'Enviar consulta' }).click();

  await expect(page.getByText('Lucas implementó sistemas RAG sobre Fury.')).toBeVisible();
  await expect(page.getByText('Fuente: CV, página 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sistemas RAG sobre Fury' })).toBeVisible();
  await expect(page.getByText('Modelo: mock-model')).toBeVisible();
});

test('shows safe Spanish refusals and invalid stream failures without rendering disallowed parts', async ({
  page,
}) => {
  await mockChatApi(page, {
    metadataVersion: CONTENT_VERSION,
    stream: ndjson([
      { type: 'start', request_id: 'refusal', sequence: 1, content_version: CONTENT_VERSION },
      {
        type: 'refusal',
        request_id: 'refusal',
        sequence: 2,
        code: 'unsupported-request',
        message: 'No cuento con información publicada para responder esa consulta.',
        retryable: false,
      },
    ]),
  });
  await page.goto('/chat');
  await page.getByLabel('Tu consulta').fill('¿Cuál es su película favorita?');
  await page.getByRole('button', { name: 'Enviar consulta' }).click();
  await expect(page.getByRole('status')).toContainText('No cuento con información publicada');

  await mockChatApi(page, {
    metadataVersion: CONTENT_VERSION,
    stream: ndjson([
      { type: 'start', request_id: 'invalid', sequence: 1, content_version: CONTENT_VERSION },
      {
        type: 'part',
        request_id: 'invalid',
        sequence: 2,
        part: { type: 'script', value: '<script>unsafe()</script>' },
      },
    ]),
  });
  await page.reload();
  await page.getByLabel('Tu consulta').fill('Consulta válida');
  await page.getByRole('button', { name: 'Enviar consulta' }).click();
  await expect(page.getByRole('alert')).toContainText('No pude validar la respuesta.');
  await expect(page.locator('script:not([src])')).toHaveCount(0);
});

test('disables only chat for incompatible metadata while static pages remain usable', async ({
  page,
}) => {
  await mockChatApi(page, { metadataVersion: 'stale-version' });
  await page.goto('/chat');

  await expect(page.getByRole('alert')).toContainText('El chat no está disponible temporalmente.');
  await expect(page.getByLabel('Tu consulta')).toBeDisabled();
  await page.getByRole('link', { name: 'Perfil', exact: true }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole('heading', { name: 'Perfil profesional' })).toBeVisible();
});
