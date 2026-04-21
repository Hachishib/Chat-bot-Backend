import express from "express";
import rateLimit from "express-rate-limit";
import { corsMiddleware } from "./middleware/cors";
import chatRouter from "./routes/chat";
import newsRouter from "./routes/news";

const app = express();

// ── Rate Limiter ─────────────────────────────────────────────
// Limits each IP to 30 requests per 15 minutes on /api/chat
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                   // ✅ EDIT: increase if needed
  message: {
    error: "Too many requests. Please wait a few minutes before trying again."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(corsMiddleware);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Apply rate limiter only to chat — not news
app.use("/api/chat", chatLimiter, chatRouter);
app.use("/api/news", newsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;