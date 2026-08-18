CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(500),
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "portal_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_university_id_catalog_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_program_id_catalog_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."catalog_programs"("id") ON DELETE no action ON UPDATE no action;