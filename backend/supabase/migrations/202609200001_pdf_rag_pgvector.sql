-- Run manually in the Supabase SQL editor before running scripts/seed_pdf_rag.py.
CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS app.pdf_versions (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    filename text NOT NULL,
    embedding_model text NOT NULL,
    embedding_dimensions integer NOT NULL CHECK (embedding_dimensions = 1536),
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_sha256, embedding_model, embedding_dimensions)
);

CREATE UNIQUE INDEX IF NOT EXISTS pdf_versions_one_active_idx
    ON app.pdf_versions ((is_active)) WHERE is_active;

CREATE TABLE IF NOT EXISTS app.pdf_chunks (
    version_id uuid NOT NULL REFERENCES app.pdf_versions(id) ON DELETE CASCADE,
    chunk_id text NOT NULL,
    chunk_text text NOT NULL,
    page integer NOT NULL CHECK (page > 0),
    filename text NOT NULL,
    embedding extensions.vector(1536) NOT NULL,
    PRIMARY KEY (version_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS pdf_chunks_embedding_idx
    ON app.pdf_chunks USING hnsw (embedding vector_cosine_ops);

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.search_portfolio_pdf(
    query_embedding extensions.vector(1536),
    result_limit integer,
    required_model text,
    required_dimensions integer
)
RETURNS TABLE (
    chunk_id text,
    chunk_text text,
    page integer,
    filename text,
    distance double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, extensions
AS $$
    SELECT chunk.chunk_id,
           chunk.chunk_text,
           chunk.page,
           chunk.filename,
           (chunk.embedding <=> query_embedding)::double precision AS distance
    FROM app.pdf_versions AS version
    JOIN app.pdf_chunks AS chunk ON chunk.version_id = version.id
    WHERE version.is_active
      AND version.embedding_model = required_model
      AND version.embedding_dimensions = required_dimensions
    ORDER BY chunk.embedding <=> query_embedding
    LIMIT GREATEST(result_limit, 0);
$$;

REVOKE ALL ON FUNCTION public.search_portfolio_pdf(extensions.vector, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_portfolio_pdf(extensions.vector, integer, text, integer) TO service_role;
