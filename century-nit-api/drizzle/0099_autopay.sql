CREATE TABLE IF NOT EXISTS payment_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    authorization_code TEXT NOT NULL,
    card_brand VARCHAR(32),
    card_last4 VARCHAR(4),
    bank TEXT,
    exp_month VARCHAR(2),
    exp_year VARCHAR(4),
    active BOOLEAN NOT NULL DEFAULT false,
    consented_at TIMESTAMPTZ,
    last_charge_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_authorizations_user_idx ON payment_authorizations(user_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS payment_authorizations_code_uniq ON payment_authorizations(user_id, authorization_code);

CREATE TABLE IF NOT EXISTS autopay_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_line_id UUID NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
    authorization_id UUID REFERENCES payment_authorizations(id) ON DELETE SET NULL,
    invoice_id UUID NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference VARCHAR(128),
    status VARCHAR(16) NOT NULL,
    failure_reason TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS autopay_attempts_line_idx ON autopay_attempts(invoice_line_id, attempted_at);
