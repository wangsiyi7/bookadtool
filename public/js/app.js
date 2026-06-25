import * as pdfjsLib from "https://unpkg.com/pdfjs-dist@4.7.76/build/pdf.min.mjs";
import { BookGraph } from "./viz.js";
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

let graph;
let currentBook = null;
let selected = null; // { type, data }

/* ----------------------------- 初始化 3D ----------------------------- */
graph = new BookGraph(el("scene"));

/* ----------------------------- 上传与提取 ----------------------------- */
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  fileName.textContent = file.name;
  await processPdf(file);
  fileInput.value = ""; // 允许重复上传同一文件
});

async function processPdf(file) {
  try {
    showLoader("正在读取 PDF…", 5);
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    let fullText = "";
    const pageBreaks = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pageBreaks.push(fullText.length);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(" ");
      fullText += pageText + "\n\n";
      const pct = 5 + Math.round((p / pdf.numPages) * 35);
      showLoader(`正在提取文本… 第 ${p}/${pdf.numPages} 页`, pct);
    }

    if (fullText.trim().length < 50) {
      throw new Error(
        "未能从该 PDF 提取到文本（可能是扫描图片型 PDF，需要 OCR）。"
      );
    }

    showLoader("AI 正在分析内容并切分语义组块…", 45);
    const crawl = startCrawl(45, 92);

    const title = file.name.replace(/\.pdf$/i, "");
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text: fullText, pageBreaks }),
    });
    clearInterval(crawl);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `分析失败（HTTP ${resp.status}）`);
    }
    const book = await resp.json();
    showLoader("正在构建 3D 可视化…", 98);

    currentBook = book;
    graph.render(book, onSelectNode);

    hideLoader();
    welcome.classList.add("hidden");
    legend.classList.remove("hidden");
    exportBookBtn.disabled = false;
    statusEl.textContent = `${book.stats.themes} 个主题 · ${book.stats.segments} 个内容块`;
  } catch (err) {
    console.error(err);
    hideLoader();
    statusEl.textContent = "";
    alert("处理失败：" + (err.message || err));
  }
}

/* ----------------------------- 加载动画 ----------------------------- */
function showLoader(text, pct) {
  welcome.classList.add("hidden");
  loader.classList.remove("hidden");
  loaderText.textContent = text;
  if (typeof pct === "number") progressBar.style.width = pct + "%";
}
function hideLoader() {
  loader.classList.add("hidden");
  progressBar.style.width = "0%";
}
// AI 分析期间无法获得真实进度，用缓慢爬升模拟
function startCrawl(from, to) {
  let v = from;
  progressBar.style.width = v + "%";
  return setInterval(() => {
    v += (to - v) * 0.04;
    progressBar.style.width = v.toFixed(1) + "%";
  }, 600);
}

/* ----------------------------- 节点详情侧栏 ----------------------------- */
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
  else if (selected.type === "root") exportBookMarkdown(selected.data); // 书籍层用整书导出
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
