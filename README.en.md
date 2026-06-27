<div align="center">

# 📚 bookadtool

**Content-aware semantic chunking for PDFs · 3D visualization · AI summaries**

Split large PDFs (including scanned / image-based ones) into interconnected content
blocks by **meaning and topic**, visualize them in a Three.js 3D space, download the
original text, export Markdown, and read AI-generated summaries. Ships with an
**HTTP API**, an **MCP server**, and a companion **Skill** for easy integration into
AI workflows.

[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![Model](https://img.shields.io/badge/Claude-Opus%204.8-d97757)](https://www.anthropic.com)
[![MCP](https://img.shields.io/badge/MCP-compatible-5b8cff)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

[简体中文](./README.md) · **English**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [PDF Support](#pdf-support)
- [Quick Start](#quick-start)
- [HTTP API](#http-api)
- [MCP Integration](#mcp-integration)
- [Companion Skill](#companion-skill)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Limitations](#limitations)
- [License](#license)

## Overview

`bookadtool` solves a concrete problem: **when a PDF book is too large and too long,
how do you split it by its actual semantic structure — rather than by chapters or page
numbers — into knowledge blocks that are understandable, searchable, and reusable?**

Unlike mechanical per-page/per-chapter splitting, this tool has the AI read the content
first, detect boundaries based on **semantic and topical coherence**, then cluster the
resulting blocks into themes and generate a summary for each. The result is a three-level
structure — **Book → Theme → Content Block** — rendered in a 3D view that makes the
relationships between nodes intuitive.

To keep downloaded and exported content **faithful to the original book**, the AI only
decides "semantic boundaries + summaries"; the real original text is sliced from the
source by the program along those boundaries.

## Features

| Capability | Description |
| --- | --- |
| 🧠 **Semantic chunking** | The AI analyzes the full text and splits it by topical coherence (not chapters/pages), then clusters blocks into themes |
| 🖼 **Image/scanned PDFs** | Automatically detects image-only PDFs and uses Claude's vision to OCR them verbatim before structuring |
| 🌐 **3D visualization** | A Three.js spherical force-directed node graph with rotate, zoom, hover highlight, and click interactions |
| 📝 **AI summaries** | Every content block, theme, and the whole book carries an AI-generated summary — not just a mechanical split |
| ⬇️ **Download & export** | Click a node to download the original text as `.txt`; export Markdown at block / theme / whole-book granularity |
| 📊 **Real-time progress** | The backend pushes real analysis progress over SSE (window splitting, per-window analysis, clustering) |
| 🔌 **HTTP API** | Analysis, OCR, asset retrieval, and Markdown export are all exposed as REST endpoints |
| 🤝 **MCP server** | Model Context Protocol compatible; AI clients can consume structured content directly without manual downloads |
| 🧩 **Companion Skill** | A built-in `book-chunker` Skill guides the AI to preprocess via this service |

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Runtime | **Node.js ≥ 20** (ESM) | Server runtime |
| Web server | **Express 4** | Static hosting + REST / SSE endpoints |
| AI model | **Anthropic Claude (default `claude-opus-4-8`)** | Semantic chunking, theme clustering, summaries, vision OCR |
| SDK | **@anthropic-ai/sdk** | Claude Messages API (structured output / vision) |
| PDF parsing | **pdfjs-dist** | Client-side text extraction & page rendering; server-side text extraction |
| 3D rendering | **Three.js (r169)** + OrbitControls | 3D node graph and interaction |
| Protocol | **@modelcontextprotocol/sdk** | MCP stdio server |
| Frontend | Native ES Modules + Canvas | No bundler; loaded directly via import map |

## Architecture

```
                        ┌──────────────────────── Frontend (browser) ────────────────────┐
                        │  pdf.js extract text/pages ─┐                                   │
   PDF ───────────────▶ │  (scanned) render→OCR ──────┼─▶ /api/analyze/stream (SSE)       │
                        │  Three.js 3D graph ◀─────────┘     click node → download/export │
                        └───────────────────────────────────┬─────────────────────────────┘
                                                             │
                        ┌──────────────────────── Backend (Express) ─────────────────────┐
                        │  /api/analyze · /api/analyze/stream · /api/ocr                  │
                        │  /api/books/:id(/markdown|/chunks/:id) · /api/export            │
                        │            │                        │                           │
                        │   src/chunker.js (Map→Reduce)   src/ocr.js (vision OCR)         │
                        └────────────┬───────────────────────────────────────────────────┘
                                     │ shared core
                        ┌────────────┴──────────── MCP server (stdio) ───────────────────┐
                        │  analyze_pdf · book_outline · book_markdown · chunk_content      │
                        │  list_books · resource book://{id}  ← consumed by AI, no download│
                        └─────────────────────────────────────────────────────────────────┘
```

**Chunking pipeline (Map → Reduce)**

1. **Map**: the book is split into character windows; for each window Claude detects
   semantic block boundaries and outputs a title, summary, keywords, and the
   "starts-with" text of each block. The program then **losslessly slices** the real
   content from the source and annotates page numbers via page offsets.
2. **Reduce**: all blocks (title + summary) are sent to Claude to cluster into 4–9
   themes and to produce an overall book summary.

## PDF Support

The tool handles two PDF types via different paths and **auto-detects** which applies:

| Type | Detection | Path |
| --- | --- | --- |
| **Text-based PDF** (with a text layer) | Normal amount of extractable text | Read the text layer directly → semantic chunking |
| **Image / scanned PDF** | Very little text (below `pages × 15` chars) | Render pages to images → **Claude vision OCR** verbatim → semantic chunking |

- **Web frontend**: pdf.js renders each page to an image and sends batches to `/api/ocr`.
- **MCP / server**: `analyze_pdf` sends the whole scanned PDF as a document to the model
  for vision transcription.
- OCR processes up to **60 pages** by default (`OCR_MAX_PAGES`); extra pages are skipped
  with a console warning.
- OCR uses the same Claude model as analysis (overridable via `ANTHROPIC_OCR_MODEL`).

> Encrypted/permission-protected PDFs must be unlocked first; pages that are pure vector
> art with no text cannot yield recognizable text.

## One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/wangsiyi7/bookadtool&env=ANTHROPIC_API_KEY&envDescription=Anthropic%20API%20Key%20(required%20for%20analysis%20%26%20OCR)&project-name=bookadtool&repository-name=bookadtool)

A `vercel.json` is included, so the app deploys to [Vercel](https://vercel.com) out of the box:

1. Click the button above (or import this repo in Vercel).
2. Set the **`ANTHROPIC_API_KEY`** environment variable (required, or analysis/OCR returns 500).
   Optional: `ANTHROPIC_MODEL`, `ANTHROPIC_OCR_MODEL`.
3. After deployment, open the assigned `*.vercel.app` link.

> Serverless notes: per-invocation limit is 60s (configured in `vercel.json`) — run locally for
> very large books; request body cap is ~4.5MB (affects huge text / a single OCR batch — lower
> "OCR batch size" in ⚙ Settings); the `/api/books` in-memory cache does not persist across
> instances in serverless (browsing/downloading in the web UI is unaffected since results live
> in the frontend's memory).

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Configure the API key
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY

# 3. Start the web service
npm start
# open http://localhost:3000
```

Click "Upload PDF" in the top-left corner. After analysis completes, browse the 3D view,
click nodes to read summaries, download original text, and export Markdown.

## HTTP API

The service runs at `http://localhost:3000` by default.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check (key configured, current model, cache size) |
| `POST` | `/api/analyze` | Synchronous analysis; returns the final structure tree (with `id`) |
| `POST` | `/api/analyze/stream` | SSE streaming analysis with real-time progress (used by the web UI) |
| `POST` | `/api/ocr` | Vision OCR over page images; returns per-page text |
| `GET` | `/api/books` | List cached analysis results |
| `GET` | `/api/books/:id` | Full JSON of one analysis |
| `GET` | `/api/books/:id/markdown` | Export the whole book as Markdown |
| `GET` | `/api/books/:id/themes/:themeId/markdown` | Export one theme as Markdown |
| `GET` | `/api/books/:id/chunks/:chunkId?format=text\|markdown\|json` | Read one content block |
| `POST` | `/api/export` | Generate Markdown directly from a posted book object |

**Examples**

```bash
# Analyze (prepare the full text and per-page start offsets first)
curl -s http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"title":"Title","text":"<full text>","pageBreaks":[0,1200,2600]}'

# Read results (consume directly, no download needed)
curl -s http://localhost:3000/api/books/<id>/markdown
curl -s "http://localhost:3000/api/books/<id>/chunks/t0-c1?format=text"
```

See the returned data shape in [`skill/book-chunker/SKILL.md`](./skill/book-chunker/SKILL.md).

## MCP Integration

This repo ships an **MCP (Model Context Protocol) stdio server** so that MCP-compatible
AI clients (e.g. Claude Desktop / Claude Code) can preprocess a PDF into structured
content and **consume it as context without manual downloads**.

**Tools**

| Tool | Purpose |
| --- | --- |
| `analyze_pdf` | Analyze a local PDF (path) or raw text; returns an outline and caches it (handles scanned PDFs automatically) |
| `book_outline` | Return a lightweight outline by id (titles/summaries/pages, no full text) |
| `book_markdown` | Return the whole-book Markdown by id, usable directly as preprocessed context |
| `chunk_content` | Return one content block's original text by id + chunkId |
| `list_books` | List books analyzed in the session |

**Resource**: `book://{id}` → whole-book Markdown.

**Register in Claude Desktop (`claude_desktop_config.json`)**

```json
{
  "mcpServers": {
    "bookadtool": {
      "command": "node",
      "args": ["/absolute/path/bookadtool/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

For Claude Code, see [`examples/mcp.json`](./examples/mcp.json) and drop it into a
`.mcp.json` at your project root. Or run locally: `npm run mcp`.

## Companion Skill

[`skill/book-chunker`](./skill/book-chunker/SKILL.md) is an Agent Skill that guides the
AI to perform PDF semantic chunking and preprocessing **through this service** (MCP
first, or the HTTP API) instead of reading the whole book page by page in the chat.

Its core strategy: fetch the outline to plan first → then pull specific content blocks
only as needed, maximizing context usage and minimizing token spend.

## Configuration

Variables supported in `.env`:

| Variable | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — (required) | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Model used for analysis |
| `ANTHROPIC_OCR_MODEL` | same as `ANTHROPIC_MODEL` | Model used for OCR (can be set separately) |
| `OCR_CONCURRENCY` | `3` | Server-side OCR concurrency |
| `PORT` | `3000` | Web service port |

Frontend "⚙ Settings" panel (top-right, persisted in browser localStorage): model
override, OCR max pages, OCR batch size, OCR render scale, and 3D auto-rotate. The
model override is sent per request and takes effect for that analysis/OCR run — no
server restart required.

## Project Structure

```
server.js                  Express backend: REST + SSE + asset API
mcp/server.js              MCP stdio server
src/chunker.js             Semantic chunking core (Map split + Reduce cluster/summary)
src/ocr.js                 Claude vision OCR (page images / whole PDF)
src/pdfText.js             Server-side PDF text extraction (pdfjs-dist)
src/markdown.js            Shared Markdown generation
public/index.html          Page shell
public/css/style.css       Styles
public/js/app.js           Frontend flow: extract/OCR → SSE analysis → render → interact
public/js/viz.js           Three.js 3D visualization engine
public/js/export.js        Frontend download / Markdown export
skill/book-chunker/        Companion Agent Skill
examples/mcp.json          Example MCP config for Claude Code
```

## Limitations

- Requires a valid `ANTHROPIC_API_KEY`; analysis/OCR incur API usage costs.
- OCR for image PDFs is bounded by a page cap (default 60); for very large scans, raise
  the threshold or split into volumes.
- In-memory analysis results (HTTP `/api/books`) are an ephemeral cache cleared on restart.
- The web UI loads Three.js / pdf.js from the unpkg CDN, which requires internet access.

## License

Released under the [MIT License](./LICENSE).
