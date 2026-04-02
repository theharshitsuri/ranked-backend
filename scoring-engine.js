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

function calculateScore(scanPromptsWithMentions) {
  if (!scanPromptsWithMentions || scanPromptsWithMentions.length === 0) {
    return { final_score: 0, presence_score: 0, dominance_score: 0, confidence_score: 0, label: 'No Data' };
  }

  let totalWeight = 0;
  let weightedPresenceSum = 0;
  let weightedDominanceSum = 0;
  let weightedRankSum = 0;
  let weightedSentimentSum = 0;
  let mentionedWeight = 0;

  for (const item of scanPromptsWithMentions) {
    const weight = item.weight || 1.0;
    totalWeight += weight;

    if (item.mentioned) {
      weightedPresenceSum += weight;
      mentionedWeight += weight;
      
      // Dominance = Rank #1
      if (item.mention_position === 1) {
        weightedDominanceSum += weight;
      }

      // Rank scoring (1.0 for rank 1, degrading downwards)
      let rankScore = 0;
      if (item.mention_position === 1) rankScore = 1.0;
      else if (item.mention_position === 2) rankScore = 0.7;
      else if (item.mention_position === 3) rankScore = 0.4;
      else if (item.mention_position <= 5) rankScore = 0.2;
      weightedRankSum += (rankScore * weight);

      // Sentiment scoring
      let sentScore = 0.6; // neutral
      if (item.sentiment === 'positive') sentScore = 1.0;
      else if (item.sentiment === 'negative') sentScore = 0.2;
      weightedSentimentSum += (sentScore * weight);
    }
  }

  const presenceRate = weightedPresenceSum / totalWeight;
  const dominanceRate = mentionedWeight > 0 ? (weightedDominanceSum / mentionedWeight) : 0;
  const avgRankScore = totalWeight > 0 ? (weightedRankSum / totalWeight) : 0;
  const avgSentimentScore = mentionedWeight > 0 ? (weightedSentimentSum / mentionedWeight) : 0;

  // Base visibility calculation: 50% presence, 40% rank, 10% sentiment
  let rawScore = 100 * ((0.5 * presenceRate) + (0.4 * avgRankScore) + (0.1 * avgSentimentScore));
  
  // Normalization and floors
  if (rawScore > 0) {
    rawScore = (rawScore * 0.85) + 15;
  }

  const finalScore = Math.min(100, Math.round(rawScore));
  
  // Confidence score based on sample size (prompts)
  const confidenceScore = Math.min(100, Math.round((scanPromptsWithMentions.length / 30) * 100));

  let label = 'Low visibility';
  if (finalScore >= 85) label = 'Dominant';
  else if (finalScore >= 70) label = 'Strong';
  else if (finalScore >= 50) label = 'Moderate';
  else if (finalScore >= 30) label = 'Emerging';
  else label = 'Low';

  return {
    final_score: finalScore,
    presence_score: Math.round(presenceRate * 100),
    dominance_score: Math.round(dominanceRate * 100),
    avg_sentiment_score: Math.round(avgSentimentScore * 100),
    confidence_score: confidenceScore,
    label: label,
    // Backward compatibility aliases
    inclusion_score: Math.round(presenceRate * 100),
    position_score: Math.round(avgRankScore * 100),
    sentiment_score: Math.round(avgSentimentScore * 100),
    metrics: {
      presence_rate: presenceRate,
      dominance_rate: dominanceRate,
      total_prompts: scanPromptsWithMentions.length,
      total_weight: totalWeight
    },
    insight_copy: generateInsight(presenceRate, dominanceRate)
  };
}

function generateInsight(presence, dominance) {
  if (presence >= 0.75 && dominance >= 0.75) return "Absolute category dominance. Recommended consistently at #1.";
  if (presence >= 0.75 && dominance < 0.4) return "Broad visibility, but AI frequently ranks competitors higher.";
  if (presence >= 0.4 && dominance >= 0.5) return "Strong authority when mentioned, but missing from many conversations.";
  if (presence > 0) return "Emerging footprint. Favored in niche queries but lacks general authority.";
  return "Currently invisible to AI discovery in this category.";
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
