# BEKIUZ TRADE AI

BEKIUZ TRADE AI is an educational chart-reading lab for Forex, Crypto, and Gold screenshots. It explains visible market structure, candlestick patterns, indicators, and support/resistance concepts.

## Safety boundary

This is an educational tool, not a trading-signal service. It does not tell users to buy or sell, predict future prices, calculate trade entries, connect to brokers, or place orders. Never use its explanations as financial instructions.

## Included in version 0.1

- Uzbek-first web interface for uploading a chart screenshot.
- Educational image analysis using Cloudflare Workers AI and Gemma 4 Vision.
- Telegram bot webhook: send a chart image and receive the same educational explanation.
- Screenshot processing in memory; the app does not intentionally save uploaded images.
- Health endpoint at /api/health.
- Basic Node.js smoke checks.

## Live preview

The current Cloudflare Worker deployment is available at:

- Web app: https://bekiuz-trade-ai.bekiuz67.workers.dev
- Health endpoint: https://bekiuz-trade-ai.bekiuz67.workers.dev/api/health

The Worker and its Workers AI binding have been uploaded to the Cloudflare account. The Telegram webhook is not active until its two secrets are configured and BotFather webhook registration is completed.

## Local setup

Requirements: Node.js 22.18 or newer.

\`\`\`powershell
npm install
npm test
npm run dev
\`\`\`

The project uses Cloudflare's \`cf\` CLI package and \`cloudflare.config.ts\`. Sign in when prompted with \`cf auth login\`.

To deploy after testing:

\`\`\`powershell
npm run deploy
\`\`\`

The Worker uses a Workers AI binding named \`AI\`, configured in \`cloudflare.config.ts\`. The selected model is \`@cf/google/gemma-4-26b-a4b-it\`.

## Telegram setup

Add these as Worker secrets in Cloudflare. Never commit their values:
- \`TELEGRAM_BOT_TOKEN\` — token created with Telegram BotFather.
- \`TELEGRAM_WEBHOOK_SECRET\` — a random string used to validate Telegram webhook requests.

After deployment, set the Telegram webhook using this URL pattern:

\`\`\`text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER_HOST>/telegram/webhook&secret_token=<YOUR_WEBHOOK_SECRET>
\`\`\`

Replace the placeholders locally. Do not post the resulting URL publicly because it contains your bot token.

## Routes

- \`GET /\` — web chart lab
- \`GET /api/health\` — reports whether AI and Telegram settings are present
- \`POST /api/analyze\` — accepts multipart form data with an \`image\` field, plus market, symbol, and timeframe fields
- \`POST /telegram/webhook\` — Telegram webhook endpoint

## Cost, beta, and privacy

Workers AI inference can incur usage charges, including during local development. Check your Cloudflare account's current pricing and usage before testing many images or inviting other users. The two-week beta label in the page is informational; automatic expiry and subscriptions are not implemented.

The app processes uploaded screenshots in request memory and does not intentionally persist them. Cloudflare and Telegram still process requests under their own service terms. Before opening the analyzer to the public, configure and test rate limiting to reduce unexpected inference usage.

## Beta

The first version has no subscriptions or payment flow. It is an educational beta, not a source of financial advice.
