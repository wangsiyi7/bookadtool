// 下载 / Markdown 导出工具

function download(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 把任意文件名清洗成安全形式
function safeName(name) {
  return (name || "untitled")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function pageRange(chunk) {
  if (!chunk.startPage) return "";
  if (chunk.endPage && chunk.endPage !== chunk.startPage) {
    return `第 ${chunk.startPage}-${chunk.endPage} 页`;
  }
  return `第 ${chunk.startPage} 页`;
}

/* ----------------------------- TXT 下载 ----------------------------- */

export function downloadChunkText(chunk) {
  const head = `# ${chunk.title}\n${pageRange(chunk)}\n\n`;
  download(`${safeName(chunk.title)}.txt`, head + (chunk.content || ""));
}

export function downloadThemeText(theme) {
  let out = `# ${theme.title}\n\n${theme.summary || ""}\n\n`;
  for (const c of theme.chunks) {
    out += `\n${"=".repeat(60)}\n## ${c.title}  ${pageRange(c)}\n\n${c.content || ""}\n`;
  }
  download(`${safeName(theme.title)}.txt`, out);
}

/* ----------------------------- Markdown 导出 ----------------------------- */

function chunkToMarkdown(chunk, level = "###") {
  let md = `${level} ${chunk.title}\n\n`;
  const range = pageRange(chunk);
  const meta = [range, chunk.charCount ? `约 ${chunk.charCount} 字` : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) md += `*${meta}*\n\n`;
  if (chunk.keywords?.length) md += `**关键词：** ${chunk.keywords.join("、")}\n\n`;
  if (chunk.summary) md += `> ${chunk.summary}\n\n`;
  if (chunk.content) md += `${chunk.content}\n\n`;
  return md;
}

export function exportChunkMarkdown(chunk) {
  download(`${safeName(chunk.title)}.md`, chunkToMarkdown(chunk, "#"));
}

export function exportThemeMarkdown(theme) {
  let md = `# ${theme.title}\n\n`;
  if (theme.summary) md += `${theme.summary}\n\n`;
  for (const c of theme.chunks) md += chunkToMarkdown(c, "##");
  download(`${safeName(theme.title)}.md`, md);
}

export function exportBookMarkdown(book) {
  let md = `# ${book.title}\n\n`;
  if (book.summary) md += `## 全书总结\n\n${book.summary}\n\n`;
  if (book.stats) {
    md += `*共 ${book.stats.themes} 个主题 · ${book.stats.segments} 个内容块*\n\n`;
  }
  md += `---\n\n`;
  for (const theme of book.themes) {
    md += `## ${theme.title}\n\n`;
    if (theme.summary) md += `${theme.summary}\n\n`;
    for (const c of theme.chunks) md += chunkToMarkdown(c, "###");
    md += `\n`;
  }
  download(`${safeName(book.title)}.md`, md);
}
