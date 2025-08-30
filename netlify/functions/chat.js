// Netlify Function: proxies requests to Groq without exposing your key.
// Update ALLOWED_ORIGINS to your GitHub Pages origin.
const ALLOWED_ORIGINS = [
  "https://inkflowstudio.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
  "Content-Type": "application/json"
});

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS(origin) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS(origin), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      return { statusCode: 500, headers: CORS_HEADERS(origin), body: JSON.stringify({ error: "Server not configured" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const model = (body.model || "llama3-70b-8192").toString();
    const clientMessages = Array.isArray(body.messages) ? body.messages : [];

    if (!clientMessages.length) {
      return { statusCode: 400, headers: CORS_HEADERS(origin), body: JSON.stringify({ error: "messages[] is required" }) };
    }

    // Safety: keep a short context and set a neutral system prompt.
    const messages = [
      {
        role: "system",
        content:
          "You are InkTalk, a concise, helpful assistant. Be direct and useful. Follow provider safety and legal policies. Decline harmful or disallowed requests."
      },
      ...clientMessages.slice(-30).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 8000) }))
    ];

    const payload = {
      model,
      messages,
      // tweak as you like:
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
      return { statusCode: groqRes.status, headers: CORS_HEADERS(origin), body: JSON.stringify({ error: "Groq error", details: text }) };
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content || "";
    const finish_reason = data?.choices?.[0]?.finish_reason || null;
    const usage = data?.usage || null;

    return {
      statusCode: 200,
      headers: CORS_HEADERS(origin),
      body: JSON.stringify({ content, finish_reason, usage, raw: data })
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS(origin), body: JSON.stringify({ error: err.message || "Unknown error" }) };
  }
};
