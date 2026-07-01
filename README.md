# Pryme 2.0 — Secure Backend

API key is stored in `.env` on the server. The browser never sees it.

## Run locally

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Deploy to Render.com (free)

1. Push this folder to a **private** GitHub repository
2. Go to render.com → New → Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add Environment Variables:
   - `GEMINI_API_KEY` = your key
   - `FIGMA_TOKEN` = your Figma token (optional)
6. Deploy → your URL will be `https://your-app.onrender.com`

## Files

- `server.js` — backend proxy (keeps API key safe)
- `index.html` — frontend UI (no API key inside)
- `.env` — secrets (NEVER commit to GitHub — it's in .gitignore)
- `.gitignore` — protects .env from being committed
