CREATE TABLE "consultation_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"type" varchar(48) NOT NULL,
	"actor_ops_user_id" uuid,
	"actor_name" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "coordinator_id" uuid;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "coordinator_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "coordinator_assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN "delegation_note" text;--> statement-breakpoint
ALTER TABLE "consultation_activities" ADD CONSTRAINT "consultation_activities_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_activities" ADD CONSTRAINT "consultation_activities_actor_ops_user_id_ops_users_id_fk" FOREIGN KEY ("actor_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultation_activities_consultation_idx" ON "consultation_activities" USING btree ("consultation_id","created_at");--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_coordinator_id_ops_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_coordinator_assigned_by_ops_users_id_fk" FOREIGN KEY ("coordinator_assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultations_coordinator_idx" ON "consultations" USING btree ("coordinator_id","status");