import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeBook } from "./src/chunker.js";
import { ocrImages } from "./src/ocr.js";
import { bookToMarkdown, themeToMarkdown, chunkToMarkdown } from "./src/markdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* --------------------- 资产存储（内存，供 API / 复用） --------------------- */
const STORE = new Map();
const STORE_MAX = 50;

function saveBook(book) {
  const id = randomUUID().slice(0, 8);
  book.id = id;
  book.createdAt = new Date().toISOString();
  STORE.set(id, book);
  // 容量上限：淘汰最早的
  if (STORE.size > STORE_MAX) {
    const oldest = STORE.keys().next().value;
    STORE.delete(oldest);
  }
  return book;
}

function findChunk(book, chunkId) {
  for (const t of book.themes || []) {
    for (const c of t.chunks || []) if (c.id === chunkId) return c;
  }
  return null;
}

function requireKey(res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "服务器未配置 ANTHROPIC_API_KEY 环境变量" });
    return false;
  }
  return true;
}

/* ------------------------------- 基础 ------------------------------- */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    stored: STORE.size,
  });
});

/* ------------------------- 分析（同步 JSON 返回） ------------------------- */
// 供编程调用 / Skill / MCP 网关使用：一次返回最终结果。
app.post("/api/analyze", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { title, text, pageBreaks } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "缺少 text 字段" });
    }
    const result = await analyzeBook({ title, text, pageBreaks }, (p) =>
      console.log("[progress]", JSON.stringify(p))
    );
    res.json(saveBook(result));
  } catch (err) {
    console.error("[analyze error]", err);
    res.status(500).json({ error: err.message || "分析失败" });
  }
});

/* ----------------------- 分析（SSE 实时进度流） ----------------------- */
// 供 Web 前端使用：边分析边推送真实进度。
app.post("/api/analyze/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    send("error", { error: "服务器未配置 ANTHROPIC_API_KEY 环境变量" });
    return res.end();
  }
  try {
    const { title, text, pageBreaks } = req.body || {};
    if (!text || typeof text !== "string") {
      send("error", { error: "缺少 text 字段" });
      return res.end();
    }
    const result = await analyzeBook({ title, text, pageBreaks }, (p) =>
      send("progress", p)
    );
    saveBook(result);
    send("result", result);
    send("done", { id: result.id });
    res.end();
  } catch (err) {
    console.error("[analyze stream error]", err);
    send("error", { error: err.message || "分析失败" });
    res.end();
  }
});

/* ------------------------------- OCR ------------------------------- */
// 接收前端渲染好的页面图片（base64），逐页转写为文本。
app.post("/api/ocr", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { images } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "缺少 images 数组" });
    }
    const pages = await ocrImages(images, (p) =>
      console.log("[ocr]", JSON.stringify(p))
    );
    res.json({ pages });
  } catch (err) {
    console.error("[ocr error]", err);
    res.status(500).json({ error: err.message || "OCR 失败" });
  }
});

/* --------------------------- 资产读取 API --------------------------- */
// 让分析结果可被直接调用，无需手动下载。
app.get("/api/books", (req, res) => {
  res.json(
    [...STORE.values()].map((b) => ({
      id: b.id,
      title: b.title,
      createdAt: b.createdAt,
      stats: b.stats,
    }))
  );
});

app.get("/api/books/:id", (req, res) => {
  const book = STORE.get(req.params.id);
  if (!book) return res.status(404).json({ error: "未找到该分析结果" });
  res.json(book);
});

app.get("/api/books/:id/markdown", (req, res) => {
  const book = STORE.get(req.params.id);
  if (!book) return res.status(404).json({ error: "未找到该分析结果" });
  res.type("text/markdown; charset=utf-8").send(bookToMarkdown(book));
});

app.get("/api/books/:id/themes/:themeId/markdown", (req, res) => {
  const book = STORE.get(req.params.id);
  if (!book) return res.status(404).json({ error: "未找到该分析结果" });
  const theme = (book.themes || []).find((t) => t.id === req.params.themeId);
  if (!theme) return res.status(404).json({ error: "未找到该主题" });
  res.type("text/markdown; charset=utf-8").send(themeToMarkdown(theme));
});

app.get("/api/books/:id/chunks/:chunkId", (req, res) => {
  const book = STORE.get(req.params.id);
  if (!book) return res.status(404).json({ error: "未找到该分析结果" });
  const chunk = findChunk(book, req.params.chunkId);
  if (!chunk) return res.status(404).json({ error: "未找到该内容块" });
  const fmt = req.query.format;
  if (fmt === "markdown") {
    return res.type("text/markdown; charset=utf-8").send(chunkToMarkdown(chunk, "#"));
  }
  if (fmt === "text") {
    return res.type("text/plain; charset=utf-8").send(chunk.content || "");
  }
  res.json(chunk);
});

/* ----------------------- 直接由 book 对象导出 MD ----------------------- */
app.post("/api/export", (req, res) => {
  const { book, scope } = req.body || {};
  if (!book) return res.status(400).json({ error: "缺少 book 字段" });
  let md;
  if (scope === "theme") md = themeToMarkdown(book);
  else if (scope === "chunk") md = chunkToMarkdown(book, "#");
  else md = bookToMarkdown(book);
  res.type("text/markdown; charset=utf-8").send(md);
});

app.listen(PORT, () => {
  console.log(`📚 bookadtool 已启动： http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  未检测到 ANTHROPIC_API_KEY，请在 .env 中配置后再使用分析功能。");
  }
});
