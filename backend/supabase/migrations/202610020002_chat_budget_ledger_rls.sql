-- Apply manually after the chat budget ledger migration.
ALTER TABLE app.chat_budget_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_budget_reservations ENABLE ROW LEVEL SECURITY;
