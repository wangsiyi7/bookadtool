// 设置面板：状态管理 + localStorage 持久化 + 弹窗交互

const KEY = "bookadtool.settings";

const DEFAULTS = {
  model: "", // 留空 = 用服务器默认
  ocrMaxPages: 60,
  ocrBatch: 5,
  renderScale: 1.6,
  autoRotate: true,
};

let state = load();

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function getSettings() {
  return { ...state };
}

const $ = (id) => document.getElementById(id);

// 把 state 写进表单
function fill() {
  $("set-model").value = state.model;
  $("set-ocr-max").value = state.ocrMaxPages;
  $("set-ocr-batch").value = state.ocrBatch;
  $("set-scale").value = state.renderScale;
  $("set-scale-val").textContent = Number(state.renderScale).toFixed(1);
  $("set-autorotate").checked = state.autoRotate;
}

// 从表单读出
function read() {
  const clamp = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    model: $("set-model").value.trim(),
    ocrMaxPages: clamp($("set-ocr-max").value, 1, 500, DEFAULTS.ocrMaxPages),
    ocrBatch: clamp($("set-ocr-batch").value, 1, 20, DEFAULTS.ocrBatch),
    renderScale: clamp($("set-scale").value, 1, 3, DEFAULTS.renderScale),
    autoRotate: $("set-autorotate").checked,
  };
}

/**
 * 初始化设置弹窗。
 * @param {(s:object)=>void} onApply 设置保存后的回调（用于即时应用，如自动旋转）
 */
export function initSettings(onApply = () => {}) {
  const overlay = $("settings-overlay");
  const open = () => {
    fill();
    overlay.classList.remove("hidden");
  };
  const close = () => overlay.classList.add("hidden");

  $("open-settings").addEventListener("click", open);
  $("settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  $("set-scale").addEventListener("input", (e) => {
    $("set-scale-val").textContent = Number(e.target.value).toFixed(1);
  });
  $("settings-reset").addEventListener("click", () => {
    state = { ...DEFAULTS };
    save();
    fill();
    onApply(getSettings());
  });
  $("settings-save").addEventListener("click", () => {
    state = read();
    save();
    close();
    onApply(getSettings());
  });

  // 初次应用一次（例如自动旋转的初始值）
  onApply(getSettings());
}
