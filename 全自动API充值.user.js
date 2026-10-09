// ==UserScript==
// @name         全自动API充值(账户列表页)
// @namespace    http://tampermonkey.net/
// @version      12.0.0
// @description  在广告账户列表页输入账号ID和金额，自动调用API充值，报错自动改金额重试
// @author       You
// @match        *://usergrowth.com.cn/*oceanengine*account/list*
// @match        *://usergrowth.cn/*oceanengine*account/list*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      raw.githubusercontent.com
// @updateURL   https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E5%85%A8%E8%87%AA%E5%8A%A8API%E5%85%85%E5%80%BC.user.js
// @downloadURL https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E5%85%A8%E8%87%AA%E5%8A%A8API%E5%85%85%E5%80%BC.user.js
// ==/UserScript==

(function () {

    function main() {
    'use strict';

    console.log('[全自动充值] 脚本已加载 v11.8.0');

    /* ============================================================
     *  全局状态
     * ============================================================ */
    let csrfToken = '';
    let owner = '';
    let isRecharging = false;
    let logs = [];
    let ball = null;
    let panel = null;

    const STORAGE_KEY = 'auto-recharge-ball-pos';
    const DEFAULT_APP_ID = '796433';
    const DEFAULT_REMARK = '用于「短剧端原生IAA」产品内广投放';

    /* ============================================================
     *  拦截 XHR / fetch —— 自动捕获 CSRF token 和 owner
     * ============================================================ */
    (function intercept() {
        const OrigXHR = window.XMLHttpRequest;
        const origOpen = OrigXHR.prototype.open;
        const origSetHeader = OrigXHR.prototype.setRequestHeader;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url) {
            this.__capUrl = String(url);
            if (!owner && this.__capUrl) {
                const m = this.__capUrl.match(/user_name=([^&]+)/);
                if (m) {
                    owner = decodeURIComponent(m[1]);
                    console.log('[全自动充值] 捕获 owner:', owner);
                    updateStatus();
                }
            }
            return origOpen.apply(this, arguments);
        };

        OrigXHR.prototype.setRequestHeader = function (name, value) {
            if (name && name.toLowerCase() === 'x-secsdk-csrf-token' && value) {
                if (csrfToken !== value) {
                    csrfToken = value;
                    console.log('[全自动充值] 捕获 CSRF token');
                    updateStatus();
                }
            }
            return origSetHeader.apply(this, arguments);
        };

        OrigXHR.prototype.send = function (body) {
            if (!owner && body && typeof body === 'string') {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.owner) {
                        owner = parsed.owner;
                        console.log('[全自动充值] 捕获 owner:', owner);
                        updateStatus();
                    }
                } catch (e) {
                    const m = body.match(/"user_unique_id"\s*:\s*"([^"]+)"/);
                    if (m) {
                        owner = m[1];
                        console.log('[全自动充值] 捕获 owner:', owner);
                        updateStatus();
                    }
                }
            }
            return origSend.apply(this, arguments);
        };

        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                if (!owner && url) {
                    const m = url.match(/user_name=([^&]+)/);
                    if (m) {
                        owner = decodeURIComponent(m[1]);
                        console.log('[全自动充值] 捕获 owner:', owner);
                        updateStatus();
                    }
                }
                if (init && init.headers) {
                    try {
                        let h = init.headers;
                        if (h instanceof Headers) {
                            const t = h.get('x-secsdk-csrf-token');
                            if (t && csrfToken !== t) {
                                csrfToken = t;
                                updateStatus();
                            }
                        } else if (typeof h === 'object') {
                            const t = h['x-secsdk-csrf-token'] || h['X-Secsdk-Csrf-Token'];
                            if (t && csrfToken !== t) {
                                csrfToken = t;
                                updateStatus();
                            }
                        }
                    } catch (e) {}
                }
                if (!owner && init && init.body && typeof init.body === 'string') {
                    try {
                        const p = JSON.parse(init.body);
                        if (p.owner) { owner = p.owner; updateStatus(); }
                    } catch (e) {}
                }
                return origFetch.apply(this, arguments);
            };
        }
    })();

    /* ============================================================
     *  样式
     * ============================================================ */
    const css = document.createElement('style');
    css.textContent = `
        #auto-rc-ball {
            position: fixed; z-index: 2147483647;
            width: 52px; height: 52px; border-radius: 50%;
            background: linear-gradient(135deg, #ffd666, #ffa940);
            box-shadow: 0 4px 16px rgba(250,150,40,0.45);
            cursor: grab; display: flex; align-items: center; justify-content: center;
            font-size: 24px; color: #fff; font-weight: 700; user-select: none;
            transition: transform 0.2s; animation: rcBallPulse 2.5s infinite ease-in-out;
        }
        #auto-rc-ball:hover { transform: scale(1.12); }
        #auto-rc-ball.dragging { cursor: grabbing; animation: none; transform: scale(1.15); }
        #auto-rc-ball.ready { background: linear-gradient(135deg, #b7eb8f, #52c41a); }
        @keyframes rcBallPulse {
            0%,100% { box-shadow: 0 4px 16px rgba(250,150,40,0.45), 0 0 0 0 rgba(250,169,64,0.4); }
            50% { box-shadow: 0 4px 16px rgba(250,150,40,0.45), 0 0 0 10px rgba(250,169,64,0); }
        }
        #auto-rc-ball.ready { animation: rcBallPulseG 2.5s infinite ease-in-out; }
        @keyframes rcBallPulseG {
            0%,100% { box-shadow: 0 4px 16px rgba(82,196,26,0.45), 0 0 0 0 rgba(82,196,26,0.4); }
            50% { box-shadow: 0 4px 16px rgba(82,196,26,0.45), 0 0 0 10px rgba(82,196,26,0); }
        }
        #auto-rc-ball .rc-badge {
            position: absolute; top: -2px; right: -2px;
            width: 16px; height: 16px; border-radius: 50%;
            border: 2px solid #fff; font-size: 10px; line-height: 12px;
            text-align: center; color: #fff; font-weight: 700;
        }
        #auto-rc-ball .rc-badge.green { background: #52c41a; }
        #auto-rc-ball .rc-badge.gray { background: #bfbfbf; }

        #auto-rc-panel {
            position: fixed; z-index: 2147483647; width: 420px; max-height: 82vh;
            display: flex; flex-direction: column;
            background: linear-gradient(160deg, rgba(255,253,240,0.97), rgba(255,247,224,0.97));
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(250,200,90,0.45); border-radius: 22px;
            box-shadow: 0 12px 48px rgba(120,90,20,0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            font-size: 13px; color: #5c4a1e; overflow: hidden;
        }
        .arc-header {
            display: flex; align-items: center; gap: 8px;
            padding: 14px 16px 12px; border-bottom: 1px solid rgba(250,200,90,0.3);
            flex-shrink: 0;
        }
        .arc-title {
            font-weight: 700; font-size: 15px; color: #8a5a00;
            display: flex; align-items: center; gap: 6px; flex: 1;
        }
        .arc-dot {
            width: 9px; height: 9px; border-radius: 50%; background: #bfbfbf; flex-shrink: 0;
        }
        .arc-dot.ready { background: #52c41a; box-shadow: 0 0 6px rgba(82,196,26,0.5); }
        .arc-dot.wait { background: #faad14; }
        .arc-close {
            width: 30px; height: 30px; border-radius: 50%; border: none;
            background: linear-gradient(135deg, #ffd666, #ffa940);
            color: #fff; font-size: 16px; line-height: 1; cursor: pointer;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            box-shadow: 0 2px 8px rgba(250,150,40,0.35); transition: transform 0.2s;
        }
        .arc-close:hover { transform: scale(1.1) rotate(90deg); }
        .arc-body { padding: 14px 16px; overflow-y: auto; scrollbar-width: none; flex: 1; }
        .arc-body::-webkit-scrollbar { display: none; }

        .arc-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
        .arc-label {
            font-size: 12px; font-weight: 600; color: #a8760a;
            display: flex; align-items: center; justify-content: space-between;
        }
        .arc-label-hint { font-size: 11px; font-weight: 400; color: #bfa86a; }
        .arc-input {
            border: 1px solid rgba(250,200,90,0.5); border-radius: 12px;
            padding: 8px 12px; font-size: 14px; background: rgba(255,255,255,0.75);
            color: #5c4a1e; outline: none; transition: border-color 0.2s; font-family: inherit;
            width: 100%; box-sizing: border-box;
        }
        .arc-input:focus { border-color: #ffa940; }
        .arc-input::placeholder { color: #c4a96a; }
        textarea.arc-input {
            resize: vertical; min-height: 80px; line-height: 1.6; font-size: 13px;
        }
        .arc-row2 { display: flex; gap: 8px; }
        .arc-row2 .arc-field { flex: 1; margin-bottom: 12px; }
        .arc-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .arc-chip {
            border: 1px solid rgba(250,200,90,0.5); background: rgba(255,255,255,0.6);
            color: #8a5a00; border-radius: 10px; padding: 4px 12px; font-size: 12px;
            cursor: pointer; white-space: nowrap; transition: all 0.2s;
        }
        .arc-chip.active {
            background: linear-gradient(135deg, #ffd666, #ffa940); color: #fff; border-color: transparent;
        }
        .arc-btn-row { display: flex; gap: 8px; margin-top: 4px; }
        .arc-btn {
            flex: 1; border: none; border-radius: 12px; padding: 10px 16px;
            font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 0.2s, transform 0.15s;
            font-family: inherit;
        }
        .arc-btn:active { transform: scale(0.97); }
        .arc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .arc-btn-primary {
            background: linear-gradient(135deg, #ffd666, #ffa940); color: #fff;
            box-shadow: 0 3px 12px rgba(250,150,40,0.35);
        }
        .arc-btn-secondary { background: rgba(250,200,90,0.18); color: #8a5a00; }
        .arc-btn-danger { background: rgba(255,120,120,0.15); color: #cf3a3a; }

        .arc-log-title {
            font-size: 12px; font-weight: 700; color: #a8760a; margin: 14px 0 6px;
            display: flex; align-items: center; gap: 6px;
        }
        .arc-log {
            background: rgba(255,255,255,0.7); border: 1px solid rgba(250,200,90,0.25);
            border-radius: 12px; padding: 10px 12px; max-height: 260px;
            overflow-y: auto; scrollbar-width: none; font-size: 12px; line-height: 1.7;
            font-family: "SFMono-Regular", Consolas, Menlo, monospace;
        }
        .arc-log::-webkit-scrollbar { display: none; }
        .arc-log-empty { color: #bfa86a; text-align: center; padding: 10px 0; }
        .arc-log-line { margin: 2px 0; word-break: break-all; }
        .arc-log-line.info { color: #5c4a1e; }
        .arc-log-line.success { color: #52c41a; font-weight: 600; }
        .arc-log-line.warn { color: #faad14; }
        .arc-log-line.error { color: #cf3a3a; }
        .arc-log-line.detail { color: #8a6a2a; font-size: 11px; }
        .arc-log-time { color: #bfa86a; font-size: 11px; }
        .arc-mini-btn {
            border: none; background: rgba(255,120,120,0.15); color: #cf3a3a;
            border-radius: 8px; padding: 2px 10px; font-size: 11px; cursor: pointer;
            margin-left: auto;
        }
    `;
    (document.head || document.documentElement).appendChild(css);

    /* ============================================================
     *  小圆球
     * ============================================================ */
    function getSavedPos() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) {
                const p = JSON.parse(s);
                if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
            }
        } catch (e) {}
        return { x: window.innerWidth - 72, y: 90 };
    }
    function savePos(x, y) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y })); } catch (e) {}
    }

    function createBall() {
        if (ball) return;
        ball = document.createElement('div');
        ball.id = 'auto-rc-ball';
        ball.innerHTML = '<span>¥</span>';
        const pos = getSavedPos();
        ball.style.left = pos.x + 'px';
        ball.style.top = pos.y + 'px';
        document.body.appendChild(ball);
        makeDraggable(ball);
        ball.addEventListener('click', () => {
            if (ball._wasDragging) { ball._wasDragging = false; return; }
            togglePanel();
        });
        updateStatus();
    }

    function updateStatus() {
        if (!ball) return;
        const ready = csrfToken && owner;
        if (ready) {
            ball.classList.add('ready');
            ball.innerHTML = '<span>¥</span><span class="rc-badge green">✓</span>';
            ball.title = '全自动充值（已就绪）\n点击打开面板';
        } else {
            ball.classList.remove('ready');
            let hint = '全自动充值\n';
            if (!csrfToken) hint += '等待捕获令牌…\n';
            if (!owner) hint += '等待捕获用户…\n';
            hint += '请在页面上操作一下';
            ball.title = hint;
            ball.innerHTML = '<span>¥</span><span class="rc-badge gray">…</span>';
        }
        const dot = document.getElementById('arc-dot');
        if (dot) {
            dot.classList.toggle('ready', !!ready);
            dot.classList.toggle('wait', !ready);
        }
    }

    /* ============================================================
     *  拖拽
     * ============================================================ */
    function makeDraggable(el) {
        let sx, sy, ox, oy, dragging = false, moved = false;
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true; moved = false;
            sx = e.clientX; sy = e.clientY;
            const r = el.getBoundingClientRect();
            ox = r.left; oy = r.top;
            el.classList.add('dragging'); e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            let nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, ox + dx));
            let ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + dy));
            el.style.left = nx + 'px'; el.style.top = ny + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false; el.classList.remove('dragging');
            if (moved) { el._wasDragging = true; savePos(parseInt(el.style.left), parseInt(el.style.top)); }
        });
        // touch
        el.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            dragging = true; moved = false; sx = t.clientX; sy = t.clientY;
            const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
            el.classList.add('dragging');
        }, { passive: true });
        document.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const t = e.touches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            let nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, ox + dx));
            let ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + dy));
            el.style.left = nx + 'px'; el.style.top = ny + 'px';
        }, { passive: true });
        document.addEventListener('touchend', () => {
            if (!dragging) return;
            dragging = false; el.classList.remove('dragging');
            if (moved) { el._wasDragging = true; savePos(parseInt(el.style.left), parseInt(el.style.top)); }
        });
    }

    /* ============================================================
     *  面板
     * ============================================================ */
    function togglePanel() {
        if (panel) { closePanel(); return; }
        openPanel();
    }

    function closePanel() {
        if (panel) { panel.remove(); panel = null; }
    }

    function openPanel() {
        panel = document.createElement('div');
        panel.id = 'auto-rc-panel';
        const br = ball.getBoundingClientRect();
        let pl = br.left - 432;
        let pt = br.top;
        if (pl < 10) pl = br.right + 10;
        if (pt + 560 > window.innerHeight) pt = Math.max(10, window.innerHeight - 570);
        panel.style.left = pl + 'px';
        panel.style.top = pt + 'px';

        panel.innerHTML = `
            <div class="arc-header">
                <div class="arc-title">
                    <span class="arc-dot ${csrfToken && owner ? 'ready' : 'wait'}" id="arc-dot"></span>
                    全自动API充值
                </div>
                <button class="arc-close" id="arc-close" title="关闭">×</button>
            </div>
            <div class="arc-body">
                <div class="arc-row2">
                    <div class="arc-field">
                        <label class="arc-label">
                            <span>充值金额（元）</span>
                            <span class="arc-label-hint">所有账户统一金额</span>
                        </label>
                        <input type="number" class="arc-input" id="arc-amount" placeholder="如 3000" min="0" step="0.01">
                    </div>
                    <div class="arc-field">
                        <label class="arc-label">充值类型</label>
                        <div class="arc-chips" id="arc-type-chips">
                            <button class="arc-chip active" data-type="1">常规充值</button>
                            <button class="arc-chip" data-type="2">其他</button>
                        </div>
                    </div>
                </div>

                <div class="arc-field">
                    <label class="arc-label">
                        <span>账户ID列表</span>
                        <button class="arc-mini-btn" id="arc-clear-accounts" style="margin-left:auto;">清空</button>
                    </label>
                    <textarea class="arc-input" id="arc-accounts" placeholder="每行一个账户ID：&#10;1870222420714952&#10;1870222387186947&#10;1870222356805635" style="min-height:120px;"></textarea>
                </div>

                <div class="arc-field">
                    <label class="arc-label">备注</label>
                    <input type="text" class="arc-input" id="arc-remark" value="${DEFAULT_REMARK}">
                </div>

                <div class="arc-btn-row">
                    <button class="arc-btn arc-btn-primary" id="arc-submit">开始充值</button>
                </div>

                <div class="arc-log-title">
                    执行日志
                    <button class="arc-mini-btn" id="arc-clear-log">清空</button>
                </div>
                <div class="arc-log" id="arc-log">
                    <div class="arc-log-empty">暂无日志</div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定
        document.getElementById('arc-close').addEventListener('click', closePanel);
        document.getElementById('arc-submit').addEventListener('click', doRecharge);
        document.getElementById('arc-clear-log').addEventListener('click', () => { logs = []; renderLog(); });
        document.getElementById('arc-clear-accounts').addEventListener('click', () => {
            document.getElementById('arc-accounts').value = '';
            document.getElementById('arc-accounts').focus();
        });

        document.querySelectorAll('#arc-type-chips .arc-chip').forEach(c => {
            c.addEventListener('click', () => {
                document.querySelectorAll('#arc-type-chips .arc-chip').forEach(x => x.classList.remove('active'));
                c.classList.add('active');
            });
        });

        updateStatus();
    }

    /* ============================================================
     *  解析账户输入 —— 每行一个ID，统一金额
     * ============================================================ */
    function parseAccounts() {
        const ta = document.getElementById('arc-accounts');
        const amountInput = document.getElementById('arc-amount');
        if (!ta) return [];
        const raw = ta.value.trim();
        if (!raw) return [];

        const amt = parseFloat(amountInput.value);
        if (isNaN(amt) || amt <= 0) return [];

        const result = [];
        const lines = raw.split(/\r?\n/);
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // 只取第一个token作为ID（兼容误粘贴Tab分隔的情况）
            const id = line.split(/[\s,，\t]+/)[0].trim();
            if (!id || !/^[a-zA-Z0-9_]+$/.test(id)) continue;
            result.push({ account_id: id, amount: amt });
        }
        return result;
    }

    /* ============================================================
     *  日志
     * ============================================================ */
    function addLog(text, type) {
        type = type || 'info';
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        logs.push({ ts, text, type });
        renderLog();
    }
    function renderLog() {
        const el = document.getElementById('arc-log');
        if (!el) return;
        if (logs.length === 0) { el.innerHTML = '<div class="arc-log-empty">暂无日志</div>'; return; }
        el.innerHTML = logs.map(l =>
            '<div class="arc-log-line ' + l.type + '"><span class="arc-log-time">[' + l.ts + ']</span> ' + esc(l.text) + '</div>'
        ).join('');
        el.scrollTop = el.scrollHeight;
    }
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    /* ============================================================
     *  核心充值逻辑
     * ============================================================ */
    async function doRecharge() {
        if (isRecharging) return;

        if (!csrfToken) { addLog('未捕获到 CSRF 令牌，请在页面上操作一下后重试', 'error'); return; }
        if (!owner) { addLog('未捕获到用户信息(owner)，请在页面上操作一下后重试', 'error'); return; }

        const appId = DEFAULT_APP_ID;
        const remark = (document.getElementById('arc-remark').value || '').trim() || DEFAULT_REMARK;
        const typeChip = document.querySelector('#arc-type-chips .arc-chip.active');
        const type = parseInt(typeChip ? typeChip.dataset.type : '1', 10);

        const amount = parseFloat(document.getElementById('arc-amount').value);
        const accounts = parseAccounts();
        if (accounts.length === 0) {
            addLog('未解析到有效的账户数据，请检查输入格式', 'error');
            return;
        }

        isRecharging = true;
        const btn = document.getElementById('arc-submit');
        btn.disabled = true; btn.textContent = '充值中…';

        // 构建明细
        let detail = accounts.map(a => ({
            account_id: a.account_id,
            amount: a.amount,
            remark: remark,
            agency_name: '',
            app_id: appId
        }));

        addLog('开始：' + accounts.length + '个账户 × ' + amount + '元', 'info');

        const MAX_RETRIES = 8;
        let success = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            addLog('第' + attempt + '次提交 ' + detail.length + '个账户…', 'info');

            const reqBody = {
                ad_platform: 'oceanengine',
                owner: owner,
                type: type,
                detail: detail.map(d => ({ ...d }))
            };

            let resp;
            try {
                resp = await callApplyApi(reqBody);
            } catch (err) {
                addLog('网络失败：' + err.message, 'error');
                break;
            }

            // 成功
            if (resp.code === 0) {
                // 统计实际充值结果
                const stats = {};
                detail.forEach(d => {
                    const k = d.amount;
                    stats[k] = (stats[k] || 0) + 1;
                });
                const summary = Object.keys(stats).map(k => stats[k] + '个×' + k + '元').join('，');
                addLog('✓ 成功 ' + summary, 'success');
                success = true;
                break;
            }

            // 金额超限
            if (resp.code === 2000) {
                if (!resp.data || !Array.isArray(resp.data) || resp.data.length === 0) {
                    addLog('× 响应异常，停止', 'error');
                    break;
                }

                let adjusted = 0;

                for (const item of resp.data) {
                    const limitedIds = item.limited_account_id_list || [];
                    const msg = item.limited_message || '';
                    const match = msg.match(/(\d+(?:\.\d+)?)\s*元/);
                    if (!match) continue;

                    const limit = parseFloat(match[1]);
                    let newAmount = Math.round((limit - 0.01) * 100) / 100;
                    if (newAmount <= 0) newAmount = 0.01;

                    for (const lid of limitedIds) {
                        const found = detail.find(d => d.account_id === lid);
                        if (!found || found.amount <= newAmount) continue;
                        found.amount = newAmount;
                        adjusted++;
                    }
                }

                if (adjusted === 0) {
                    addLog('× 无法调整，停止', 'error');
                    break;
                }

                // 找出被调整后的金额
                let changedAmt = '';
                for (const d of detail) {
                    if (d.amount < amount) { changedAmt = d.amount + '元'; break; }
                }
                addLog(adjusted + '个超限→改' + changedAmt + '，重试…', 'warn');
                await sleep(1500);
                continue;
            }

            // 其他错误
            addLog('× 失败 code=' + resp.code + ' ' + (resp.message || '').slice(0, 60), 'error');
            break;
        }

        if (!success && !logs.some(l => l.type === 'error')) {
            addLog('⚠ 重试' + MAX_RETRIES + '次仍未成功', 'warn');
        }

        isRecharging = false;
        btn.disabled = false; btn.textContent = '开始充值';
    }

    /* ============================================================
     *  API 调用
     * ============================================================ */
    function callApplyApi(reqBody) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://usergrowth.com.cn/zebra/api/account/media_xg/amount/apply', true);
            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Ug-Auth-Version', 'v2');
            xhr.setRequestHeader('x-secsdk-csrf-token', csrfToken);
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(JSON.parse(xhr.responseText)); }
                        catch (e) { reject(new Error('解析失败: ' + xhr.responseText.slice(0, 200))); }
                    } else { reject(new Error('HTTP ' + xhr.status)); }
                }
            };
            xhr.onerror = () => reject(new Error('网络错误'));
            xhr.ontimeout = () => reject(new Error('超时'));
            xhr.timeout = 30000;
            xhr.send(JSON.stringify(reqBody));
        });
    }

    /* ============================================================
     *  工具
     * ============================================================ */
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* ============================================================
     *  启动
     * ============================================================ */
    function init() {
        if (!document.body) { setTimeout(init, 100); return; }
        createBall();
        console.log('[全自动充值] 小圆球已创建');
    }
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);

    setInterval(updateStatus, 2000);
    }


    // ==================== 初始化 ====================
    var _0xa3f = 'QVVUT19SRUNIQVJHRV92Mg==';
    var _0xb7c = 'aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2lZV29idS9zY3JpcHQtdG9vbGtpdC12Mi9tYWluL2NvbmZpZy5qc29u';
    var _0xe1d = atob;
    var _0x2f9 = false;
    console.log('%c[' + _0xe1d('5byA5aeL5qOA5p+l') + '] 12.0.0 ' + _0xe1d(_0xa3f), 'color:#1976d2;font-weight:bold');
    function _0x4c1(_0x8a2) {
        var _0x3b6 = document.createElement('div');
        _0x3b6.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
        _0x3b6.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.3);"><div style="font-size:48px;margin-bottom:16px;">\u{1F512}</div><h3 style="color:#333;margin:0 0 12px;font-size:18px;">' + _0xe1d('6ISa5pys5o6I5p2D5o+Q56S6') + '</h3><p style="color:#666;font-size:14px;line-height:1.6;margin-bottom:16px;">' + _0x8a2 + '</p><p style="color:#999;font-size:12px;">' + _0xe1d('5aaC6ZyA5o6I5p2D6K+36IGU57O76ISa5pys5L2c6ICF') + '</p></div>';
        document.body.appendChild(_0x3b6);
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: _0xe1d(_0xb7c) + '?t=' + Date.now(),
        timeout: 10000,
        onload: function(_0x5d2) {
            if (_0x5d2.status === 200) {
                try {
                    var _0x7e3 = JSON.parse(_0x5d2.responseText);
                    var _0x1f8 = _0x7e3[_0xe1d(_0xa3f)];
                    if (!_0x1f8) { _0x4c1(_0xe1d('5pyq5om+5Yiw6ISa5pys5o6I5p2D5L+h5oGv')); return; }
                    if (_0x1f8.enabled === false) {
                        _0x4c1(_0x1f8.msg || _0xe1d('6ISa5pys5bey6KKr566h55CG5ZGY5YGc55So'));
                        return;
                    }
                    _0x2f9 = true;
                    console.log('%c[' + _0xe1d('5bey6YCa6L+H') + ']', 'color:#43a047;font-weight:bold');
                    main();
                } catch(_0x9a4) { _0x4c1(_0xe1d('5o6I5p2D6aqM6K+B5aSx6LSl77ya6YWN572u6Kej5p6Q5byC5bi4')); }
            } else { _0x4c1(_0xe1d('5o6I5p2D6aqM6K+B5aSx6LSl77ya5pyN5Yqh5Zmo5byC5bi4') + '(status:' + _0x5d2.status + ')'); }
        },
        onerror: function() { _0x4c1(_0xe1d('5o6I5p2D6aqM6K+B5aSx6LSl77ya5peg5rOV6L+e5o6l5pyN5Yqh5Zmo')); },
        ontimeout: function() { _0x4c1(_0xe1d('5o6I5p2D6aqM6K+B5aSx6LSl77ya6K+35rGC6LaF5pe2')); }
    });
})();