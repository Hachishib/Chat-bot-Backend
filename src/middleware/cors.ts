import { Request, Response, NextFunction } from "express";

// ✅ EDIT: Add your frontend's deployed Vercel URL here
const allowedOrigins = [
  "http://localhost:5173",           // Vite local dev default
  "http://localhost:4173",           // Vite preview
  process.env.FRONTEND_URL ?? "",    // Set this in your .env
];

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin ?? "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}