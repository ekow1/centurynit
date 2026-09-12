-- Every package names the documents it needs; they are collected and verified
-- during the Consultation chapter so nothing is chased once applications
-- start. Existing packages get the standard set.
ALTER TABLE "service_packages" ADD COLUMN IF NOT EXISTS "required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL;
UPDATE "service_packages" SET "required_documents" = '["passport","transcript","diploma","statement","recommendation","english"]'::jsonb
	WHERE "required_documents" = '[]'::jsonb;
