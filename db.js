const { Pool } = require('pg');
require('dotenv').config();

let db;
let isPostgres = !!process.env.DATABASE_URL;

async function initDB() {
  if (isPostgres) {
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Required for Neon/Render/Supabase
    });
    console.log('PostgreSQL connected.');
  } else {
    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');
    db = await open({
      filename: './rankedai.db',
      driver: sqlite3.Database
    });
    console.log('SQLite connected.');
  }
  return db;
}

const query = async (text, params) => {
  if (isPostgres) {
    // Convert ? to $1, $2, etc for Postgres
    let count = 0;
    const pgText = text.replace(/\?/g, () => `$${++count}`);
    const res = await db.query(pgText, params);
    return { rows: res.rows, lastID: res.rows[0]?.id || null };
  } else {
    const res = await db.all(text, params);
    return { rows: res };
  }
};

const get = async (text, params) => {
  if (isPostgres) {
    let count = 0;
    const pgText = text.replace(/\?/g, () => `$${++count}`);
    const res = await db.query(pgText, params);
    return res.rows[0];
  } else {
    return await db.get(text, params);
  }
};

const all = async (text, params) => {
  if (isPostgres) {
    let count = 0;
    const pgText = text.replace(/\?/g, () => `$${++count}`);
    const res = await db.query(pgText, params);
    return res.rows;
  } else {
    return await db.all(text, params);
  }
};

const run = async (text, params) => {
  if (isPostgres) {
    let count = 0;
    // For inserts, we often want the ID back. 
    // We'll automatically add RETURNING id if it's an INSERT and not present.
    let pgText = text.replace(/\?/g, () => `$${++count}`);
    if (pgText.trim().toUpperCase().startsWith('INSERT') && !pgText.toUpperCase().includes('RETURNING')) {
      pgText += ' RETURNING id';
    }
    const res = await db.query(pgText, params);
    return { lastID: res.rows[0]?.id };
  } else {
    const res = await db.run(text, params);
    return { lastID: res.lastID };
  }
};

module.exports = { initDB, query, get, all, run, isPostgres };
