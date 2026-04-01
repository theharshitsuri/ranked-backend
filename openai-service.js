const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI(); // Uses OPENAI_API_KEY from .env

async function runPrompt(promptText) {
  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: "user", content: promptText }],
      model: "gpt-4o-mini",
      temperature: 0.1, // low temperature for deterministic extraction
      max_tokens: 500
    });
    
    return {
      success: true,
      text: completion.choices[0].message.content,
      prompt_tokens: completion.usage.prompt_tokens,
      completion_tokens: completion.usage.completion_tokens,
      latency: Date.now() - t0
    };
  } catch (err) {
    console.error('OpenAI Error:', err);
    return { 
      success: false, 
      error: err.message, 
      latency: Date.now() - t0 
    };
  }
}

module.exports = { runPrompt };
