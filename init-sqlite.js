const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');

async function run() {
  const db = await open({
    filename: './rankedai.db',
    driver: sqlite3.Database
  });

  console.log('Connected to SQLite DB. Creating tables...');

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS brand_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER REFERENCES brands(id),
      alias TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_text TEXT NOT NULL,
      prompt_type TEXT,
      category TEXT,
      active BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER REFERENCES brands(id),
      user_id TEXT,
      status TEXT DEFAULT 'pending', 
      score_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS scan_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER REFERENCES scans(id),
      prompt_id INTEGER REFERENCES prompts(id),
      resolved_prompt_text TEXT NOT NULL,
      cluster_type TEXT,
      weight REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_prompt_id INTEGER REFERENCES scan_prompts(id) ON DELETE CASCADE,
      model_name TEXT,
      provider TEXT,
      raw_response TEXT,
      latency_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_run_id INTEGER REFERENCES model_runs(id) ON DELETE CASCADE,
      brand_id INTEGER REFERENCES brands(id),
      matched_text TEXT,
      mention_position INTEGER,
      sentiment_label TEXT,
      confidence NUMERIC,
      excerpt TEXT
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
      recommendation_type TEXT,
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
    const row = await db.get('SELECT id FROM prompts WHERE prompt_text = ?', [p.text]);
    if (!row) {
      await db.run('INSERT INTO prompts (prompt_text, prompt_type) VALUES (?, ?)', [p.text, p.type]);
    }
  }

  console.log('Seeding complete. Ready.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
