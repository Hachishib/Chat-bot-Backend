import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config(); // Load .env before anything else

import { createClient } from "@supabase/supabase-js";
import { embedText } from "../src/lib/embeddings";

const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_KEY ?? ""
);

// ✅ EDIT: Adjust chunk sizes to balance context quality vs token usage
const CHUNK_SIZE = 400;    // Max characters per chunk
const CHUNK_OVERLAP = 50;  // Characters of overlap between chunks

// ✅ EDIT: Add or remove data files to ingest
const DATA_DIR = path.join(__dirname, "../data");
const DATA_FILES = [
  { file: "school-faq.md",   type: "markdown" },
  { file: "announcement.md", type: "markdown" },
  { file: "fb-posts.json",   type: "json"     },
];

// ── Text Chunking ─────────────────────────────────────────────
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks.filter((c) => c.length > 20); // Drop tiny chunks
}

// ── Data Loaders ──────────────────────────────────────────────
function processMarkdown(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.flatMap((p) => chunkText(p));
}

function processFbPosts(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const posts: Record<string, string>[] = JSON.parse(raw);
  return posts
    .map((p) => p.excerpt ?? p.text ?? p.content ?? "")
    .filter(Boolean)
    .flatMap((t) => chunkText(t));
}

// ── News Ingestion with Duplicate Check ───────────────────────
async function ingestNews() {
  // ── From fb-posts.json ──
  const fbPath = path.join(DATA_DIR, "fb-posts.json");
  if (fs.existsSync(fbPath)) {
    const posts = JSON.parse(fs.readFileSync(fbPath, "utf-8"));
    let inserted = 0;
    let skipped = 0;

    for (const post of posts) {
      // Check if a news item with the same title already exists
      const { data: existing } = await supabase
        .from("news")
        .select("id")
        .eq("title", post.title)
        .maybeSingle();

      if (existing) {
        console.log(`⏭️  Skipping duplicate: "${post.title}"`);
        skipped++;
        continue;
      }

      const { error: insertError } = await supabase.from("news").insert({
        title:     post.title,
        excerpt:   post.excerpt,
        category:  post.category,
        date:      post.date,
        image_url: post.image_url ?? null,
      });

      if (insertError) {
        console.error(`❌ Insert error: ${insertError.message}`);
      } else {
        inserted++;
      }
    }

    console.log(`✅ fb-posts.json — ${inserted} inserted, ${skipped} skipped (duplicates)`);
  }

  // ── From announcement.md ──
  const mdPath = path.join(DATA_DIR, "announcement.md");
  if (fs.existsSync(mdPath)) {
    const raw = fs.readFileSync(mdPath, "utf-8");
    const entries = raw.split(/^---$/m).reduce((acc, _, i, arr) => {
      if (i % 3 === 1) {
        const frontmatter = arr[i];
        const body      = arr[i + 1]?.trim() ?? "";
        const title     = frontmatter.match(/title:\s*"(.+?)"/)?.[1] ?? "";
        const category  = frontmatter.match(/category:\s*"(.+?)"/)?.[1] ?? "Announcements";
        const date      = frontmatter.match(/date:\s*"(.+?)"/)?.[1] ?? "";
        const image_url = frontmatter.match(/image_url:\s*"(.*?)"/)?.[1] ?? null;
        if (title) acc.push({ title, excerpt: body, category, date, image_url });
      }
      return acc;
    }, [] as any[]);

    let inserted = 0;
    let skipped = 0;

    for (const entry of entries) {
      // Check if a news item with the same title already exists
      const { data: existing } = await supabase
        .from("news")
        .select("id")
        .eq("title", entry.title)
        .maybeSingle();

      if (existing) {
        console.log(`⏭️  Skipping duplicate: "${entry.title}"`);
        skipped++;
        continue;
      }

      const { error: insertError } = await supabase.from("news").insert(entry);

      if (insertError) {
        console.error(`❌ Insert error: ${insertError.message}`);
      } else {
        inserted++;
      }
    }

    console.log(`✅ announcement.md — ${inserted} inserted, ${skipped} skipped (duplicates)`);
  }
}

// ── Main RAG Ingestion with Duplicate Check ───────────────────
async function ingest() {
  let allChunks: string[] = [];

  for (const { file, type } of DATA_FILES) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found, skipping: ${file}`);
      continue;
    }

    console.log(`📄 Processing ${file}...`);
    const chunks = type === "json" ? processFbPosts(filePath) : processMarkdown(filePath);
    console.log(`   → ${chunks.length} chunks`);
    allChunks = allChunks.concat(chunks);
  }

  console.log(`\n🔢 Total chunks to embed: ${allChunks.length}`);
  console.log("⏳ Embedding and uploading (this may take a minute)...\n");

  let success = 0;
  let skipped = 0;
  let failed  = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];

    try {
      // Check if this exact chunk already exists in documents table
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("content", chunk)
        .maybeSingle();

      if (existing) {
        skipped++;
        process.stdout.write(`\r⏭️  ${skipped} skipped, ✅ ${success}/${allChunks.length} uploaded`);
        continue;
      }

      // Embed and insert if not a duplicate
      const embedding = await embedText(chunk);

      const { error } = await supabase.from("documents").insert({
        content: chunk,
        embedding,
      });

      if (error) throw error;

      success++;
      process.stdout.write(`\r⏭️  ${skipped} skipped, ✅ ${success}/${allChunks.length} uploaded`);
    } catch (err) {
      failed++;
      console.error(`\n❌ Failed chunk ${i + 1}:`, err);
    }

    // Small delay to avoid hitting Google AI rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n\n🎉 Documents done — ${success} uploaded, ${skipped} skipped, ${failed} failed`);

  console.log("\n📰 Ingesting news entries...");
  await ingestNews();
}

ingest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});