import { supabase } from "./supabase";
import { embedText } from "./embeddings";

// ✅ EDIT: Tune these to control retrieval quality
const MATCH_COUNT = 5;       // Number of chunks to return
const MATCH_THRESHOLD = 0.5; // Similarity threshold (0 = anything, 1 = exact)

export type RetrievedChunk = {
  content: string;
  similarity: number;
};

/**
 * Embeds the user's query, then calls the match_documents RPC in Supabase
 * to find the most semantically similar document chunks.
 */
export async function retrieveContext(query: string): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_threshold: MATCH_THRESHOLD,
    match_count: MATCH_COUNT,
  });

  if (error) {
    console.error("Supabase retrieval error:", error.message);
    return [];
  }

  return (data as RetrievedChunk[]) ?? [];
}