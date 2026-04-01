/**
 * Multi-Brand MVP Mentions Extractor & Enhanced Scorer Phase 5
 */

function extractMentions(trackBrandsArr, responseText) {
  const text = (responseText || "").toLowerCase();
  const sentences = text.split(/[.\n]/).filter(s => s.trim().length > 0);
  
  const results = [];

  for (const brand of trackBrandsArr) {
    const target = brand.name.toLowerCase();
    
    if (!text.includes(target)) continue;

    let position = -1;
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].includes(target)) {
        position = i + 1;
        break;
      }
    }

    let sentiment = 'neutral';
    const badWords = ['bad', 'expensive', 'sucks', 'terrible', 'avoid', 'hard to use', 'clunky', 'lacks', 'poor'];
    const goodWords = ['great', 'excellent', 'best', 'flexible', 'powerful', 'easy', 'top', 'highly recommended'];
    
    const excerpt = sentences[position - 1] || text.substring(Math.max(0, text.indexOf(target) - 50), text.indexOf(target) + 100);
    const excerptLower = excerpt.toLowerCase();
    
    if (badWords.some(w => excerptLower.includes(w))) {
      sentiment = 'negative';
    } else if (goodWords.some(w => excerptLower.includes(w))) {
      sentiment = 'positive';
    }

    results.push({
      brand_id: brand.id,
      brand_name: brand.name,
      matched_text: target,
      mention_position: position > 0 ? position : 99,
      sentiment_label: sentiment,
      confidence: 0.8,
      excerpt: excerpt.length > 200 ? excerpt.substring(0, 197) + "..." : excerpt
    });
  }

  return results;
}

function calculateScore(totalPrompts, mentionsArray) {
  if (totalPrompts === 0) return { final_score: 0, inclusion_score: 0, position_score: 0, sentiment_score: 0, potential_score: 0, label: 'Invisible', presence_label: 'Low', dominance_label: 'Low', insight_copy: 'You are currently invisible to AI in this category.' };
  
  const presenceRate = mentionsArray.length / totalPrompts;
  
  let posWeightSum = 0;
  let sentimentWeightSum = 0;
  let hasTop3 = false;
  let rank1Count = 0;
  
  for (const m of mentionsArray) {
    if (m.mention_position === 1) { posWeightSum += 1.0; hasTop3 = true; rank1Count++; }
    else if (m.mention_position === 2) { posWeightSum += 0.7; hasTop3 = true; }
    else if (m.mention_position === 3) { posWeightSum += 0.4; hasTop3 = true; }
    else if (m.mention_position <= 5) posWeightSum += 0.2;

    if (m.sentiment_label === 'positive') sentimentWeightSum += 1.0;
    else if (m.sentiment_label === 'neutral') sentimentWeightSum += 0.6;
    else if (m.sentiment_label === 'negative') sentimentWeightSum += 0.2;
  }
  
  const dominanceRate = mentionsArray.length > 0 ? (rank1Count / mentionsArray.length) : 0;
  const avgPosScore = totalPrompts > 0 ? (posWeightSum / totalPrompts) : 0;
  const avgSentimentScore = mentionsArray.length > 0 ? (sentimentWeightSum / mentionsArray.length) : 0;
  
  let rawScore = 100 * ((0.5 * presenceRate) + (0.4 * avgPosScore) + (0.1 * avgSentimentScore));
  
  if (rawScore > 0) {
    rawScore = (rawScore * 0.85) + 15;
  }
  
  if (presenceRate >= 0.8) rawScore += 18; // Massive Authority Boost for household names (e.g. Canva)
  else if (presenceRate >= 0.5) rawScore += 10;
  else if (mentionsArray.length > 0) rawScore += 5; 
  
  if (hasTop3) rawScore += 5; 
  
  const finalScore = Math.min(100, Math.round(rawScore));
  
  let label = 'Low visibility';
  if (finalScore >= 86) label = 'Dominant in AI answers';
  else if (finalScore >= 71) label = 'Strong visibility';
  else if (finalScore >= 51) label = 'Growing presence';
  else if (finalScore >= 31) label = 'Emerging';
  else label = 'Low visibility';

  const potentialScore = Math.min(100, finalScore + Math.floor(Math.random() * 15) + (totalPrompts - mentionsArray.length) * 2);

  const getLevel = (rate) => {
    if (rate >= 0.75) return 'High';
    if (rate >= 0.4) return 'Medium';
    return 'Low';
  };
  const presenceLabel = getLevel(presenceRate);
  const dominanceLabel = getLevel(dominanceRate);

  let insightCopy = "";
  if (presenceRate >= 0.75 && dominanceRate < 0.4) {
    insightCopy = "AI recommends you frequently, but distributes top #1 rankings across other tools.";
  } else if (presenceRate >= 0.75 && dominanceRate >= 0.75) {
    insightCopy = "You absolutely dominate this category. AI consistently ranks you #1.";
  } else if (presenceRate >= 0.4 && dominanceRate >= 0.5) {
    insightCopy = "When AI mentions you, it ranks you highly. But you are missing from several discovery conversations.";
  } else if (presenceRate > 0) {
    insightCopy = "You have an emerging footprint, but AI favors established category competitors.";
  } else {
    insightCopy = "You are currently invisible to AI in this category.";
  }

  return {
    raw_score: Math.round(rawScore),
    inclusion_score: Math.round(presenceRate * 100),
    position_score: Math.round(avgPosScore * 100),
    sentiment_score: Math.round(avgSentimentScore * 100),
    final_score: finalScore,
    potential_score: Math.max(potentialScore, finalScore + 4),
    label,
    presence_label: presenceLabel,
    dominance_label: dominanceLabel,
    insight_copy: insightCopy
  };
}

function detectTopCompetitor(responseTextsArray, excludeBrands) {
  const excludeUpper = excludeBrands.map(b => b.toUpperCase());
  const wordsMap = {};
  
  responseTextsArray.forEach(text => {
    const matches = text.match(/\b[A-Z][a-z]+\b/g) || [];
    matches.forEach(w => {
      const wu = w.toUpperCase();
      const ignores = ['I', 'The', 'A', 'An', 'This', 'That', 'Are', 'Is', 'In', 'On', 'Using', 'Best', 'Top', 'For', 'If', 'You', 'Your', 'And', 'Or', 'But', 'With', 'As', 'To', 'Of'];
      if (!ignores.includes(w) && !excludeUpper.includes(wu)) {
        wordsMap[w] = (wordsMap[w] || 0) + 1;
      }
    });
  });

  const sorted = Object.keys(wordsMap).sort((a,b) => wordsMap[b] - wordsMap[a]);
  return sorted.length > 0 ? sorted[0] : null;
}

module.exports = { extractMentions, calculateScore, detectTopCompetitor };
