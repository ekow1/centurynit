CREATE TABLE "catalog_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"university_id" text,
	"level" text,
	"field" text,
	"duration" text,
	"tuition" text,
	"tuition_usd" integer,
	"intake" jsonb,
	"application_deadline" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "catalog_scholarships" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"university_id" text,
	"amount" text,
	"type" text,
	"deadline" text,
	"eligibility" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "catalog_universities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"destination_id" text,
	"city" text,
	"ranking" text,
	"type" text,
	"acceptance" text,
	"description" text,
	"image" text,
	"tags" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"tagline" text,
	"description" text,
	"highlights" jsonb,
	"universities" integer DEFAULT 0,
	"programs" integer DEFAULT 0,
	"image" text,
	"flag" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "catalog_programs" ADD CONSTRAINT "catalog_programs_university_id_catalog_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_scholarships" ADD CONSTRAINT "catalog_scholarships_university_id_catalog_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_universities" ADD CONSTRAINT "catalog_universities_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;