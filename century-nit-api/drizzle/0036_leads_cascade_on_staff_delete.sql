ALTER TABLE "leads" DROP CONSTRAINT "leads_assigned_staff_id_ops_users_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_staff_id_ops_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;