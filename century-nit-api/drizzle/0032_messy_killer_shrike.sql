CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."staff_presence_status" AS ENUM('available', 'busy', 'on_leave', 'offline');--> statement-breakpoint
CREATE TYPE "public"."stage_assignment_status" AS ENUM('active', 'reassigned', 'on_leave', 'completed');--> statement-breakpoint
ALTER TYPE "public"."conversation_role" ADD VALUE 'former';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'applicant';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'support';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'case';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'stage';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'internal';--> statement-breakpoint
ALTER TYPE "public"."conversation_type" ADD VALUE 'escalation';--> statement-breakpoint
ALTER TYPE "public"."invoice_type" ADD VALUE 'agency' BEFORE 'custom';--> statement-breakpoint
CREATE TABLE "communication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"actor_ops_user_id" uuid,
	"action" varchar(64) NOT NULL,
	"conversation_id" uuid,
	"application_id" uuid,
	"stage_key" varchar(80),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"channel_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "staff_presence" (
	"ops_user_id" uuid PRIMARY KEY NOT NULL,
	"status" "staff_presence_status" DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"status_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage" varchar(80) NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"status" "stage_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "conversation_participants_pk";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DEFAULT 'document_verification';--> statement-breakpoint
ALTER TABLE "conversation_participants" ALTER COLUMN "ops_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_ops_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_ops_user_id_participant_user_id_pk" PRIMARY KEY("conversation_id","ops_user_id","participant_user_id");--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "participant_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "stage_key" varchar(80);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "email_inbox_token" varchar(64);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalated_by_ops_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" "conversation_status" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "event_id" varchar(200);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "priority" varchar(20) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "entity_type" varchar(50);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "entity_id" varchar(100);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "case_id" varchar(100);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_actor_ops_user_id_ops_users_id_fk" FOREIGN KEY ("actor_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_presence" ADD CONSTRAINT "staff_presence_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communication_events_conversation_idx" ON "communication_events" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_events_application_idx" ON "communication_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "communication_events_action_idx" ON "communication_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "push_subs_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stage_assignments_application_idx" ON "stage_assignments" USING btree ("application_id","stage");--> statement-breakpoint
CREATE INDEX "stage_assignments_ops_user_idx" ON "stage_assignments" USING btree ("ops_user_id","status");--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_participant_user_id_users_id_fk" FOREIGN KEY ("participant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_escalated_by_ops_user_id_ops_users_id_fk" FOREIGN KEY ("escalated_by_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_participants_part_user_idx" ON "conversation_participants" USING btree ("participant_user_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_stage_idx" ON "conversations" USING btree ("linked_entity_type","linked_entity_id","stage_key");--> statement-breakpoint
CREATE INDEX "notifications_case_idx" ON "notifications" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_email_inbox_token_unique" UNIQUE("email_inbox_token");