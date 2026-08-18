import dotenv from 'dotenv';
dotenv.config({path: '.env'});
import { Client } from 'pg';
import fs from 'fs';

async function main() {
  const dbUrl = 'postgres://postgres:postgres@localhost:5432/century_nit';
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  // Format connection string with port 5432
  const parsed = new URL(dbUrl);
  // parsed.port = "5432";
  // parsed.searchParams.set('sslmode', 'no-verify');
  
  const client = new Client({
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const sql = fs.readFileSync('drizzle/0026_funny_menace.sql', 'utf8');
  
  try {
    const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      console.log('Executing:', stmt);
      await client.query(stmt);
    }
    console.log('Successfully applied migration');
  } catch (err) {
    console.error('Error applying migration:', err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
