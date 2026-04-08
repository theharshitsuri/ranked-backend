const { OpenAI } = require('openai');
const { get, run } = require('./db');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Validate a proxy API key (llm_obs_ prefix) against the DB.
 * Returns the key record or null.
 */
async function validateProxyKey(rawKey) {
  if (!rawKey || !rawKey.startsWith('llm_obs_')) return null;

  // Check DB first
  const record = await get(
    'SELECT * FROM proxy_api_keys WHERE key_value = ? AND is_active = TRUE',
    [rawKey]
  );

  // If not in DB, fall back to env var (bootstrap key)
  if (!record && rawKey === process.env.PROXY_API_KEY) {
    return { id: 0, label: 'env-bootstrap', key_value: rawKey };
  }

  return record || null;
}

/**
 * Forward a chat completions request to OpenAI and return usage + response.
 */
async function forwardChatCompletion(body) {
  const t0 = Date.now();
  const { model = 'gpt-4o', messages, ...rest } = body;

  const completion = await openai.chat.completions.create({
    model,
    messages,
    ...rest,
  });

  return {
    completion,
    latency_ms: Date.now() - t0,
    prompt_tokens: completion.usage?.prompt_tokens || 0,
    completion_tokens: completion.usage?.completion_tokens || 0,
    model: completion.model,
  };
}

/**
 * Log a proxy request to the proxy_logs table.
 */
async function logProxyRequest({ keyId, model, promptTokens, completionTokens, latencyMs, status, errorMsg }) {
  try {
    await run(
      `INSERT INTO proxy_logs (key_id, model, prompt_tokens, completion_tokens, latency_ms, status, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [keyId || null, model || 'unknown', promptTokens || 0, completionTokens || 0, latencyMs || 0, status, errorMsg || null]
    );
  } catch (err) {
    console.error('Failed to log proxy request:', err.message);
  }
}

/**
 * Generate a new proxy API key and store it in the DB.
 */
async function generateProxyKey(label) {
  const { nanoid } = await import('nanoid');
  const key = `llm_obs_${nanoid(32)}`;
  await run(
    'INSERT INTO proxy_api_keys (label, key_value, is_active) VALUES (?, ?, TRUE)',
    [label || 'default', key]
  );
  return key;
}

module.exports = { validateProxyKey, forwardChatCompletion, logProxyRequest, generateProxyKey };
