const fs = require('fs');

const schemaAdditions = `
// --- ACADEMIC CATALOGUE ---

export const destinations = pgTable("destinations", {
	id: text("id").primaryKey(), // e.g. "ca", "uk"
	name: text("name").notNull(),
	region: text("region").notNull(),
	tagline: text("tagline"),
	description: text("description"),
	highlights: jsonb("highlights").$type<string[]>(), // Array of strings
	universities: integer("universities").default(0),
	programs: integer("programs").default(0),
	image: text("image"),
	flag: text("flag"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogUniversities = pgTable("catalog_universities", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	destinationId: text("destination_id").references(() => destinations.id),
	city: text("city"),
	ranking: text("ranking"),
	type: text("type"),
	acceptance: text("acceptance"),
	description: text("description"),
	image: text("image"),
	tags: jsonb("tags").$type<string[]>(), // Array of strings
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogPrograms = pgTable("catalog_programs", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	universityId: text("university_id").references(() => catalogUniversities.id),
	level: text("level"), // Undergraduate, Postgraduate, etc.
	field: text("field"), // STEM, Arts, etc.
	duration: text("duration"),
	tuition: text("tuition"),
	tuitionUsd: integer("tuition_usd"),
	intake: jsonb("intake").$type<string[]>(), // ["Sept 2024", "Jan 2025"]
	applicationDeadline: text("application_deadline"),
	description: text("description"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogScholarships = pgTable("catalog_scholarships", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	universityId: text("university_id").references(() => catalogUniversities.id),
	amount: text("amount"),
	type: text("type"),
	deadline: text("deadline"),
	eligibility: text("eligibility"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
`;

fs.appendFileSync('src/db/schema.ts', '\n' + schemaAdditions);
console.log('Appended catalog tables to schema.ts');
