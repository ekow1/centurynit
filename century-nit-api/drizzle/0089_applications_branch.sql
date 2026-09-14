-- The office that owns the case, separate from the client's location —
-- a case can be referred to another branch (Kumasi client handled by
-- Accra) without rewriting who the client is. Null falls back to the
-- applicant's branch at read time.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "branch" varchar(64);
