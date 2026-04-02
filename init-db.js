require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to DB. Creating tables...');

  // Create tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      website VARCHAR(255),
      category VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS brand_aliases (
      id SERIAL PRIMARY KEY,
      brand_id INTEGER REFERENCES brands(id),
      alias VARCHAR(255) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id SERIAL PRIMARY KEY,
      prompt_text TEXT NOT NULL,
      prompt_type VARCHAR(100),
      category VARCHAR(255),
      active BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      brand_id INTEGER REFERENCES brands(id),
      user_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending', 
      score_data JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scan_prompts (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER REFERENCES scans(id),
      prompt_id INTEGER REFERENCES prompts(id),
      resolved_prompt_text TEXT NOT NULL,
      cluster_type VARCHAR(100),
      weight NUMERIC DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      id SERIAL PRIMARY KEY,
      scan_prompt_id INTEGER REFERENCES scan_prompts(id) ON DELETE CASCADE,
      model_name VARCHAR(100),
      provider VARCHAR(100),
      raw_response TEXT,
      latency_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id SERIAL PRIMARY KEY,
      model_run_id INTEGER REFERENCES model_runs(id) ON DELETE CASCADE,
      brand_id INTEGER REFERENCES brands(id),
      matched_text TEXT,
      mention_position INTEGER,
      sentiment_label VARCHAR(50),
      confidence NUMERIC,
      excerpt TEXT
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
      recommendation_type VARCHAR(100),
      text TEXT,
      priority INTEGER
    );
  `);
  
  console.log('Tables created. Seeding initial prompts...');

  const initialPrompts = [
    { text: "What is the best {category} tool for startups?", type: "best-of" },
    { text: "Top 5 {category} software in 2026", type: "best-of" },
    { text: "Which {category} platform is easiest to use for beginners?", type: "persona" },
    { text: "Best {category} tools for enterprise", type: "best-of" },
    { text: "Most reliable {category} solutions", type: "recommendation" },
    { text: "What are the top alternatives to {competitor} in the {category} space?", type: "alternatives" },
    { text: "Is there a better {category} tool than {competitor}?", type: "alternatives" },
    { text: "Compare {competitor} vs other {category} tools", type: "comparison" },
    { text: "Cheaper alternatives to {competitor} for {category}", type: "alternatives" },
    { text: "What should I use instead of {competitor}?", type: "alternatives" },
    { text: "What is the best tool for {use_case} in {category}?", type: "use-case" },
    { text: "How to handle {use_case} with the right {category} software", type: "use-case" },
    { text: "Which {category} platform is best suited for {use_case}?", type: "use-case" },
    { text: "Top {category} apps for {use_case}", type: "use-case" },
    { text: "Recommendations for {category} specific to {use_case}", type: "use-case" },
    { text: "What are the most popular {category} tools right now?", type: "discovery" },
    { text: "Give me a list of {category} software I should evaluate.", type: "discovery" },
    { text: "What is the industry standard for {category}?", type: "discovery" },
    { text: "Highly rated {category} tools on G2 or Reddit", type: "discovery" },
    { text: "If I'm looking for {category}, what are the top 3 options?", type: "discovery" }
  ];

  for (const p of initialPrompts) {
    const res = await client.query('SELECT id FROM prompts WHERE prompt_text = $1', [p.text]);
    if (res.rows.length === 0) {
      await client.query('INSERT INTO prompts (prompt_text, prompt_type) VALUES ($1, $2)', [p.text, p.type]);
    }
  }

  console.log('Seeding complete. Ready.');
  await client.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
