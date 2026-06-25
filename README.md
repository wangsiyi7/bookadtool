<div align="center">

# 📚 bookadtool

**基于内容语义的 PDF 智能切分 · 3D 可视化 · AI 总结**

把大部头 PDF（含扫描/图片型）按**语义与主题**切分为相互关联的内容组块，
在 Three.js 3D 空间中可视化呈现，支持原文下载、Markdown 导出、AI 内容总结，
并提供 **HTTP API**、**MCP 服务**与配套 **Skill**，方便接入各类 AI 工作流。

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![Model](https://img.shields.io/badge/Claude-Opus%204.8-d97757)](https://www.anthropic.com)
[![MCP](https://img.shields.io/badge/MCP-compatible-5b8cff)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**简体中文** · [English](./README.en.md)

</div>

---

## 目录

- [项目介绍](#项目介绍)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [PDF 支持说明](#pdf-支持说明)
- [快速开始](#快速开始)
- [HTTP API](#http-api)
- [MCP 接入](#mcp-接入)
- [配套 Skill](#配套-skill)
- [配置项](#配置项)
- [目录结构](#目录结构)
- [使用限制](#使用限制)
- [许可证](#许可证)

## 项目介绍

`bookadtool` 致力于解决一个具体问题：**当一本 PDF 书籍过大、过长时，如何按内容本身的语义结构，
而非简单的章节或页码，把它切分为可理解、可检索、可复用的知识组块。**

与传统按页/按章的机械切分不同，本工具由 AI 先理解全文内容，依据**语义与主题的连贯性**
识别内容边界，再把这些内容块聚类为若干主题，并为每一块生成总结。最终形成
「**书籍 → 主题 → 内容块**」三层结构，在 3D 视图中直观呈现节点间的关系。

为了保证下载与导出的内容**忠于原书**，AI 只负责「判断语义边界 + 总结」，
真实原文由程序按边界精确切片得到。

## 核心特性

| 能力 | 说明 |
| --- | --- |
| 🧠 **语义智能切分** | AI 分析全文，按主题连贯性切分内容块（非章节/页数），并聚类为主题层级 |
| 🖼 **图片/扫描型 PDF** | 自动检测纯图片 PDF，调用 Claude 视觉能力进行 OCR 逐字转写后再结构化 |
| 🌐 **3D 可视化** | 基于 Three.js 的球状力导向节点图，支持旋转、缩放、悬停高亮、点击交互 |
| 📝 **AI 内容总结** | 每个内容块、每个主题、整本书都附带 AI 生成的总结，而不仅是机械拆分 |
| ⬇️ **下载与导出** | 点击节点下载原文 `.txt`；按内容块/主题/全书三种粒度导出 Markdown |
| 📊 **实时进度** | 后端经 SSE 向前端推送真实分析进度（切分窗口、逐窗分析、聚类总结） |
| 🔌 **HTTP API** | 分析、OCR、资产读取、Markdown 导出全部开放为 REST 接口 |
| 🤝 **MCP 服务** | 兼容 Model Context Protocol，AI 客户端可直接取用结构化内容，无需手动下载 |
| 🧩 **配套 Skill** | 内置 `book-chunker` Skill，指导 AI 通过本服务完成预处理 |

## 技术栈

| 层 | 技术 | 用途 |
| --- | --- | --- |
| 运行时 | **Node.js ≥ 20** (ESM) | 服务端运行环境 |
| Web 服务 | **Express 4** | 静态资源托管 + REST / SSE 接口 |
| AI 模型 | **Anthropic Claude（默认 `claude-opus-4-8`）** | 语义切分、主题聚类、内容总结、视觉 OCR |
| SDK | **@anthropic-ai/sdk** | 调用 Claude Messages API（结构化输出 / 视觉） |
| PDF 解析 | **pdfjs-dist** | 前端文本提取与页面渲染；服务端文本抽取 |
| 3D 渲染 | **Three.js (r169)** + OrbitControls | 3D 节点图可视化与交互 |
| 协议 | **@modelcontextprotocol/sdk** | MCP stdio 服务器 |
| 前端 | 原生 ES Modules + Canvas | 无打包依赖，import map 直接加载 |

## 系统架构

```
                        ┌──────────────────────── 前端 (浏览器) ─────────────────────────┐
                        │  pdf.js 提取文本/页码  ─┐                                       │
   PDF ───────────────▶ │  (扫描型) 渲染页面→OCR ─┼─▶ /api/analyze/stream (SSE 实时进度)  │
                        │  Three.js 3D 节点图 ◀───┘        点击节点 → 下载/导出 Markdown   │
                        └───────────────────────────────────┬───────────────────────────┘
                                                             │
                        ┌──────────────────────── 后端 (Express) ───────────────────────┐
                        │  /api/analyze · /api/analyze/stream · /api/ocr                 │
                        │  /api/books/:id(/markdown|/chunks/:id) · /api/export           │
                        │            │                        │                          │
                        │   src/chunker.js (Map→Reduce)   src/ocr.js (视觉 OCR)          │
                        └────────────┬──────────────────────────────────────────────────┘
                                     │ 共用核心逻辑
                        ┌────────────┴──────────── MCP 服务 (stdio) ─────────────────────┐
                        │  analyze_pdf · book_outline · book_markdown · chunk_content     │
                        │  list_books · 资源 book://{id}     ←  AI 客户端直接取用，免下载   │
                        └────────────────────────────────────────────────────────────────┘
```

**切分原理（Map → Reduce）**

1. **Map**：整书按字符窗口切分，逐窗让 Claude 依据语义识别内容块边界，输出标题、摘要、关键词
   及「段首定位文字」；程序据此从原文**无损切片**得到每块真实内容，并据页码偏移标注页码。
2. **Reduce**：把所有内容块（标题 + 摘要）交给 Claude 聚类为 4–9 个主题，并生成全书总结。

## PDF 支持说明

本工具对两类 PDF 提供不同的处理路径，并能**自动判别**：

| 类型 | 判别方式 | 处理路径 |
| --- | --- | --- |
| **文本型 PDF**（含可选文字层） | 提取到的文本量正常 | 直接读取文字层 → 语义切分 |
| **图片型 / 扫描型 PDF** | 文本量极少（低于 `页数 × 15` 字符的阈值） | 渲染页面为图片 → **Claude 视觉 OCR** 逐字转写 → 语义切分 |

- **Web 前端**：用浏览器内的 pdf.js 将每页渲染为图片，分批送 `/api/ocr` 进行视觉识别。
- **MCP / 服务端**：`analyze_pdf` 直接把整份扫描 PDF 作为 document 交给模型做视觉转写。
- OCR 默认最多处理 **60 页**（可配 `OCR_MAX_PAGES`），超出部分会在控制台提示并跳过。
- OCR 采用与分析相同的 Claude 模型（可经 `ANTHROPIC_OCR_MODEL` 单独指定）。

> 加密/带权限保护的 PDF 需先解除限制；纯矢量图无文字的页面无法识别出文本。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 3. 启动 Web 服务
npm start
# 打开 http://localhost:3000
```

在页面左上角点击「上传 PDF」，等待分析完成后即可在 3D 视图中浏览、点击节点查看总结、
下载原文与导出 Markdown。

## HTTP API

服务默认运行于 `http://localhost:3000`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查（是否配置 Key、当前模型、缓存数量） |
| `POST` | `/api/analyze` | 同步分析，返回最终结构树（含 `id`） |
| `POST` | `/api/analyze/stream` | SSE 流式分析，实时推送进度（Web 前端使用） |
| `POST` | `/api/ocr` | 对页面图片做视觉 OCR，返回逐页文本 |
| `GET` | `/api/books` | 列出已缓存的分析结果 |
| `GET` | `/api/books/:id` | 读取某次分析的完整 JSON |
| `GET` | `/api/books/:id/markdown` | 导出整书 Markdown |
| `GET` | `/api/books/:id/themes/:themeId/markdown` | 导出某主题 Markdown |
| `GET` | `/api/books/:id/chunks/:chunkId?format=text\|markdown\|json` | 读取某内容块 |
| `POST` | `/api/export` | 由传入的 book 对象直接生成 Markdown |

**示例**

```bash
# 分析（需先准备整书文本与逐页起始偏移）
curl -s http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"title":"书名","text":"<整书文本>","pageBreaks":[0,1200,2600]}'

# 读取结果（免下载，直接取用）
curl -s http://localhost:3000/api/books/<id>/markdown
curl -s "http://localhost:3000/api/books/<id>/chunks/t0-c1?format=text"
```

返回的数据结构见 [`skill/book-chunker/SKILL.md`](./skill/book-chunker/SKILL.md)。

## MCP 接入

本仓库内置一个 **MCP（Model Context Protocol）stdio 服务器**，让兼容 MCP 的 AI 客户端
（如 Claude Desktop / Claude Code）直接把 PDF 预处理为结构化内容并**作为上下文取用，无需手动下载**。

**提供的工具**

| 工具 | 作用 |
| --- | --- |
| `analyze_pdf` | 分析本地 PDF（路径）或纯文本，返回结构大纲并缓存（自动处理扫描型） |
| `book_outline` | 按 id 返回轻量大纲（标题/摘要/页码，不含全文） |
| `book_markdown` | 按 id 返回整书 Markdown，可直接作为预处理上下文 |
| `chunk_content` | 按 id + chunkId 返回某内容块原文 |
| `list_books` | 列出会话内已分析的书目 |

**提供的资源**：`book://{id}` → 整书 Markdown。

**在 Claude Desktop / Claude Code 中注册（`claude_desktop_config.json` / MCP 配置）**

```json
{
  "mcpServers": {
    "bookadtool": {
      "command": "node",
      "args": ["/绝对路径/bookadtool/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Claude Code 用户可参考 [`examples/mcp.json`](./examples/mcp.json) 放入项目根目录的 `.mcp.json`。
或本地直接运行：`npm run mcp`。

## 配套 Skill

[`skill/book-chunker`](./skill/book-chunker/SKILL.md) 是一个 Agent Skill，
用于指导 AI**通过本服务**（MCP 优先，或 HTTP API）完成 PDF 的语义切分与预处理，
而不是在对话里逐页硬读整本书。把该目录加入你的 Skills 路径即可启用。

其核心策略：先取大纲做规划 → 仅按需取用具体内容块，最大化利用上下文、最小化 token 消耗。

## 配置项

`.env` 支持的变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | —（必填） | Anthropic API Key |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | 分析所用模型 |
| `ANTHROPIC_OCR_MODEL` | 同 `ANTHROPIC_MODEL` | OCR 所用模型（可单独指定） |
| `OCR_CONCURRENCY` | `3` | 服务端 OCR 并发数 |
| `PORT` | `3000` | Web 服务端口 |

前端常量（`public/js/app.js`）：`OCR_MAX_PAGES`（默认 60）、`OCR_BATCH`（默认 5）。

## 目录结构

```
server.js                  Express 后端：REST + SSE + 资产读取 API
mcp/server.js              MCP stdio 服务器
src/chunker.js             语义切分核心（Map 分窗切分 + Reduce 聚类总结）
src/ocr.js                 Claude 视觉 OCR（页面图片 / 整份 PDF）
src/pdfText.js             服务端 PDF 文本提取（pdfjs-dist）
src/markdown.js            共用 Markdown 生成
public/index.html          页面骨架
public/css/style.css       样式
public/js/app.js           前端主流程：提取/OCR → SSE 分析 → 渲染 → 交互
public/js/viz.js           Three.js 3D 可视化引擎
public/js/export.js        前端下载 / Markdown 导出
skill/book-chunker/        配套 Agent Skill
```

## 使用限制

- 需配置有效的 `ANTHROPIC_API_KEY`；分析/OCR 会产生相应 API 调用费用。
- 图片型 PDF 的 OCR 受页数上限约束（默认 60 页），超大扫描书建议提高阈值或分卷处理。
- 内存中的分析结果（HTTP `/api/books`）为易失缓存，进程重启即清空。
- Web 端依赖联网从 unpkg CDN 加载 Three.js / pdf.js。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
