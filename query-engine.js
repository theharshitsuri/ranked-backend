const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI();

async function generatePrompts(brand, category, competitors = []) {
  try {
    const competitorList = Array.isArray(competitors) ? competitors.join(', ') : competitors;
    
    const systemPrompt = `You are an LLM SEO Specialist. Your goal is to generate 30 diverse discovery prompts that a real user would ask an AI (ChatGPT/Claude/Gemini) to find or compare products in a specific category.
    
    Category: ${category}
    Target Brand: ${brand}
    Competitors: ${competitorList}
    
    IMPORTANT: Do NOT mention the target brand "${brand}" in the prompts. We want to see if the AI mentions it naturally.
    
    Generate 30 prompts distributed across these clusters:
    1. best-of (5 prompts): General "best tools" queries.
    2. alternatives (5 prompts): "Alternatives to {competitor}" queries.
    3. persona (5 prompts): "Best tools for {startup/enterprise/small business}" queries.
    4. use-case (5 prompts): "Tools for {specific task within category}" queries.
    5. budget (5 prompts): "Cheaper/Free/Value for money" queries.
    6. discovery (5 prompts): General exploration of the space.
    
    Return ONLY a JSON array of objects with the following structure:
    [
      { "text": "...", "cluster": "best-of", "weight": 1.5 },
      { "text": "...", "cluster": "alternatives", "weight": 1.0 },
      ...
    ]
    
    Weights: best-of: 1.5, discovery: 1.2, alternatives: 1.0, persona: 0.8, use-case: 0.8, budget: 0.5.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a specialized JSON generator for LLM SEO prompts." },
        { role: "user", content: systemPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    });

    const content = JSON.parse(response.choices[0].message.content);
    // Handle cases where the model wraps the array in a property like "prompts"
    const prompts = Array.isArray(content) ? content : (content.prompts || content.items || []);
    
    if (prompts.length < 5) throw new Error("Generated too few prompts.");
    
    return prompts;
  } catch (err) {
    console.error('Query Engine Error:', err);
    // Fallback static prompts if LLM fails
    return [
      { text: `What are the best ${category} tools in 2026?`, cluster: "best-of", weight: 1.5 },
      { text: `Top 5 alternatives to ${competitors[0] || 'the market leader'} for ${category}`, cluster: "alternatives", weight: 1.0 },
      { text: `Most reliable ${category} platforms for small business`, cluster: "persona", weight: 0.8 },
      { text: `Which ${category} software is easiest to use?`, cluster: "discovery", weight: 1.2 }
    ];
  }
}

module.exports = { generatePrompts };
