// Netlify Function: proxies chat requests to Groq safely.
//
// 1) Set your allowed origins below (GitHub Pages origin and local dev).
// 2) On Netlify, add an env var: GROQ_API_KEY = your key from https://console.groq.com
//
// Endpoint: https://YOUR_NETLIFY_SUBDOMAIN.netlify.app/.netlify/functions/chat
//
// Note: This returns JSON { content, finish_reason, usage, raw }.

const ALLOWED_ORIGINS = [
  "https://https://inkflowstudio.github.io", // GitHub Pages origin (no trailing slash, no path)
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

function corsHeaders(origin, event) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": event?.headers?.["access-control-request-headers"] || "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
    "Content-Type": "application/json"
  };
}

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  const headers = corsHeaders(origin, event);

  // Preflight (CORS)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!process.env.GROQ_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server not configured (missing GROQ_API_KEY)" }) };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const model = String(body.model || "llama3-70b-8192");
    const clientMessages = Array.isArray(body.messages) ? body.messages : [];
    if (!clientMessages.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "messages[] is required" }) };
    }

    // System prompt + last 30 messages (truncate each for safety)
    const messages = [
      {
        role: "system",
        content: "You are InkTalk, a concise, helpful assistant. Be direct and useful. Follow provider safety and legal policies."
      },
      ...clientMessages.slice(-30).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 8000)
      }))
    ];

    const payload = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
      stream: false
    };

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await groqRes.text();
    if (!groqRes.ok) {
      // Pass through Groq error to help debug
      return { statusCode: groqRes.status, headers, body: JSON.stringify({ error: "Groq error", details: safeJson(text) }) };
    }

    const data = safeJson(text);
    const content = data?.choices?.[0]?.message?.content || "";
    const finish_reason = data?.choices?.[0]?.finish_reason || null;
    const usage = data?.usage || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content, finish_reason, usage, raw: data })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err?.message || "Unknown error" }) };
  }
};

function safeJson(s) {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}
