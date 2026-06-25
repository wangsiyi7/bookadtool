// 服务端 PDF 文本提取（供 MCP / API 使用；Web 前端则用浏览器内的 pdf.js）。
// 使用 pdfjs-dist 的 legacy 构建，在 Node 中以“假 worker”方式运行，仅做文本抽取。
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * 从 PDF 二进制数据中提取全文与逐页起始偏移。
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Promise<{ text: string, pageBreaks: number[], numPages: number, charsPerPage: number }>}
 */
export async function extractPdfText(data) {
  // 必须是“纯” Uint8Array：Node 的 Buffer 虽是其子类，但 pdfjs 会拒绝。
  const bytes = new Uint8Array(
    data instanceof ArrayBuffer ? data : data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data
  );
  const pdf = await getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0, // 静默 pdfjs 日志（MCP 的 stdio 通道不能被污染）
  }).promise;

  let text = "";
  const pageBreaks = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    pageBreaks.push(text.length);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str || "").join(" ");
    text += pageText + "\n\n";
  }

  const charsPerPage = pdf.numPages ? text.trim().length / pdf.numPages : 0;
  return { text, pageBreaks, numPages: pdf.numPages, charsPerPage };
}

/** 判断该 PDF 是否疑似“图片型 / 扫描型”（文本极少，需要 OCR）。 */
export function looksScanned({ text, numPages, charsPerPage }) {
  if (!text || text.trim().length < Math.max(200, numPages * 15)) return true;
  return charsPerPage < 15;
}
