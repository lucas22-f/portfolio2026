-- Apply manually after the PDF schema migration and before the chat budget migration.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO service_role;

ALTER TABLE app.pdf_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.pdf_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.pdf_versions TO service_role;
DROP POLICY IF EXISTS backend_only_pdf_versions ON app.pdf_versions;
CREATE POLICY backend_only_pdf_versions ON app.pdf_versions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE app.pdf_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.pdf_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.pdf_chunks TO service_role;
DROP POLICY IF EXISTS backend_only_pdf_chunks ON app.pdf_chunks;
CREATE POLICY backend_only_pdf_chunks ON app.pdf_chunks
    FOR ALL TO service_role USING (true) WITH CHECK (true);
