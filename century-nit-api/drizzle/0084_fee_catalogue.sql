-- The fee model: Century's own fee is the package's service fee plus a
-- short list of add-ons; everything else is a third-party cost paid on the
-- client's behalf at cost. The tariffs live on the catalogue rows they
-- belong to; Century's items and the optional at-cost items live in one
-- small table finance edits.

ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "visa_fee_cents" integer NOT NULL DEFAULT 0;
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "biometrics_fee_cents" integer NOT NULL DEFAULT 0;
ALTER TABLE "catalog_universities" ADD COLUMN IF NOT EXISTS "application_fee_cents" integer NOT NULL DEFAULT 0;
-- A programme can charge differently from its university; null means "as the university".
ALTER TABLE "catalog_programs" ADD COLUMN IF NOT EXISTS "application_fee_cents" integer;

DO $$ BEGIN
	CREATE TYPE "fee_kind" AS ENUM ('century', 'pass_through');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "fee_items" (
	"key" text PRIMARY KEY,
	"kind" "fee_kind" NOT NULL,
	"chapter" text NOT NULL,
	"name" text NOT NULL,
	"client_label" text NOT NULL,
	"description" text,
	"amount_cents" integer NOT NULL DEFAULT 0,
	"optional" boolean NOT NULL DEFAULT false,
	"active" boolean NOT NULL DEFAULT true,
	"sort_order" integer NOT NULL DEFAULT 0,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seeded with the code defaults; `seed-fee-items` copies any amounts finance
-- had set in platform settings over these (settings are encrypted, so SQL
-- cannot read them).
INSERT INTO "fee_items" ("key", "kind", "chapter", "name", "client_label", "description", "amount_cents", "optional", "active", "sort_order") VALUES
	('consultation',       'century',      'consult', 'Consultation fee',                    'Consultation',                                   'Charged when a consultation is booked.',                                                   15000, false, true,  10),
	('extra_school',       'century',      'apply',   'Extra school (beyond the package)',   'Extra school application',                       'One per school beyond the package''s allowance — Century''s work on that application.',    7000,  false, true,  20),
	('visa_reapplication', 'century',      'visa',    'Visa reapplication',                  'Visa reapplication',                             'Offered when a refused case is reopened for a second attempt.',                            0,     true,  false, 30),
	('translation',        'pass_through', 'visa',    'Certified translation',               'Certified translation — paid on your behalf',    'An external certified translator''s fee, recovered at cost.',                              5000,  true,  true,  40),
	('tb_test',            'pass_through', 'visa',    'TB test',                             'TB test — paid on your behalf',                  'Clinic fee where the destination requires a test, recovered at cost.',                     0,     true,  false, 50),
	('courier',            'pass_through', 'apply',   'Courier',                             'Courier — paid on your behalf',                  'Document courier to a school or embassy, recovered at cost.',                              0,     true,  false, 60)
ON CONFLICT ("key") DO NOTHING;

-- Same posture as every other table: nothing reaches it except through this API.
ALTER TABLE "fee_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_items" FORCE ROW LEVEL SECURITY;
