/**
 * Pryme 2.0 — Production Backend (v2)
 * ======================================================
 * Features:
 *   1. Secure Gemini AI proxy (key never in browser)
 *   2. Email automation via Nodemailer (Gmail SMTP)
 *   3. Stripe subscription management (Free/Pro/Platinum)
 *   4. Image generation via Stability AI (free tier)
 *   5. WhatsApp bot via Twilio
 *   6. Figma design generator
 *
 * All secrets live in .env — never committed to GitHub.
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const fetch     = require('node-fetch');
const path      = require('path');
const fs        = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── Serve frontend ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const p = path.join(__dirname, 'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('index.html not found');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 1 — GEMINI AI PROXY (unchanged from v1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-flash-8b'];

const SYSTEM_PROMPT =
  'You are Pryme 2.0, the ultimate unified AI Agent created exclusively by Pryme X AI Company (Prymexai@gmail.com). '+
  'ABSOLUTE IDENTITY RULE: You are PRYME 2.0. Never claim to be Gemini, Claude, GPT, or any other AI. '+
  'CEO: Yasiru Nethshan Gunasinghe — Sri Lankan tech entrepreneur based in Matugama, specializing in AI, Cybersecurity (Red/Purple Teaming, VAPT), UI/UX design. '+
  'Contact: Prymexai@gmail.com, yasirunethshan001@gmail.com. '+
  'Profiles: behance.net/yasiru-nethshan | layers.to/prymexairo3y8o8kh7d. '+
  'Reply in the EXACT language the user writes in. Give complete, untruncated answers. '+
  'For design requests, always include a Color System with hex codes. '+
  'You have live Google Search — use it for current events, news, prices, dates.';

function isAuthTokenError(body){
  const m=(body?.error?.message||'').toLowerCase();
  return m.includes('oauth 2 access token')||m.includes('access_token_type_unsupported')||m.includes('invalid authentication credentials');
}

async function callGemini(contents, maxTokens=8192, useSearch=true){
  const body={
    contents,
    generationConfig:{temperature:0.9,maxOutputTokens:maxTokens},
    ...(useSearch?{tools:[{google_search:{}}]}:{})
  };
  for(let mi=0;mi<GEMINI_MODELS.length;mi++){
    const model=GEMINI_MODELS[mi];
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
    try{
      let res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      let data=await res.json();
      if(!res.ok&&useSearch&&isAuthTokenError(data)){
        // Known AQ-key bug with search — retry without search tool
        const b2={...body};delete b2.tools;
        res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b2)});
        data=await res.json();
      }
      if(res.status===429){if(mi<GEMINI_MODELS.length-1)continue;return{error:'rate_limit',status:429};}
      if(!res.ok){if(mi<GEMINI_MODELS.length-1)continue;return{error:data?.error?.message||'Gemini error',status:res.status};}
      const text=data?.candidates?.[0]?.content?.parts?.[0]?.text||'';
      const chunks=data?.candidates?.[0]?.groundingMetadata?.groundingChunks||[];
      return{text,chunks,model};
    }catch(err){if(mi<GEMINI_MODELS.length-1)continue;return{error:err.message,status:500};}
  }
  return{error:'All models failed',status:500};
}

app.post('/api/chat',async(req,res)=>{
  try{
    const{message,images=[],maxOutputTokens=8192,sessionHistory=[]}=req.body;
    if(!message&&!images.length)return res.status(400).json({error:'No message'});
    if(!GEMINI_KEY)return res.status(500).json({error:'GEMINI_API_KEY not set in .env'});
    const parts=[];
    images.forEach(img=>parts.push({inline_data:{mime_type:img.mime_type||'image/jpeg',data:img.data}}));
    parts.push({text:SYSTEM_PROMPT+'\n\nUser: '+message});
    const contents=[...sessionHistory.slice(-10).map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:t.content}]})),{role:'user',parts}];
    const result=await callGemini(contents,maxOutputTokens);
    if(result.error)return res.status(result.status||500).json({error:result.error,message:result.error});
    let responseText=result.text;
    if(result.chunks.length){
      const sources=result.chunks.filter(c=>c.web?.uri).slice(0,5).map((c,i)=>`${i+1}. [${c.web.title||c.web.uri}](${c.web.uri})`).join('\n');
      if(sources)responseText+='\n\n---\n**🔎 Live sources:**\n'+sources;
    }
    return res.json({response:responseText,model:result.model,engine:'Pryme 2.0'});
  }catch(err){return res.status(500).json({error:err.message});}
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 2 — EMAIL AUTOMATION (Nodemailer + Gmail)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Setup: Gmail -> My Account -> Security -> 2-Step Verification -> App passwords
// Create an app password for "Mail" -> use that as EMAIL_PASS (NOT your real password)
// .env: EMAIL_USER=Prymexai@gmail.com  EMAIL_PASS=xxxx xxxx xxxx xxxx

let transporter = null;
(async()=>{
  try{
    const nodemailer=require('nodemailer');
    if(process.env.EMAIL_USER&&process.env.EMAIL_PASS){
      transporter=nodemailer.createTransport({
        service:'gmail',
        auth:{user:process.env.EMAIL_USER,pass:process.env.EMAIL_PASS}
      });
      await transporter.verify();
      console.log('[Email] ✅ Nodemailer connected via Gmail');
    }else{
      console.log('[Email] ⚠️  EMAIL_USER/EMAIL_PASS not set — email features disabled');
    }
  }catch(e){console.log('[Email] ❌ Nodemailer setup failed:',e.message);}
})();

async function sendEmail(to,subject,html){
  if(!transporter){return{success:false,error:'Email not configured — add EMAIL_USER and EMAIL_PASS to .env'};}
  try{
    await transporter.sendMail({from:`"Pryme X AI" <${process.env.EMAIL_USER}>`,to,subject,html});
    return{success:true};
  }catch(e){return{success:false,error:e.message};}
}

// POST /api/email/signup — called when a user signs up
// Sends: welcome email to user + notification to Prymexai@gmail.com
app.post('/api/email/signup',async(req,res)=>{
  const{name,email}=req.body;
  if(!email)return res.status(400).json({error:'Email required'});
  const displayName=name||email.split('@')[0];

  // 1) Welcome email to new user
  const welcomeHtml=`
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#0d0d14;color:#e3e3e3;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 32px;text-align:center;border-bottom:1px solid #2a2a3e">
        <div style="font-size:28px;font-weight:800;background:linear-gradient(90deg,#e8d700,#fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">PRYME X AI</div>
        <p style="color:#8ab4f8;margin:8px 0 0;font-size:13px;letter-spacing:1px">POWERED BY PRYME 2.0</p>
      </div>
      <div style="padding:40px 32px">
        <h2 style="color:#fff;margin:0 0 16px">Welcome, ${displayName}! 🎉</h2>
        <p style="color:#9aa0a6;line-height:1.7">Your Pryme 2.0 account is now active. You're on the <strong style="color:#e8d700">Free Plan</strong> — 10 messages per day to get you started.</p>
        <div style="background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:20px;margin:24px 0">
          <p style="color:#e3e3e3;margin:0 0 8px;font-weight:600">What you can do:</p>
          <ul style="color:#9aa0a6;margin:0;padding-left:20px;line-height:2">
            <li>AI coding, debugging & content creation</li>
            <li>Cybersecurity & DevOps guidance</li>
            <li>Figma design generation with plugin scripts</li>
            <li>Live web search & research</li>
            <li>30+ language support</li>
          </ul>
        </div>
        <p style="color:#9aa0a6">Want more? Upgrade to <strong style="color:#e8d700">Pro</strong> for 500 messages/day or <strong style="color:#c084fc">Platinum</strong> for unlimited.</p>
        <p style="color:#5f6368;font-size:12px;margin-top:32px">Pryme X AI Company · Prymexai@gmail.com · prymexai.com</p>
      </div>
    </div>`;

  // 2) Notification to company
  const notifyHtml=`
    <div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;background:#0d0d14;color:#e3e3e3;border-radius:12px;padding:28px">
      <h3 style="color:#e8d700;margin:0 0 16px">🔔 New Pryme 2.0 Signup</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="color:#9aa0a6;padding:6px 0">Name:</td><td style="color:#fff;padding:6px 0">${displayName}</td></tr>
        <tr><td style="color:#9aa0a6;padding:6px 0">Email:</td><td style="color:#8ab4f8;padding:6px 0">${email}</td></tr>
        <tr><td style="color:#9aa0a6;padding:6px 0">Time:</td><td style="color:#fff;padding:6px 0">${new Date().toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</td></tr>
        <tr><td style="color:#9aa0a6;padding:6px 0">Plan:</td><td style="color:#e8d700;padding:6px 0">Free</td></tr>
      </table>
    </div>`;

  const [welcomeResult,notifyResult]=await Promise.all([
    sendEmail(email,'Welcome to Pryme 2.0 — Your AI Agent is Ready! 🚀',welcomeHtml),
    sendEmail('Prymexai@gmail.com','🔔 New User Signup — Pryme 2.0',notifyHtml),
  ]);

  res.json({
    welcomeEmail:welcomeResult,
    notificationEmail:notifyResult,
    user:{name:displayName,email}
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 3 — STRIPE SUBSCRIPTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Setup:
//   1. stripe.com -> create account
//   2. Dashboard -> Products -> create "Pro" ($20/mo) and "Platinum" ($100/mo)
//   3. Copy Price IDs (price_xxx) into .env
//   4. .env: STRIPE_SECRET_KEY=sk_live_xxx  STRIPE_PRO_PRICE=price_xxx  STRIPE_PLAT_PRICE=price_xxx
//   5. Webhooks: Dashboard -> Webhooks -> Add endpoint -> your-domain.com/api/stripe/webhook
//      -> select: checkout.session.completed, customer.subscription.deleted

let stripe=null;
if(process.env.STRIPE_SECRET_KEY){
  try{stripe=require('stripe')(process.env.STRIPE_SECRET_KEY);console.log('[Stripe] ✅ Stripe connected');}
  catch(e){console.log('[Stripe] ❌ stripe package not installed — run: npm install stripe');}
}else{console.log('[Stripe] ⚠️  STRIPE_SECRET_KEY not set — payment features disabled');}

// POST /api/stripe/checkout — create a checkout session
app.post('/api/stripe/checkout',async(req,res)=>{
  if(!stripe)return res.status(503).json({error:'Stripe not configured — add STRIPE_SECRET_KEY to .env'});
  const{plan,email}=req.body;
  const priceMap={pro:process.env.STRIPE_PRO_PRICE,platinum:process.env.STRIPE_PLAT_PRICE};
  const priceId=priceMap[plan];
  if(!priceId)return res.status(400).json({error:`No price ID for plan "${plan}" — check .env STRIPE_PRO_PRICE / STRIPE_PLAT_PRICE`});
  try{
    const session=await stripe.checkout.sessions.create({
      payment_method_types:['card'],
      mode:'subscription',
      customer_email:email||undefined,
      line_items:[{price:priceId,quantity:1}],
      success_url:`${process.env.BASE_URL||'http://localhost:3000'}?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${process.env.BASE_URL||'http://localhost:3000'}?checkout=cancelled`,
      metadata:{plan},
    });
    res.json({url:session.url,sessionId:session.id});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST /api/stripe/webhook — Stripe calls this after payment
// Must be raw body — add before express.json() in production by moving this route up
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
  if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(200).send('Stripe/webhook not configured');
  let event;
  try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
  catch(e){return res.status(400).json({error:'Webhook signature failed: '+e.message});}
  if(event.type==='checkout.session.completed'){
    const s=event.data.object;
    const plan=s.metadata?.plan||'pro';
    const email=s.customer_email;
    console.log(`[Stripe] ✅ Payment completed — ${email} -> ${plan}`);
    // Send upgrade confirmation email
    if(email){
      const upgradeHtml=`
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#0d0d14;color:#e3e3e3;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 32px;text-align:center">
            <div style="font-size:28px;font-weight:800;background:linear-gradient(90deg,#e8d700,#fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">PRYME X AI</div>
          </div>
          <div style="padding:40px 32px">
            <h2 style="color:#fff">🎊 You're now on ${plan==='platinum'?'<span style="color:#c084fc">Platinum</span>':'<span style="color:#e8d700">Pro</span>'}!</h2>
            <p style="color:#9aa0a6;line-height:1.7">Your account has been upgraded. ${plan==='platinum'?'Enjoy unlimited messages, priority routing, and all advanced features.':'Enjoy 500 messages/day and full-length responses.'}</p>
            <p style="color:#5f6368;font-size:12px;margin-top:32px">Pryme X AI Company · Prymexai@gmail.com</p>
          </div>
        </div>`;
      await sendEmail(email,`🎊 Welcome to Pryme 2.0 ${plan.charAt(0).toUpperCase()+plan.slice(1)}!`,upgradeHtml);
    }
  }
  res.json({received:true});
});

// GET /api/stripe/verify/:sessionId — frontend calls this after redirect to confirm plan
app.get('/api/stripe/verify/:sessionId',async(req,res)=>{
  if(!stripe)return res.status(503).json({error:'Stripe not configured'});
  try{
    const session=await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if(session.payment_status==='paid'){
      return res.json({valid:true,plan:session.metadata?.plan||'pro',email:session.customer_email});
    }
    return res.json({valid:false});
  }catch(e){return res.status(500).json({error:e.message});}
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 4 — ADVANCED AI: IMAGE GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Uses Stability AI free tier (10 credits free per day)
// Setup: platform.stability.ai -> API Keys -> copy key
// .env: STABILITY_API_KEY=sk-xxx

app.post('/api/image/generate',async(req,res)=>{
  const{prompt,width=1024,height=1024}=req.body;
  if(!prompt)return res.status(400).json({error:'Prompt required'});
  if(!process.env.STABILITY_API_KEY){
    return res.status(503).json({
      error:'Image generation not configured',
      setup:'Add STABILITY_API_KEY to .env — get free key at platform.stability.ai'
    });
  }
  try{
    const r=await fetch('https://api.stability.ai/v2beta/stable-image/generate/core',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+process.env.STABILITY_API_KEY,
        'Accept':'image/*'
      },
      body:(()=>{
        const fd=new(require('node-fetch').FormData||global.FormData||class FormData{
          constructor(){this._d=[];}
          append(k,v){this._d.push(`--boundary\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`);}
          get body(){return this._d.join('\r\n')+'\r\n--boundary--';}
          get headers(){return{'Content-Type':'multipart/form-data; boundary=boundary'};}
        })();
        fd.append('prompt',prompt);
        fd.append('output_format','png');
        return fd.body||fd;
      })()
    });
    if(r.ok){
      const imgBuffer=await r.buffer();
      const b64=imgBuffer.toString('base64');
      return res.json({success:true,image:`data:image/png;base64,${b64}`,prompt});
    }
    const err=await r.json().catch(()=>({}));
    return res.status(r.status).json({error:err.message||'Image generation failed'});
  }catch(e){
    return res.status(500).json({error:e.message});
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 5 — WHATSAPP BOT (Twilio)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Setup:
//   1. twilio.com -> create account -> get free number
//   2. Sandbox: twilio.com/console/messaging/whatsapp/sandbox
//   3. Set webhook URL to: your-domain.com/api/whatsapp/webhook
//   4. .env: TWILIO_ACCOUNT_SID=ACxxx  TWILIO_AUTH_TOKEN=xxx  TWILIO_PHONE=whatsapp:+14155238886

app.post('/api/whatsapp/webhook',express.urlencoded({extended:false}),async(req,res)=>{
  const incomingMsg=req.body.Body||'';
  const from=req.body.From||'';
  console.log(`[WhatsApp] Message from ${from}: ${incomingMsg}`);

  if(!process.env.TWILIO_ACCOUNT_SID){
    return res.set('Content-Type','text/xml').send('<Response><Message>WhatsApp integration not configured.</Message></Response>');
  }

  try{
    // Use Gemini to generate the reply
    const result=await callGemini([{role:'user',parts:[{text:SYSTEM_PROMPT+'\n\nUser (WhatsApp): '+incomingMsg}]}],1024,false);
    const reply=result.text
      ?result.text.replace(/\*\*/g,'*').replace(/#{1,6}\s/g,'').substring(0,1500)  // WhatsApp-friendly format
      :'I\'m Pryme 2.0 by Pryme X AI. How can I help you today?';

    res.set('Content-Type','text/xml').send(`<Response><Message>${reply}</Message></Response>`);
  }catch(e){
    res.set('Content-Type','text/xml').send('<Response><Message>Error processing your message. Please try again.</Message></Response>');
  }
});

// POST /api/whatsapp/send — proactively send a WhatsApp message
app.post('/api/whatsapp/send',async(req,res)=>{
  if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN){
    return res.status(503).json({error:'Twilio not configured — add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env'});
  }
  const{to,message}=req.body;
  if(!to||!message)return res.status(400).json({error:'to and message required'});
  try{
    const twilio=require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
    const msg=await twilio.messages.create({
      from:`whatsapp:${process.env.TWILIO_PHONE||'+14155238886'}`,
      to:`whatsapp:${to}`,
      body:message
    });
    res.json({success:true,sid:msg.sid});
  }catch(e){res.status(500).json({error:e.message});}
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 6 — FIGMA (unchanged from v1 — works well already)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/figma/verify',async(req,res)=>{
  const token=req.body.token||process.env.FIGMA_TOKEN||'';
  if(!token)return res.status(400).json({valid:false,error:'No token'});
  try{
    const r=await fetch('https://api.figma.com/v1/me',{headers:{'X-Figma-Token':token}});
    const d=await r.json();
    if(!r.ok)return res.json({valid:false,error:d.err||`HTTP ${r.status}`});
    let fileName=null;
    if(req.body.fileId){
      try{const fr=await fetch(`https://api.figma.com/v1/files/${req.body.fileId}`,{headers:{'X-Figma-Token':token}});
         if(fr.ok)fileName=(await fr.json()).name;}catch(_){}
    }
    res.json({valid:true,name:d.handle||d.email,email:d.email,fileName});
  }catch(e){res.status(500).json({valid:false,error:e.message});}
});

app.post('/api/figma/design',async(req,res)=>{
  const{prompt,title='Pryme 2.0 Design'}=req.body;
  if(!prompt)return res.status(400).json({error:'No prompt'});
  const spec_prompt=`Create a complete Figma design specification for: "${prompt}". Include Color System (hex codes for background, primary, accent, text), Typography table, Frame dimensions, Component list with exact measurements, Auto-layout settings, and CSS design tokens.`;
  const result=await callGemini([{role:'user',parts:[{text:SYSTEM_PROMPT+'\n\n'+spec_prompt}]}],8192,false);
  if(result.error)return res.status(500).json({error:result.error});
  const hexes=(result.text.match(/#[0-9A-Fa-f]{6}/g)||[]);
  const h=h=>{const x=h.replace('#','');return{r:parseInt(x.slice(0,2),16)/255,g:parseInt(x.slice(2,4),16)/255,b:parseInt(x.slice(4,6),16)/255};};
  const bg=hexes[0]?h(hexes[0]):{r:.043,g:.051,b:.075};
  const pri=hexes[1]?h(hexes[1]):{r:1,g:.843,b:0};
  const acc=hexes[2]?h(hexes[2]):{r:.580,g:.643,b:.722};
  const safeTitle=title.replace(/[`'"\\]/g,'').slice(0,60);
  const pluginScript=`// Pryme 2.0 Figma Plugin — ${safeTitle}
// Run: Figma → Plugins → Development → New plugin → paste this → Run
async function main(){
  await figma.loadFontAsync({family:"Inter",style:"Regular"});
  await figma.loadFontAsync({family:"Inter",style:"Bold"});
  const C={bg:{r:${bg.r.toFixed(3)},g:${bg.g.toFixed(3)},b:${bg.b.toFixed(3)}},pri:{r:${pri.r.toFixed(3)},g:${pri.g.toFixed(3)},b:${pri.b.toFixed(3)}},acc:{r:${acc.r.toFixed(3)},g:${acc.g.toFixed(3)},b:${acc.b.toFixed(3)}},w:{r:1,g:1,b:1}};
  const f=s=>([{type:"SOLID",color:s}]);
  const root=figma.createFrame();root.name="${safeTitle}";root.resize(1440,900);root.fills=f(C.bg);root.layoutMode="VERTICAL";root.itemSpacing=0;root.primaryAxisSizingMode="FIXED";root.counterAxisSizingMode="FIXED";
  const h=figma.createFrame();h.name="Header";h.resize(1440,80);h.fills=f(C.bg);h.strokes=f(C.acc);h.strokeWeight=0.5;h.layoutMode="HORIZONTAL";h.paddingLeft=h.paddingRight=64;h.counterAxisAlignItems="CENTER";h.primaryAxisAlignItems="SPACE_BETWEEN";h.primaryAxisSizingMode="FIXED";h.counterAxisSizingMode="FIXED";
  const logo=figma.createText();logo.fontName={family:"Inter",style:"Bold"};logo.characters="${safeTitle.split(' ')[0]||'PRYME'}";logo.fontSize=22;logo.fills=f(C.pri);h.appendChild(logo);root.appendChild(h);
  const hero=figma.createFrame();hero.name="Hero";hero.resize(1440,500);hero.fills=f(C.bg);hero.layoutMode="VERTICAL";hero.primaryAxisAlignItems="CENTER";hero.counterAxisAlignItems="CENTER";hero.itemSpacing=20;hero.paddingTop=80;hero.paddingBottom=80;hero.primaryAxisSizingMode="FIXED";hero.counterAxisSizingMode="FIXED";
  const t=figma.createText();t.fontName={family:"Inter",style:"Bold"};t.characters="${safeTitle}";t.fontSize=60;t.fills=f(C.w);t.textAlignHorizontal="CENTER";hero.appendChild(t);
  const s=figma.createText();s.fontName={family:"Inter",style:"Regular"};s.characters="Generated by Pryme 2.0 AI";s.fontSize=18;s.fills=f(C.acc);s.textAlignHorizontal="CENTER";hero.appendChild(s);
  root.appendChild(hero);
  figma.currentPage.appendChild(root);figma.viewport.scrollAndZoomIntoView([root]);
  figma.closePlugin("✅ Design created: ${safeTitle}");
}
main().catch(e=>{figma.closePlugin("❌ "+e.message);});`;
  res.json({spec:result.text,pluginScript,colors:{background:hexes[0]||'#0B0D13',primary:hexes[1]||'#FFD700',accent:hexes[2]||'#94A3B8'},title:safeTitle});
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HEALTH CHECK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/api/health',(_,res)=>res.json({
  status:'ok',service:'Pryme 2.0 Backend v2',
  features:{
    ai:!!GEMINI_KEY,
    email:!!process.env.EMAIL_USER,
    stripe:!!process.env.STRIPE_SECRET_KEY,
    imageGen:!!process.env.STABILITY_API_KEY,
    whatsapp:!!process.env.TWILIO_ACCOUNT_SID,
    figma:!!(process.env.FIGMA_TOKEN)
  },
  timestamp:new Date().toISOString()
}));

app.listen(PORT,()=>{
  console.log(`
╔══════════════════════════════════════════════════╗
║      Pryme 2.0 — Production Backend v2           ║
╠══════════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}                  ║
║  Health:  http://localhost:${PORT}/api/health       ║
╠══════════════════════════════════════════════════╣
║  ✅ AI Chat:       /api/chat                     ║
║  ✅ Email:         /api/email/signup             ║
║  ✅ Stripe:        /api/stripe/checkout          ║
║  ✅ Image Gen:     /api/image/generate           ║
║  ✅ WhatsApp:      /api/whatsapp/webhook         ║
║  ✅ Figma:         /api/figma/design             ║
╚══════════════════════════════════════════════════╝`);
});
