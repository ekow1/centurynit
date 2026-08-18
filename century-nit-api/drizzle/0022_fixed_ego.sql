CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(16) DEFAULT 'email' NOT NULL,
	"subject" varchar(500),
	"header" varchar(500),
	"body" text NOT NULL,
	"footer" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailing_list_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailing_list_id" uuid NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailing_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"channel" varchar(16) DEFAULT 'email' NOT NULL,
	"audience" varchar(255),
	"subject" varchar(500),
	"body" text NOT NULL,
	"template_id" uuid,
	"mailing_list_id" uuid,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailing_list_contacts" ADD CONSTRAINT "mailing_list_contacts_mailing_list_id_mailing_lists_id_fk" FOREIGN KEY ("mailing_list_id") REFERENCES "public"."mailing_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mlc_list_idx" ON "mailing_list_contacts" USING btree ("mailing_list_id");--> statement-breakpoint
CREATE INDEX "mlc_email_idx" ON "mailing_list_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "marketing_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_type_idx" ON "marketing_campaigns" USING btree ("type");