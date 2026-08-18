CREATE TABLE "auth_settings" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enrolled" boolean DEFAULT false NOT NULL;