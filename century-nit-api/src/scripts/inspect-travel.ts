import { config } from "dotenv";
import pg from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.production") });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
	// APP-2026-0001 journey signals
	const res = await pool.query(`
		SELECT a.id, a.app_number, a.stage, a.proceed_status, a.funding_track,
		       a.app_fee_paid, a.deposit_paid, a.visa_invoice_paid, a.travel_invoice_paid,
		       a.visa_stage, a.travel_clearance, a.payment_plan_id,
		       a.agency_stage_index, a.agency_settled, a.assigned_staff_id,
		       ap.email as applicant_email
		FROM applications a
		JOIN applicants ap ON ap.id = a.applicant_id
		WHERE a.app_number = 'APP-2026-0001';
	`);
	const app = res.rows[0];
	console.log("=== APP-2026-0001 ===");
	console.log("  stage:", app.stage);
	console.log("  visaStage:", app.visa_stage);
	console.log("  travelClearance:", app.travel_clearance);
	console.log("  travelInvoicePaid:", app.travel_invoice_paid);
	console.log("  paymentPlanId:", app.payment_plan_id);
	console.log("  agencyStageIndex:", app.agency_stage_index);
	console.log("  agencySettled:", app.agency_settled);

	// Check travel request
	const taRes = await pool.query(`
		SELECT status, decision, booking_confirmation, assigned_ops_user_id
		FROM travel_assistance_requests
		WHERE application_id = $1
		ORDER BY created_at DESC LIMIT 1;
	`, [app.id]);
	console.log("  TA:", taRes.rows[0]);

	// Check pre-departure tasks
	const pdRes = await pool.query(`
		SELECT pre_departure_tasks FROM applications WHERE id = $1;
	`, [app.id]);
	console.log("  preDepartureTasks:", pdRes.rows[0]?.pre_departure_tasks);

	await pool.end();
}

main().catch((err) => {
	console.error(err);
	pool.end();
});
