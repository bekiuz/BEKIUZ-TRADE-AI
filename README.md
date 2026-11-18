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

## Cloudflare setup

1. Install Node.js 22.18 or newer.
2. Install Cloudflare CLI with: npm install --global cf@latest
3. Sign in with: cf auth login
4. From this repository, run: cf dev
5. Deploy with: cf deploy

The Worker needs a Workers AI binding named AI. The configuration declares this binding. The selected model is @cf/google/gemma-4-26b-a4b-it.

Add these as Worker secrets in Cloudflare. Never commit their values:
- TELEGRAM_BOT_TOKEN — token created with Telegram BotFather.
- TELEGRAM_WEBHOOK_SECRET — a random string used to validate Telegram webhook requests.

After deployment, set the Telegram webhook using this URL pattern:
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER_HOST>/telegram/webhook&secret_token=<YOUR_WEBHOOK_SECRET>

Replace the placeholders locally. Do not post the resulting URL publicly because it contains your bot token.

## Routes

- GET / — web chart lab
- GET /api/health — checks whether the AI binding and Telegram bot secret are configured
- POST /api/analyze — accepts multipart form data with an image field, plus market, symbol, and timeframe fields
- POST /telegram/webhook — Telegram webhook endpoint

## Cost and privacy

Workers AI inference can consume paid usage. Check current Cloudflare account pricing and usage before inviting users. Do not assume the beta is cost-free or unlimited.

Images are processed in the request and are not intentionally persisted by this app. Cloudflare and Telegram still process requests under their own service terms.

## Beta

The first version is intended for a limited 14-day educational beta. It has no subscriptions or payment flow.
