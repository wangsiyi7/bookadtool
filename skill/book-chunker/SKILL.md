---
name: book-chunker
description: >-
  通过 bookadtool 服务对大型 PDF 书籍进行「基于语义」的智能切分、总结与可视化预处理。
  当用户需要把一本大部头 PDF（含扫描/图片型）转化为「主题 → 内容块」结构、提取每块原文与
  AI 总结、导出 Markdown，或希望把书的内容作为上下文直接喂给模型时使用。优先通过 bookadtool
  的 HTTP API 或 MCP 服务完成处理，而不是在当前会话里手工逐页阅读整本书。
---

# book-chunker

`bookadtool` 是一个把大型 PDF 按**内容语义**（而非章节/页数）切分为
「书籍 → 主题 → 内容块」三层结构的服务：每个内容块都带有标题、关键词、AI 总结和**真实原文**。
本 Skill 指导你**调用该服务**完成预处理，避免在对话里直接吞下整本书。

## 何时使用

- 用户给到一本大 PDF，想要「按内容/主题切分」「做成知识卡片/组块」「逐块总结」。
- 需要把整本书或其中某些主题作为上下文，但不想手动复制粘贴或逐页阅读。
- 用户提到扫描版 / 图片型 PDF，需要先 OCR 再结构化。
- 用户想要导出 Markdown，或在 3D 视图里浏览（Web 端 `http://localhost:3000`）。

## 两种接入方式（任选其一）

### A. MCP（推荐，内容免下载、可直接作为上下文）

若已配置 bookadtool 的 MCP 服务（见仓库 README「MCP 接入」），直接调用其工具：

1. `analyze_pdf({ path })` —— 传入本地 PDF 绝对路径（或 `{ text }` 传纯文本）。
   返回结构化大纲（主题、内容块标题/摘要/页码）并给出 `id`。扫描型 PDF 会自动走视觉 OCR。
2. `book_outline({ id })` —— 取轻量大纲做规划（不含全文，省 token）。
3. `book_markdown({ id })` —— 取整书 Markdown，**直接作为预处理上下文**使用。
4. `chunk_content({ id, chunkId })` —— 仅取某个内容块的原文（如 `t0-c1`）。
5. 资源 `book://{id}` —— 整书 Markdown 资源，可被客户端直接挂载引用。

典型流程：先 `analyze_pdf` → 用 `book_outline` 判断需要哪几块 → 仅 `chunk_content`
精准取用，避免把整本书塞进上下文。

### B. HTTP API（编程/脚本场景）

服务默认运行在 `http://localhost:3000`（端口可配）。

```bash
# 1) 分析（同步返回最终结果；需先把 PDF 文本与逐页起始偏移准备好）
curl -s http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"title":"书名","text":"<整书文本>","pageBreaks":[0,1200,2600]}'
# → 返回 { id, title, summary, stats, themes:[{ id,title,summary,chunks:[...] }] }

# 2) 图片型 PDF：先把页面渲染成图片再 OCR（base64，不含 data: 前缀）
curl -s http://localhost:3000/api/ocr \
  -H 'Content-Type: application/json' \
  -d '{"images":[{"page":1,"base64":"<jpeg-base64>","mediaType":"image/jpeg"}]}'
# → { pages:[{page,text}] }，把各页 text 拼成整书文本后再调 /api/analyze

# 3) 资产读取（分析结果免下载，直接取用）
curl -s http://localhost:3000/api/books/<id>                 # 完整 JSON
curl -s http://localhost:3000/api/books/<id>/markdown        # 整书 Markdown
curl -s "http://localhost:3000/api/books/<id>/chunks/<chunkId>?format=text"  # 某块原文
```

> 提示：Web 前端用浏览器内的 pdf.js 自动完成「文本提取 / 页面渲染 / OCR / 调用分析」，
> 无需手工准备 `text`/`pageBreaks`。脚本场景若只有 PDF 文件，建议改用 MCP 的
> `analyze_pdf({ path })`，它会在服务端完成抽取与 OCR。

## 返回数据结构

```jsonc
{
  "id": "ab12cd34",
  "title": "书名",
  "summary": "全书总结…",
  "stats": { "windows": 6, "segments": 42, "themes": 7 },
  "themes": [
    {
      "id": "t0",
      "title": "主题标题",
      "summary": "主题摘要",
      "chunks": [
        {
          "id": "t0-c0",
          "title": "内容块标题",
          "summary": "AI 总结",
          "keywords": ["关键词", "…"],
          "content": "该块的真实原文…",
          "charCount": 1234,
          "startPage": 12,
          "endPage": 15
        }
      ]
    }
  ]
}
```

## 工作要点

- **优先用大纲规划，按需取块**：先看 `book_outline` / `stats`，只在需要时取具体块的 `content`，
  避免把整本书一次性塞进上下文。
- **原文可信**：`content` 是由代码按 AI 判定的语义边界从原文切片得到的，可放心引用。
- **扫描型 PDF**：MCP 的 `analyze_pdf` 会自动判断并走视觉 OCR；HTTP 路线需先经 `/api/ocr`。
- **不要在平台内逐页硬读整本书**——交给本服务做结构化预处理，再消费其产出。
