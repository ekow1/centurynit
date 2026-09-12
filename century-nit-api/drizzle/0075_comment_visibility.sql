CREATE TYPE "public"."case_comment_visibility" AS ENUM('internal', 'applicant');
ALTER TABLE "case_comments" ADD COLUMN "visibility" "case_comment_visibility" DEFAULT 'internal' NOT NULL;
