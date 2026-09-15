-- Standing case-oversight grants: the authority layer under coordination.
-- A grant makes a staff member delegable at any scope (case, applicant
-- journey, duty) without a coordinator/manager role, until it is retracted
-- (revoked_at) or lapses (expires_at; null = open-ended).
CREATE TABLE IF NOT EXISTS "coordination_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "coordination_grants" ADD CONSTRAINT "coordination_grants_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_grants" ADD CONSTRAINT "coordination_grants_granted_by_ops_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_grants" ADD CONSTRAINT "coordination_grants_revoked_by_ops_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coordination_grants_user_idx" ON "coordination_grants" ("ops_user_id", "revoked_at");
