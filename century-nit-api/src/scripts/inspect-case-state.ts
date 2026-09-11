import { config } from "dotenv";
import pg from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.production") });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
	const appRes = await pool.query(`
		SELECT id, app_number, stage, proceed_status, deposit_paid, agency_stage_index, agency_settled, assigned_staff_id, funding_track
		FROM applications
		WHERE id = 'a432acba-a5e5-4d9d-bf6b-a1a0894eb8d1';
	`);
	console.log("Applications:", JSON.stringify(appRes.rows, null, 2));

	if (appRes.rows.length > 0) {
		const appId = appRes.rows[0].id;
		const handoffsRes = await pool.query(`
			SELECT id, application_id, stage, source, status, from_ops_user_id, resolved_ops_user_id, created_at, updated_at
			FROM stage_handoffs
			WHERE application_id = $1
			ORDER BY created_at DESC;
		`, [appId]);
		console.log("Handoffs for latest app:", JSON.stringify(handoffsRes.rows, null, 2));

		const applicantRes = await pool.query(`
			SELECT id, name, email, user_id, assigned_officer_id
			FROM applicants
			WHERE id = $1;
		`, [appRes.rows[0].applicant_id]);
		console.log("Applicant:", JSON.stringify(applicantRes.rows, null, 2));
	}
	await pool.end();
}

main().catch((err) => {
	console.error(err);
	pool.end();
});
