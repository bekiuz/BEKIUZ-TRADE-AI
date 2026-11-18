import { PAGE } from "./page.js";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = [
  "You are BEKIUZ TRADE AI, an educational chart-reading tutor.",
  "Describe only what is visibly present in the screenshot.",
  "Never give trading signals or tell the user to buy, sell, enter, exit, open a position, or place an order.",
  "Never forecast future prices or provide entry, stop-loss, take-profit, leverage, or position-size values.",
  "Do not claim certainty or a win probability. Do not invent symbols, prices, indicators, or timeframes.",
  "If something is blurry, cropped, or unreadable, say so clearly.",
  "Reply in Uzbek. Return only valid JSON with these keys:",
  "trend (one of bullish, bearish, sideways, unclear),",
  "market_structure (short educational description),",
  "candlestick_observation (short visible observation),",
  "visible_indicators (array of visible indicator names and what can be read),",
  "support_resistance (educational description of visible zones; do not provide trading levels or instructions),",
  "uncertainties (array of what cannot be confirmed from the image),",
  "learning_points (array of 2 to 4 chart-reading lessons)."
].join(" ");

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function getModelText(result) {
  if (typeof result?.response === "string") return result.response;
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(function (part) { return part.text || ""; }).join("\n");
  }
  if (typeof result?.output_text === "string") return result.output_text;
  throw new Error("AI model javob formatini qaytarmadi.");
}

function parseModelJson(raw) {
  const cleaned = raw.replaceAll(String.fromCharCode(96), "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI javobini o‘qib bo‘lmadi.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function safeText(value, fallback) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, 700) || fallback;
}

function safeList(value, fallback) {
  if (!Array.isArray(value)) return [fallback];
  const items = value
    .filter(function (item) { return typeof item === "string" && item.trim(); })
    .slice(0, 5)
    .map(function (item) { return item.trim().slice(0, 350); });
  return items.length ? items : [fallback];
}

async function analyzeChart(env, imageDataUrl, details) {
  if (!env.AI) throw new Error("Cloudflare Workers AI binding AI sozlanmagan.");

  const userPrompt = "Foydalanuvchi bergan ma’lumotlar: bozor — " + details.market +
    "; aktiv — " + (details.symbol || "ko‘rsatilmagan") +
    "; timeframe — " + details.timeframe +
    ". Screenshotni faqat o‘quv maqsadida izohla. Javob faqat JSON bo‘lsin.";

  const modelResult = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }
    ],
    max_tokens: 900,
    temperature: 0.1,
    chat_template_kwargs: { enable_thinking: false }
  });

  const parsed = parseModelJson(getModelText(modelResult));
  const allowedTrends = ["bullish", "bearish", "sideways", "unclear"];

  return {
    trend: allowedTrends.includes(parsed.trend) ? parsed.trend : "unclear",
    marketStructure: safeText(parsed.market_structure, "Bozor tuzilishini aniq o‘qib bo‘lmadi."),
    candlestickObservation: safeText(parsed.candlestick_observation, "Shamlar aniq ko‘rinmayapti."),
    visibleIndicators: safeList(parsed.visible_indicators, "Aniq indikator ko‘rinmadi."),
    supportResistance: safeText(parsed.support_resistance, "Support/resistance zonalarini aniqlash uchun rasm yetarli emas."),
    uncertainties: safeList(parsed.uncertainties, "Rasmda qo‘shimcha noaniqlik ko‘rinmadi."),
    learningPoints: safeList(parsed.learning_points, "Tiniqroq screenshot bilan qayta tahlil qiling.")
  };
}

async function analyzeRequest(request, env) {
  const form = await request.formData();
  const image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function") {
    return json({ error: "Grafik rasmini yuboring." }, 400);
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
    return json({ error: "Faqat PNG, JPG yoki WEBP rasm qabul qilinadi." }, 415);
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return json({ error: "Rasm hajmi 5 MB dan oshmasligi kerak." }, 413);
  }

  const marketValue = String(form.get("market") || "Forex");
  const market = ["Forex", "Crypto", "Gold"].includes(marketValue) ? marketValue : "Aniqlanmagan";
  const timeframe = String(form.get("timeframe") || "Aniqlanmagan").slice(0, 20);
  const symbol = String(form.get("symbol") || "").slice(0, 24);
  const bytes = new Uint8Array(await image.arrayBuffer());
  const dataUrl = "data:" + image.type + ";base64," + bytesToBase64(bytes);

  try {
    const analysis = await analyzeChart(env, dataUrl, { market: market, timeframe: timeframe, symbol: symbol });
    return json({
      ok: true,
      market: market,
      timeframe: timeframe,
      symbol: symbol,
      analysis: analysis,
      notice: "Bu faqat grafikni o‘qishni o‘rganish uchun. Moliyaviy tavsiya yoki savdo signali emas."
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "chart_analysis_failed", message: error instanceof Error ? error.message : String(error) }));
    return json({ error: "AI tahlili bajarilmadi. AI binding va model sozlamalarini tekshiring." }, 503);
  }
}

async function secretMatches(expected, received) {
  if (!expected || !received) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(received))
  ]);
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function telegramCall(token, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram API request failed.");
  return result.result;
}

async function sendTelegram(token, chatId, text) {
  return telegramCall(token, "sendMessage", { chat_id: chatId, text: text });
}

function trendLabel(value) {
  if (value === "bullish") return "Ko‘tarilish tendensiyasi";
  if (value === "bearish") return "Pasayish tendensiyasi";
  if (value === "sideways") return "Yonlama harakat";
  return "Aniq emas";
}

function telegramSummary(details, analysis) {
  return [
    "BEKIUZ TRADE AI — O‘QUV TAHLILI",
    "",
    "Bozor: " + details.market,
    "Aktiv: " + (details.symbol || "Aniqlanmagan"),
    "Timeframe: " + details.timeframe,
    "Trend: " + trendLabel(analysis.trend),
    "",
    "Bozor tuzilishi: " + analysis.marketStructure,
    "",
    "Shamlar: " + analysis.candlestickObservation,
    "",
    "Ko‘rinayotgan indikatorlar:",
    analysis.visibleIndicators.map(function (item) { return "• " + item; }).join("\n"),
    "",
    "Support / resistance: " + analysis.supportResistance,
    "",
    "Noaniqliklar:",
    analysis.uncertainties.map(function (item) { return "• " + item; }).join("\n"),
    "",
    "O‘rganish uchun:",
    analysis.learningPoints.map(function (item) { return "• " + item; }).join("\n"),
    "",
    "Eslatma: bu faqat ta’limiy grafik izohi. Moliyaviy tavsiya emas."
  ].join("\n").slice(0, 3900);
}

async function handleTelegram(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Telegram secrets are not configured.", { status: 503 });
  }

  const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!await secretMatches(env.TELEGRAM_WEBHOOK_SECRET, suppliedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await request.json();
  const message = update.message;
  if (!message || !message.chat || !message.chat.id) return new Response("ok");

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = message.chat.id;
  const messageText = String(message.text || "").trim();

  if (messageText.startsWith("/start") || messageText.startsWith("/help")) {
    await sendTelegram(token, chatId, [
      "BEKIUZ TRADE AI ga xush kelibsiz!",
      "",
      "Forex, Crypto yoki Gold grafik screenshotini yuboring.",
      "Men trend, shamlar, indikatorlar va support/resistance tushunchalarini o‘quv maqsadida izohlayman.",
      "",
      "Bu bot savdo signali bermaydi va real savdo uchun tavsiya qilmaydi."
    ].join("\n"));
    return new Response("ok");
  }

  if (!Array.isArray(message.photo) || !message.photo.length) {
    await sendTelegram(token, chatId, "Grafik screenshotini rasm ko‘rinishida yuboring. Bot faqat o‘quv tahlilini beradi.");
    return new Response("ok");
  }

  try {
    const photo = message.photo[message.photo.length - 1];
    if (photo.file_size && photo.file_size > MAX_IMAGE_BYTES) {
      await sendTelegram(token, chatId, "Rasm hajmi 5 MB dan kichik bo‘lishi kerak.");
      return new Response("ok");
    }

    const fileInfo = await telegramCall(token, "getFile", { file_id: photo.file_id });
    const fileResponse = await fetch("https://api.telegram.org/file/bot" + token + "/" + fileInfo.file_path);
    if (!fileResponse.ok) throw new Error("Telegram image download failed.");
    const buffer = await fileResponse.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      await sendTelegram(token, chatId, "Rasm hajmi 5 MB dan kichik bo‘lishi kerak.");
      return new Response("ok");
    }

    const path = String(fileInfo.file_path || "").toLowerCase();
    const mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const details = { market: "Aniqlanmagan", symbol: "", timeframe: "Aniqlanmagan" };
    const dataUrl = "data:" + mime + ";base64," + bytesToBase64(new Uint8Array(buffer));
    const analysis = await analyzeChart(env, dataUrl, details);
    await sendTelegram(token, chatId, telegramSummary(details, analysis));
  } catch (error) {
    console.error(JSON.stringify({ event: "telegram_chart_failed", message: error instanceof Error ? error.message : String(error) }));
    await sendTelegram(token, chatId, "Screenshotni tahlil qilishda xatolik yuz berdi. Rasm tiniq va 5 MB dan kichik ekanini tekshirib, qayta yuboring.");
  }

  return new Response("ok");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        mode: "educational",
        aiAvailable: Boolean(env.AI),
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      return analyzeRequest(request, env);
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      return handleTelegram(request, env);
    }

    return new Response("Not found", { status: 404 });
  }
};
