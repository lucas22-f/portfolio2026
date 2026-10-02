from pathlib import Path
import re


def test_chat_budget_ledger_rls_migration_preserves_backend_rpc_access() -> None:
    root = Path(__file__).parents[1]
    migration = (
        root
        / "supabase"
        / "migrations"
        / "202610020002_chat_budget_ledger_rls.sql"
    ).read_text(encoding="utf-8")
    sql = re.sub(r"--[^\n]*", "", migration).lower()

    for table in ("chat_budget_months", "chat_budget_reservations"):
        assert f"alter table app.{table} enable row level security" in sql

    assert "force row level security" not in sql
    assert not re.search(r"create\s+policy", sql)
    assert not re.search(r"\bgrant\b", sql)
    assert not re.search(r"\brevoke\b", sql)

    budget_migration = (
        root
        / "supabase"
        / "migrations"
        / "202610010001_chat_monthly_budget.sql"
    ).read_text(encoding="utf-8")
    budget_sql = re.sub(r"--[^\n]*", "", budget_migration).lower()
    assert "revoke all on all tables in schema app from public, anon, authenticated" in budget_sql

    for signature in (
        "app.reserve_chat_budget(uuid, date, numeric, numeric, numeric)",
        "app.settle_chat_budget(uuid, bigint, bigint, numeric, numeric, numeric)",
        "app.release_chat_budget(uuid)",
        "app.retain_chat_budget(uuid)",
    ):
        assert re.search(
            rf"revoke all on function {re.escape(signature)}\s+from public, anon, authenticated",
            budget_sql,
        )
        assert re.search(rf"grant execute on function {re.escape(signature)}\s+to service_role", budget_sql)

    for function_name in (
        "reserve_chat_budget",
        "settle_chat_budget",
        "release_chat_budget",
        "retain_chat_budget",
    ):
        definition = re.search(
            rf"create\s+or\s+replace\s+function\s+app\.{function_name}\b.*?\$\$;",
            budget_sql,
            re.DOTALL,
        )
        assert definition is not None
        assert re.search(r"\bsecurity\s+definer\b", definition.group())

    assert not re.search(
        r"grant\s+[^;]*\bto\s+(?:public|anon|authenticated)\b",
        migration.lower(),
    )
