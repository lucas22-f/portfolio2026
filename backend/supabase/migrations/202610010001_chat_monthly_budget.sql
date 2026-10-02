-- Apply manually through an explicitly authorized deployment operation.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO service_role;

CREATE TABLE app.chat_budget_months (
    month_start date PRIMARY KEY,
    settled_usd numeric(18, 8) NOT NULL DEFAULT 0 CHECK (settled_usd >= 0),
    warning_emitted boolean NOT NULL DEFAULT false
);

CREATE TABLE app.chat_budget_reservations (
    reservation_id uuid PRIMARY KEY,
    month_start date NOT NULL REFERENCES app.chat_budget_months(month_start),
    reserved_usd numeric(18, 8) NOT NULL CHECK (reserved_usd > 0),
    state text NOT NULL CHECK (state IN ('reserved', 'retained', 'settled', 'released')),
    over_reserved boolean NOT NULL DEFAULT false
);

CREATE INDEX chat_budget_reservations_open_idx
    ON app.chat_budget_reservations (month_start) WHERE state IN ('reserved', 'retained');
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.reserve_chat_budget(
    p_reservation_id uuid, p_month_start date, p_reserved_usd numeric,
    p_monthly_cap_usd numeric, p_warning_usd numeric
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    existing app.chat_budget_reservations%ROWTYPE;
    current_spend numeric(18, 8);
    open_reservations numeric(18, 8);
BEGIN
    INSERT INTO app.chat_budget_months(month_start)
      VALUES (p_month_start) ON CONFLICT (month_start) DO NOTHING;
    SELECT settled_usd INTO STRICT current_spend FROM app.chat_budget_months
      WHERE month_start = p_month_start FOR UPDATE;
    SELECT * INTO existing FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id FOR UPDATE;
    IF FOUND THEN
        IF existing.month_start <> p_month_start OR existing.reserved_usd <> p_reserved_usd THEN
            RAISE EXCEPTION 'reservation id reused with different budget parameters';
        END IF;
        RETURN CASE WHEN existing.state IN ('reserved', 'retained') THEN 'accepted'
                    ELSE 'already_final' END;
    END IF;
    SELECT COALESCE(sum(reserved_usd), 0) INTO open_reservations
      FROM app.chat_budget_reservations
      WHERE month_start = p_month_start AND state IN ('reserved', 'retained');
    IF current_spend + open_reservations + p_reserved_usd > p_monthly_cap_usd THEN
        RETURN 'cap_reached';
    END IF;
    INSERT INTO app.chat_budget_reservations(reservation_id, month_start, reserved_usd, state)
      VALUES (p_reservation_id, p_month_start, p_reserved_usd, 'reserved');
    RETURN 'accepted';
END;
$$;

CREATE OR REPLACE FUNCTION app.settle_chat_budget(
    p_reservation_id uuid, p_input_tokens bigint, p_output_tokens bigint,
    p_input_price numeric, p_output_price numeric, p_warning_usd numeric
) RETURNS TABLE(success boolean, warning boolean, over_reservation boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    reservation app.chat_budget_reservations%ROWTYPE;
    reservation_month date;
    actual_usd numeric(18, 8);
    updated_warning boolean := false;
    v_over_reserved boolean := false;
BEGIN
    -- Read the immutable period without locking, then always lock month before row.
    SELECT month_start INTO reservation_month FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'chat budget reservation not found'; END IF;
    PERFORM 1 FROM app.chat_budget_months
      WHERE month_start = reservation_month FOR UPDATE;
    SELECT * INTO STRICT reservation FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id FOR UPDATE;
    IF reservation.month_start <> reservation_month THEN
      RAISE EXCEPTION 'chat budget reservation period changed';
    END IF;
    IF reservation.state = 'settled' THEN
      RETURN QUERY SELECT true, false, reservation.over_reserved;
      RETURN;
    END IF;
    IF reservation.state = 'released' THEN v_over_reserved := true; END IF;
    IF p_input_tokens < 0 OR p_output_tokens < 0 OR p_input_price < 0 OR p_output_price < 0 THEN
      RAISE EXCEPTION 'invalid chat usage settlement';
    END IF;
    actual_usd := ceil(((p_input_tokens * p_input_price + p_output_tokens * p_output_price)
                         / 1000000)::numeric * 100000000) / 100000000;
    IF actual_usd > reservation.reserved_usd THEN
      v_over_reserved := true;
    END IF;
    UPDATE app.chat_budget_months
      SET settled_usd = settled_usd + actual_usd
      WHERE month_start = reservation.month_start;
    UPDATE app.chat_budget_months
      SET warning_emitted = true
      WHERE month_start = reservation.month_start AND NOT warning_emitted
        AND settled_usd >= p_warning_usd
      RETURNING true INTO updated_warning;
    UPDATE app.chat_budget_reservations
       SET state = 'settled', over_reserved = v_over_reserved
      WHERE reservation_id = p_reservation_id;
    RETURN QUERY SELECT true, COALESCE(updated_warning, false), v_over_reserved;
END;
$$;

CREATE OR REPLACE FUNCTION app.release_chat_budget(p_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    reservation app.chat_budget_reservations%ROWTYPE;
    reservation_month date;
BEGIN
    SELECT month_start INTO reservation_month FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM 1 FROM app.chat_budget_months
      WHERE month_start = reservation_month FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chat budget month not found'; END IF;
    SELECT * INTO STRICT reservation FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id FOR UPDATE;
    IF reservation.month_start <> reservation_month THEN
      RAISE EXCEPTION 'chat budget reservation period changed';
    END IF;
    IF reservation.state IN ('released', 'settled') THEN RETURN false; END IF;
    UPDATE app.chat_budget_reservations SET state = 'released'
      WHERE reservation_id = p_reservation_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.retain_chat_budget(p_reservation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    reservation app.chat_budget_reservations%ROWTYPE;
    reservation_month date;
BEGIN
    SELECT month_start INTO reservation_month FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM 1 FROM app.chat_budget_months
      WHERE month_start = reservation_month FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chat budget month not found'; END IF;
    SELECT * INTO STRICT reservation FROM app.chat_budget_reservations
      WHERE reservation_id = p_reservation_id FOR UPDATE;
    IF reservation.month_start <> reservation_month THEN
      RAISE EXCEPTION 'chat budget reservation period changed';
    END IF;
    IF reservation.state = 'reserved' THEN
      UPDATE app.chat_budget_reservations SET state = 'retained'
        WHERE reservation_id = p_reservation_id;
    END IF;
    RETURN reservation.state IN ('reserved', 'retained');
END;
$$;

REVOKE ALL ON FUNCTION app.reserve_chat_budget(uuid, date, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.settle_chat_budget(uuid, bigint, bigint, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.release_chat_budget(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.retain_chat_budget(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.reserve_chat_budget(uuid, date, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION app.settle_chat_budget(uuid, bigint, bigint, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION app.release_chat_budget(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION app.retain_chat_budget(uuid) TO service_role;
