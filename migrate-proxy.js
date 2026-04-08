require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected. Running proxy tables migration...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS proxy_api_keys (
      id SERIAL PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      key_value VARCHAR(255) NOT NULL UNIQUE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proxy_logs (
      id SERIAL PRIMARY KEY,
      key_id INTEGER REFERENCES proxy_api_keys(id) ON DELETE SET NULL,
      model VARCHAR(100),
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      status VARCHAR(50) DEFAULT 'success',
      error_msg TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('Proxy tables created successfully.');
  await client.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
