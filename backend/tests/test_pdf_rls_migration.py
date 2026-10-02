from pathlib import Path
import re


def test_pdf_rls_migration_is_backend_only_and_idempotent() -> None:
    migration = (
        Path(__file__).parents[1]
        / "supabase"
        / "migrations"
        / "202610020001_pdf_tables_backend_rls.sql"
    ).read_text(encoding="utf-8")
    sql = re.sub(r"--[^\n]*", "", migration).lower()

    for table in ("pdf_versions", "pdf_chunks"):
        assert f"alter table app.{table} enable row level security" in sql
        assert f"revoke all on table app.{table} from public, anon, authenticated" in sql
        assert re.search(
            rf"grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+app\.{table}\s+to\s+service_role\s*;",
            sql,
        )
        assert f"drop policy if exists backend_only_{table} on app.{table}" in sql
        policy = re.search(
            rf"create policy backend_only_{table} on app\.{table}.*?;", sql, re.DOTALL
        )
        assert policy is not None
        assert "for all to service_role using (true) with check (true)" in policy.group()

    assert "revoke all on schema app from public, anon, authenticated" in sql
    assert "grant usage on schema app to service_role" in sql
    assert not re.search(r"create\s+policy[^;]*\bto\s+(?:anon|authenticated)\b", sql)
    assert "force row level security" not in sql
    assert "search_portfolio_pdf" not in sql
