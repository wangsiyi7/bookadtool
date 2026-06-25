import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeBook } from "./src/chunker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "60mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 健康检查 + 是否已配置 API Key
app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// 接收前端提取出的文本，进行语义切分 + 总结
app.post("/api/analyze", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res
        .status(500)
        .json({ error: "服务器未配置 ANTHROPIC_API_KEY 环境变量" });
    }
    const { title, text, pageBreaks } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "缺少 text 字段" });
    }

    const result = await analyzeBook(
      { title, text, pageBreaks },
      (p) => console.log("[progress]", JSON.stringify(p))
    );
    res.json(result);
  } catch (err) {
    console.error("[analyze error]", err);
    res.status(500).json({ error: err.message || "分析失败" });
  }
});

app.listen(PORT, () => {
  console.log(`📚 bookadtool 已启动： http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  未检测到 ANTHROPIC_API_KEY，请在 .env 中配置后再使用分析功能。");
  }
});
