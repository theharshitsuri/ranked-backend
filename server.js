const express = require('express');
const cors = require('cors');
const { initDB, get, all, run, isPostgres } = require('./db');
const { runPrompt } = require('./openai-service');
const { extractMentions, calculateScore, detectTopCompetitor } = require('./scoring-engine');
const { validateProxyKey, forwardChatCompletion, logProxyRequest, generateProxyKey } = require('./proxy-service');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

initDB().then(() => {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`RankedAI API running on port ${PORT}`);
  });
});

app.post('/api/scan', async (req, res) => {
  try {
    const { brand, website, category, competitors } = req.body;
    if (!brand || !category) return res.status(400).json({ error: 'Brand and Category are required.' });

    let brandRecord = await get('SELECT * FROM brands WHERE LOWER(name) = LOWER(?)', [brand]);
    if (!brandRecord) {
      const result = await run('INSERT INTO brands (name, website, category) VALUES (?, ?, ?)', [brand, website || null, category]);
      brandRecord = { id: result.lastID, name: brand, website, category };
    }

    const competitorRecords = [];
    if (competitors && typeof competitors === 'string') {
      const compNames = competitors.split(',').map(s => s.trim()).filter(Boolean);
      for (const c of compNames) {
        let r = await get('SELECT * FROM brands WHERE LOWER(name) = LOWER(?)', [c]);
        if (!r) {
          const ins = await run('INSERT INTO brands (name, category) VALUES (?, ?)', [c, category]);
          r = { id: ins.lastID, name: c, category };
        }
        competitorRecords.push(r);
      }
    }

    const scanResult = await run('INSERT INTO scans (brand_id, status) VALUES (?, ?)', [brandRecord.id, 'pending']);
    const scanId = scanResult.lastID;

    // Pick 20 prompts for Phase 3 deep scan analysis
    const prompts = await all('SELECT * FROM prompts ORDER BY RANDOM() LIMIT 20');
    for (const p of prompts) {
      const resolvedText = p.prompt_text.replace(/{category}/ig, category);
      await run('INSERT INTO scan_prompts (scan_id, prompt_id, resolved_prompt_text) VALUES (?, ?, ?)', [scanId, p.id, resolvedText]);
    }

    runScanWorker(scanId, brandRecord, competitorRecords).catch(err => console.error('Worker failed:', err));
    return res.json({ success: true, scan_id: scanId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/scans/:id', async (req, res) => {
  try {
    const scanId = req.params.id;
    const scan = await get('SELECT * FROM scans WHERE id = ?', [scanId]);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    let scoreData = null;
    if (scan.score_data) {
      scoreData = typeof scan.score_data === 'string' ? JSON.parse(scan.score_data) : scan.score_data;
    }

    const rawPrompts = await all(`
      SELECT sp.id as sp_id, sp.resolved_prompt_text, m.brand_id, m.matched_text, m.mention_position, m.sentiment_label, m.excerpt 
      FROM scan_prompts sp
      LEFT JOIN model_runs mr ON sp.id = mr.scan_prompt_id
      LEFT JOIN mentions m ON mr.id = m.model_run_id
      WHERE sp.scan_id = ?
    `, [scanId]);

    const groupedMap = {};
    for (const row of rawPrompts) {
      if (!groupedMap[row.sp_id]) {
        groupedMap[row.sp_id] = { text: row.resolved_prompt_text, target_mention: null, competitor_mentions: [] };
      }
      
      if (row.brand_id) {
        const payload = { matched_text: row.matched_text, position: row.mention_position, sentiment: row.sentiment_label, excerpt: row.excerpt, brand_id: row.brand_id };
        if (row.brand_id === scan.brand_id) groupedMap[row.sp_id].target_mention = payload;
        else groupedMap[row.sp_id].competitor_mentions.push(payload);
      }
    }
    const promptsData = Object.values(groupedMap);

    const totalPrompts = await get('SELECT COUNT(*) as c FROM scan_prompts WHERE scan_id = ?', [scanId]);
    const runsDone = await get(`
      SELECT COUNT(*) as c FROM model_runs mr
      JOIN scan_prompts sp ON mr.scan_prompt_id = sp.id
      WHERE sp.scan_id = ? AND mr.status = 'completed'
    `, [scanId]);

    res.json({
      scan_id: scan.id,
      brand_id: scan.brand_id,
      status: scan.status,
      progress: `${runsDone.c} / ${totalPrompts.c}`,
      score: scoreData,
      prompts_data: promptsData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


async function runScanWorker(scanId, brandRecord, competitorRecords) {
  try {
    await run("UPDATE scans SET status = 'processing' WHERE id = ?", [scanId]);
    const scanPrompts = await all('SELECT * FROM scan_prompts WHERE scan_id = ?', [scanId]);
    
    const allBrandsToTrack = [brandRecord, ...competitorRecords];
    let allMentions = [];
    const allResponseTexts = [];

    // Parallel Batching (5 at a time) for speed and scaling
    for (let i = 0; i < scanPrompts.length; i += 5) {
      const batch = scanPrompts.slice(i, i + 5);
      
      await Promise.all(batch.map(async (sp) => {
        const res = await runPrompt(sp.resolved_prompt_text);
        if (res.success) allResponseTexts.push(res.text);

        const runResult = await run(`
          INSERT INTO model_runs (scan_prompt_id, model_name, provider, raw_response, latency_ms, prompt_tokens, completion_tokens, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [sp.id, 'gpt-4o-mini', 'openai', res.success ? res.text : res.error, res.latency, res.prompt_tokens || 0, res.completion_tokens || 0, res.success ? 'completed' : 'failed']);

        const runId = runResult.lastID;

        if (res.success) {
          const foundMentions = extractMentions(allBrandsToTrack, res.text);
          for (const m of foundMentions) {
            allMentions.push(m);
            await run(`
              INSERT INTO mentions (model_run_id, brand_id, matched_text, mention_position, sentiment_label, confidence, excerpt)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [runId, m.brand_id, m.matched_text, m.mention_position, m.sentiment_label, m.confidence, m.excerpt]);
          }
        }
      }));
    }

    const targetScore = calculateScore(scanPrompts.length, allMentions.filter(m => m.brand_id === brandRecord.id));
    const compScores = competitorRecords.map(c => {
       const ms = allMentions.filter(m => m.brand_id === c.id);
       return { name: c.name, score: calculateScore(scanPrompts.length, ms) };
    });

    const autoCompetitor = detectTopCompetitor(allResponseTexts, allBrandsToTrack.map(b => b.name));

    const finalScorePayload = { 
      target: targetScore, 
      competitors: compScores,
      auto_competitor: autoCompetitor
    };

    await run(
      "UPDATE scans SET status = 'completed', score_data = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(finalScorePayload), scanId]
    );
    console.log(`Scan ${scanId} completed. Target score: ${targetScore.final_score}`);
  } catch (err) {
    console.error('Worker failed:', err);
    await run("UPDATE scans SET status = 'failed' WHERE id = ?", [scanId]);
  }
}

// ─── LLM PROXY ROUTES ────────────────────────────────────────────────────────

/**
 * POST /v1/chat/completions
 * OpenAI-compatible drop-in proxy endpoint.
 * Auth: Authorization: Bearer llm_obs_xxxx
 */
app.post('/v1/chat/completions', async (req, res) => {
  const t0 = Date.now();
  const authHeader = req.headers['authorization'] || '';
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  const keyRecord = await validateProxyKey(rawKey);
  if (!keyRecord) {
    return res.status(401).json({
      error: { message: 'Invalid or inactive proxy API key.', type: 'invalid_request_error', code: 'invalid_api_key' }
    });
  }

  try {
    const { completion, latency_ms, prompt_tokens, completion_tokens, model } = await forwardChatCompletion(req.body);
    await logProxyRequest({ keyId: keyRecord.id || null, model, promptTokens: prompt_tokens, completionTokens: completion_tokens, latencyMs: latency_ms, status: 'success' });
    return res.json(completion);
  } catch (err) {
    const latency_ms = Date.now() - t0;
    console.error('Proxy error:', err.message);
    await logProxyRequest({ keyId: keyRecord.id || null, model: req.body?.model || 'unknown', promptTokens: 0, completionTokens: 0, latencyMs: latency_ms, status: 'error', errorMsg: err.message });
    return res.status(502).json({
      error: { message: err.message, type: 'upstream_error' }
    });
  }
});

/**
 * POST /api/proxy/keys
 * Generate a new llm_obs_ API key.
 * Body: { label: "my-app" }
 */
app.post('/api/proxy/keys', async (req, res) => {
  try {
    const { label } = req.body;
    const key = await generateProxyKey(label);
    res.json({ success: true, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate key.' });
  }
});

/**
 * GET /api/proxy/logs
 * Returns recent proxy usage logs.
 */
app.get('/api/proxy/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await all(
      `SELECT pl.*, pak.label as key_label
       FROM proxy_logs pl
       LEFT JOIN proxy_api_keys pak ON pl.key_id = pak.id
       ORDER BY pl.created_at DESC
       LIMIT ?`,
      [limit]
    );
    const summary = await get(
      `SELECT COUNT(*) as total_requests,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
              COALESCE(AVG(latency_ms), 0) as avg_latency_ms
       FROM proxy_logs`,
      []
    );
    res.json({ summary, logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

/**
 * GET /api/proxy/keys
 * List all proxy API keys.
 */
app.get('/api/proxy/keys', async (req, res) => {
  try {
    const keys = await all(
      `SELECT id, label, key_value, is_active, created_at FROM proxy_api_keys ORDER BY created_at DESC`,
      []
    );
    res.json({ keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch keys.' });
  }
});
