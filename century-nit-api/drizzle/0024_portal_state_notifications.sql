ALTER TABLE "applicants" ADD COLUMN "portal_state" jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(500),
	"read" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");
