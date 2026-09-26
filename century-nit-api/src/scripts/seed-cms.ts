/**
 * Seed published pages/* CMS entries from the compiled copy.
 *
 * Run with the target env file loaded first — dotenv does not override
 * already-set variables, so the runtime's own dotenv/config stays inert:
 *
 *   npx tsx --env-file=.env.production src/scripts/seed-cms.ts
 */
import { seedCompiledContent } from "../services/cms.js";

const res = await seedCompiledContent({ email: "seed-compiled-content" });
console.log(`[seed-cms] created ${res.created}, skipped ${res.skipped}`);
process.exit(0);
