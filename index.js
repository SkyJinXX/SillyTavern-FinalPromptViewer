/**
 * 最终提示词查看器
 * 通过拦截 fetch 在请求真正发出前捕获最终 messages，
 * 所有 EJS 渲染、worldbook 注入都已完成。
 */
(function () {
    'use strict';

    let displayMessages = [];
    let pendingMessages = null;
    let panelVisible = false;

    // 每条消息当前激活的匹配索引
    const msgMatchIdx = {};

    // ─── 设置持久化 ──────────────────────────────────────────────────────────────

    const SETTINGS_KEY = 'fpv_settings';
    const settings = Object.assign(
        { showFloatBtn: true, btnX: null, btnY: null },
        (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; } })()
    );

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

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
                    if (panelVisible) {
                        pendingMessages = body.messages;
                        showNewDataHint();
                    } else {
                        displayMessages = body.messages;
                        pendingMessages = null;
                        showFloatBadge();
                    }
                }
            } catch (_) {}
        }
        return _origFetch.apply(this, arguments);
    };

    // ─── 工具函数 ───────────────────────────────────────────────────────────────

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function contentToHtml(content) {
        let text = '';
        if (typeof content === 'string') {
            text = content;
        } else if (Array.isArray(content)) {
            text = content
                .map(c => (c.type === 'text' ? c.text : c.type === 'image_url' ? '[图片]' : ''))
                .join('');
        }
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
        const other = text.length - cjk;
        return cjk + Math.ceil(other / 4);
    }

    // ─── 匹配导航 ───────────────────────────────────────────────────────────────

    /** 跳转到某条消息内的第 matchIdx 个高亮，并更新导轨 */
    function jumpToMatch(idx, matchIdx) {
        const body = document.getElementById(`fpv-body-${idx}`);
        if (!body) return;
        const marks = [...body.querySelectorAll('.fpv-hl')];
        if (!marks.length) return;

        const clampedIdx = (matchIdx % marks.length + marks.length) % marks.length;
        msgMatchIdx[idx] = clampedIdx;

        // 更新高亮样式
        marks.forEach((m, i) => m.classList.toggle('fpv-hl-active', i === clampedIdx));

        // 滚动到目标匹配词
        const target = marks[clampedIdx];
        body.scrollTo({ top: target.offsetTop - body.clientHeight / 3, behavior: 'smooth' });

        // 更新计数器
        const counter = document.getElementById(`fpv-nav-count-${idx}`);
        if (counter) counter.textContent = `${clampedIdx + 1} / ${marks.length}`;

        // 更新导轨激活刻度
        const map = document.getElementById(`fpv-map-${idx}`);
        if (map) {
            map.querySelectorAll('.fpv-map-tick').forEach((t, i) => {
                t.classList.toggle('fpv-map-tick-active', i === clampedIdx);
            });
        }
    }

    /** 在消息展开后初始化导航条和导轨 */
    function initMatchNav(idx) {
        const body = document.getElementById(`fpv-body-${idx}`);
        const nav = document.getElementById(`fpv-nav-${idx}`);
        const map = document.getElementById(`fpv-map-${idx}`);
        if (!body) return;

        const marks = [...body.querySelectorAll('.fpv-hl')];

        // ── 导航条 ──
        if (nav) {
            if (marks.length > 0) {
                nav.style.display = 'flex';
                const counter = document.getElementById(`fpv-nav-count-${idx}`);
                if (counter) counter.textContent = `1 / ${marks.length}`;
                msgMatchIdx[idx] = 0;
                marks.forEach((m, i) => m.classList.toggle('fpv-hl-active', i === 0));
                // 自动滚到第一个匹配
                body.scrollTo({ top: marks[0].offsetTop - body.clientHeight / 3, behavior: 'smooth' });
            } else {
                nav.style.display = 'none';
            }
        }

        // ── 导轨 minimap ──
        if (!map) return;
        map.innerHTML = '';
        if (!marks.length) return;

        const scrollH = body.scrollHeight;
        if (!scrollH) return;

        marks.forEach((mark, i) => {
            const pct = (mark.offsetTop / scrollH) * 100;
            const tick = document.createElement('div');
            tick.className = 'fpv-map-tick' + (i === 0 ? ' fpv-map-tick-active' : '');
            tick.style.top = `calc(${pct}% - 2px)`;
            tick.title = `匹配 ${i + 1}`;
            tick.addEventListener('click', e => {
                e.stopPropagation();
                jumpToMatch(idx, i);
            });
            map.appendChild(tick);
        });
    }

    window._fpvNavMatch = function (idx, dir) {
        const body = document.getElementById(`fpv-body-${idx}`);
        if (!body) return;
        const marks = body.querySelectorAll('.fpv-hl');
        if (!marks.length) return;
        jumpToMatch(idx, (msgMatchIdx[idx] ?? -1) + dir);
    };

    // ─── 新数据提示 ──────────────────────────────────────────────────────────────

    function showNewDataHint() {
        const hint = document.getElementById('fpv-new-hint');
        if (hint) hint.style.display = 'flex';
    }

    function hideNewDataHint() {
        const hint = document.getElementById('fpv-new-hint');
        if (hint) hint.style.display = 'none';
    }

    function applyPending() {
        if (pendingMessages) {
            displayMessages = pendingMessages;
            pendingMessages = null;
        }
        hideNewDataHint();
        renderMessages();
    }

    function showFloatBadge() {
        const badge = document.getElementById('fpv-badge');
        if (badge) badge.style.display = 'block';
    }

    // ─── 渲染面板内容 ───────────────────────────────────────────────────────────

    function renderMessages() {
        const container = document.getElementById('fpv-messages');
        const statsEl = document.getElementById('fpv-stats');
        const matchEl = document.getElementById('fpv-match-count');
        if (!container) return;

        if (!displayMessages.length) {
            container.innerHTML =
                '<div class="fpv-empty">还没有捕获到数据。<br>请先发送一条消息触发生成。</div>';
            if (statsEl) statsEl.textContent = '';
            if (matchEl) matchEl.textContent = '';
            return;
        }

        const query = (document.getElementById('fpv-search')?.value || '').toLowerCase().trim();
        let matchCount = 0;
        let totalTokens = 0;
        const total = displayMessages.length;

        const parts = displayMessages.map((msg, idx) => {
            const role = msg.role || 'unknown';
            const plain = rawText(msg.content);
            const tokens = estimateTokens(plain);
            totalTokens += tokens;

            const matched = !query || plain.toLowerCase().includes(query);
            if (query && matched) matchCount++;
            if (query && !matched) return '';

            const preview = plain.replace(/\s+/g, ' ').slice(0, 130) + (plain.length > 130 ? '…' : '');
            let bodyHtml = contentToHtml(msg.content);
            if (query) bodyHtml = highlight(bodyHtml, query);

            // 导航条只在有搜索词时渲染
            const navBar = query
                ? `<div class="fpv-msg-nav" id="fpv-nav-${idx}" style="display:none">
  <span class="fpv-nav-label">匹配位置：</span>
  <span class="fpv-nav-count" id="fpv-nav-count-${idx}">-</span>
  <button class="fpv-nav-btn" onclick="window._fpvNavMatch(${idx},-1)" title="上一处">▲</button>
  <button class="fpv-nav-btn" onclick="window._fpvNavMatch(${idx},1)" title="下一处">▼</button>
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
                ? `共 ${total} 条 &nbsp;·&nbsp; 显示 ${matchCount} 条匹配 &nbsp;·&nbsp; 总计 <strong>~${totalTokens.toLocaleString()} tokens</strong>`
                : `${total}/${total} 条消息 &nbsp;·&nbsp; 总计 <strong>~${totalTokens.toLocaleString()} tokens</strong> <span class="fpv-approx">（估算）</span>`;
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
        if (open) {
            // 等 DOM 渲染完再计算位置
            requestAnimationFrame(() => initMatchNav(idx));
        }
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

    // ─── 打开/关闭面板 ──────────────────────────────────────────────────────────

    function openPanel() {
        const panel = document.getElementById('fpv-panel');
        if (!panel) return;
        panel.style.display = 'flex';
        panelVisible = true;
        const badge = document.getElementById('fpv-badge');
        if (badge) badge.style.display = 'none';
        renderMessages();
    }

    function closePanel() {
        const panel = document.getElementById('fpv-panel');
        if (panel) panel.style.display = 'none';
        panelVisible = false;
        pendingMessages = null;
        hideNewDataHint();
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
        item.innerHTML = `
            <div class="fa-fw fa-solid fa-clipboard extensionsMenuExtensionButton"></div>
            <span>最终提示词查看器</span>
        `;
        item.addEventListener('click', () => {
            // 关闭菜单（如果 ST 暴露了关闭方法）
            document.getElementById('extensionsMenu')?.classList.remove('open');
            openPanel();
        });
        menu.appendChild(item);
    }

    // ─── 扩展设置面板 ────────────────────────────────────────────────────────────

    async function injectSettingsUI() {
        const container = document.getElementById('extensions_settings') ||
                          document.getElementById('extensions_settings2');
        if (!container) return;

        try {
            const res = await fetch('/scripts/extensions/third-party/final-prompt-viewer/settings.html');
            if (!res.ok) return;
            const html = await res.text();
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            container.appendChild(wrapper);
            bindSettingsUI();
        } catch (_) {}
    }

    function bindSettingsUI() {
        const cb = document.getElementById('fpv_show_float_btn');
        if (!cb) return;
        cb.checked = settings.showFloatBtn;
        cb.addEventListener('change', () => {
            settings.showFloatBtn = cb.checked;
            saveSettings();
            applyFloatBtnVisibility();
        });
    }

    function applyFloatBtnVisibility() {
        const btn = document.getElementById('fpv-btn');
        if (!btn) return;
        btn.style.display = settings.showFloatBtn ? 'flex' : 'none';
    }

    // ─── 构建 DOM ───────────────────────────────────────────────────────────────

    function buildUI() {
        const btn = document.createElement('div');
        btn.id = 'fpv-btn';
        btn.title = '最终提示词查看器';
        btn.innerHTML = `<span>📋</span><span id="fpv-badge"></span>`;
        btn.addEventListener('click', openPanel);
        // 恢复上次拖拽位置
        if (settings.btnX !== null && settings.btnY !== null) {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = settings.btnX + 'px';
            btn.style.top = settings.btnY + 'px';
        }
        applyFloatBtnVisibility();
        document.body.appendChild(btn);

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
<div id="fpv-new-hint">
  <span>🔔 检测到新的请求数据</span>
  <button onclick="window._fpvApplyPending()">加载新数据</button>
  <button onclick="window._fpvDismissHint()">忽略</button>
</div>
<div id="fpv-statusbar"><span id="fpv-stats"></span></div>
<div id="fpv-messages"></div>
`;
        document.body.appendChild(panel);

        window._fpvClose = closePanel;
        window._fpvApplyPending = applyPending;
        window._fpvDismissHint = hideNewDataHint;

        document.getElementById('fpv-search').addEventListener('input', () => renderMessages());

        // 面板拖拽（拖 header）
        let panelDragging = false, pox = 0, poy = 0;
        document.getElementById('fpv-header').addEventListener('mousedown', e => {
            if (e.target.closest('button, input')) return;
            panelDragging = true;
            const r = panel.getBoundingClientRect();
            pox = e.clientX - r.left;
            poy = e.clientY - r.top;
        });
        document.addEventListener('mousemove', e => {
            if (!panelDragging) return;
            panel.style.left = (e.clientX - pox) + 'px';
            panel.style.top = (e.clientY - poy) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => (panelDragging = false));

        // 悬浮按钮拖拽
        let btnMouseDown = false, btnDragging = false, box = 0, boy = 0;
        btn.addEventListener('mousedown', e => {
            btnMouseDown = true;
            btnDragging = false;
            box = e.clientX;
            boy = e.clientY;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!btnMouseDown) return; // 必须在鼠标按下状态才处理
            if (Math.abs(e.clientX - box) < 4 && Math.abs(e.clientY - boy) < 4) return;
            btnDragging = true;
            const r = btn.getBoundingClientRect();
            btn.style.left = (e.clientX - r.width / 2) + 'px';
            btn.style.top = (e.clientY - r.height / 2) + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (btnDragging) {
                settings.btnX = parseInt(btn.style.left);
                settings.btnY = parseInt(btn.style.top);
                saveSettings();
            }
            btnMouseDown = false;
            btnDragging = false;
        });
        btn.addEventListener('click', e => {
            if (btnDragging) { e.stopImmediatePropagation(); }
        });

        // 注册魔法棒菜单项（等 DOM 稳定后）
        const tryAddMenu = () => {
            if (document.getElementById('extensionsMenu')) {
                addMenuEntry();
            } else {
                setTimeout(tryAddMenu, 500);
            }
        };
        setTimeout(tryAddMenu, 300);

        // 注入设置 UI 到扩展面板
        injectSettingsUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }

    console.log('[最终提示词查看器] 已加载，fetch 拦截器已激活 ✓');
})();
