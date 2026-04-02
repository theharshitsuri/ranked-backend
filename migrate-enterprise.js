require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Running Enterprise Migration: Adding cluster_type and weight to scan_prompts...');
  try {
    await client.query('ALTER TABLE scan_prompts ADD COLUMN IF NOT EXISTS cluster_type VARCHAR(100)');
    await client.query('ALTER TABLE scan_prompts ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 1.0');
    console.log('Migration successful: Columns added to scan_prompts.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
