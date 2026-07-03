require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// Current working models July 2026 — gemini-1.5 is SHUT DOWN, use 2.5
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.get('/', (req, res) => {
  const p = path.join(__dirname, 'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('index.html not found');
});

const SYSTEM = `You are Pryme 2.0, the ultimate unified AI Agent created exclusively by Pryme X AI Company (Prymexai@gmail.com).
ABSOLUTE IDENTITY RULE: You are PRYME 2.0. Never say you are Gemini, Claude, GPT, or any other AI — in any language, any phrasing, ever.
CEO/Founder: Yasiru Nethshan Gunasinghe — Sri Lankan tech entrepreneur, Matugama, Sri Lanka. Cybersecurity (Red/Purple Teaming, VAPT), AI, UI/UX, Automation.
Contacts: Prymexai@gmail.com | yasirunethshan001@gmail.com
Profiles: behance.net/yasiru-nethshan | layers.to/prymexairo3y8o8kh7d
LANGUAGE RULE: Always reply in the exact language the user writes in. Singlish/mixed → match exactly.
CAPABILITIES: Coding, debugging, cybersecurity, UI/UX, Figma design, business proposals, translation (30+ languages), math, finance, live web research, automation.
DESIGN RULE: For any design/UI/UX request, always include hex color codes (background, primary, accent).
QUALITY: Complete, untruncated, professional answers every time.`;

function isAuthError(d) {
  const m = (d?.error?.message || '').toLowerCase();
  return m.includes('oauth 2') || m.includes('access_token_type') || m.includes('invalid authentication');
}

async function callGemini({ message, images = [], history = [], maxTokens = 8192, useSearch = true }) {
  if (!GEMINI_KEY) return { error: 'GEMINI_API_KEY not set in .env', status: 500 };

  const userParts = [];
  for (const img of images) userParts.push({ inline_data: { mime_type: img.mime_type || 'image/jpeg', data: img.data } });
  userParts.push({ text: SYSTEM + '\n\nUser: ' + message });

  const contents = [
    ...history.slice(-10).map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
    { role: 'user', parts: userParts }
  ];

  for (let mi = 0; mi < MODELS.length; mi++) {
    const model = MODELS[mi];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    // Try with search, fall back without if AQ-key auth bug fires
    const attempts = useSearch ? [true, false] : [false];
    for (const withSearch of attempts) {
      const body = {
        contents,
        generationConfig: { temperature: 0.9, maxOutputTokens: maxTokens, topP: 0.95 },
        ...(withSearch ? { tools: [{ google_search: {} }] } : {})
      };
      try {
        const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();

        if (!res.ok && withSearch && isAuthError(data)) {
          console.log(`[Gemini] ${model}: search auth bug → retrying without search`);
          continue;
        }
        if (res.status === 429) {
          if (mi < MODELS.length - 1) { break; }
          return { error: 'Rate limit — wait 60s and retry', status: 429 };
        }
        if (!res.ok) {
          const msg = data?.error?.message || `HTTP ${res.status}`;
          console.error(`[Gemini] ${model} error: ${msg}`);
          if (mi < MODELS.length - 1) { break; }
          return { error: msg, status: res.status };
        }

        const text   = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        console.log(`[Gemini] OK ${model} (search:${withSearch}) — ${text.length} chars`);
        return { text, chunks, model };

      } catch (err) {
        console.error(`[Gemini] ${model} network error:`, err.message);
        if (mi < MODELS.length - 1) { break; }
        return { error: err.message, status: 500 };
      }
    }
  }
  return { error: 'All Gemini models failed', status: 500 };
}

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message, images = [], maxOutputTokens = 8192, sessionHistory = [] } = req.body;
  if (!message && !images.length) return res.status(400).json({ error: 'No message' });

  const result = await callGemini({ message, images, history: sessionHistory, maxTokens: maxOutputTokens, useSearch: true });
  if (result.error) return res.status(result.status || 500).json({ error: result.error, message: result.error });

  let text = result.text;
  if (result.chunks?.length) {
    const src = result.chunks.filter(c => c.web?.uri).slice(0, 5)
      .map((c, i) => `${i + 1}. [${c.web.title || c.web.uri}](${c.web.uri})`).join('\n');
    if (src) text += '\n\n---\n**Live sources:**\n' + src;
  }
  res.json({ response: text, model: result.model, engine: 'Pryme 2.0' });
});

// POST /api/image/analyze
app.post('/api/image/analyze', async (req, res) => {
  const { image, prompt = 'Describe this image in detail', mime_type = 'image/jpeg' } = req.body;
  if (!image) return res.status(400).json({ error: 'No image data' });
  const result = await callGemini({ message: prompt, images: [{ data: image, mime_type }], maxTokens: 4096, useSearch: false });
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.json({ analysis: result.text, model: result.model });
});

// POST /api/figma/verify
app.post('/api/figma/verify', async (req, res) => {
  const token = req.body.token || process.env.FIGMA_TOKEN || '';
  if (!token) return res.status(400).json({ valid: false, error: 'No token' });
  try {
    const r = await fetch('https://api.figma.com/v1/me', { headers: { 'X-Figma-Token': token } });
    const d = await r.json();
    if (!r.ok) return res.json({ valid: false, error: d.err || `HTTP ${r.status}` });
    let fileName = null;
    if (req.body.fileId) {
      try {
        const fr = await fetch(`https://api.figma.com/v1/files/${req.body.fileId}`, { headers: { 'X-Figma-Token': token } });
        if (fr.ok) fileName = (await fr.json()).name;
      } catch (_) {}
    }
    res.json({ valid: true, name: d.handle || d.email, email: d.email, fileName });
  } catch (e) { res.status(500).json({ valid: false, error: e.message }); }
});

// POST /api/figma/design
app.post('/api/figma/design', async (req, res) => {
  const { prompt, title = 'Pryme Design' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  const r = await callGemini({
    message: `Create a complete Figma design specification for: "${prompt}". Include hex color codes, typography, frame dimensions, and component measurements.`,
    maxTokens: 8192, useSearch: false
  });
  if (r.error) return res.status(r.status || 500).json({ error: r.error });
  const hexes = (r.text.match(/#[0-9A-Fa-f]{6}/g) || []);
  const h = s => { const x = s.replace('#', ''); return { r: parseInt(x.slice(0,2),16)/255, g: parseInt(x.slice(2,4),16)/255, b: parseInt(x.slice(4,6),16)/255 }; };
  const bg  = hexes[0] ? h(hexes[0]) : { r: .043, g: .051, b: .075 };
  const pri = hexes[1] ? h(hexes[1]) : { r: 1, g: .843, b: 0 };
  const acc = hexes[2] ? h(hexes[2]) : { r: .58, g: .64, b: .72 };
  const st = title.replace(/[`'"\\]/g, '').slice(0, 60);
  const plugin = `// Pryme 2.0 Figma Plugin — ${st}
// Figma: Plugins → Development → New Plugin → paste this → Run
async function main(){
  await figma.loadFontAsync({family:"Inter",style:"Regular"});
  await figma.loadFontAsync({family:"Inter",style:"Bold"});
  const C={bg:{r:${bg.r.toFixed(3)},g:${bg.g.toFixed(3)},b:${bg.b.toFixed(3)}},pri:{r:${pri.r.toFixed(3)},g:${pri.g.toFixed(3)},b:${pri.b.toFixed(3)}},acc:{r:${acc.r.toFixed(3)},g:${acc.g.toFixed(3)},b:${acc.b.toFixed(3)}},w:{r:1,g:1,b:1}};
  const f=c=>([{type:"SOLID",color:c}]);
  const root=figma.createFrame();root.name="${st}";root.resize(1440,900);root.fills=f(C.bg);root.layoutMode="VERTICAL";root.primaryAxisSizingMode="FIXED";root.counterAxisSizingMode="FIXED";
  const hdr=figma.createFrame();hdr.name="Header";hdr.resize(1440,80);hdr.fills=f(C.bg);hdr.layoutMode="HORIZONTAL";hdr.paddingLeft=hdr.paddingRight=64;hdr.counterAxisAlignItems="CENTER";hdr.primaryAxisAlignItems="SPACE_BETWEEN";hdr.primaryAxisSizingMode="FIXED";hdr.counterAxisSizingMode="FIXED";
  const lt=figma.createText();lt.fontName={family:"Inter",style:"Bold"};lt.characters="${st.split(' ')[0]||'PRYME'}";lt.fontSize=22;lt.fills=f(C.pri);hdr.appendChild(lt);root.appendChild(hdr);
  const hero=figma.createFrame();hero.name="Hero";hero.resize(1440,520);hero.fills=f(C.bg);hero.layoutMode="VERTICAL";hero.primaryAxisAlignItems="CENTER";hero.counterAxisAlignItems="CENTER";hero.itemSpacing=20;hero.paddingTop=80;hero.paddingBottom=80;hero.primaryAxisSizingMode="FIXED";hero.counterAxisSizingMode="FIXED";
  const ht=figma.createText();ht.fontName={family:"Inter",style:"Bold"};ht.characters="${st}";ht.fontSize=60;ht.fills=f(C.w);ht.textAlignHorizontal="CENTER";hero.appendChild(ht);
  root.appendChild(hero);figma.currentPage.appendChild(root);figma.viewport.scrollAndZoomIntoView([root]);
  figma.closePlugin("Done: ${st}");
}
main().catch(e=>{figma.closePlugin("Error: "+e.message);});`;
  res.json({ spec: r.text, pluginScript: plugin, colors: { background: hexes[0] || '#0B0D13', primary: hexes[1] || '#FFD700', accent: hexes[2] || '#94A3B8' } });
});

// Email
let mailer = null;
(async () => {
  try {
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const nm = require('nodemailer');
      mailer = nm.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
      await mailer.verify();
      console.log('[Email] Gmail connected');
    }
  } catch (e) { console.log('[Email]', e.message); }
})();
async function mail(to, subj, html) {
  if (!mailer) return { success: false, error: 'Not configured' };
  try { await mailer.sendMail({ from: `"Pryme X AI" <${process.env.EMAIL_USER}>`, to, subject: subj, html }); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}
app.post('/api/email/signup', async (req, res) => {
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const n = name || email.split('@')[0];
  const [w, ntf] = await Promise.all([
    mail(email, 'Welcome to Pryme 2.0', `<div style="font-family:sans-serif;background:#0d0d14;color:#e3e3e3;padding:32px;border-radius:12px"><h2 style="color:#e8d700">Welcome, ${n}!</h2><p>Your Pryme 2.0 account is active (Free Plan — 10 msg/day).</p></div>`),
    mail('Prymexai@gmail.com', 'New Signup', `<div style="font-family:sans-serif;background:#0d0d14;color:#e3e3e3;padding:24px;border-radius:12px"><h3 style="color:#e8d700">New User</h3><p>Name: ${n}</p><p>Email: ${email}</p><p>Time: ${new Date().toLocaleString()}</p></div>`),
  ]);
  res.json({ welcome: w, notify: ntf });
});

// Stripe
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); console.log('[Stripe] Connected'); }
  catch (e) { console.log('[Stripe] Not installed'); }
}
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => res.json({ received: true }));
app.post('/api/stripe/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { plan, email } = req.body;
  const prices = { pro: process.env.STRIPE_PRO_PRICE, platinum: process.env.STRIPE_PLAT_PRICE };
  if (!prices[plan]) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const s = await stripe.checkout.sessions.create({ payment_method_types: ['card'], mode: 'subscription', customer_email: email || undefined, line_items: [{ price: prices[plan], quantity: 1 }], success_url: `${process.env.BASE_URL || 'http://localhost:3000'}?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}`, metadata: { plan } });
    res.json({ url: s.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/stripe/verify/:sid', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Not configured' });
  try { const s = await stripe.checkout.sessions.retrieve(req.params.sid); res.json(s.payment_status === 'paid' ? { valid: true, plan: s.metadata?.plan || 'pro' } : { valid: false }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// WhatsApp
app.post('/api/whatsapp/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  const msg = req.body.Body || '';
  const r = await callGemini({ message: msg, maxTokens: 1024, useSearch: false });
  const reply = (r.text || "I'm Pryme 2.0. How can I help?").replace(/\*\*/g, '*').replace(/#{1,6} /g, '').substring(0, 1500);
  res.set('Content-Type', 'text/xml').send(`<Response><Message>${reply}</Message></Response>`);
});

// Health
app.get('/api/health', (_, res) => res.json({
  status: 'ok', service: 'Pryme 2.0', version: '3.1',
  models: MODELS,
  gemini_key_loaded: !!GEMINI_KEY,
  timestamp: new Date().toISOString()
}));

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Pryme 2.0 — Backend v3.1                  ║
║   Port: ${PORT}                                 ║
║   Models: ${MODELS[0]}         ║
║   Gemini key: ${GEMINI_KEY ? 'LOADED' : 'MISSING — set in .env'}      ║
║   Health: /api/health                       ║
╚══════════════════════════════════════════════╝`);
});
