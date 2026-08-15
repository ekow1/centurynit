CREATE TYPE "public"."document_status" AS ENUM('PENDING_UPLOAD', 'UPLOADED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "applicant_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"file_name" text NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" integer,
	"storage_key" text NOT NULL,
	"status" "document_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicant_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "applicant_documents" ADD CONSTRAINT "applicant_documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_documents" ADD CONSTRAINT "applicant_documents_reviewed_by_ops_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applicant_documents_owner_idx" ON "applicant_documents" USING btree ("owner_user_id","document_type");--> statement-breakpoint
CREATE INDEX "applicant_documents_status_idx" ON "applicant_documents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applicant_documents_current_unique" ON "applicant_documents" USING btree ("owner_user_id","document_type") WHERE status <> 'REJECTED';