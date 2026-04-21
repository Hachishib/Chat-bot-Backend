import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// GET /api/news
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("news")
    .select("id, title, excerpt, category, date, image_url")
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "Failed to fetch news." });
    return;
  }

  // Map image_url → imageUrl to match frontend's NewsItem type
  const news = data.map((item) => ({
    id:       String(item.id),
    title:    item.title,
    excerpt:  item.excerpt,
    category: item.category,
    date:     item.date,
    imageUrl: item.image_url ?? undefined,
  }));

  res.json(news);
});

export default router;