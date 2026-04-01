require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Running migration: Adding excerpt column to mentions table...');
  try {
    await client.query('ALTER TABLE mentions ADD COLUMN IF NOT EXISTS excerpt TEXT');
    console.log('Migration successful: Column added.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
