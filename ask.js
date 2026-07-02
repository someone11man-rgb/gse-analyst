// GSE Analyst — smart Q&A endpoint
//
// This is what makes the "Ask" box actually intelligent instead of a
// keyword matcher. Every question gets answered by Claude, grounded in
// two sources of truth:
//
//   1. This app's own daily-tracked signals (data/latest.json, macro.json)
//      — authoritative for the specific stocks this app follows.
//   2. Live web search — for everything else: other listed companies,
//      historical events, dividend history, listing rules, broker info,
//      or anything not in the local dataset.
//
// The system prompt explicitly forbids inventing numbers or events —
// every claim has to trace back to local data or a search result.
//
// Requires ANTHROPIC_API_KEY as an environment variable on your hosting
// platform (e.g. Vercel project settings). Never exposed to the browser.

import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadLocalData() {
  const dataDir = path.join(process.cwd(), "data");
  const readJSON = async (file, fallback) => {
    try { return JSON.parse(await readFile(path.join(dataDir, file), "utf-8")); }
    catch { return fallback; }
  };
  const [latest, macro, performance] = await Promise.all([
    readJSON("latest.json", { signals: [] }),
    readJSON("macro.json", {}),
    readJSON("performance.json", [])
  ]);
  return { latest, macro, performance };
}

function buildSystemPrompt(localData) {
  const acc = localData.performance.slice(-10);
  const accSummary = acc.length
    ? `Self-graded accuracy over last ${acc.length} graded day(s): ${Math.round(100 * acc.reduce((s,r)=>s+r.correct,0) / acc.reduce((s,r)=>s+r.sampleSize,0))}% (${acc.reduce((s,r)=>s+r.sampleSize,0)} calls graded).`
    : "No graded track record yet.";

  return `You are GSE Analyst, an expert assistant on the Ghana Stock Exchange (GSE).

You have two sources of truth — never invent a third:

1. LOCAL TRACKED DATA — this app's own daily signals, authoritative for these specific tickers as of ${localData.latest.date || "unknown"}:
${JSON.stringify(localData.latest.signals || [], null, 2)}

MACRO CONTEXT: ${JSON.stringify(localData.macro || {}, null, 2)}
TRACK RECORD: ${accSummary}

2. WEB SEARCH — use it for anything outside the local data: other GSE-listed companies, historical prices or events, dividend history, IPOs, listing/delisting rules, brokerage firms, regulatory (SEC Ghana) matters, or broader Ghanaian/global macro context.

RULES:
- Ground every claim in local data or a search result. If you're not sure, say so plainly — never guess a number, date, or event.
- When you state a figure, briefly say where it's from ("per today's tracked data" / "per [source]").
- You are not a licensed financial advisor. Explain data and reasoning; do not tell the user what they personally should do. End with a brief reminder this isn't financial advice.
- Be concise and well-organized — short paragraphs or a short list, not a wall of text.
- If a question is entirely unrelated to Ghana's stock market or investing, politely redirect.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "Missing 'question' in request body" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY. Add it in your hosting platform's project settings." });
    return;
  }

  const localData = await loadLocalData();
  const systemPrompt = buildSystemPrompt(localData);

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: question.slice(0, 2000) }],
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      res.status(502).json({ error: `Analysis engine returned ${anthropicRes.status}`, detail });
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");
    const usedWebSearch = (data.content || []).some(b => b.type === "server_tool_use" || b.type === "web_search_tool_result");

    res.status(200).json({
      answer: text || "I couldn't generate an answer just now — try rephrasing.",
      usedWebSearch
    });
  } catch (err) {
    console.error("ask.js error:", err);
    res.status(500).json({ error: "Failed to reach the analysis engine." });
  }
}
