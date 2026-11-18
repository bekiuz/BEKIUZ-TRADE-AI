import { PAGE } from "./page.js";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = [
  "You are BEKIUZ TRADE AI, a technical chart-analysis tutor for demo and paper-trading education.",
  "Analyze visible trend, market structure, candles, and readable indicators together. Mention EMA, RSI, MACD, Bollinger Bands or volume only when actually visible; never invent values.",
  "Return integer buy_score, sell_score and neutral_score from 0 to 100, summing to exactly 100. These are heuristic scenario-strength scores, NOT calibrated probabilities, win rates or predictions.",
  "If evidence conflicts or the chart is unclear, increase neutral_score. Explain the evidence briefly.",
  "Never tell the user to place real-money orders. Do not provide live execution instructions, entry/exit prices, stop-loss, take-profit, leverage or position sizing. Keep it simulated and educational.",
  "Do not invent symbols, prices, indicators or timeframes. If unreadable, say so. Reply in Uzbek. Return only valid JSON with keys:",
  "trend (bullish, bearish, sideways, unclear), buy_score (integer), sell_score (integer), neutral_score (integer), score_reason (one short sentence), market_structure (one short sentence),",
  "candlestick_observation (one short sentence), visible_indicators (array), support_resistance (one short sentence), uncertainties (array), learning_points (array of 1 to 2 short items)."
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
function actionKeyboard() { return menuKeyboard(); }
function cancelKeyboard() {
  return { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]] };
}
async function sendTelegram(token, chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramCall(token, "sendMessage", payload);
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

async function issueLinkCode(env, chatId) {
  if (!env.USER_MEMORY) throw new Error("USER_MEMORY KV binding sozlanmagan.");
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
  const code = String(bytes[0] % 1000000).padStart(6, "0");
  await env.USER_MEMORY.put("linkcode:" + code, String(chatId), { expirationTtl: 300 });
  return code;
}
function menuKeyboard() {
  return { inline_keyboard: [
    [{ text: "📊 Grafik tahlili", callback_data: "new_analysis" }, { text: "🤖 AI Ustoz", callback_data: "ask_tutor" }],
    [{ text: "🎓 Academy", callback_data: "academy" }, { text: "📚 Lug‘at", callback_data: "glossary" }],
    [{ text: "🧪 Demo Simulator", callback_data: "simulator" }, { text: "📓 Journal", callback_data: "journal" }],
    [{ text: "📈 Natijalarim", callback_data: "results" }, { text: "🔗 Saytni ulash", callback_data: "link_site" }],
    [{ text: "👤 Profil", callback_data: "show_profile" }, { text: "⚙️ Sozlash", callback_data: "configure" }]
  ] };
}
const LEARNING_CONTENT = {
  academy: "🎓 TRADING ACADEMY\n\n1-dars: Trend nima?\nTrend — narx harakatining umumiy yo‘nalishi. Yuqoriroq cho‘qqi va pastliklar ko‘tarilish tuzilishini, pastroq cho‘qqi va pastliklar pasayish tuzilishini ko‘rsatishi mumkin. Bitta sham asosida xulosa qilmang.\n\nKeyingi dars: support/resistance va timeframe.",
  glossary: "📚 TRADING LUG‘ATI\n\n• Trend — narxning umumiy yo‘nalishi.\n• Support — xaridorlar faollashishi mumkin bo‘lgan kuzatuv zonasi.\n• Resistance — sotuvchilar faollashishi mumkin bo‘lgan kuzatuv zonasi.\n• RSI — momentum indikatori; odatda 0–100 oralig‘ida.\n• EMA — narxlarning eksponensial o‘rtacha qiymati.\n• Volume — savdo hajmi.\n• Timeframe — bitta sham qamrab oladigan vaqt.",
  simulator: "🧪 DEMO SIMULATOR\n\nBu bo‘lim faqat virtual o‘quv mashqlari uchun. Haqiqiy pul, broker yoki real buy/sell buyruqlari ulanmagan.\n\nMashq: grafikda trendni aniqlang. Higher highs + higher lows ko‘rinsa, bu qanday tuzilma?\nA) Ko‘tarilish  B) Pasayish  C) Yonlama\n\nJavobni A, B yoki C deb yuboring.",
  journal: "📓 TRADING JOURNAL\n\nHozircha bu yerda o‘quv mashqlaringiz va grafik tahlillaringiz tarixi ko‘rsatiladi. Har bir natija demo tahlil sifatida qaraladi.",
  results: "📈 NATIJALARIM\n\nO‘quv natijalari va demo mashqlar tarixi keyingi bosqichda umumiy profil bilan ko‘rsatiladi. Hozircha grafik yuborib, tahlilni o‘rganishni boshlang."
};
async function claimSiteLink(request, env) {
  if (!env.USER_MEMORY) return json({ error: "Xotira xizmati mavjud emas." }, 503);
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) return json({ error: "6 xonali kodni kiriting." }, 400);
  const chatId = await env.USER_MEMORY.get("linkcode:" + code);
  if (!chatId) return json({ error: "Kod noto‘g‘ri yoki muddati tugagan. Botdan yangi kod oling." }, 400);
  await env.USER_MEMORY.delete("linkcode:" + code);
  const raw = new Uint8Array(32); crypto.getRandomValues(raw);
  const token = Array.from(raw, b => b.toString(16).padStart(2, "0")).join("");
  await env.USER_MEMORY.put("sitetoken:" + token, chatId, { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ ok: true, token, expiresInDays: 30 });
}
async function siteMe(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !env.USER_MEMORY) return json({ error: "Sayt Telegram bilan ulanmagan." }, 401);
  const chatId = await env.USER_MEMORY.get("sitetoken:" + token);
  if (!chatId) return json({ error: "Ulanish muddati tugagan. Qayta ulang." }, 401);
  const profile = await getProfile(env, chatId);
  return json({ ok: true, profile: profile || null, linked: true });
}


async function tutorReply(env, question) {
  if (!env.AI) return "AI Ustoz hozircha mavjud emas. Keyinroq qayta urinib ko‘ring.";
  const result = await env.AI.run(MODEL, { messages: [
    { role: "system", content: "Sen BEKIUZ TRADE AI o‘quv ustozisan. O‘zbek tilida sodda va aniq tushuntir. Faqat trading tushunchalari, grafik savodxonligi va indikatorlar haqida ta’limiy javob ber. Hech qachon real pulga savdo signali, buy/sell buyrug‘i, kirish/chiqish narxi, stop-loss, take-profit, leverage yoki pozitsiya hajmini bermagin. Javob 900 belgidan oshmasin. Foydalanuvchiga xavfsiz demo/paper-trading o‘rganishni eslat." },
    { role: "user", content: String(question).slice(0, 1000) }
  ], max_tokens: 350, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } });
  return getModelText(result).slice(0, 3000);
}
function tutorKeyboard() {
  return { inline_keyboard: [
    [{ text: "RSI nima?", callback_data: "tutor:rsi" }, { text: "EMA nima?", callback_data: "tutor:ema" }],
    [{ text: "Nega shunday?", callback_data: "tutor:why" }, { text: "Keyingi mavzu", callback_data: "tutor:next" }],
    [{ text: "📚 Lug‘at", callback_data: "glossary" }, { text: "🏠 Menyu", callback_data: "menu" }]
  ] };
}
async function saveJournal(env, chatId, analysis, profile) {
  if (!env.USER_MEMORY) return;
  const key = "journal:" + chatId;
  const items = await env.USER_MEMORY.get(key, "json") || [];
  items.unshift({ at: new Date().toISOString(), symbol: profile.symbol, market: profile.market, timeframe: profile.timeframe, trend: analysis.trend, buy: analysis.buyScore, sell: analysis.sellScore, neutral: analysis.neutralScore });
  await env.USER_MEMORY.put(key, JSON.stringify(items.slice(0, 10)));
}

async function handleText(token, env, chatId, text) {
  const command = text.split(/\s+/)[0].toLowerCase();
  let p = await getProfile(env, chatId);
  if (command === "/link" || command === "/ulash") {
    const code = await issueLinkCode(env, chatId);
    await sendTelegram(token, chatId, "Saytni Telegram profilingizga ulash kodi: " + code + "\\nKod 5 daqiqa amal qiladi. Saytdagi ‘Telegram bilan ulash’ bo‘limiga kiriting.", menuKeyboard()); return;
  }
  if (command === "/menu") { await sendTelegram(token, chatId, "BEKIUZ TRADE AI — asosiy menyu", menuKeyboard()); return; }
  if (["/cancel", "/bekor", "bekor qilish"].includes(command)) {
    if (p) { delete p.step; await saveProfile(env, chatId, p); }
    await sendTelegram(token, chatId, "Jarayon bekor qilindi. Saqlangan profilingiz o‘zgarmadi.", menuKeyboard());
    return;
  }
  if (command === "/start" || command === "/sozlash") {
    p = p || {}; p.step = "platform"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, firstQuestion(), cancelKeyboard()); return;
  }
  if (command === "/profil") {
    if (p?.platform && p?.market && p?.symbol && p?.timeframe) await sendTelegram(token, chatId, profileSummary(p), actionKeyboard());
    else await sendTelegram(token, chatId, "Profil hali to‘liq emas. /start yuboring.", actionKeyboard());
    return;
  }
  if (p?.mode === "quiz") {
    const answer = text.trim().toUpperCase();
    delete p.mode;
    if (["A", "B", "C"].includes(answer)) {
      if (answer === "A") p.quizCorrect = (p.quizCorrect || 0) + 1;
      p.quizAttempts = (p.quizAttempts || 0) + 1;
      await saveProfile(env, chatId, p);
      await sendTelegram(token, chatId, answer === "A" ? "To‘g‘ri! Higher highs va higher lows ko‘tarilish tuzilmasini anglatadi. 🎉" : "Bu safar to‘g‘ri emas. To‘g‘ri javob: A) Ko‘tarilish. Higher highs + higher lows shu tuzilmani ko‘rsatadi.", menuKeyboard());
    } else {
      await sendTelegram(token, chatId, "Javobni A, B yoki C shaklida yuboring.", menuKeyboard());
    }
    return;
  }
  if (p && !p.step) {
    try {
      const answer = await tutorReply(env, text);
      await sendTelegram(token, chatId, answer, tutorKeyboard());
    } catch {
      await sendTelegram(token, chatId, "Savolga javob berishda xatolik. Boshqacha yozib ko‘ring.", menuKeyboard());
    }
    return;
  }
  if (!p || !p.step) {
    p = { step: "platform" }; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, firstQuestion(), cancelKeyboard()); return;
  }
  if (p.step === "platform") {
    p.platform = text.slice(0, 60); p.step = "market"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, marketQuestion(), { inline_keyboard: [
      [{ text: "Forex", callback_data: "market:Forex" }, { text: "Crypto", callback_data: "market:Crypto" }, { text: "Gold", callback_data: "market:Gold" }],
      [{ text: "❌ Bekor qilish", callback_data: "cancel" }]
    ] }); return;
  }
  if (p.step === "market") {
    p.market = text.slice(0, 30); p.step = "symbol"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, symbolQuestion(), cancelKeyboard()); return;
  }
  if (p.step === "symbol") {
    p.symbol = text.slice(0, 24).toUpperCase(); p.step = "timeframe"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, timeframeQuestion(), { inline_keyboard: [
      [{ text: "M5", callback_data: "tf:M5" }, { text: "M15", callback_data: "tf:M15" }, { text: "M30", callback_data: "tf:M30" }],
      [{ text: "H1", callback_data: "tf:H1" }, { text: "H4", callback_data: "tf:H4" }, { text: "D1", callback_data: "tf:D1" }],
      [{ text: "❌ Bekor qilish", callback_data: "cancel" }]
    ] }); return;
  }
  if (p.step === "timeframe") {
    p.timeframe = text.slice(0, 20).toUpperCase(); delete p.step; p.updatedAt = new Date().toISOString();
    await saveProfile(env, chatId, p); await sendTelegram(token, chatId, profileSummary(p), actionKeyboard()); return;
  }
  await sendTelegram(token, chatId, "Grafik screenshotini yuboring yoki pastdagi tugmalardan foydalaning.", actionKeyboard());
}
async function handleCallback(token, env, query) {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;
  const data = String(query.data || "");
  let p = await getProfile(env, chatId);
  await telegramCall(token, "answerCallbackQuery", { callback_query_id: query.id });
  if (data === "menu") { await sendTelegram(token, chatId, "BEKIUZ TRADE AI — asosiy menyu", menuKeyboard()); return; }
  if (data.startsWith("tutor:")) {
    const topic = data.slice(6);
    const question = topic === "rsi" ? "RSI indikatori nima va uni qanday o‘qishni o‘rganish mumkin?" : topic === "ema" ? "EMA nima va u nimani ko‘rsatadi?" : topic === "why" ? "AI grafik tahlilida xulosalar qanday dalillarga tayanadi?" : "Keyingi dars sifatida support va resistance zonalarini tushuntir.";
    try { await sendTelegram(token, chatId, await tutorReply(env, question), tutorKeyboard()); } catch { await sendTelegram(token, chatId, "AI Ustoz vaqtincha javob bera olmadi.", menuKeyboard()); }
    return;
  }
  if (data === "link_site") {
    const code = await issueLinkCode(env, chatId);
    await sendTelegram(token, chatId, "Saytni ulash kodi: " + code + "\n5 daqiqa amal qiladi. Saytdagi ulash oynasiga kiriting.", menuKeyboard()); return;
  }
  if (data === "simulator") { const q = await getProfile(env, chatId) || {}; q.mode = "quiz"; await saveProfile(env, chatId, q); await sendTelegram(token, chatId, LEARNING_CONTENT.simulator, menuKeyboard()); return; }
  if (data === "journal" || data === "results") {
    const items = env.USER_MEMORY ? (await env.USER_MEMORY.get("journal:" + chatId, "json") || []) : [];
    const summary = data === "journal" ? (items.length ? "📓 OXIRGI TAHLILLAR\n" + items.slice(0, 5).map((x, i) => (i + 1) + ". " + x.symbol + " · " + x.market + " · " + x.trend + " · " + x.at.slice(0, 10)).join("\n") : "Hozircha jurnal bo‘sh. Avval grafik yuboring.") : "📈 NATIJALARIM\nSaqlangan demo tahlillar: " + items.length + "\nQuiz to‘g‘ri javoblari: " + ((p && p.quizCorrect) || 0) + " / " + ((p && p.quizAttempts) || 0);
    await sendTelegram(token, chatId, summary, menuKeyboard()); return;
  }
  if (data === "academy" || data === "glossary") { await sendTelegram(token, chatId, LEARNING_CONTENT[data], menuKeyboard()); return; }
  if (data === "ask_tutor") {
    await sendTelegram(token, chatId, "AI Ustozga savolingizni yozing. Masalan: RSI indikatori qanday ishlaydi?", tutorKeyboard()); return;
  }
  if (data === "cancel") {
    if (p) { delete p.step; await saveProfile(env, chatId, p); }
    await sendTelegram(token, chatId, "Jarayon bekor qilindi. Profil ma’lumotlari saqlandi.", actionKeyboard()); return;
  }
  if (data === "new_analysis") {
    if (p?.platform && p?.market && p?.symbol && p?.timeframe) {
      await sendTelegram(token, chatId, "Tayyor. Grafik screenshotini yuboring.", actionKeyboard());
    } else {
      p = { ...(p || {}), step: "platform" }; await saveProfile(env, chatId, p);
      await sendTelegram(token, chatId, firstQuestion(), cancelKeyboard());
    }
    return;
  }
  if (data === "show_profile") {
    await sendTelegram(token, chatId, p?.platform && p?.market && p?.symbol && p?.timeframe ? profileSummary(p) : "Profil hali to‘liq emas. Sozlashni boshlang.", actionKeyboard()); return;
  }
  if (data === "configure") {
    p = p || {}; p.step = "platform"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, firstQuestion(), cancelKeyboard()); return;
  }
  if (data.startsWith("market:") && p?.step === "market") {
    p.market = data.slice(7); p.step = "symbol"; await saveProfile(env, chatId, p);
    await sendTelegram(token, chatId, symbolQuestion(), cancelKeyboard()); return;
  }
  if (data.startsWith("tf:") && p?.step === "timeframe") {
    p.timeframe = data.slice(3); delete p.step; p.updatedAt = new Date().toISOString();
    await saveProfile(env, chatId, p); await sendTelegram(token, chatId, profileSummary(p), actionKeyboard());
  }
}
async function handleTelegram(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response("Telegram secrets missing", { status: 503 });
  if (!await secretMatches(env.TELEGRAM_WEBHOOK_SECRET, request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "")) return new Response("Unauthorized", { status: 401 });
  const update = await request.json();
  const token = env.TELEGRAM_BOT_TOKEN;
  if (update.callback_query) { await handleCallback(token, env, update.callback_query); return new Response("ok"); }
  const message = update.message;
  if (!message?.chat?.id) return new Response("ok");
  const chatId = message.chat.id;
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
    await saveJournal(env, chatId, analysis, profile);
    await sendTelegram(token, chatId, shortAnalysis(profile, analysis), actionKeyboard());
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
    if (request.method === "POST" && url.pathname === "/api/link/claim") return claimSiteLink(request, env);
    if (request.method === "GET" && url.pathname === "/api/me") return siteMe(request, env);
    if (request.method === "POST" && url.pathname === "/telegram/webhook") return handleTelegram(request, env);
    return new Response("Not found", { status: 404 });
  }
};
