// 服务端 / MCP 共用的 Markdown 生成器（与前端 export.js 保持一致的输出格式）

function pageRange(chunk) {
  if (!chunk.startPage) return "";
  if (chunk.endPage && chunk.endPage !== chunk.startPage) {
    return `第 ${chunk.startPage}-${chunk.endPage} 页`;
  }
  return `第 ${chunk.startPage} 页`;
}

export function chunkToMarkdown(chunk, level = "###") {
  let md = `${level} ${chunk.title}\n\n`;
  const meta = [
    pageRange(chunk),
    chunk.charCount ? `约 ${chunk.charCount} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta) md += `*${meta}*\n\n`;
  if (chunk.keywords?.length) md += `**关键词：** ${chunk.keywords.join("、")}\n\n`;
  if (chunk.summary) md += `> ${chunk.summary}\n\n`;
  if (chunk.content) md += `${chunk.content}\n\n`;
  return md;
}

export function themeToMarkdown(theme) {
  let md = `# ${theme.title}\n\n`;
  if (theme.summary) md += `${theme.summary}\n\n`;
  for (const c of theme.chunks || []) md += chunkToMarkdown(c, "##");
  return md;
}

export function bookToMarkdown(book) {
  let md = `# ${book.title}\n\n`;
  if (book.summary) md += `## 全书总结\n\n${book.summary}\n\n`;
  if (book.stats) {
    md += `*共 ${book.stats.themes} 个主题 · ${book.stats.segments} 个内容块*\n\n`;
  }
  md += `---\n\n`;
  for (const theme of book.themes || []) {
    md += `## ${theme.title}\n\n`;
    if (theme.summary) md += `${theme.summary}\n\n`;
    for (const c of theme.chunks || []) md += chunkToMarkdown(c, "###");
    md += `\n`;
  }
  return md;
}
