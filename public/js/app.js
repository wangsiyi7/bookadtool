import * as pdfjsLib from "https://unpkg.com/pdfjs-dist@4.7.76/build/pdf.min.mjs";
import { BookGraph } from "./viz.js";
import { getSettings, initSettings } from "./settings.js";
import {
  downloadChunkText,
  downloadThemeText,
  exportChunkMarkdown,
  exportThemeMarkdown,
  exportBookMarkdown,
} from "./export.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";

/* ----------------------------- DOM ----------------------------- */
const el = (id) => document.getElementById(id);
const fileInput = el("file-input");
const fileName = el("file-name");
const statusEl = el("status");
const welcome = el("welcome");
const loader = el("loader");
const loaderText = el("loader-text");
const progressBar = el("progress-bar");
const legend = el("legend");
const panel = el("panel");
const exportBookBtn = el("export-book");

let graph = new BookGraph(el("scene"));
let currentBook = null;
let selected = null;

// 初始化设置面板，并即时应用（如自动旋转）
initSettings((s) => graph.setAutoRotate(s.autoRotate));

/* ----------------------------- 上传 ----------------------------- */
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  fileName.textContent = file.name;
  await processPdf(file);
  fileInput.value = "";
});

async function processPdf(file) {
  try {
    const settings = getSettings();
    showLoader("正在读取 PDF…", 4);
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    // 1) 先尝试直接提取文本层
    let fullText = "";
    let pageBreaks = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pageBreaks.push(fullText.length);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += content.items.map((it) => it.str).join(" ") + "\n\n";
      setProgress(4 + (p / pdf.numPages) * 24);
      loaderText.textContent = `正在提取文本层… 第 ${p}/${pdf.numPages} 页`;
    }

    // 2) 文本极少 → 判定为图片型/扫描型 → 走 OCR
    const scanned = fullText.trim().length < Math.max(200, pdf.numPages * 15);
    if (scanned) {
      const ocr = await runOcr(pdf, settings);
      fullText = ocr.text;
      pageBreaks = ocr.pageBreaks;
    }

    if (fullText.trim().length < 50) {
      throw new Error("未能从该 PDF 获取到可用文本。");
    }

    // 3) 流式分析（真实进度）
    const title = file.name.replace(/\.pdf$/i, "");
    const analyzeBase = scanned ? 72 : 30;
    const book = await analyzeViaStream(
      { title, text: fullText, pageBreaks, model: settings.model || undefined },
      analyzeBase
    );

    setProgress(99);
    loaderText.textContent = "正在构建 3D 可视化…";
    currentBook = book;
    graph.render(book, onSelectNode);

    hideLoader();
    welcome.classList.add("hidden");
    legend.classList.remove("hidden");
    exportBookBtn.disabled = false;
    statusEl.textContent =
      `${book.stats.themes} 个主题 · ${book.stats.segments} 个内容块` +
      (scanned ? " · OCR" : "");
  } catch (err) {
    console.error(err);
    hideLoader();
    statusEl.textContent = "";
    alert("处理失败：" + (err.message || err));
  }
}

/* ----------------------------- OCR 流程 ----------------------------- */
async function runOcr(pdf, settings) {
  const maxPages = settings.ocrMaxPages || 60;
  const batchSize = settings.ocrBatch || 5;
  const scale = settings.renderScale || 1.6;
  const total = Math.min(pdf.numPages, maxPages);
  if (pdf.numPages > maxPages) {
    console.warn(`扫描页过多，仅 OCR 前 ${maxPages} 页`);
  }
  loaderText.textContent = "检测到图片型 PDF，正在进行 OCR 识别…";
  setProgress(30);

  // 逐页渲染为 JPEG
  const images = [];
  for (let p = 1; p <= total; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    images.push({ page: p, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    setProgress(30 + (p / total) * 10);
    loaderText.textContent = `正在渲染页面… ${p}/${total}`;
  }

  // 分批送后端 OCR
  const pageTexts = new Array(total).fill("");
  let doneCount = 0;
  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    const resp = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: batch, model: settings.model || undefined }),
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e.error || "OCR 失败");
    }
    const { pages } = await resp.json();
    for (const pg of pages) pageTexts[pg.page - 1] = pg.text || "";
    doneCount += batch.length;
    setProgress(40 + (doneCount / total) * 30);
    loaderText.textContent = `OCR 识别中… ${doneCount}/${total} 页`;
  }

  // 组装全文与页码偏移
  let text = "";
  const pageBreaks = [];
  for (const t of pageTexts) {
    pageBreaks.push(text.length);
    text += t + "\n\n";
  }
  return { text, pageBreaks };
}

/* ----------------------- 流式分析（SSE 真实进度） ----------------------- */
async function analyzeViaStream(payload, base) {
  const resp = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok || !resp.body) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error || `分析失败（HTTP ${resp.status}）`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = null;
  let totalWindows = 1;
  const span = 99 - base;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const { event, data } = parseSSE(rawEvent);
      if (!event) continue;
      if (event === "error") throw new Error(data.error || "分析失败");
      if (event === "result") result = data;
      if (event === "progress") {
        if (data.stage === "split") {
          totalWindows = data.windows || 1;
          setProgress(base + span * 0.05);
          loaderText.textContent = `已切分为 ${totalWindows} 个分析窗口…`;
        } else if (data.stage === "analyze") {
          const frac = data.current / data.total;
          setProgress(base + span * (0.1 + frac * 0.75));
          loaderText.textContent = `AI 语义分析中… 窗口 ${data.current}/${data.total}`;
        } else if (data.stage === "cluster") {
          setProgress(base + span * 0.92);
          loaderText.textContent = "正在聚类主题并生成全书总结…";
        }
      }
    }
  }
  if (!result) throw new Error("未收到分析结果");
  return result;
}

function parseSSE(raw) {
  let event = null;
  let data = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      try {
        data = JSON.parse(line.slice(5).trim());
      } catch {
        data = null;
      }
    }
  }
  return { event, data };
}

/* ----------------------------- 进度 UI ----------------------------- */
function showLoader(text, pct) {
  welcome.classList.add("hidden");
  loader.classList.remove("hidden");
  loaderText.textContent = text;
  if (typeof pct === "number") setProgress(pct);
}
function hideLoader() {
  loader.classList.add("hidden");
  setProgress(0);
}
function setProgress(pct) {
  progressBar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%";
}

/* ----------------------------- 节点详情 ----------------------------- */
function onSelectNode(type, data) {
  selected = { type, data };
  panel.classList.remove("hidden");

  const kind = el("panel-kind");
  const contentWrap = el("panel-content-wrap");
  el("panel-title").textContent = data.title || "未命名";

  if (type === "root") {
    kind.textContent = "📖 书籍";
    el("panel-meta").textContent = data.stats
      ? `${data.stats.themes} 个主题 · ${data.stats.segments} 个内容块`
      : "";
    el("panel-keywords").innerHTML = "";
    el("panel-summary").textContent = data.summary || "（无总结）";
    contentWrap.classList.add("hidden");
  } else if (type === "theme") {
    kind.textContent = "🗂 主题";
    el("panel-meta").textContent = `包含 ${data.chunks.length} 个内容块`;
    el("panel-keywords").innerHTML = "";
    el("panel-summary").textContent = data.summary || "";
    contentWrap.classList.add("hidden");
  } else {
    kind.textContent = "🧩 内容块";
    const range = data.startPage
      ? data.endPage && data.endPage !== data.startPage
        ? `第 ${data.startPage}-${data.endPage} 页`
        : `第 ${data.startPage} 页`
      : "";
    el("panel-meta").textContent = [range, data.charCount ? `约 ${data.charCount} 字` : ""]
      .filter(Boolean)
      .join(" · ");
    el("panel-keywords").innerHTML = (data.keywords || [])
      .map((k) => `<span>${escapeHtml(k)}</span>`)
      .join("");
    el("panel-summary").textContent = data.summary || "";
    el("panel-content").textContent = data.content || "（无内容）";
    contentWrap.classList.remove("hidden");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

el("panel-close").addEventListener("click", () => {
  panel.classList.add("hidden");
  selected = null;
});

/* ----------------------------- 下载 / 导出 ----------------------------- */
el("download-txt").addEventListener("click", () => {
  if (!selected) return;
  if (selected.type === "chunk") downloadChunkText(selected.data);
  else if (selected.type === "theme") downloadThemeText(selected.data);
  else if (selected.type === "root") exportBookMarkdown(selected.data);
});

el("export-md").addEventListener("click", () => {
  if (!selected) return;
  if (selected.type === "chunk") exportChunkMarkdown(selected.data);
  else if (selected.type === "theme") exportThemeMarkdown(selected.data);
  else if (selected.type === "root") exportBookMarkdown(selected.data);
});

exportBookBtn.addEventListener("click", () => {
  if (currentBook) exportBookMarkdown(currentBook);
});
