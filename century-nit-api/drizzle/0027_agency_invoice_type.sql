-- Add 'agency' to the invoice_type enum so the portal can pay agency/service fees via Paystack
ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'agency';
