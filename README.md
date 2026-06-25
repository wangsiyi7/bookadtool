# 📚 bookadtool — PDF 智能语义切分 · 3D 组块可视化

把大部头 PDF 书籍，按 **内容语义**（而非简单的章节 / 页数）智能切分为相互关联的内容组块，
用 Three.js 在 3D 空间中可视化，并支持下载原文、导出 Markdown、查看 AI 生成的内容总结。

## ✨ 功能

1. **智能切分**：上传 PDF 后，AI 分析全文内容，依据语义与主题的连贯性识别内容边界，
   把整书切分为「书籍 → 主题 → 内容块」三层结构，转化为可视化子节点。
2. **3D 可视化**：基于 Three.js Web 3D 引擎，节点以球状力导向布局呈现，
   支持拖拽旋转、滚轮缩放、点击交互。
3. **功能支持**：
   - (a) 点击节点 → 直接下载该节点对应的原文（`.txt`）
   - (b) 支持导出 Markdown（单个内容块 / 单个主题 / 全书）
   - (c) 每个节点都附带 AI 生成的**内容总结**（不仅仅是机械拆分）

## 🧠 工作原理

```
PDF ──(pdf.js 前端提取文本+页码)──▶ 后端
                                     │
                          ┌──────────┴───────────┐
                          │ Map：分窗口让 Claude  │  按语义识别内容块边界
                          │ 给出标题/摘要/关键词/  │  + 由代码按边界切出真实原文
                          │ 段首定位文字           │
                          └──────────┬───────────┘
                                     │
                          ┌──────────┴───────────┐
                          │ Reduce：让 Claude 把   │  聚类成 4-9 个主题
                          │ 所有内容块聚类成主题   │  + 生成全书总结
                          └──────────┬───────────┘
                                     ▼
                       { 书籍 → 主题 → 内容块 } 层级树
                                     ▼
                          Three.js 3D 节点图
```

AI 只负责「判断语义边界 + 总结」，真实原文由代码按边界切片得到，保证下载内容忠于原书。
使用模型：`claude-opus-4-8`（可通过 `ANTHROPIC_MODEL` 覆盖）。

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 3. 启动
npm start
# 打开 http://localhost:3000
```

然后点击左上角「上传 PDF」，等待 AI 分析完成，即可在 3D 视图中浏览、点击节点下载与导出。

## 📂 目录结构

```
server.js            Express 后端（静态服务 + /api/analyze）
src/chunker.js       语义切分核心：Map（分窗口切分）+ Reduce（聚类+总结）
public/index.html    页面骨架
public/css/style.css 样式
public/js/app.js     主流程：PDF 提取 → 调用后端 → 渲染 → 交互
public/js/viz.js     Three.js 3D 可视化引擎
public/js/export.js  下载 / Markdown 导出
```

## ⚠️ 说明

- 仅支持**文本型 PDF**。扫描图片型 PDF 需先 OCR，本工具不内置 OCR。
- 超大书籍会被自动分窗口处理（默认上限 40 个窗口），分析时间随篇幅增长。
- 依赖联网加载 CDN 上的 Three.js / pdf.js（unpkg）。
