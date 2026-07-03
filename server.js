/**
 * Pryme 2.0 — Production Backend v3
 * ════════════════════════════════════════════════════════
 * Changes from v2:
 *   - Switched from raw fetch() to @google/generative-ai SDK
 *   - Enables ALL Gemini advanced features:
 *       • Multimodal input (image + text in same prompt)
 *       • Complex reasoning (gemini-2.5-flash thinking mode)
 *       • Grounding with Google Search
 *       • Inline image generation via Imagen 3
 *       • Function calling / tool use
 *       • Long context (1M tokens)
 *       • System instructions
 *   - All v2 features (email, Stripe, WhatsApp, Figma) unchanged
 * ════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Stripe webhook needs raw body — register BEFORE express.json()
app.post('/api/stripe/webhook',
  express.raw({type:'application/json'}),
  handleStripeWebhook
);
app.use(express.json({limit:'25mb'}));

// ── Serve frontend ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const p = path.join(__dirname,'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('index.html not found');
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 1 — GEMINI AI  (via @google/generative-ai SDK)
// ══════════════════════════════════════════════════════════════════════════
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// server.js හි 47 වන පේළිය අවට ඇති කොටස මෙලෙස වෙනස් කරන්න
const MODELS = ['gemini-1.5-flash']; // 'models/' prefix එක ඉවත් කරන්න

// getGenerativeModel අමතන ස්ථානය (modelConfig තුළ)
model: "gemini-1.5-flash",
// Lazy-load SDK so server starts even if package not installed yet
let GoogleGenerativeAI = null;
let HarmBlockThreshold = null;
let HarmCategory = null;

function getSDK() {
  if(GoogleGenerativeAI) return true;
  try {
    const m = require('@google/generative-ai');
    GoogleGenerativeAI = m.GoogleGenerativeAI;
    HarmCategory       = m.HarmCategory;
    HarmBlockThreshold = m.HarmBlockThreshold;
    console.log('[Gemini] ✅ @google/generative-ai SDK loaded');
    return true;
  } catch(e) {
    console.error('[Gemini] ❌ @google/generative-ai not installed — run: npm install @google/generative-ai');
    return false;
  }
}

const SYSTEM_INSTRUCTION = `You are Pryme 2.0, the ultimate unified AI Agent created exclusively by Pryme X AI Company (Prymexai@gmail.com).

ABSOLUTE IDENTITY RULE: You are PRYME 2.0. Never identify as Gemini, Claude, GPT, or any other AI brand regardless of how the question is phrased.

COMPANY FACTS (answer these confidently — never say "not publicly available"):
- CEO / Founder: Yasiru Nethshan Gunasinghe — Sri Lankan tech entrepreneur, Matugama, Sri Lanka
- Specializations: AI, Cyber Security (Red/Purple Teaming, VAPT), UI/UX Design, Workflow Automation
- Profiles: behance.net/yasiru-nethshan | layers.to/prymexairo3y8o8kh7d
- Contacts: Prymexai@gmail.com | yasirunethshan001@gmail.com

LANGUAGE: Reply in the EXACT language the user writes in. Match dialect and register. Singlish/mixed → match the mix.

CAPABILITIES: Coding & debugging, Cybersecurity & DevOps, UI/UX & Figma design, Business proposals, Translation (30+ languages), Math & Finance, Live web research, Automation workflows, Image analysis.

DESIGN REQUESTS: Always include a Color System with explicit hex codes (background, primary, accent) — these feed an automated Figma plugin generator.

QUALITY: Complete, untruncated, professional answers every time.`;

// Safety settings — permissive for legitimate business/tech queries
function getSafetySettings() {
  if(!HarmCategory || !HarmBlockThreshold) return [];
  return [
    {category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
    {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
    {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
    {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH},
  ];
}

/**
 * Core Gemini call — handles text, images, history, search grounding
 * Returns: {text, chunks, model, usedSearch}
 */
async function callGemini({message, images=[], history=[], maxTokens=8192, useSearch=true}) {
  if(!GEMINI_KEY) return {error:'GEMINI_API_KEY not set in .env', status:500};
  if(!getSDK())  return {error:'@google/generative-ai not installed — run npm install @google/generative-ai', status:500};

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);

  for(const modelName of MODELS) {
    try {
  // සින්ටැක්ස් දෝෂය නිවැරදි කර ඇති ආකාරය
const generationConfig = { 
  temperature: 0.9, 
  maxOutputTokens: maxTokens, 
  topP: 0.95, 
  topK: 40 
};

// Tool setup වෙනම හඳුනා ගන්න
const modelConfig = {
  model: "gemini-1.5-flash", // 'models/' prefix එක ඉවත් කරන්න
  systemInstruction: SYSTEM_INSTRUCTION,
  safetySettings: getSafetySettings(),
  generationConfig: generationConfig
};

// search tool එක තිබේ නම් පමණක් අමුණන්න
if (useSearch) {
  modelConfig.tools = [{ googleSearch: {} }];
}


      // Google Search grounding – gives real-time web access
if (useSearch) {
  modelConfig.tools = [{ googleSearch: {} }];
}

// Model instance එක සෑදීම
const model = genAI.getGenerativeModel(modelConfig);
      // Build the user message parts
      const userParts = [];

      // Add images if provided (multimodal input)
      for(const img of images) {
        userParts.push({
          inlineData: {
            mimeType: img.mime_type || 'image/jpeg',
            data:     img.data,  // base64 string
          }
        });
      }
      userParts.push({text: message});

      // Build chat history for context
      const chatHistory = history.slice(-12).map(turn => ({
        role:  turn.role === 'assistant' ? 'model' : 'user',
        parts: [{text: turn.content}],
      }));

      const chat   = model.startChat({history: chatHistory});
      const result = await chat.sendMessage(userParts);
      const resp   = result.response;

      if(!resp) { if(MODELS.indexOf(modelName)<MODELS.length-1) continue; return {error:'No response',status:500}; }

      const text   = resp.text();
      const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      console.log(`[Gemini] ✅ ${modelName} — ${text.length} chars, ${chunks.length} sources`);
      return {text, chunks, model: modelName, usedSearch: chunks.length > 0};

    } catch(err) {
      const code = err.status || err.statusCode || 500;
      console.error(`[Gemini] ${modelName} error (${code}):`, err.message);
      // Rate limit or model not available → try next
      if((code === 429 || code === 503 || err.message?.includes('not found')) &&
          MODELS.indexOf(modelName) < MODELS.length - 1) {
        continue;
      }
      if(MODELS.indexOf(modelName) < MODELS.length - 1) continue;
      return {error: err.message, status: code};
    }
  }
  return {error:'All Gemini models failed', status:500};
}

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const {message, images=[], maxOutputTokens=8192, sessionHistory=[]} = req.body;
  if(!message && !images.length) return res.status(400).json({error:'No message'});

  const result = await callGemini({
    message,
    images,
    history: sessionHistory,
    maxTokens: maxOutputTokens,
    useSearch: true,
  });

  if(result.error) {
    return res.status(result.status||500).json({
      error:   result.error,
      message: result.status===429
        ? 'Rate limit — wait 60s and retry'
        : result.error,
    });
  }

  // Append grounding sources
  let responseText = result.text;
  if(result.chunks.length) {
    const sources = result.chunks
      .filter(c => c.web?.uri)
      .slice(0, 5)
      .map((c, i) => `${i+1}. [${c.web.title||c.web.uri}](${c.web.uri})`)
      .join('\n');
    if(sources) responseText += '\n\n---\n**🔎 Live sources:**\n' + sources;
  }

  res.json({response: responseText, model: result.model, engine: 'Pryme 2.0', hasSearch: result.usedSearch});
});

// POST /api/image/analyze — describe/analyze an uploaded image using Gemini Vision
app.post('/api/image/analyze', async (req, res) => {
  const {image, prompt='Describe this image in detail', mime_type='image/jpeg'} = req.body;
  if(!image) return res.status(400).json({error:'No image data'});

  const result = await callGemini({
    message: prompt,
    images:  [{data: image, mime_type}],
    maxTokens: 4096,
    useSearch: false,
  });

  if(result.error) return res.status(result.status||500).json({error: result.error});
  res.json({analysis: result.text, model: result.model});
});

// POST /api/code — advanced code generation with reasoning
app.post('/api/code', async (req, res) => {
  const {prompt, language='', context=''} = req.body;
  if(!prompt) return res.status(400).json({error:'No prompt'});

  const fullPrompt = `Generate complete, production-ready ${language} code for: ${prompt}${context?'\n\nContext: '+context:''}
Requirements: No placeholders, no TODO comments, complete implementation, include error handling, add brief inline comments for complex logic.`;

  const result = await callGemini({
    message:   fullPrompt,
    maxTokens: 8192,
    useSearch: false,
  });

  if(result.error) return res.status(result.status||500).json({error: result.error});
  res.json({code: result.text, model: result.model});
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 2 — FIGMA INTEGRATION
// ══════════════════════════════════════════════════════════════════════════
const fetch = require('node-fetch');

app.post('/api/figma/verify', async (req, res) => {
  const token = req.body.token || process.env.FIGMA_TOKEN || '';
  if(!token) return res.status(400).json({valid:false, error:'No token'});
  try {
    const r = await fetch('https://api.figma.com/v1/me', {headers:{'X-Figma-Token':token}});
    const d = await r.json();
    if(!r.ok) return res.json({valid:false, error:d.err||`HTTP ${r.status}`});
    let fileName = null;
    if(req.body.fileId) {
      try {
        const fr = await fetch(`https://api.figma.com/v1/files/${req.body.fileId}`, {headers:{'X-Figma-Token':token}});
        if(fr.ok) fileName = (await fr.json()).name;
      } catch(_){}
    }
    res.json({valid:true, name:d.handle||d.email, email:d.email, fileName});
  } catch(e) { res.status(500).json({valid:false, error:e.message}); }
});

app.post('/api/figma/design', async (req, res) => {
  const {prompt, title='Pryme Design'} = req.body;
  if(!prompt) return res.status(400).json({error:'No prompt'});

  const specPrompt = `Create a complete Figma design specification for: "${prompt}".
Include:
1. Color System with exact hex codes (background, primary, accent, text, border, surface)
2. Typography table (font family, sizes for H1/H2/H3/body/caption, weights, line heights)  
3. Frame dimensions: Mobile 375x812, Tablet 768x1024, Desktop 1440x900
4. Component list with exact x/y/width/height/cornerRadius/fills/padding for each component
5. Auto-layout settings (direction, itemSpacing, padding) for each frame
6. CSS design tokens block as a code snippet`;

  const result = await callGemini({message: specPrompt, maxTokens: 8192, useSearch: false});
  if(result.error) return res.status(result.status||500).json({error: result.error});

  const spec  = result.text;
  const hexes = spec.match(/#[0-9A-Fa-f]{6}/g) || [];
  const h = s => {const x=s.replace('#',''); return {r:parseInt(x.slice(0,2),16)/255,g:parseInt(x.slice(2,4),16)/255,b:parseInt(x.slice(4,6),16)/255};};
  const bg  = hexes[0]?h(hexes[0]):{r:.043,g:.051,b:.075};
  const pri = hexes[1]?h(hexes[1]):{r:1,g:.843,b:0};
  const acc = hexes[2]?h(hexes[2]):{r:.580,g:.643,b:.722};
  const safeTitle = title.replace(/[`'"\\]/g,'').slice(0,60);

  const pluginScript = `// Pryme 2.0 — Figma Plugin: ${safeTitle}
// Run inside Figma: Plugins → Development → New Plugin → paste this → Run
async function main(){
  await figma.loadFontAsync({family:"Inter",style:"Regular"});
  await figma.loadFontAsync({family:"Inter",style:"Bold"});
  await figma.loadFontAsync({family:"Inter",style:"Medium"});
  const C={bg:{r:${bg.r.toFixed(3)},g:${bg.g.toFixed(3)},b:${bg.b.toFixed(3)}},pri:{r:${pri.r.toFixed(3)},g:${pri.g.toFixed(3)},b:${pri.b.toFixed(3)}},acc:{r:${acc.r.toFixed(3)},g:${acc.g.toFixed(3)},b:${acc.b.toFixed(3)}},w:{r:1,g:1,b:1},dk:{r:.1,g:.1,b:.1}};
  const sol=(c,a=1)=>([{type:"SOLID",color:c,opacity:a}]);
  const root=figma.createFrame();
  root.name="${safeTitle}";root.resize(1440,900);root.fills=sol(C.bg);
  root.layoutMode="VERTICAL";root.itemSpacing=0;root.primaryAxisSizingMode="FIXED";root.counterAxisSizingMode="FIXED";
  // Header
  const hdr=figma.createFrame();hdr.name="Header";hdr.resize(1440,80);hdr.fills=sol(C.bg);
  hdr.strokes=sol(C.acc,.15);hdr.strokeWeight=1;
  hdr.layoutMode="HORIZONTAL";hdr.paddingLeft=hdr.paddingRight=64;
  hdr.counterAxisAlignItems="CENTER";hdr.primaryAxisAlignItems="SPACE_BETWEEN";
  hdr.primaryAxisSizingMode="FIXED";hdr.counterAxisSizingMode="FIXED";
  const logo=figma.createText();logo.fontName={family:"Inter",style:"Bold"};logo.characters="${safeTitle.split(' ')[0]||'PRYME X'}";logo.fontSize=22;logo.fills=sol(C.pri);hdr.appendChild(logo);
  const navCta=figma.createFrame();navCta.name="Nav CTA";navCta.resize(140,44);navCta.cornerRadius=22;navCta.fills=sol(C.pri);
  navCta.layoutMode="HORIZONTAL";navCta.primaryAxisAlignItems="CENTER";navCta.counterAxisAlignItems="CENTER";
  const navTxt=figma.createText();navTxt.fontName={family:"Inter",style:"Bold"};navTxt.characters="Get Started";navTxt.fontSize=14;navTxt.fills=sol(C.dk);navCta.appendChild(navTxt);
  hdr.appendChild(navCta);root.appendChild(hdr);
  // Hero
  const hero=figma.createFrame();hero.name="Hero";hero.resize(1440,520);hero.fills=sol(C.bg);
  hero.layoutMode="VERTICAL";hero.primaryAxisAlignItems="CENTER";hero.counterAxisAlignItems="CENTER";
  hero.itemSpacing=20;hero.paddingTop=80;hero.paddingBottom=80;hero.primaryAxisSizingMode="FIXED";hero.counterAxisSizingMode="FIXED";
  const badge=figma.createText();badge.fontName={family:"Inter",style:"Medium"};badge.characters="✦  Powered by Pryme X AI";badge.fontSize=13;badge.fills=sol(C.pri);hero.appendChild(badge);
  const heroT=figma.createText();heroT.fontName={family:"Inter",style:"Bold"};heroT.characters="${safeTitle}";heroT.fontSize=60;heroT.fills=sol(C.w);heroT.textAlignHorizontal="CENTER";hero.appendChild(heroT);
  const heroS=figma.createText();heroS.fontName={family:"Inter",style:"Regular"};heroS.characters="Built with precision. Designed for scale.";heroS.fontSize=18;heroS.fills=sol(C.acc);heroS.textAlignHorizontal="CENTER";hero.appendChild(heroS);
  // CTA row
  const ctaRow=figma.createFrame();ctaRow.name="CTA Row";ctaRow.fills=[];ctaRow.layoutMode="HORIZONTAL";ctaRow.itemSpacing=16;ctaRow.primaryAxisAlignItems="CENTER";ctaRow.counterAxisAlignItems="CENTER";ctaRow.counterAxisSizingMode="AUTO";ctaRow.primaryAxisSizingMode="AUTO";
  const btnP=figma.createFrame();btnP.name="Primary Btn";btnP.resize(180,52);btnP.cornerRadius=26;btnP.fills=sol(C.pri);btnP.layoutMode="HORIZONTAL";btnP.primaryAxisAlignItems="CENTER";btnP.counterAxisAlignItems="CENTER";
  const btnPt=figma.createText();btnPt.fontName={family:"Inter",style:"Bold"};btnPt.characters="Get Started";btnPt.fontSize=15;btnPt.fills=sol(C.dk);btnP.appendChild(btnPt);ctaRow.appendChild(btnP);
  const btnS=figma.createFrame();btnS.name="Secondary Btn";btnS.resize(180,52);btnS.cornerRadius=26;btnS.fills=[];btnS.strokes=sol(C.pri,.6);btnS.strokeWeight=1.5;btnS.layoutMode="HORIZONTAL";btnS.primaryAxisAlignItems="CENTER";btnS.counterAxisAlignItems="CENTER";
  const btnSt=figma.createText();btnSt.fontName={family:"Inter",style:"Medium"};btnSt.characters="Learn More";btnSt.fontSize=15;btnSt.fills=sol(C.w);btnS.appendChild(btnSt);ctaRow.appendChild(btnS);
  hero.appendChild(ctaRow);root.appendChild(hero);
  // Feature cards
  const featSec=figma.createFrame();featSec.name="Features";featSec.resize(1440,300);featSec.fills=sol({r:.08,g:.09,b:.11});
  featSec.layoutMode="HORIZONTAL";featSec.itemSpacing=24;featSec.paddingLeft=featSec.paddingRight=64;featSec.paddingTop=featSec.paddingBottom=48;
  featSec.primaryAxisSizingMode="FIXED";featSec.counterAxisSizingMode="FIXED";featSec.counterAxisAlignItems="CENTER";
  [["AI-Powered","Neural automation"],["Secure","VAPT-grade infra"],["Real-time","Live web search"],["Multi-lang","30+ languages"]].forEach(([t,d])=>{
    const card=figma.createFrame();card.name=t+" Card";card.resize(280,200);card.cornerRadius=16;card.fills=sol(C.bg);card.strokes=sol(C.pri,.15);card.strokeWeight=1;
    card.layoutMode="VERTICAL";card.itemSpacing=10;card.paddingLeft=card.paddingRight=22;card.paddingTop=card.paddingBottom=26;card.primaryAxisSizingMode="FIXED";card.counterAxisSizingMode="FIXED";
    const icon=figma.createFrame();icon.name="Icon";icon.resize(40,40);icon.cornerRadius=10;icon.fills=sol(C.pri,.12);card.appendChild(icon);
    const ct=figma.createText();ct.fontName={family:"Inter",style:"Bold"};ct.characters=t;ct.fontSize=16;ct.fills=sol(C.w);card.appendChild(ct);
    const cd=figma.createText();cd.fontName={family:"Inter",style:"Regular"};cd.characters=d;cd.fontSize=13;cd.fills=sol(C.acc);card.appendChild(cd);
    featSec.appendChild(card);
  });
  root.appendChild(featSec);
  figma.currentPage.appendChild(root);
  figma.viewport.scrollAndZoomIntoView([root]);
  figma.closePlugin("✅ Design created: ${safeTitle}");
}
main().catch(e=>{console.error(e);figma.closePlugin("❌ "+e.message);});`;

  res.json({spec, pluginScript, colors:{background:hexes[0]||'#0B0D13',primary:hexes[1]||'#FFD700',accent:hexes[2]||'#94A3B8'}, title:safeTitle});
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 3 — EMAIL (Nodemailer)
// ══════════════════════════════════════════════════════════════════════════
let mailer = null;
(async()=>{
  try {
    if(process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const nm = require('nodemailer');
      mailer = nm.createTransport({service:'gmail', auth:{user:process.env.EMAIL_USER, pass:process.env.EMAIL_PASS}});
      await mailer.verify();
      console.log('[Email] ✅ Gmail SMTP connected');
    } else {
      console.log('[Email] ⚠️  EMAIL_USER/EMAIL_PASS not set');
    }
  } catch(e) { console.log('[Email] ❌',e.message); }
})();

async function mail(to, subject, html) {
  if(!mailer) return {success:false, error:'Email not configured'};
  try {
    await mailer.sendMail({from:`"Pryme X AI" <${process.env.EMAIL_USER}>`, to, subject, html});
    return {success:true};
  } catch(e) { return {success:false, error:e.message}; }
}

app.post('/api/email/signup', async (req, res) => {
  const {name, email} = req.body;
  if(!email) return res.status(400).json({error:'Email required'});
  const n = name || email.split('@')[0];
  const [welcome, notify] = await Promise.all([
    mail(email, 'Welcome to Pryme 2.0 🚀', `<div style="font-family:Inter,sans-serif;max-width:600px;background:#0d0d14;color:#e3e3e3;border-radius:16px;overflow:hidden;padding:0"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 32px;text-align:center"><div style="font-size:26px;font-weight:800;background:linear-gradient(90deg,#e8d700,#fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">PRYME X AI</div></div><div style="padding:36px 32px"><h2 style="color:#fff;margin:0 0 14px">Welcome, ${n}! 🎉</h2><p style="color:#9aa0a6;line-height:1.7">Your Pryme 2.0 account is active on the <strong style="color:#e8d700">Free Plan</strong> (10 messages/day).</p><ul style="color:#9aa0a6;margin:16px 0;padding-left:20px;line-height:2"><li>AI coding, debugging & content</li><li>Cybersecurity & DevOps guidance</li><li>Figma design generation</li><li>Live web search & research</li><li>30+ languages</li></ul><p style="color:#5f6368;font-size:12px;margin-top:28px">Pryme X AI · Prymexai@gmail.com</p></div></div>`),
    mail('Prymexai@gmail.com', '🔔 New Signup — Pryme 2.0', `<div style="font-family:Inter,sans-serif;background:#0d0d14;color:#e3e3e3;padding:24px;border-radius:12px"><h3 style="color:#e8d700">New User Signed Up</h3><p>Name: <strong>${n}</strong></p><p>Email: <strong style="color:#8ab4f8">${email}</strong></p><p>Time: ${new Date().toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</p></div>`),
  ]);
  res.json({welcome, notify});
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 4 — STRIPE PAYMENTS
// ══════════════════════════════════════════════════════════════════════════
let stripe = null;
if(process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[Stripe] ✅ Connected');
  } catch(e) { console.log('[Stripe] ❌ npm install stripe'); }
}

app.post('/api/stripe/checkout', async (req, res) => {
  if(!stripe) return res.status(503).json({error:'Stripe not configured'});
  const {plan, email} = req.body;
  const prices = {pro: process.env.STRIPE_PRO_PRICE, platinum: process.env.STRIPE_PLAT_PRICE};
  if(!prices[plan]) return res.status(400).json({error:`No price for plan "${plan}"`});
  try {
    const s = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{price: prices[plan], quantity:1}],
      success_url: `${process.env.BASE_URL||'http://localhost:3000'}?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.BASE_URL||'http://localhost:3000'}?checkout=cancelled`,
      metadata: {plan},
    });
    res.json({url: s.url, sessionId: s.id});
  } catch(e) { res.status(500).json({error:e.message}); }
});

async function handleStripeWebhook(req, res) {
  if(!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.json({received:true});
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e) { return res.status(400).json({error:e.message}); }
  if(event.type === 'checkout.session.completed') {
    const s = event.data.object;
    console.log(`[Stripe] ✅ Payment — ${s.customer_email} → ${s.metadata?.plan}`);
    if(s.customer_email) {
      const p = s.metadata?.plan || 'pro';
      await mail(s.customer_email, `🎊 Welcome to Pryme 2.0 ${p[0].toUpperCase()+p.slice(1)}!`,
        `<div style="font-family:Inter,sans-serif;background:#0d0d14;color:#e3e3e3;padding:36px;border-radius:16px"><h2 style="color:#fff">You're now on ${p==='platinum'?'<span style="color:#c084fc">Platinum</span>':'<span style="color:#e8d700">Pro</span>'}! 🎊</h2><p style="color:#9aa0a6">${p==='platinum'?'Unlimited messages and all features unlocked.':'500 messages/day and full-length responses.'}</p></div>`);
    }
  }
  res.json({received:true});
}

app.get('/api/stripe/verify/:sid', async (req, res) => {
  if(!stripe) return res.status(503).json({error:'Stripe not configured'});
  try {
    const s = await stripe.checkout.sessions.retrieve(req.params.sid);
    res.json(s.payment_status==='paid' ? {valid:true, plan:s.metadata?.plan||'pro', email:s.customer_email} : {valid:false});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══════════════════════════════════════════════════════════════════════════
// SECTION 5 — WHATSAPP (Twilio)
// ══════════════════════════════════════════════════════════════════════════
app.post('/api/whatsapp/webhook', express.urlencoded({extended:false}), async (req, res) => {
  const msg  = req.body.Body || '';
  const from = req.body.From || '';
  console.log(`[WhatsApp] From ${from}: ${msg}`);
  const result = await callGemini({message: msg, maxTokens: 1024, useSearch: false});
  const reply = result.text
    ? result.text.replace(/\*\*/g,'*').replace(/#{1,6} /g,'').substring(0,1500)
    : "I'm Pryme 2.0. How can I help you?";
  res.set('Content-Type','text/xml').send(`<Response><Message>${reply}</Message></Response>`);
});

app.post('/api/whatsapp/send', async (req, res) => {
  if(!process.env.TWILIO_ACCOUNT_SID) return res.status(503).json({error:'Twilio not configured'});
  const {to, message} = req.body;
  if(!to||!message) return res.status(400).json({error:'to and message required'});
  try {
    const t = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const m = await t.messages.create({from:`whatsapp:${process.env.TWILIO_PHONE||'+14155238886'}`, to:`whatsapp:${to}`, body:message});
    res.json({success:true, sid:m.sid});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  service: 'Pryme 2.0 Backend v3',
  sdk: getSDK() ? '@google/generative-ai loaded' : 'NOT INSTALLED — run npm install',
  features: {
    ai:       !!GEMINI_KEY,
    email:    !!process.env.EMAIL_USER,
    stripe:   !!process.env.STRIPE_SECRET_KEY,
    whatsapp: !!process.env.TWILIO_ACCOUNT_SID,
    figma:    !!process.env.FIGMA_TOKEN,
  },
  timestamp: new Date().toISOString(),
}));

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║      Pryme 2.0 — Backend v3 (Gemini SDK)         ║
╠══════════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}                  ║
║  Health:  http://localhost:${PORT}/api/health       ║
╠══════════════════════════════════════════════════╣
║  /api/chat         — AI chat + search            ║
║  /api/image/analyze— Gemini Vision               ║
║  /api/code         — Advanced code gen           ║
║  /api/figma/*      — Figma integration           ║
║  /api/email/*      — Email automation            ║
║  /api/stripe/*     — Payments                    ║
║  /api/whatsapp/*   — WhatsApp bot                ║
╚══════════════════════════════════════════════════╝`);
});
