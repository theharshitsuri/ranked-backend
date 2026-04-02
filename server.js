const express = require('express');
const cors = require('cors');
const { initDB, get, all, run, isPostgres } = require('./db');
const { runPrompt } = require('./openai-service');
const { extractMentions, calculateScore, detectTopCompetitor } = require('./scoring-engine');
const { generatePrompts } = require('./query-engine');

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

    // Phase 6: Dynamic Enterprise Query Expansion
    const compositePrompts = await generatePrompts(brand, category, competitorRecords.map(c => c.name));
    for (const p of compositePrompts) {
      await run(`
        INSERT INTO scan_prompts (scan_id, resolved_prompt_text, cluster_type, weight) 
        VALUES (?, ?, ?, ?)
      `, [scanId, p.text, p.cluster || 'discovery', p.weight || 1.0]);
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
      SELECT sp.id as sp_id, sp.resolved_prompt_text, sp.cluster_type, sp.weight,
             m.brand_id, m.matched_text, m.mention_position, m.sentiment_label, m.excerpt 
      FROM scan_prompts sp
      LEFT JOIN model_runs mr ON sp.id = mr.scan_prompt_id
      LEFT JOIN mentions m ON mr.id = m.model_run_id
      WHERE sp.scan_id = ?
    `, [scanId]);

    const groupedMap = {};
    for (const row of rawPrompts) {
      if (!groupedMap[row.sp_id]) {
        groupedMap[row.sp_id] = { 
          text: row.resolved_prompt_text, 
          cluster: row.cluster_type,
          weight: row.weight,
          target_mention: null, 
          competitor_mentions: [] 
        };
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
    const resultsMap = {}; // Map of promptId -> result info

    // Parallel Batching (5 at a time)
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
        resultsMap[sp.id] = { weight: sp.weight, cluster: sp.cluster_type, mentioned: false, rank: 99, sentiment: 'neutral', runId };

        if (res.success) {
          const foundMentions = extractMentions(allBrandsToTrack, res.text);
          for (const m of foundMentions) {
            allMentions.push(m);
            if (m.brand_id === brandRecord.id) {
              resultsMap[sp.id].mentioned = true;
              resultsMap[sp.id].rank = m.mention_position;
              resultsMap[sp.id].sentiment = m.sentiment_label;
            }
            await run(`
              INSERT INTO mentions (model_run_id, brand_id, matched_text, mention_position, sentiment_label, confidence, excerpt)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [runId, m.brand_id, m.matched_text, m.mention_position, m.sentiment_label, m.confidence, m.excerpt]);
          }
        }
      }));
    }

    // Enterprise Scoring Logic
    const targetScore = calculateScore(Object.values(resultsMap));
    
    // Competitor relative scores
    const compScores = competitorRecords.map(c => {
       const cResults = scanPrompts.map(sp => {
          const res = resultsMap[sp.id];
          const m = allMentions.find(mStore => mStore.brand_id === c.id && mStore.model_run_id === res.runId); 
          return { weight: sp.weight, mentioned: !!m, mention_position: m ? m.mention_position : 99, sentiment: m ? m.sentiment_label : 'neutral' };
       });
       return { name: c.name, score: calculateScore(cResults) };
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
