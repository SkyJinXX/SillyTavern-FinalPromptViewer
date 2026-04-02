# 开发记录 · AI 协作笔记

本文件记录开发过程中遇到的技术难点及解决方案，供后续维护参考。

---

## 问题一：扩展设置面板在 GitHub 安装后不显示

### 现象
通过 GitHub 链接安装扩展后，在 SillyTavern 的 Extensions 面板里看不到扩展的配置项（显示/隐藏悬浮按钮的开关）。本地克隆安装时正常。

### 根本原因
代码中使用了 `document.currentScript?.src` 来获取当前扩展的路径，用于动态加载 `settings.html`。

SillyTavern 以 **ES Module**（`type="module"`）方式加载所有扩展 JS。在 ES Module 上下文中，`document.currentScript` 始终为 `null`，导致路径解析失败，`settings.html` 无法注入。

### 解决方案
将路径获取方式改为 `import.meta.url`，这是 ES Module 环境下获取当前模块 URL 的标准方法：

```javascript
const _fpvExtPath = (() => {
    try {
        const url = import.meta.url;
        if (url) return url.substring(0, url.lastIndexOf('/'));
    } catch (_) {}
    const src = document.currentScript?.src || '';
    return src ? src.substring(0, src.lastIndexOf('/')) : '/scripts/extensions/third-party/final-prompt-viewer';
})();
```

---

## 问题二：import script.js 报 404

### 现象
将 `eventSource` 的导入路径改为绝对路径 `/scripts/script.js` 后，扩展加载失败并报错：

```
GET http://127.0.0.1:8123/scripts/script.js  404 (Not Found)
Extension "最终提示词查看器" failed to load: [object Event]
```

### 根本原因
SillyTavern 的 `script.js` 并不在 `public/scripts/` 目录下，而是在 `public/` **根目录**。

- 实际文件路径：`public/script.js`
- 正确 URL：`/script.js`
- 错误 URL：`/scripts/script.js`（❌ 不存在）

JS-Slash-Runner 的 bundle 也印证了这一点——它使用 `'../../../../../script.js'` 来从 `/scripts/extensions/third-party/JS-Slash-Runner/dist/` 向上五级找到 `/script.js`。

### 解决方案
```javascript
// ❌ 错误
import { eventSource, event_types } from '/scripts/script.js';

// ✅ 正确
import { eventSource, event_types } from '/script.js';
```

---

## 问题三：iframe 内的直接 fetch 无法被事件系统捕获

### 现象
用户工作流中有一个"数据库"JS 插件（via JS-Slash-Runner），该插件在每次对话时会：
1. **记忆召回**：发送 AI 请求，筛选相关记忆
2. **主对话**：ST 本体发送主要 AI 请求
3. **记忆更新**：发送 AI 请求，更新记忆库

扩展只能捕获到第 2、3 条请求，第 1 条记忆召回始终捕获不到。

### 诊断过程

**第一步：以为是 fetch 拦截时机问题。**
最初使用 `window.fetch` 拦截。在 `fetch` 拦截器中加入 `console.log`，发现第 1 条请求根本没有经过主窗口的 `fetch`。

**第二步：确认 iframe 隔离。**
JS-Slash-Runner 将用户脚本运行在独立的 `<iframe>` 中。每个 iframe 有自己独立的 `window.fetch`。替换主窗口的 `fetch` 对 iframe 内的调用完全无效。

**第三步：改用 ST 事件系统。**
改为监听 `eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY)`。该事件在 `openai.js` 的 `sendOpenAIRequest` 中触发。第 2、3 条请求走了这条路径，成功捕获。

**第四步：确认第 1 条请求的代码路径。**
通过下载数据库插件源码（`gcore.jsdelivr.net/gh/AlbusKen/shujuku@xingv2.6/index.js`）分析，发现其 `callAI` 函数有三条路径：

```javascript
if (effectiveApiMode === 'tavern') {
    // 路径 A：ConnectionManagerRequestService.sendRequest
} else if (effectiveApiConfig.useMainApi) {
    // 路径 B：TavernHelper.generateRaw → 触发 CHAT_COMPLETION_SETTINGS_READY
} else {
    // 路径 C：直接 fetch('/api/backends/chat-completions/generate', ...)
    //          ← 记忆召回走的是这条路！完全绕过事件系统
}
```

记忆召回使用了"独立 API 配置"模式（路径 C），直接从 iframe 内部 `fetch` ST 后端，既不触发 ST 事件，也不经过主窗口 `fetch`。

在 `CHAT_COMPLETION_SETTINGS_READY` 监听器中加入诊断日志后，也确认该事件对第 1 条请求完全没有触发。

### 解决方案
双策略捕获：

**策略一（事件监听）**：保留，覆盖走 `sendOpenAIRequest` / `generateRaw` 路径的请求。

**策略二（iframe fetch 补丁）**：
用 `MutationObserver` 监听所有 `<iframe>` 的创建，在 iframe 加载完成后立即替换其 `window.fetch`。被替换的 `fetch` 在检测到目标请求时，将 `messages` 数据通过 `window.postMessage` 发送到主窗口，主扩展监听 `message` 事件完成捕获。

```javascript
function patchIframeFetch(iframe) {
    const iwin = iframe.contentWindow;
    if (!iwin || iwin.__fpv_fetched) return;
    iwin.__fpv_fetched = true;
    const origFetch = iwin.fetch.bind(iwin);
    iwin.fetch = async function (url, options = {}) {
        const urlStr = typeof url === 'string' ? url : (url?.url || String(url));
        if (urlStr.includes('/api/backends/chat-completions/generate') && options.method === 'POST') {
            const data = JSON.parse(options.body);
            if (Array.isArray(data?.messages)) {
                window.postMessage({ _fpv: true, messages: data.messages }, '*');
            }
        }
        return origFetch(url, options);
    };
}

// 主窗口接收
window.addEventListener('message', e => {
    if (e.data?._fpv) addCapture(e.data.messages);
});
```

---

## 关键知识点汇总

| 知识点 | 说明 |
|--------|------|
| `document.currentScript` 在 ES Module 中为 `null` | 用 `import.meta.url` 代替 |
| ST 的 `script.js` 在 `public/` 根目录 | URL 为 `/script.js` 而非 `/scripts/script.js` |
| iframe 有独立的 `window.fetch` | 主窗口 fetch 拦截无法覆盖 iframe |
| `CHAT_COMPLETION_SETTINGS_READY` 仅在 `openai.js` 中触发 | 只覆盖走 ST 标准路径的请求 |
| `MutationObserver` + `load` 事件 | 可在 iframe 脚本执行前完成 fetch 补丁注入 |
