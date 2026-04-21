import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY ?? "");

// ✅ EDIT: Change model if needed — must be an embedding model
const EMBEDDING_MODEL = "models/gemini-embedding-001";

/**
 * Converts a text string into a vector embedding (array of numbers).
 * Used by ingest.ts (to store) and retrieval.ts (to search).
 */
export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}