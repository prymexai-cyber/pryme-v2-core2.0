# Pryme 2.0 — Production Backend v2

## Quick Start (Local)
```bash
npm install
node server.js
# Open http://localhost:3000
```

## Feature Setup Guide

### 1. Email Automation (Nodemailer)
1. Gmail account → Google Account → Security → 2-Step Verification (enable it)
2. Same page → App passwords → Select app: Mail → Generate
3. Copy the 16-character password
4. Add to `.env`:
   ```
   EMAIL_USER=Prymexai@gmail.com
   EMAIL_PASS=abcd efgh ijkl mnop
   ```

### 2. Stripe Payments
1. stripe.com → create account
2. Dashboard → Products → Add product → "Pro Plan" → $20/month (recurring)
3. Same → "Platinum Plan" → $100/month
4. Developers → API Keys → copy Secret key
5. Add to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_PRO_PRICE=price_xxx
   STRIPE_PLAT_PRICE=price_xxx
   BASE_URL=https://your-app.onrender.com
   ```
6. After deploy → Webhooks → Add endpoint → `https://your-app.onrender.com/api/stripe/webhook`
   → Events: checkout.session.completed

### 3. Image Generation (Stability AI — Free)
1. platform.stability.ai → create account → API Keys
2. Add to `.env`:
   ```
   STABILITY_API_KEY=sk-xxx
   ```
3. Free tier: 10 images/day. In chat, type: `generate image of [description]`

### 4. WhatsApp Bot (Twilio)
1. twilio.com → create account → get free number
2. Messaging → Try it out → WhatsApp → Sandbox
3. Set webhook: `https://your-app.onrender.com/api/whatsapp/webhook`
4. Add to `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxx
   TWILIO_AUTH_TOKEN=xxx
   TWILIO_PHONE=+14155238886
   ```

### 5. Mobile App (CapacitorJS) — iOS & Android
CapacitorJS wraps your existing web app into a native iOS/Android app.
No code changes needed to index.html.

```bash
# Prerequisites: Node.js, Android Studio (for Android), Xcode (for iOS, Mac only)

# Step 1: Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# Step 2: Initialize (run once)
npx cap init "Pryme X AI" "com.prymex.ai" --web-dir "."

# Step 3: Add platforms
npx cap add android
npx cap add ios  # Mac only

# Step 4: Update capacitor.config.json
# Set the server URL to your live Render.com URL so the app uses your backend:
# "server": { "url": "https://your-app.onrender.com", "cleartext": false }

# Step 5: Sync and open
npx cap sync
npx cap open android   # Opens Android Studio → Run on emulator/device
npx cap open ios       # Opens Xcode → Run on simulator/device (Mac only)

# For Google Play Store / Apple App Store submission:
# Android: Android Studio → Build → Generate Signed APK/Bundle
# iOS: Xcode → Product → Archive → Distribute App
```

### 6. Deploy to Render.com (free)
1. Push this folder to a PRIVATE GitHub repository (NOT .env — it's in .gitignore)
2. render.com → New → Web Service → connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Environment Variables → add all values from your .env file
6. Deploy → your URL: `https://pryme-x-ai.onrender.com`

## API Reference
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/chat | POST | Main AI chat |
| /api/email/signup | POST | Welcome + notify emails |
| /api/stripe/checkout | POST | Create payment session |
| /api/stripe/webhook | POST | Stripe payment confirmation |
| /api/stripe/verify/:id | GET | Verify payment after redirect |
| /api/image/generate | POST | AI image generation |
| /api/whatsapp/webhook | POST | WhatsApp bot |
| /api/whatsapp/send | POST | Send WhatsApp message |
| /api/figma/verify | POST | Verify Figma token |
| /api/figma/design | POST | Generate Figma plugin script |
| /api/health | GET | Server health check |
