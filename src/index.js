import { PAGE } from "./page.js";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = [
  "You are BEKIUZ TRADE AI, an educational chart-reading tutor.",
  "Describe only what is visibly present in the screenshot.",
  "Never tell the user to buy, sell, enter, exit, or place an order.",
  "Never forecast future prices or provide profit percentages, entry, stop-loss, take-profit, leverage, or position size.",
  "Do not claim certainty or a win probability. Do not invent symbols, prices, indicators, or timeframes.",
  "If something is unreadable, say so. Reply in Uzbek. Return only valid JSON with keys:",
  "trend (bullish, bearish, sideways, unclear), market_structure (one short sentence),",
  "candlestick_observation (one short sentence), visible_indicators (array),",
  "support_resistance (one short sentence), uncertainties (array), learning_points (array of 1 to 2 short items)."
].join(" ");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }});
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function getModelText(result) {
  if (typeof result?.response === "string") return result.response;
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(p => p.text || "").join("\n");
  if (typeof result?.output_text === "string") return result.output_text;
  throw new Error("AI model javob formatini qaytarmadi.");
}
function parseModelJson(raw) {
  const cleaned = raw.replaceAll(String.fromCharCode(96), "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI javobini o‘qib bo‘lmadi.");
  return JSON.parse(cleaned.slice(start, end + 1));
}
function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : fallback;
}
function normalizeScores(p) {
  const values = [p.buy_score, p.sell_score, p.neutral_score].map(v =>
    Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : 0
  );
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return { buyScore: 0, sellScore: 0, neutralScore: 100 };
  const scaled = values.map(v => Math.round(v * 100 / total));
  scaled[2] += 100 - scaled.reduce((a, b) => a + b, 0);
  return { buyScore: scaled[0], sellScore: scaled[1], neutralScore: scaled[2] };
}
function safeList(value, fallback) {
  if (!Array.isArray(value)) return [fallback];
  const items = value.filter(v => typeof v === "string" && v.trim()).slice(0, 2).map(v => v.trim().slice(0, 180));
  return items.length ? items : [fallback];
}
async function analyzeChart(env, imageDataUrl, details) {
  if (!env.AI) throw new Error("AI binding sozlanmagan.");
  const prompt = "Foydalanuvchi profili: platforma — " + (details.platform || "noma’lum") +
    "; bozor — " + details.market + "; aktiv — " + (details.symbol || "aniqlanmagan") +
    "; timeframe — " + details.timeframe + ". Faqat qisqa o‘quv tahlilini ber.";
  const result = await env.AI.run(MODEL, { messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] }
  ], max_tokens: 650, temperature: 0.1, chat_template_kwargs: { enable_thinking: false } });
  const p = parseModelJson(getModelText(result));
  const trends = ["bullish", "bearish", "sideways", "unclear"];
  return {
    trend: trends.includes(p.trend) ? p.trend : "unclear",
    ...normalizeScores(p),
    scoreReason: safeText(p.score_reason, "Grafikdan yetarli dalil ko‘rinmadi."),
    marketStructure: safeText(p.market_structure, "Aniq ko‘rinmadi."),
    candlestickObservation: safeText(p.candlestick_observation, "Shamlar aniq ko‘rinmadi."),
    visibleIndicators: safeList(p.visible_indicators, "Aniq indikator ko‘rinmadi."),
    supportResistance: safeText(p.support_resistance, "Zonalarni aniqlash uchun rasm yetarli emas."),
    uncertainties: safeList(p.uncertainties, "Qo‘shimcha noaniqlik aniqlanmadi."),
    learningPoints: safeList(p.learning_points, "Tiniqroq grafik yuboring.")
  };
}
async function analyzeRequest(request, env) {
  const form = await request.formData(), image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function") return json({ error: "Grafik rasmini yuboring." }, 400);
  if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) return json({ error: "Faqat PNG, JPG yoki WEBP." }, 415);
  if (image.size > MAX_IMAGE_BYTES) return json({ error: "Rasm 5 MB dan oshmasin." }, 413);
  const market = ["Forex", "Crypto", "Gold"].includes(String(form.get("market"))) ? String(form.get("market")) : "Aniqlanmagan";
  const details = { market, symbol: String(form.get("symbol") || "").slice(0, 24), timeframe: String(form.get("timeframe") || "Aniqlanmagan").slice(0, 20), platform: "" };
  try {
    const data = "data:" + image.type + ";base64," + bytesToBase64(new Uint8Array(await image.arrayBuffer()));
    return json({ ok: true, ...details, analysis: await analyzeChart(env, data, details),
      notice: "BUY/SELL/neytral ballari demo-tahlil bahosi; kalibrlangan ehtimollik yoki real savdo tavsiyasi emas." });
  } catch (e) {
    console.error(JSON.stringify({ event: "chart_analysis_failed", message: String(e) }));
    return json({ error: "AI tahlili bajarilmadi." }, 503);
  }
}
async function secretMatches(expected, received) {
  if (!expected || !received) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(expected)), crypto.subtle.digest("SHA-256", enc.encode(received))]);
  const x = new Uint8Array(a), y = new Uint8Array(b); let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function telegramCall(token, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram API request failed: " + method);
  return result.result;
}
async function sendTelegram(token, chatId, text) {
  return telegramCall(token, "sendMessage", { chat_id: chatId, text });
}
async function getProfile(env, chatId) {
  if (!env.USER_MEMORY) return null;
  try { return await env.USER_MEMORY.get("telegram:" + chatId, "json"); } catch { return null; }
}
async function saveProfile(env, chatId, profile) {
  if (!env.USER_MEMORY) throw new Error("USER_MEMORY KV binding sozlanmagan.");
  await env.USER_MEMORY.put("telegram:" + chatId, JSON.stringify(profile));
}
function firstQuestion() {
  return "Assalomu alaykum! Men BEKIUZ TRADE AI. Siz haqingizda bir necha savol beraman, javoblaringizni eslab qolaman.\n\n1/4. Grafikni qaysi ilovada ko‘rasiz?\nMasalan: TradingView, MT5, Binance yoki boshqa.";
}
function marketQuestion() {
  return "2/4. Qaysi bozorni kuzatasiz?\nForex, Crypto yoki Gold deb yozing.";
}
function symbolQuestion() {
  return "3/4. Ko‘proq qaysi aktivni kuzatasiz?\nMasalan: XAUUSD, EURUSD yoki BTCUSDT.";
}
function timeframeQuestion() {
  return "4/4. Qaysi timeframe sizga kerak?\nMasalan: M5, M15, H1 yoki H4.";
}
function profileSummary(p) {
  return "Profilingiz saqlandi ✓\n\nIlova: " + p.platform + "\nBozor: " + p.market +
    "\nAktiv: " + p.symbol + "\nTimeframe: " + p.timeframe +
    "\n\nEndi grafik screenshotini yuboring. Keyingi safar bu savollarni qayta bermayman.\n/profil — ma’lumotlaringizni ko‘rish\n/sozlash — profilni yangilash";
}
function trendLabel(t) {
  return t === "bullish" ? "Ko‘tarilish" : t === "bearish" ? "Pasayish" : t === "sideways" ? "Yonlama" : "Aniq emas";
}
function shortAnalysis(p, a) {
  return [
    "BEKIUZ TRADE AI — QISQA TAHLIL",
    "Ilova: " + p.platform + " | " + p.market,
    "Aktiv: " + p.symbol + " | " + p.timeframe,
    "Trend: " + trendLabel(a.trend),
    "BUY ssenariy balli: " + a.buyScore + "/100",
    "SELL ssenariy balli: " + a.sellScore + "/100",
    "Neytral/noaniq: " + a.neutralScore + "/100",
    "Baholash sababi: " + a.scoreReason,
    "Struktura: " + a.marketStructure,
    "Shamlar: " + a.candlestickObservation,
    "Indikator: " + a.visibleIndicators.join("; "),
    "Zonalar: " + a.supportResistance,
    "Noaniqlik: " + a.uncertainties.join("; "),
    "O‘rganish: " + a.learningPoints.join("; "),
    "",
    "Eslatma: ballar demo-tahlil bahosi, real ehtimollik yoki foyda kafolati emas. Faqat paper-trading/o‘rganish uchun."
  ].join("\n").slice(0, 3000);
}
async function handleText(token, env, chatId, text) {
  const command = text.split(/\s+/)[0].toLowerCase();
  let p = await getProfile(env, chatId);
  if (command === "/start" || command === "/sozlash") {
    p = p || {};
    p.step = "platform";
    await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, firstQuestion());
    return;
  }
  if (command === "/profil") {
    if (p?.platform && p?.market && p?.symbol && p?.timeframe) await sendTelegram(token, chatId, profileSummary(p));
    else await sendTelegram(token, chatId, "Profil hali to‘liq emas. /start yuboring.");
    return;
  }
  if (!p || !p.step) {
    p = { step: "platform" }; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, firstQuestion()); return;
  }
  if (p.step === "platform") {
    p.platform = text.slice(0, 60); p.step = "market"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, marketQuestion()); return;
  }
  if (p.step === "market") {
    p.market = text.slice(0, 30); p.step = "symbol"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, symbolQuestion()); return;
  }
  if (p.step === "symbol") {
    p.symbol = text.slice(0, 24).toUpperCase(); p.step = "timeframe"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, timeframeQuestion()); return;
  }
  if (p.step === "timeframe") {
    p.timeframe = text.slice(0, 20).toUpperCase(); delete p.step; p.updatedAt = new Date().toISOString();
    await saveProfile(env, chatId, p); await sendTelegram(token, chatId, profileSummary(p)); return;
  }
  await sendTelegram(token, chatId, "Grafik screenshotini yuboring. Profilni yangilash uchun /sozlash.");
}
async function handleTelegram(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response("Telegram secrets missing", { status: 503 });
  if (!await secretMatches(env.TELEGRAM_WEBHOOK_SECRET, request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "")) return new Response("Unauthorized", { status: 401 });
  const update = await request.json(), message = update.message;
  if (!message?.chat?.id) return new Response("ok");
  const token = env.TELEGRAM_BOT_TOKEN, chatId = message.chat.id;
  if (message.text) { await handleText(token, env, chatId, String(message.text).trim()); return new Response("ok"); }
  if (!Array.isArray(message.photo) || !message.photo.length) {
    await sendTelegram(token, chatId, "Grafik screenshotini yuboring. Profilni boshlash yoki yangilash uchun /start.");
    return new Response("ok");
  }
  const profile = await getProfile(env, chatId);
  if (!profile?.platform || !profile?.market || !profile?.symbol || !profile?.timeframe) {
    await sendTelegram(token, chatId, firstQuestion()); await saveProfile(env, chatId, { step: "platform" });
    return new Response("ok");
  }
  try {
    const photo = message.photo[message.photo.length - 1];
    if (photo.file_size > MAX_IMAGE_BYTES) { await sendTelegram(token, chatId, "Rasm 5 MB dan kichik bo‘lsin."); return new Response("ok"); }
    const file = await telegramCall(token, "getFile", { file_id: photo.file_id });
    const res = await fetch("https://api.telegram.org/file/bot" + token + "/" + file.file_path);
    if (!res.ok) throw new Error("Image download failed");
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) { await sendTelegram(token, chatId, "Rasm 5 MB dan kichik bo‘lsin."); return new Response("ok"); }
    const path = String(file.file_path || "").toLowerCase();
    const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const data = "data:" + mime + ";base64," + bytesToBase64(new Uint8Array(buffer));
    const analysis = await analyzeChart(env, data, profile);
    await sendTelegram(token, chatId, shortAnalysis(profile, analysis));
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_chart_failed", message: String(e) }));
    await sendTelegram(token, chatId, "Tahlil bajarilmadi. Tiniqroq screenshot yuborib ko‘ring.");
  }
  return new Response("ok");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }});
    if (request.method === "GET" && url.pathname === "/") return new Response(PAGE, { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin"
    }});
    if (request.method === "GET" && url.pathname === "/api/health") return json({
      ok: true, mode: "educational", aiAvailable: Boolean(env.AI),
      telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET),
      memoryAvailable: Boolean(env.USER_MEMORY)
    });
    if (request.method === "POST" && url.pathname === "/api/analyze") return analyzeRequest(request, env);
    if (request.method === "POST" && url.pathname === "/telegram/webhook") return handleTelegram(request, env);
    return new Response("Not found", { status: 404 });
  }
};
