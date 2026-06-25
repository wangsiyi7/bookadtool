#!/usr/bin/env node
// bookadtool MCP 服务器（stdio 传输）
//
// 让任意兼容 MCP 的 AI 客户端（如 Claude Desktop）直接把一本 PDF 预处理成
// 「书籍 → 主题 → 内容块」结构，并把内容作为上下文直接取用——无需手动下载。
//
// 暴露的工具：
//   analyze_pdf    分析本地 PDF（路径）或直接传入文本 → 返回结构树并缓存，给出 id
//   book_outline   按 id 返回轻量大纲（标题 + 摘要，不含全文），适合做上下文
//   book_markdown  按 id 返回整书 Markdown（可直接作为预处理内容喂给模型）
//   chunk_content  按 id + chunkId 返回某个内容块的原文
//   list_books     列出本会话已分析的书目
// 资源：book://{id} → 整书 Markdown
//
// 注意：stdio 通道即协议通道，严禁向 stdout 写日志，诊断信息一律走 stderr。
import "dotenv/config";
import { readFile } from "fs/promises";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { analyzeBook } from "../src/chunker.js";
import { extractPdfText, looksScanned } from "../src/pdfText.js";
import { ocrPdfDocument } from "../src/ocr.js";
import { bookToMarkdown, chunkToMarkdown } from "../src/markdown.js";

const log = (...a) => console.error("[bookadtool-mcp]", ...a);
const store = new Map(); // id -> book

function outline(book) {
  return {
    id: book.id,
    title: book.title,
    summary: book.summary,
    stats: book.stats,
    themes: (book.themes || []).map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      chunks: (t.chunks || []).map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        keywords: c.keywords,
        pages: c.startPage
          ? c.endPage && c.endPage !== c.startPage
            ? `${c.startPage}-${c.endPage}`
            : `${c.startPage}`
          : null,
      })),
    })),
  };
}

// 把 PDF 路径 / 文本解析为 { text, pageBreaks }
async function resolveSource({ path, text, title }) {
  if (text && text.trim()) return { text, pageBreaks: [0], title };
  if (!path) throw new Error("必须提供 path 或 text");
  const data = await readFile(path);
  const extracted = await extractPdfText(data);
  if (!looksScanned(extracted)) {
    return { text: extracted.text, pageBreaks: extracted.pageBreaks, title };
  }
  // 图片型 PDF：整份交给模型做视觉 OCR
  log("检测到图片型 PDF，使用视觉 OCR：", path);
  const ocr = await ocrPdfDocument(data.toString("base64"));
  return { text: ocr.text, pageBreaks: ocr.pageBreaks, title };
}

const server = new McpServer({ name: "bookadtool", version: "1.0.0" });

/* ------------------------------ 工具 ------------------------------ */

server.registerTool(
  "analyze_pdf",
  {
    title: "分析 PDF / 文本",
    description:
      "按内容语义把一本 PDF（本地路径）或一段长文本智能切分为「主题 → 内容块」结构，" +
      "并为每块生成总结。支持文本型与图片型（扫描）PDF。返回结构树并缓存，后续可用 id 取用。",
    inputSchema: {
      path: z.string().optional().describe("本地 PDF 文件的绝对路径"),
      text: z.string().optional().describe("直接传入的长文本（与 path 二选一）"),
      title: z.string().optional().describe("书名/标题提示"),
    },
  },
  async ({ path, text, title }) => {
    try {
      const src = await resolveSource({ path, text, title });
      const book = await analyzeBook(src, (p) => log("progress", JSON.stringify(p)));
      book.id = "b" + (store.size + 1) + "_" + book.themes.length;
      store.set(book.id, book);
      return {
        content: [{ type: "text", text: JSON.stringify(outline(book), null, 2) }],
      };
    } catch (err) {
      log("analyze_pdf error", err);
      return { isError: true, content: [{ type: "text", text: "分析失败：" + err.message }] };
    }
  }
);

server.registerTool(
  "book_outline",
  {
    title: "获取大纲",
    description: "按 id 返回某本书的轻量大纲（主题、内容块标题与摘要，不含全文），适合作为上下文。",
    inputSchema: { id: z.string().describe("analyze_pdf 返回的 id") },
  },
  async ({ id }) => {
    const book = store.get(id);
    if (!book) return { isError: true, content: [{ type: "text", text: "未找到该 id" }] };
    return { content: [{ type: "text", text: JSON.stringify(outline(book), null, 2) }] };
  }
);

server.registerTool(
  "book_markdown",
  {
    title: "获取整书 Markdown",
    description: "按 id 返回整本书的 Markdown（含主题、内容块、原文与总结），可直接作为预处理内容使用。",
    inputSchema: { id: z.string().describe("analyze_pdf 返回的 id") },
  },
  async ({ id }) => {
    const book = store.get(id);
    if (!book) return { isError: true, content: [{ type: "text", text: "未找到该 id" }] };
    return { content: [{ type: "text", text: bookToMarkdown(book) }] };
  }
);

server.registerTool(
  "chunk_content",
  {
    title: "获取内容块原文",
    description: "按 id 与 chunkId 返回某个内容块的原文文本。",
    inputSchema: {
      id: z.string().describe("analyze_pdf 返回的 id"),
      chunkId: z.string().describe("内容块 id，例如 t0-c1"),
    },
  },
  async ({ id, chunkId }) => {
    const book = store.get(id);
    if (!book) return { isError: true, content: [{ type: "text", text: "未找到该 id" }] };
    for (const t of book.themes || [])
      for (const c of t.chunks || [])
        if (c.id === chunkId)
          return { content: [{ type: "text", text: chunkToMarkdown(c, "#") }] };
    return { isError: true, content: [{ type: "text", text: "未找到该内容块" }] };
  }
);

server.registerTool(
  "list_books",
  {
    title: "列出已分析书目",
    description: "列出当前会话已分析并缓存的书目（id、标题、统计）。",
    inputSchema: {},
  },
  async () => {
    const list = [...store.values()].map((b) => ({
      id: b.id,
      title: b.title,
      stats: b.stats,
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

/* ------------------------------ 资源 ------------------------------ */
// book://{id} → 整书 Markdown
server.registerResource(
  "book",
  new ResourceTemplate("book://{id}", {
    list: async () => ({
      resources: [...store.values()].map((b) => ({
        uri: `book://${b.id}`,
        name: b.title,
        mimeType: "text/markdown",
      })),
    }),
  }),
  { title: "已分析书籍", description: "按 id 读取整书 Markdown" },
  async (uri, { id }) => {
    const book = store.get(id);
    if (!book) throw new Error("未找到该 id");
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: bookToMarkdown(book) }],
    };
  }
);

/* ------------------------------ 启动 ------------------------------ */
const transport = new StdioServerTransport();
await server.connect(transport);
log("MCP 服务器已就绪（stdio）");
