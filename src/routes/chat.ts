import { Router, Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retrieveContext } from "../lib/retrieval";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY ?? "");

// ✅ EDIT: Update model name as newer versions release
const GEMINI_MODEL = "models/gemini-3.1-flash-lite-preview";

// ✅ EDIT: How many previous messages to carry for conversation context
const MAX_HISTORY = 6;

// ✅ EDIT: Security limits — adjust if needed
const MAX_MESSAGES = 20;         // Max messages allowed per request
const MAX_MESSAGE_LENGTH = 1000; // Max characters per message

// ✅ EDIT: Customize the AI's persona and behavior
function buildSystemPrompt(contextChunks: string[]): string {
  const contextBlock =
    contextChunks.length > 0
      ? contextChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")
      : "No relevant school information was found for this query.";

  return `You are a helpful AI assistant for SPIST — Southern Philippines Institute of Science and Technology, a private School located in Imus, Cavite, Philippines.

Your job is to answer questions from students, parents, and visitors about SPIST — including enrollment, requirements, school events, announcements, fees, graduation, and general school information.

IMPORTANT RULES:
- Answer ONLY using the context provided below. Do not use outside knowledge.
- If the answer is not found in the context, do not guess. Instead respond with:
  "I don't have that specific information yet. For accurate answers, you may contact SPIST directly:
   📞 0917 132 8042
   📧 spistmarketing@spist.edu.ph
   📘 facebook.com/spistofficial
   🏫 Tia Maria Bldg., E. Aguinaldo Highway, Anabu 2-A, Imus, Cavite (open Mon–Fri, 8AM–5PM)"
- Never make up fees, dates, schedules, or policies that are not in the context.
- Be friendly, concise, and easy to understand.
- Respond in the same language the user writes in. If they write in Filipino, respond in Filipino. If in English, respond in English. If mixed (Taglish), you may respond in Taglish.
- Keep answers brief and direct. Use bullet points when listing multiple items.

--- SCHOOL CONTEXT ---
${contextBlock}
--- END CONTEXT ---`;
}

type Message = {
  role: "user" | "assistant";
  content: string;
};

// POST /api/chat
router.post("/", async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: Message[] };

  // ── Validation ────────────────────────────────────────────

  // Check messages array exists and is not empty
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required." });
    return;
  }

  // Prevent oversized conversation history from hitting Gemini
  if (messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: "Too many messages in history." });
    return;
  }

  // Get the latest user message for retrieval
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!latestUserMessage) {
    res.status(400).json({ error: "No user message found." });
    return;
  }

  // Prevent oversized individual messages from hitting Gemini
  if (latestUserMessage.content.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      error: "Message is too long. Please keep your message under 1000 characters.",
    });
    return;
  }

  // ── RAG + Gemini ──────────────────────────────────────────
  try {
    // Step 1: Retrieve relevant chunks from Supabase
    const chunks = await retrieveContext(latestUserMessage.content);
    const contextTexts = chunks.map((c) => c.content);

    // Step 2: Build system prompt with retrieved context
    const systemPrompt = buildSystemPrompt(contextTexts);

    // Step 3: Prepare conversation history (trim to MAX_HISTORY)
    const history = messages
      .slice(0, -1)        // All except the last message
      .slice(-MAX_HISTORY) // Keep only recent history
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));

    // Step 4: Call Gemini
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(latestUserMessage.content);
    const reply = result.response.text();

    // Step 5: Return response to frontend
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate a response." });
  }
});

export default router;