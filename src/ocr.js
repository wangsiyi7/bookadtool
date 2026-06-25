// 图片型 / 扫描型 PDF 的 OCR：基于 Claude 的视觉能力做逐字转写。
// 两种入口：
//   ocrImages       —— 前端用 pdf.js 把页面渲染成图片后逐页转写（可精确重建页码）
//   ocrPdfDocument  —— 把整份 PDF 作为 document 直接交给模型转写（供 MCP / 无浏览器场景）
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_OCR_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const OCR_CONCURRENCY = Number(process.env.OCR_CONCURRENCY || 3);

const client = new Anthropic();

const OCR_PROMPT =
  "请把这张书页图片中的文字**逐字转写**为纯文本。要求：\n" +
  "1) 只输出页面上的正文文字，保持自然的阅读顺序与段落；\n" +
  "2) 不要添加任何解释、标题、Markdown 或额外说明；\n" +
  "3) 忽略页眉/页脚的页码与装饰；\n" +
  "4) 若该页没有可识别的文字，输出空字符串。";

function firstText(message) {
  return message.content.find((b) => b.type === "text")?.text || "";
}

// 简单的并发限制
async function mapLimit(items, limit, fn, onEach = () => {}) {
  const results = new Array(items.length);
  let idx = 0;
  let done = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      onEach(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * 逐页 OCR。
 * @param {{page:number, base64:string, mediaType?:string}[]} images
 * @returns {Promise<{page:number, text:string}[]>}
 */
export async function ocrImages(images, onProgress = () => {}) {
  return mapLimit(
    images,
    OCR_CONCURRENCY,
    async (img) => {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mediaType || "image/jpeg",
                  data: img.base64,
                },
              },
              { type: "text", text: OCR_PROMPT },
            ],
          },
        ],
      });
      return { page: img.page, text: firstText(message).trim() };
    },
    (done, total) => onProgress({ stage: "ocr", current: done, total })
  );
}

/**
 * 把整份 PDF 直接交给模型转写（带页码标记，便于重建页起始偏移）。
 * @param {string} base64Pdf
 * @returns {Promise<{ text: string, pageBreaks: number[] }>}
 */
export async function ocrPdfDocument(base64Pdf) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 64000,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
          },
          {
            type: "text",
            text:
              "请把这份 PDF 中每一页的文字逐字转写为纯文本。" +
              "在每一页文字开始前，单独用一行输出页标记 `[[[PAGE n]]]`（n 为页码，从 1 开始），" +
              "之后是该页正文。不要添加任何解释或 Markdown。",
          },
        ],
      },
    ],
  });

  const raw = firstText(message);
  // 解析页标记，重建 text 与 pageBreaks
  const parts = raw.split(/\n?\[\[\[PAGE\s+\d+\]\]\]\n?/);
  const pages = parts.map((s) => s.trim()).filter((_, i) => i > 0 || parts.length === 1);
  if (pages.length <= 1) {
    return { text: raw.trim() + "\n\n", pageBreaks: [0] };
  }
  let text = "";
  const pageBreaks = [];
  for (const p of pages) {
    pageBreaks.push(text.length);
    text += p + "\n\n";
  }
  return { text, pageBreaks };
}
