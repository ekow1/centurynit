import { db } from "./db/index.js";
import { bookings, consultations } from "./db/schema.js";
import { eq } from "drizzle-orm";

async function run() {
	try {
		console.log("Looking for cancelled consultations...");
		const cancelledConsultations = await db.select().from(consultations).where(eq(consultations.status, "CANCELLED"));
		
		if (cancelledConsultations.length === 0) {
			console.log("No cancelled consultations found.");
			process.exit(0);
		}

		for (const c of cancelledConsultations) {
			console.log(`Resetting consultation ${c.id} (ref: ${c.reference})`);
			
			// Reset consultation to UNDER_REVIEW
			await db.update(consultations)
				.set({ status: "UNDER_REVIEW" })
				.where(eq(consultations.id, c.id));
				
			if (c.bookingId) {
				console.log(`Resetting booking ${c.bookingId}`);
				await db.update(bookings)
					.set({ status: "UNASSIGNED" })
					.where(eq(bookings.id, c.bookingId));
			}
		}
		
		console.log("Done!");
		process.exit(0);
	} catch (err) {
		console.error("Error:", err);
		process.exit(1);
	}
}

run();
