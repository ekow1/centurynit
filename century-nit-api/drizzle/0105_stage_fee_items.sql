-- Visa and Departure are priced flat, whatever the track: two Century items
-- in the fee catalogue, where finance already edits the consultation fee.
-- Seeded from the non-scholarship package's stage prices (0104) so nothing
-- changes in price on the day; the package's own visa/departure numbers stay
-- as a fallback for a catalogue that switches these items off.
INSERT INTO "fee_items" ("key", "kind", "chapter", "name", "client_label", "description", "amount_cents", "optional", "active", "sort_order")
SELECT 'stage_visa', 'century', 'visa', 'Visa stage', 'Visa stage — service fee',
	'Financial file, CAS / I-20 handling, visa filing, biometrics booking, mock interview. Flat, whatever the track.',
	COALESCE((SELECT ("stage_prices"->>'visa')::int FROM "service_packages" WHERE "code" = 'non_scholarship'), 70000), false, true, 12
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "fee_items" ("key", "kind", "chapter", "name", "client_label", "description", "amount_cents", "optional", "active", "sort_order")
SELECT 'stage_departure', 'century', 'depart', 'Departure & arrival stage', 'Departure & arrival stage — service fee',
	'Flight and housing coordination, airport pickup, pre-departure briefing, first-week check-in. Flat, whatever the track.',
	COALESCE((SELECT ("stage_prices"->>'departure')::int FROM "service_packages" WHERE "code" = 'non_scholarship'), 30000), false, true, 14
ON CONFLICT ("key") DO NOTHING;
