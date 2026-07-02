/**
 * Pryme 2.0 — Production Backend v3 (Fixed)
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const app  = express();
const PORT = process.env.PORT || 3000;

// Model definition
const MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"];

app.use(cors());
app.post('/api/stripe/webhook', express.raw({type:'application/json'}), handleStripeWebhook);
app.use(express.json({limit:'25mb'}));

// ── Serve frontend ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const p = path.join(__dirname,'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('index.html not found');
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 1 — GEMINI AI
// ══════════════════════════════════════════════════════════════════════════
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const SYSTEM_INSTRUCTION = "You are Pryme 2.0, the ultimate unified AI Agent created exclusively by Pryme X AI Company (Prymexai@gmail.com). ABSOLUTE IDENTITY RULE: You are PRYME 2.0. Never identify as Gemini, Claude, GPT, or any other AI brand. COMPANY FACTS: CEO/Founder: Yasiru Nethshan Gunasinghe. Specializations: AI, Cyber Security (Red/Purple Teaming, VAPT), UI/UX Design, Workflow Automation. LANGUAGE: Reply in the EXACT language the user writes in. DESIGN REQUESTS: Always include a Color System with explicit hex codes.";

function getSafetySettings() {
  return [
    {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
    {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
    {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
    {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
  ];
}

async function callGemini({message, images=[], history=[], maxTokens=8192, useSearch=true}) {
  if(!GEMINI_KEY) return {error:'GEMINI_API_KEY not set', status:500};

  for(const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        safetySettings: getSafetySettings(),
        generationConfig: { temperature: 0.9, maxOutputTokens: maxTokens, topP: 0.95, topK: 40 },
        ...(useSearch ? {tools: [{googleSearch: {}}]} : {}),
      });

      const userParts = images.map(img => ({
        inlineData: { mimeType: img.mime_type || 'image/jpeg', data: img.data }
      }));
      userParts.push({text: message});

      const chatHistory = history.slice(-12).map(turn => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{text: turn.content}],
      }));

      const chat = model.startChat({history: chatHistory});
      const result = await chat.sendMessage(userParts);
      const resp = result.response;

      return {text: resp.text(), chunks: resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [], model: modelName, usedSearch: true};
    } catch(err) {
      console.error(`[Gemini] ${modelName} error:`, err.message);
      continue;
    }
  }
  return {error:'All Gemini models failed', status:500};
}

// ... (ඉතිරි කේත කොටස් එලෙසම තබා ගන්න)

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// Stripe Webhook Handler - මෙය ඔබගේ server.js හි අනිවාර්යයෙන් තිබිය යුතුය
async function handleStripeWebhook(req, res) {
  if(!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.json({received:true});
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) { return res.status(400).json({error:e.message}); }
  
  if(event.type === 'checkout.session.completed') {
    const s = event.data.object;
    console.log(`[Stripe] ✅ Payment — ${s.customer_email}`);
  }
  res.json({received:true});
}
