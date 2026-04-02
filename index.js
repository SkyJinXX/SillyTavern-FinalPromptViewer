/**
 * 最终提示词查看器
 * 通过拦截 fetch 捕获发往 AI 的最终 messages（含所有 EJS/worldbook 处理结果）。
 * 保留历史记录列表，方便区分"主对话"与"后台脚本"请求。
 */
// 在脚本同步执行阶段捕获自身路径（document.currentScript 只在此阶段有效）
const _fpvExtPath = (() => {
    const src = document.currentScript?.src || '';
    return src ? src.substring(0, src.lastIndexOf('/')) : '/scripts/extensions/third-party/final-prompt-viewer';
})();

(function () {
    'use strict';

    // ─── 状态 ───────────────────────────────────────────────────────────────────

    /** @type {Array<{id:number, ts:number, messages:any[], totalTokens:number, seen:boolean}>} */
    let captureHistory = [];
    let selectedIdx = -1;      // 当前查看的 capture 索引（captureHistory 中的下标）
    let captureSeq = 0;        // 自增 ID
    let panelVisible = false;
    const MAX_HISTORY = 20;

    const msgMatchIdx = {};    // 每条消息当前激活的匹配索引

    // ─── 设置持久化 ──────────────────────────────────────────────────────────────

    const SETTINGS_KEY = 'fpv_settings';
    const settings = Object.assign(
        { showFloatBtn: true, btnX: null, btnY: null },
        (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; } })()
    );
    function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

    // ─── Fetch 拦截器 ───────────────────────────────────────────────────────────

    const _origFetch = window.fetch;
    window.fetch = async function (url, options) {
        if (
            typeof url === 'string' &&
            url.includes('chat-completions/generate') &&
            options?.method === 'POST'
        ) {
            try {
                const body = JSON.parse(options.body);
                if (Array.isArray(body?.messages) && body.messages.length >= 2) {
                    addCapture(body.messages);
                }
            } catch (_) {}
        }
        return _origFetch.apply(this, arguments);
    };

    function addCapture(messages) {
        const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(rawText(m.content)), 0);
        const capture = {
            id: ++captureSeq,
            ts: Date.now(),
            messages,
            totalTokens,
            seen: false,
        };

        captureHistory.push(capture);
        if (captureHistory.length > MAX_HISTORY) captureHistory.shift();

        if (panelVisible) {
            // 面板开着：不切换视图，只刷新历史栏（新条目标为未读）
            renderHistoryBar();
            showFloatBadge(); // badge 也亮一下表示有新数据
        } else {
            // 面板关着：自动选中最新的
            selectedIdx = captureHistory.length - 1;
            showFloatBadge();
        }
    }

    // ─── 工具函数 ───────────────────────────────────────────────────────────────

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function contentToHtml(content) {
        let text = '';
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content))
            text = content.map(c => c.type === 'text' ? c.text : c.type === 'image_url' ? '[图片]' : '').join('');
        return escHtml(text).replace(/\n/g, '<br>');
    }

    function highlight(html, query) {
        if (!query) return html;
        const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return html.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="fpv-hl">$1</mark>');
    }

    function rawText(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map(c => c.text || '').join('');
        return '';
    }

    function estimateTokens(text) {
        const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
        return cjk + Math.ceil((text.length - cjk) / 4);
    }

    function fmtTime(ts) {
        const d = new Date(ts);
        return d.getHours().toString().padStart(2, '0') + ':' +
               d.getMinutes().toString().padStart(2, '0') + ':' +
               d.getSeconds().toString().padStart(2, '0');
    }

    // ─── 历史栏渲染 ──────────────────────────────────────────────────────────────

    function renderHistoryBar() {
        const bar = document.getElementById('fpv-history-bar');
        if (!bar) return;

        if (!captureHistory.length) {
            bar.innerHTML = '<span class="fpv-history-empty">暂无捕获记录，发送消息后自动出现</span>';
            return;  // no clear button needed when empty
        }

        // 消息最多的那条（通常是主对话）
        const maxMsgCount = Math.max(...captureHistory.map(c => c.messages.length));

        const items = captureHistory.map((cap, i) => {
            const isSelected = i === selectedIdx;
            const isLargest = cap.messages.length === maxMsgCount && captureHistory.filter(c => c.messages.length === maxMsgCount).length === 1;
            const newDot = !cap.seen && !isSelected ? '<span class="fpv-hist-new-dot"></span>' : '';
            const starLabel = isLargest ? ' ★' : '';
            const tokenStr = cap.totalTokens >= 1000
                ? (cap.totalTokens / 1000).toFixed(1) + 'k'
                : cap.totalTokens;

            return `<div class="fpv-hist-item${isSelected ? ' fpv-hist-selected' : ''}" 
                        data-hist-idx="${i}" 
                        onclick="window._fpvSelectCapture(${i})"
                        title="${fmtTime(cap.ts)} · ${cap.messages.length} 条消息 · ~${cap.totalTokens.toLocaleString()} tokens">
                ${newDot}
                <span class="fpv-hist-num">#${cap.id}</span>
                <span class="fpv-hist-meta">${cap.messages.length}条${starLabel}</span>
                <span class="fpv-hist-tokens">${tokenStr}</span>
            </div>`;
        });

        bar.innerHTML = items.join('') +
            `<button class="fpv-clear-btn-inline" onclick="window._fpvClearHistory()" title="清空历史记录">🗑</button>`;
    }

    window._fpvSelectCapture = function (i) {
        if (i < 0 || i >= captureHistory.length) return;
        selectedIdx = i;
        captureHistory[i].seen = true;
        renderHistoryBar();
        renderMessages();
    };

    window._fpvClearHistory = function () {
        captureHistory = [];
        selectedIdx = -1;
        captureSeq = 0;
        renderHistoryBar();
        renderMessages();
    };

    // ─── 匹配导航 ───────────────────────────────────────────────────────────────

    function jumpToMatch(idx, matchIdx) {
        const body = document.getElementById(`fpv-body-${idx}`);
        if (!body) return;
        const marks = [...body.querySelectorAll('.fpv-hl')];
        if (!marks.length) return;

        const ci = (matchIdx % marks.length + marks.length) % marks.length;
        msgMatchIdx[idx] = ci;
        marks.forEach((m, i) => m.classList.toggle('fpv-hl-active', i === ci));
        body.scrollTo({ top: marks[ci].offsetTop - body.clientHeight / 3, behavior: 'smooth' });

        const counter = document.getElementById(`fpv-nav-count-${idx}`);
        if (counter) counter.textContent = `${ci + 1} / ${marks.length}`;

        const map = document.getElementById(`fpv-map-${idx}`);
        if (map) map.querySelectorAll('.fpv-map-tick').forEach((t, i) => t.classList.toggle('fpv-map-tick-active', i === ci));
    }

    function initMatchNav(idx) {
        const body = document.getElementById(`fpv-body-${idx}`);
        const nav  = document.getElementById(`fpv-nav-${idx}`);
        const map  = document.getElementById(`fpv-map-${idx}`);
        if (!body) return;

        const marks = [...body.querySelectorAll('.fpv-hl')];

        if (nav) {
            if (marks.length) {
                nav.style.display = 'flex';
                const counter = document.getElementById(`fpv-nav-count-${idx}`);
                if (counter) counter.textContent = `1 / ${marks.length}`;
                msgMatchIdx[idx] = 0;
                marks.forEach((m, i) => m.classList.toggle('fpv-hl-active', i === 0));
                body.scrollTo({ top: marks[0].offsetTop - body.clientHeight / 3, behavior: 'smooth' });
            } else {
                nav.style.display = 'none';
            }
        }

        if (!map || !marks.length) return;
        map.innerHTML = '';
        const scrollH = body.scrollHeight;
        if (!scrollH) return;
        marks.forEach((mark, i) => {
            const tick = document.createElement('div');
            tick.className = 'fpv-map-tick' + (i === 0 ? ' fpv-map-tick-active' : '');
            tick.style.top = `calc(${(mark.offsetTop / scrollH) * 100}% - 2px)`;
            tick.title = `匹配 ${i + 1}`;
            tick.addEventListener('click', e => { e.stopPropagation(); jumpToMatch(idx, i); });
            map.appendChild(tick);
        });
    }

    window._fpvNavMatch = function (idx, dir) {
        const body = document.getElementById(`fpv-body-${idx}`);
        if (!body) return;
        if (!body.querySelectorAll('.fpv-hl').length) return;
        jumpToMatch(idx, (msgMatchIdx[idx] ?? -1) + dir);
    };

    // ─── 渲染消息列表 ────────────────────────────────────────────────────────────

    function renderMessages() {
        const container = document.getElementById('fpv-messages');
        const statsEl   = document.getElementById('fpv-stats');
        const matchEl   = document.getElementById('fpv-match-count');
        if (!container) return;

        const capture = captureHistory[selectedIdx];

        if (!capture) {
            container.innerHTML = '<div class="fpv-empty">暂无数据。<br>发送消息后点击上方历史条目查看。</div>';
            if (statsEl) statsEl.innerHTML = '';
            if (matchEl) matchEl.textContent = '';
            return;
        }

        const messages = capture.messages;
        const query = (document.getElementById('fpv-search')?.value || '').toLowerCase().trim();
        let matchCount = 0, totalTokens = 0;

        const parts = messages.map((msg, idx) => {
            const role  = msg.role || 'unknown';
            const plain = rawText(msg.content);
            const tokens = estimateTokens(plain);
            totalTokens += tokens;

            const matched = !query || plain.toLowerCase().includes(query);
            if (query && matched) matchCount++;
            if (query && !matched) return '';

            const preview = plain.replace(/\s+/g, ' ').slice(0, 130) + (plain.length > 130 ? '…' : '');
            let bodyHtml = contentToHtml(msg.content);
            if (query) bodyHtml = highlight(bodyHtml, query);

            const navBar = query ? `<div class="fpv-msg-nav" id="fpv-nav-${idx}" style="display:none">
  <span class="fpv-nav-label">匹配位置：</span>
  <span class="fpv-nav-count" id="fpv-nav-count-${idx}">-</span>
  <button class="fpv-nav-btn" onclick="window._fpvNavMatch(${idx},-1)">▲</button>
  <button class="fpv-nav-btn" onclick="window._fpvNavMatch(${idx},1)">▼</button>
</div>` : '';

            return `
<div class="fpv-msg fpv-role-${escHtml(role)}" data-idx="${idx}">
  <div class="fpv-msg-head" onclick="window._fpvToggle(${idx})">
    <span class="fpv-badge-role fpv-badge-${escHtml(role)}">${escHtml(role)}</span>
    <span class="fpv-preview">${escHtml(preview)}</span>
    <span class="fpv-token-count">~${tokens.toLocaleString()} tokens</span>
    <span class="fpv-chevron" id="fpv-chev-${idx}">▶</span>
  </div>
  ${navBar}
  <div class="fpv-body-wrap" id="fpv-wrap-${idx}">
    <div class="fpv-msg-body" id="fpv-body-${idx}">${bodyHtml}</div>
    <div class="fpv-minimap" id="fpv-map-${idx}"></div>
  </div>
</div>`;
        });

        container.innerHTML = parts.join('') ||
            `<div class="fpv-empty">没有匹配「${escHtml(query)}」的内容</div>`;

        if (statsEl) {
            statsEl.innerHTML = query
                ? `共 ${messages.length} 条 · 显示 ${matchCount} 条匹配 · 总计 <strong>~${totalTokens.toLocaleString()} tokens</strong>`
                : `${messages.length}/${messages.length} 条消息 · 总计 <strong>~${totalTokens.toLocaleString()} tokens</strong> <span class="fpv-approx">（估算）</span>`;
        }
        if (matchEl) matchEl.textContent = query ? `${matchCount} 条匹配` : '';
    }

    // ─── 折叠/展开 ──────────────────────────────────────────────────────────────

    window._fpvToggle = function (idx) {
        const wrap = document.getElementById(`fpv-wrap-${idx}`);
        const chev = document.getElementById(`fpv-chev-${idx}`);
        if (!wrap) return;
        const open = wrap.classList.toggle('fpv-wrap-open');
        if (chev) chev.textContent = open ? '▼' : '▶';
        if (open) requestAnimationFrame(() => initMatchNav(idx));
    };

    window._fpvExpandAll = function () {
        document.querySelectorAll('.fpv-body-wrap').forEach(el => {
            el.classList.add('fpv-wrap-open');
            const idx = el.closest('[data-idx]')?.dataset.idx;
            if (idx != null) requestAnimationFrame(() => initMatchNav(Number(idx)));
        });
        document.querySelectorAll('.fpv-chevron').forEach(el => (el.textContent = '▼'));
    };

    window._fpvCollapseAll = function () {
        document.querySelectorAll('.fpv-body-wrap').forEach(el => el.classList.remove('fpv-wrap-open'));
        document.querySelectorAll('.fpv-chevron').forEach(el => (el.textContent = '▶'));
    };

    // ─── 浮动按钮角标 ────────────────────────────────────────────────────────────

    function showFloatBadge() {
        const badge = document.getElementById('fpv-badge');
        if (badge) badge.style.display = 'block';
    }

    // ─── 打开/关闭面板 ──────────────────────────────────────────────────────────

    function openPanel() {
        const panel = document.getElementById('fpv-panel');
        if (!panel) return;
        panel.style.display = 'flex';
        panelVisible = true;
        const badge = document.getElementById('fpv-badge');
        if (badge) badge.style.display = 'none';
        // 标记当前选中为已读
        if (captureHistory[selectedIdx]) captureHistory[selectedIdx].seen = true;
        renderHistoryBar();
        renderMessages();
    }

    function closePanel() {
        const panel = document.getElementById('fpv-panel');
        if (panel) panel.style.display = 'none';
        panelVisible = false;
    }

    // ─── 魔法棒菜单 ──────────────────────────────────────────────────────────────

    function addMenuEntry() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return;
        const item = document.createElement('div');
        item.id = 'fpv-menu-item';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.setAttribute('role', 'listitem');
        item.title = '最终提示词查看器';
        item.innerHTML = `<div class="fa-fw fa-solid fa-clipboard extensionsMenuExtensionButton"></div><span>最终提示词查看器</span>`;
        item.addEventListener('click', () => { document.getElementById('extensionsMenu')?.classList.remove('open'); openPanel(); });
        menu.appendChild(item);
    }

    // ─── 扩展设置面板 ────────────────────────────────────────────────────────────

    async function injectSettingsUI() {
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (!container) return;
        try {
            const res = await fetch(`${_fpvExtPath}/settings.html`);
            if (!res.ok) return;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = await res.text();
            container.appendChild(wrapper);
            bindSettingsUI();
        } catch (_) {}
    }

    function bindSettingsUI() {
        const cb = document.getElementById('fpv_show_float_btn');
        if (!cb) return;
        cb.checked = settings.showFloatBtn;
        cb.addEventListener('change', () => { settings.showFloatBtn = cb.checked; saveSettings(); applyFloatBtnVisibility(); });
    }

    function applyFloatBtnVisibility() {
        const btn = document.getElementById('fpv-btn');
        if (btn) btn.style.display = settings.showFloatBtn ? 'flex' : 'none';
    }

    // ─── 构建 DOM ───────────────────────────────────────────────────────────────

    function buildUI() {
        // 浮动按钮
        const btn = document.createElement('div');
        btn.id = 'fpv-btn';
        btn.title = '最终提示词查看器';
        btn.innerHTML = `<span>📋</span><span id="fpv-badge"></span>`;
        btn.addEventListener('click', openPanel);
        if (settings.btnX !== null && settings.btnY !== null) {
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
            btn.style.left = settings.btnX + 'px'; btn.style.top = settings.btnY + 'px';
        }
        applyFloatBtnVisibility();
        document.body.appendChild(btn);

        // 主面板
        const panel = document.createElement('div');
        panel.id = 'fpv-panel';
        panel.innerHTML = `
<div id="fpv-header">
  <span id="fpv-title">📋 最终提示词查看器</span>
  <div id="fpv-toolbar">
    <input id="fpv-search" type="text" placeholder="搜索内容…" autocomplete="off" />
    <span id="fpv-match-count"></span>
    <button onclick="window._fpvExpandAll()">展开全部</button>
    <button onclick="window._fpvCollapseAll()">折叠全部</button>
    <button id="fpv-close-btn" onclick="window._fpvClose()">✕</button>
  </div>
</div>
<div id="fpv-history-bar">
  <span class="fpv-history-empty">暂无捕获记录，发送消息后自动出现</span>
</div>
<div id="fpv-statusbar"><span id="fpv-stats"></span></div>
<div id="fpv-messages"></div>
`;
        document.body.appendChild(panel);

        window._fpvClose = closePanel;

        document.getElementById('fpv-search').addEventListener('input', () => renderMessages());

        // 面板拖拽
        let panelDragging = false, pox = 0, poy = 0;
        document.getElementById('fpv-header').addEventListener('mousedown', e => {
            if (e.target.closest('button, input')) return;
            panelDragging = true;
            const r = panel.getBoundingClientRect();
            pox = e.clientX - r.left; poy = e.clientY - r.top;
        });
        document.addEventListener('mousemove', e => {
            if (!panelDragging) return;
            panel.style.left = (e.clientX - pox) + 'px';
            panel.style.top  = (e.clientY - poy) + 'px';
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => (panelDragging = false));

        // 浮动按钮拖拽
        let btnMouseDown = false, btnDragging = false, box = 0, boy = 0;
        btn.addEventListener('mousedown', e => { btnMouseDown = true; btnDragging = false; box = e.clientX; boy = e.clientY; e.preventDefault(); });
        document.addEventListener('mousemove', e => {
            if (!btnMouseDown) return;
            if (Math.abs(e.clientX - box) < 4 && Math.abs(e.clientY - boy) < 4) return;
            btnDragging = true;
            const r = btn.getBoundingClientRect();
            btn.style.left = (e.clientX - r.width / 2) + 'px';
            btn.style.top  = (e.clientY - r.height / 2) + 'px';
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (btnDragging) { settings.btnX = parseInt(btn.style.left); settings.btnY = parseInt(btn.style.top); saveSettings(); }
            btnMouseDown = false; btnDragging = false;
        });
        btn.addEventListener('click', e => { if (btnDragging) e.stopImmediatePropagation(); });

        // 菜单 & 设置
        const tryAddMenu = () => document.getElementById('extensionsMenu') ? addMenuEntry() : setTimeout(tryAddMenu, 500);
        setTimeout(tryAddMenu, 300);
        injectSettingsUI();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();

    console.log('[最终提示词查看器] 已加载，fetch 拦截器已激活 ✓');
})();
