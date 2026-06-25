import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// 单个窗口的最大字符数（约 1.2 万 token）。整书会被切成若干窗口分别分析。
const WINDOW_CHARS = 40000;
// 窗口数量上限，超过则自动加大窗口，避免请求过多。
const MAX_WINDOWS = 40;

const client = new Anthropic(); // 读取 ANTHROPIC_API_KEY 环境变量

/* ----------------------------- 工具函数 ----------------------------- */

// 把字符串规范化（折叠空白、转小写），并保留 norm 下标 -> 原始下标 的映射。
function normalizeWithMap(s) {
  let norm = "";
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (!prevSpace) {
        norm += " ";
        map.push(i);
        prevSpace = true;
      }
    } else {
      norm += c.toLowerCase();
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

// 在窗口文本中定位某段落的起始字符下标（基于其开头若干词的模糊匹配）。
function locateOffset(windowText, normCtx, startsWith) {
  if (!startsWith) return -1;
  const needle = startsWith
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 60);
  if (!needle) return -1;
  const pos = normCtx.norm.indexOf(needle);
  if (pos === -1) {
    // 退化：只用前几个词再试一次
    const short = needle.split(" ").slice(0, 4).join(" ");
    const pos2 = short ? normCtx.norm.indexOf(short) : -1;
    if (pos2 === -1) return -1;
    return normCtx.map[pos2];
  }
  return normCtx.map[pos];
}

// 根据全局字符偏移与页起始偏移数组，估算页码（1-based）。
function pageForOffset(globalOffset, pageBreaks) {
  if (!pageBreaks || pageBreaks.length === 0) return null;
  let lo = 0;
  let hi = pageBreaks.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageBreaks[mid] <= globalOffset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1; // 转成 1-based 页码
}

// 把整书文本切成若干窗口，返回 [{ text, startChar }]。
function splitWindows(fullText) {
  let size = WINDOW_CHARS;
  if (fullText.length / size > MAX_WINDOWS) {
    size = Math.ceil(fullText.length / MAX_WINDOWS);
  }
  const windows = [];
  for (let i = 0; i < fullText.length; i += size) {
    windows.push({ text: fullText.slice(i, i + size), startChar: i });
  }
  return windows;
}

// 从 Claude 的结构化响应中取出第一个文本块并解析为 JSON。
function parseStructured(message) {
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("模型未返回文本内容");
  return JSON.parse(block.text);
}

/* ----------------------------- Map 阶段 ----------------------------- */
// 对单个窗口：让 AI 按语义识别段落边界（标题/摘要/关键词/段首文字）。

const SEGMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          startsWith: { type: "string" },
        },
        required: ["title", "summary", "keywords", "startsWith"],
      },
    },
  },
  required: ["segments"],
};

async function analyzeWindow(windowText, model) {
  const system =
    "你是一名资深的内容结构分析专家。你会拿到一本书的一段连续文本。" +
    "请基于**语义和主题的连贯性**（而不是页码或机械的字数）把它切分成若干内容块。" +
    "每个内容块应当是一个相对独立、围绕同一主题/概念展开的语义单元。" +
    "对每个内容块给出：title（精炼标题）、summary（1-3 句话概括其核心内容）、" +
    "keywords（3-6 个关键词）、startsWith（该内容块开头的前 8-12 个词，必须与原文逐字一致，用于定位边界）。" +
    "按它们在原文中出现的先后顺序排列。请使用与原文一致的语言作答。";

  const message = await client.messages.create({
    model: model || MODEL,
    max_tokens: 16000,
    system,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SEGMENT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content:
          "以下是需要切分的文本：\n\n<<<TEXT>>>\n" + windowText + "\n<<<END>>>",
      },
    ],
  });
  return parseStructured(message).segments || [];
}

/* ----------------------------- Reduce 阶段 ----------------------------- */
// 把所有段落（仅标题/摘要）聚类成主题层级，并生成全书标题与总结。

const THEME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bookTitle: { type: "string" },
    bookSummary: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          segmentIndexes: { type: "array", items: { type: "integer" } },
        },
        required: ["title", "summary", "segmentIndexes"],
      },
    },
  },
  required: ["bookTitle", "bookSummary", "themes"],
};

async function clusterSegments(segments, fallbackTitle, model) {
  const compact = segments.map((s, i) => ({
    index: i,
    title: s.title,
    summary: s.summary,
  }));

  const system =
    "你是一名内容架构师。你会拿到一本书被切分出的所有语义内容块（含序号、标题、摘要）。" +
    "请完成两件事：\n" +
    "1) 给出全书的 bookTitle（若已知书名则用书名）和 bookSummary（4-8 句话的整体总结，提炼全书脉络与核心观点）。\n" +
    "2) 把这些内容块聚类成 4-9 个 themes（主题）。每个主题给出 title、summary（2-4 句），" +
    "并在 segmentIndexes 中列出属于它的内容块序号。\n" +
    "约束：每个内容块必须且只能归入一个主题；所有序号都要被覆盖。请使用与内容一致的语言作答。";

  const message = await client.messages.create({
    model: model || MODEL,
    max_tokens: 16000,
    system,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: THEME_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content:
          "书名提示：" +
          (fallbackTitle || "（未知）") +
          "\n\n内容块列表（JSON）：\n" +
          JSON.stringify(compact),
      },
    ],
  });
  return parseStructured(message);
}

/* ----------------------------- 主流程 ----------------------------- */

export async function analyzeBook({ title, text, pageBreaks, model }, onProgress = () => {}) {
  if (!text || text.trim().length < 50) {
    throw new Error("文本内容太短，无法分析");
  }

  const windows = splitWindows(text);
  onProgress({ stage: "split", windows: windows.length });

  // Map：逐窗口分析，切出真实原文内容
  const allSegments = [];
  for (let w = 0; w < windows.length; w++) {
    const { text: wText, startChar } = windows[w];
    onProgress({ stage: "analyze", current: w + 1, total: windows.length });

    const segs = await analyzeWindow(wText, model);
    const normCtx = normalizeWithMap(wText);

    // 计算每个段落在窗口内的起始偏移
    const located = segs.map((s) => {
      let off = locateOffset(wText, normCtx, s.startsWith);
      return { ...s, localStart: off };
    });
    // 对定位失败的，用上一个/比例兜底，保证递增
    let lastOff = 0;
    for (let i = 0; i < located.length; i++) {
      if (located[i].localStart < 0 || located[i].localStart < lastOff) {
        located[i].localStart =
          located.length > 1
            ? Math.floor((wText.length * i) / located.length)
            : 0;
      }
      lastOff = located[i].localStart;
    }

    // 依据边界切出真实内容
    for (let i = 0; i < located.length; i++) {
      const start = located[i].localStart;
      const end =
        i + 1 < located.length ? located[i + 1].localStart : wText.length;
      const content = wText.slice(start, end).trim();
      const globalStart = startChar + start;
      const globalEnd = startChar + end;
      allSegments.push({
        title: located[i].title,
        summary: located[i].summary,
        keywords: located[i].keywords || [],
        content,
        charCount: content.length,
        startPage: pageForOffset(globalStart, pageBreaks),
        endPage: pageForOffset(globalEnd, pageBreaks),
      });
    }
  }

  if (allSegments.length === 0) {
    throw new Error("未能切分出任何内容块");
  }

  // Reduce：聚类成主题 + 全书总结
  onProgress({ stage: "cluster", segments: allSegments.length });
  const clustered = await clusterSegments(allSegments, title, model);

  // 组装层级树，并确保每个段落都被归类（漏掉的放进“其他”）
  const used = new Set();
  const themes = (clustered.themes || []).map((t, ti) => {
    const chunks = [];
    for (const idx of t.segmentIndexes || []) {
      if (idx >= 0 && idx < allSegments.length && !used.has(idx)) {
        used.add(idx);
        const s = allSegments[idx];
        chunks.push({
          id: `t${ti}-c${chunks.length}`,
          title: s.title,
          summary: s.summary,
          keywords: s.keywords,
          content: s.content,
          charCount: s.charCount,
          startPage: s.startPage,
          endPage: s.endPage,
        });
      }
    }
    return {
      id: `t${ti}`,
      title: t.title,
      summary: t.summary,
      chunks,
    };
  });

  const leftover = [];
  for (let i = 0; i < allSegments.length; i++) {
    if (!used.has(i)) leftover.push(allSegments[i]);
  }
  if (leftover.length > 0) {
    const ti = themes.length;
    themes.push({
      id: `t${ti}`,
      title: "其他内容",
      summary: "未被归入上述主题的内容块。",
      chunks: leftover.map((s, ci) => ({
        id: `t${ti}-c${ci}`,
        title: s.title,
        summary: s.summary,
        keywords: s.keywords,
        content: s.content,
        charCount: s.charCount,
        startPage: s.startPage,
        endPage: s.endPage,
      })),
    });
  }

  return {
    title: clustered.bookTitle || title || "未命名书籍",
    summary: clustered.bookSummary || "",
    stats: {
      windows: windows.length,
      segments: allSegments.length,
      themes: themes.length,
    },
    themes,
  };
}
