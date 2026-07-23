import {
  computeContentVersion,
  computeSourceTextHash,
  normalizeContentText,
  validateContentBundle,
  verifyProvenanceLocator,
} from './content-validator';
import portfolioJson from '../../../../../content/v1/portfolio.json';
import manifestJson from '../../../../../content/v1/reviewed-manifest.json';
import sourceJson from '../../../../../content/v1/cv-source.json';
import vectors from '../../../../../content/v1/content-contract-vectors.json';

const validPortfolio = {
  schema_version: '1.0.0',
  content_version: '',
  locale: 'es',
  records: [
    {
      id: 'profile-lucas',
      kind: 'profile',
      title: 'Lucas Figueroa',
      claims: [
        { claim_id: 'profile-role', text: 'Backend Developer', provenance_id: 'cv-role' },
      ],
      tags: ['backend'],
      aliases: ['Lucas'],
      provenance: ['cv-role'],
    },
  ],
};

const validManifest = {
  schema_version: '1.0.0',
  content_version: '',
  sources: [
    {
      source_id: 'cv-lucas',
      file_name: 'CV_Lucas_Figueroa7-7.pdf',
      source_sha256: 'a'.repeat(64),
      source_text_sha256: '',
      page_count: 2,
    },
  ],
  entries: [
    {
      provenance_id: 'cv-role',
      source_id: 'cv-lucas',
      source_sha256: 'a'.repeat(64),
      page: 1,
      normalized_start: 0,
      normalized_end: 17,
      excerpt_sha256: 'b'.repeat(64),
      reviewed_at: '2026-07-22',
      reviewer: 'Lucas Figueroa',
    },
  ],
};

const validSource = {
  schema_version: '1.0.0',
  normalization: 'unicode-nfc-explicit-whitespace-utf8-offsets-v1',
  source_id: 'cv-lucas',
  file_name: 'CV_Lucas_Figueroa7-7.pdf',
  source_sha256: 'a'.repeat(64),
  pages: [
    {
      page: 1,
      normalized_text: 'Backend Developer',
      normalized_sha256: '',
    },
  ],
};

async function buildValidBundle(portfolioInput: unknown = validPortfolio) {
  const pageHash = await digest('Backend Developer');
  const source = {
    ...validSource,
    pages: [{ ...validSource.pages[0], normalized_sha256: pageHash }],
  };
  const sourceTextHash = await computeSourceTextHash(source);
  const manifest = {
    ...validManifest,
    sources: [{ ...validManifest.sources[0], source_text_sha256: sourceTextHash, page_count: 1 }],
    entries: [{ ...validManifest.entries[0], excerpt_sha256: pageHash }],
  };
  const contentVersion = await computeContentVersion(portfolioInput, manifest);
  return {
    portfolio: { ...(portfolioInput as Record<string, unknown>), content_version: contentVersion },
    manifest: { ...manifest, content_version: contentVersion },
    source,
  };
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('content contract validation', () => {
  it('normalizes text and verifies a normalized locator hash', async () => {
    const page = '  Cafe\u0301\r\n  con\tIA  ';
    const normalized = 'Caf\u00e9 con IA';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );

    expect(normalizeContentText(page)).toBe(normalized);
    await expect(
      verifyProvenanceLocator(page, 0, new TextEncoder().encode(normalized).length, digest),
    ).resolves.toBe(true);
    await expect(verifyProvenanceLocator(page, 0, 4, digest)).resolves.toBe(false);
  });

  it('accepts records only when portfolio and manifest share the computed version', async () => {
    const { portfolio, manifest, source } = await buildValidBundle();

    const bundle = await validateContentBundle(portfolio, manifest, source);

    expect(bundle.contentVersion).toBe(portfolio.content_version);
    expect(bundle.portfolio.records[0].claims[0].text).toBe('Backend Developer');
  });

  it('rejects a provenance reference that is absent from the reviewed manifest', async () => {
    const values = await buildValidBundle();
    const portfolio = {
      ...values.portfolio,
      records: [
        {
          ...validPortfolio.records[0],
          claims: [
            {
              ...validPortfolio.records[0].claims[0],
              provenance_id: 'missing-reference',
            },
          ],
        },
      ],
    };
    await expect(
      validateContentBundle(portfolio, values.manifest, values.source),
    ).rejects.toThrow('missing-reference');
  });

  it('preserves a missing optional project links field', async () => {
    const projectPortfolio = {
      ...validPortfolio,
      records: [
        {
          ...validPortfolio.records[0],
          id: 'project-rag',
          kind: 'project',
          project: { summary: 'Sistema RAG sobre Fury.' },
        },
      ],
    };
    const values = await buildValidBundle(projectPortfolio);
    const bundle = await validateContentBundle(values.portfolio, values.manifest, values.source);

    expect(bundle.portfolio.records[0].project?.links).toBeUndefined();
  });

  it('rejects a record with a missing required title', async () => {
    const invalidRecord = { ...validPortfolio.records[0] } as Partial<
      (typeof validPortfolio.records)[number]
    >;
    delete invalidRecord.title;
    const portfolio = { ...validPortfolio, records: [invalidRecord] };
    const values = await buildValidBundle(portfolio);

    await expect(
      validateContentBundle(values.portfolio, values.manifest, values.source),
    ).rejects.toThrow('record.title');
  });

  it('validates the checked-in bundle and rehashes its real source locators', async () => {
    const bundle = await validateContentBundle(portfolioJson, manifestJson, sourceJson);

    expect(bundle.contentVersion).toBe(vectors.expected_content_version);
    expect(JSON.stringify(bundle.portfolio)).not.toContain('?');
  });

  it('uses the shared Unicode and invalid-shape vectors', async () => {
    for (const vector of vectors.normalization_vectors) {
      expect(normalizeContentText(vector.input)).toBe(vector.normalized);
      const bytes = new TextEncoder().encode(vector.normalized);
      expect(bytes.length).toBe(vector.utf8_length);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      expect(
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      ).toBe(vector.sha256);
    }
    for (const vector of vectors.locator_vectors) {
      await expect(
        verifyProvenanceLocator(
          vector.page_text,
          vector.normalized_start,
          vector.normalized_end,
          vector.excerpt_sha256,
        ),
      ).resolves.toBe(true);
    }

    for (const vector of vectors.negative_vectors) {
      const portfolio = structuredClone(portfolioJson) as Record<string, unknown>;
      const manifest = structuredClone(manifestJson) as Record<string, unknown>;
      const target = vector.document === 'portfolio' ? portfolio : manifest;
      setPath(target, vector.path, vector.value);
      const version = await computeContentVersion(portfolio, manifest);
      portfolio['content_version'] = version;
      manifest['content_version'] = version;
      await expect(validateContentBundle(portfolio, manifest, sourceJson)).rejects.toThrow(
        new RegExp(vector.expected_error),
      );
    }
  });

  it('rejects a locator switched to a second manifest source', async () => {
    const portfolio = structuredClone(portfolioJson) as Record<string, unknown>;
    const manifest = structuredClone(manifestJson) as Record<string, unknown>;
    const sources = manifest['sources'] as Array<Record<string, unknown>>;
    sources[0]['source_id'] = 'other-source';
    (manifest['entries'] as Array<Record<string, unknown>>)[0]['source_id'] = 'other-source';
    const version = await computeContentVersion(portfolio, manifest);
    portfolio['content_version'] = manifest['content_version'] = version;

    await expect(validateContentBundle(portfolio, manifest, sourceJson)).rejects.toThrow(
      /source text.*manifest|source mismatch/,
    );
  });

  it('rejects an unused second manifest source', async () => {
    const portfolio = structuredClone(portfolioJson) as Record<string, unknown>;
    const manifest = structuredClone(manifestJson) as Record<string, unknown>;
    const sources = manifest['sources'] as Array<Record<string, unknown>>;
    sources.push({ ...sources[0], source_id: 'unused-source' });
    const version = await computeContentVersion(portfolio, manifest);
    portfolio['content_version'] = manifest['content_version'] = version;

    await expect(validateContentBundle(portfolio, manifest, sourceJson)).rejects.toThrow(
      'exactly one manifest source',
    );
  });

  it('rejects empty project links and coercible manifest integers', async () => {
    const portfolio = structuredClone(portfolioJson) as Record<string, unknown>;
    const manifest = structuredClone(manifestJson) as Record<string, unknown>;
    const records = portfolio['records'] as Array<Record<string, unknown>>;
    (records[15]['project'] as Record<string, unknown>)['links'] = [];
    let version = await computeContentVersion(portfolio, manifest);
    portfolio['content_version'] = manifest['content_version'] = version;
    await expect(validateContentBundle(portfolio, manifest, sourceJson)).rejects.toThrow('links');

    delete (records[15]['project'] as Record<string, unknown>)['links'];
    const sources = manifest['sources'] as Array<Record<string, unknown>>;
    sources[0]['page_count'] = '2';
    version = await computeContentVersion(portfolio, manifest);
    portfolio['content_version'] = manifest['content_version'] = version;
    await expect(validateContentBundle(portfolio, manifest, sourceJson)).rejects.toThrow(
      'page_count',
    );
  });
});

function setPath(document: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: unknown = document;
  for (const part of parts.slice(0, -1)) {
    cursor = Array.isArray(cursor)
      ? cursor[Number(part)]
      : (cursor as Record<string, unknown>)[part];
  }
  const finalPart = parts.at(-1)!;
  if (Array.isArray(cursor)) {
    cursor[Number(finalPart)] = value;
  } else {
    (cursor as Record<string, unknown>)[finalPart] = value;
  }
}
