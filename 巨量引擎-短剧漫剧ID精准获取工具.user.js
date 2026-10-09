// ==UserScript==
// @name         巨量引擎-短剧漫剧ID精准获取工具
// @namespace    https://business.oceanengine.com/
// @version      11.9.3
// @description  通过短剧漫剧名称批量搜索，精准匹配获取短剧漫剧ID，支持导出Excel
// @author       You
// @match        https://business.oceanengine.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      gitee.com
// @connect      *
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E-%E7%9F%AD%E5%89%A7%E6%BC%AB%E5%89%A7ID%E7%B2%BE%E5%87%86%E8%8E%B7%E5%8F%96%E5%B7%A5%E5%85%B7.user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E-%E7%9F%AD%E5%89%A7%E6%BC%AB%E5%89%A7ID%E7%B2%BE%E5%87%86%E8%8E%B7%E5%8F%96%E5%B7%A5%E5%85%B7.user.js
// ==/UserScript==

(function () {

    function main() {
    'use strict';

    console.log('%c[短剧ID获取] 脚本已加载 v11.8.0', 'color:#FF9800;font-weight:700;font-size:14px;');

    /* ================ 配置 ================ */
    const CONFIG = {
        searchApi: '/api/ebp/macro_asset/platform_dpa/product/list',
        pageSize: 100,
        concurrency: 5,
        batchDelay: 3000,
        retryTimes: 2,
        retryDelay: 2000,
    };

    /* ================ 状态 ================ */
    let state = {
        platformId: '',
        ebpid: '',
        csrfToken: '',
        isRunning: false,
        results: [],
        total: 0,
        done: 0,
        matched: 0,
        notFound: 0,
    };

    let fabEl = null;
    let panelEl = null;
    let xlsxLoaded = false;

    /* ================ 工具函数 ================ */
    function log(msg, type) {
        type = type || 'info';
        const colors = { info: '#8d6e63', success: '#4caf50', error: '#e53935', warn: '#ff9800' };
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        console.log('%c[短剧ID获取] ' + ts + ' ' + msg, 'color:' + (colors[type] || colors.info) + ';font-weight:600');
        const logEl = panelEl && panelEl.querySelector('#sop-log');
        if (logEl) {
            const line = document.createElement('div');
            line.style.cssText = 'color:' + (colors[type] || colors.info) + ';margin-bottom:2px;line-height:1.5;';
            line.textContent = '[' + ts + '] ' + msg;
            logEl.appendChild(line);
            logEl.scrollTop = logEl.scrollHeight;
            while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
        }
    }

    function extractPlatformId() {
        const m = location.pathname.match(/\/library\/(\d+)\/detail/);
        return m ? m[1] : '';
    }

    function extractEbpId() {
        const u = new URLSearchParams(location.search);
        return u.get('ebpId') || u.get('ebpid') || '';
    }

    function getCsrfToken() {
        try {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const parts = cookies[i].trim().split('=');
                const k = parts[0];
                const v = parts.slice(1).join('=');
                if (k === 'csrf_session_id' || k === 'csrftoken' || k === 'csrf_token') return v;
            }
            const meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) return meta.content;
        } catch (e) {}
        return '';
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    // 动态加载 XLSX 库（仅导出时需要）
    function loadXlsx() {
        return new Promise(function(resolve, reject) {
            if (xlsxLoaded && window.XLSX) { resolve(); return; }
            log('正在加载Excel导出库...');
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = function() { xlsxLoaded = true; log('Excel导出库加载完成'); resolve(); };
            s.onerror = function() { log('Excel库加载失败，将改用CSV导出', 'error'); reject(new Error('xlsx load failed')); };
            document.head.appendChild(s);
        });
    }

    /* ================ 搜索核心 ================ */
    async function searchDrama(name, retry) {
        retry = retry || 0;
        var body = JSON.stringify({
            platformId: state.platformId,
            pageSize: CONFIG.pageSize,
            page: 1,
            reviewStatus: '0',
            productName: name
        });

        try {
            var resp = await fetch(CONFIG.searchApi + '?ebpid=' + state.ebpid, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json',
                    'x-csrftoken': state.csrfToken,
                },
                credentials: 'include',
                body: body
            });

            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var json = await resp.json();
            if (json.code !== 0) throw new Error('API错误: ' + (json.message || json.msg || json.code));
            return json.data || { dpaProducts: [], totalCount: 0 };
        } catch (e) {
            if (retry < CONFIG.retryTimes) {
                log('「' + name + '」搜索失败，第' + (retry + 1) + '次重试: ' + e.message, 'warn');
                await sleep(CONFIG.retryDelay);
                return searchDrama(name, retry + 1);
            }
            throw e;
        }
    }

    function findExactMatch(name, products) {
        if (!products || products.length === 0) return null;
        var exact = null;
        for (var i = 0; i < products.length; i++) {
            if (products[i].name === name) { exact = products[i]; break; }
        }
        if (exact) return { match: exact, isExact: true };
        for (var i = 0; i < products.length; i++) {
            if ((products[i].name || '').replace(/\s+/g, '') === name.replace(/\s+/g, '')) { exact = products[i]; break; }
        }
        if (exact) return { match: exact, isExact: true };
        return null;
    }

    /* ================ 批量处理 ================ */
    async function processBatch(names) {
        state.total = names.length;
        state.done = 0;
        state.matched = 0;
        state.notFound = 0;
        state.results = [];
        state.isRunning = true;
        updateProgress();
        updateResultsTable();
        updateButtons();

        log('开始处理 ' + names.length + ' 个剧名，并发数 ' + CONFIG.concurrency);

        for (var i = 0; i < names.length; i += CONFIG.concurrency) {
            if (!state.isRunning) { log('已手动停止', 'warn'); break; }
            var batch = names.slice(i, i + CONFIG.concurrency);
            log('处理第 ' + (i + 1) + ' - ' + Math.min(i + CONFIG.concurrency, names.length) + ' 个...');

            var promises = batch.map(function(name) {
                return (async function() {
                    var result = {
                        searchName: name,
                        productID: '',
                        matchType: '',
                        similarNames: '',
                    };
                    try {
                        var data = await searchDrama(name);
                        var products = data.dpaProducts || [];
                        var found = findExactMatch(name, products);
                        if (found && found.match) {
                            result.productID = found.match.productID || '';
                            result.matchType = '✅ 精准匹配';
                            state.matched++;
                        } else {
                            result.matchType = '❌ 未找到';
                            if (products.length > 0) result.similarNames = products.map(function(p) { return p.name; }).join(' | ');
                            state.notFound++;
                        }
                    } catch (e) {
                        result.matchType = '⚠️ 失败';
                        result.similarNames = e.message;
                        state.notFound++;
                    }
                    state.done++;
                    state.results.push(result);
                    updateProgress();
                    updateResultsTable();
                })();
            });

            await Promise.all(promises);
            if (i + CONFIG.concurrency < names.length && state.isRunning) {
                log('等待 ' + (CONFIG.batchDelay / 1000) + 's 后继续...');
                await sleep(CONFIG.batchDelay);
            }
        }

        state.isRunning = false;
        updateButtons();
        log('完成！共 ' + state.done + ' 个，匹配 ' + state.matched + ' 个，未匹配 ' + state.notFound + ' 个', 'success');
    }

    /* ================ 样式 ================ */
    function injectStyle() {
        if (document.getElementById('sop-style')) return;
        var style = document.createElement('style');
        style.id = 'sop-style';
        style.textContent = [
            '#sop-fab {',
            '  position: fixed; top: 80px; right: 24px; z-index: 999998;',
            '  width: 52px; height: 52px; border-radius: 50%;',
            '  background: linear-gradient(135deg, #FFB74D, #FF9800);',
            '  box-shadow: 0 6px 20px rgba(255,152,0,0.45);',
            '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
            '  font-size: 24px; color: #fff; user-select: none;',
            '  transition: transform .25s, box-shadow .25s;',
            '  animation: sop-fab-pulse 2.5s ease-in-out infinite;',
            '}',
            '#sop-fab:hover { transform: scale(1.12); box-shadow: 0 8px 26px rgba(255,152,0,0.6); }',
            '#sop-fab.dragging { animation: none; transition: none; cursor: grabbing; }',
            '@keyframes sop-fab-pulse {',
            '  0%,100% { box-shadow: 0 6px 20px rgba(255,152,0,0.45); }',
            '  50% { box-shadow: 0 6px 20px rgba(255,152,0,0.45), 0 0 0 10px rgba(255,152,0,0.12); }',
            '}',
            '#sop-panel {',
            '  position: fixed; top: 80px; right: 24px; z-index: 999999;',
            '  width: 440px; max-height: 82vh;',
            '  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
            '  background: rgba(255,248,225,0.93);',
            '  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
            '  border: 1px solid rgba(255,213,79,0.5);',
            '  border-radius: 18px;',
            '  box-shadow: 0 10px 40px rgba(255,193,7,0.25);',
            '  display: none; flex-direction: column; overflow: hidden;',
            '  color: #5d4037; font-size: 13px;',
            '}',
            '#sop-panel.show { display: flex; }',
            '#sop-panel.minimized { max-height: 46px; }',
            '#sop-panel.minimized .sop-body { display: none; }',
            '.sop-header {',
            '  padding: 11px 14px;',
            '  background: linear-gradient(135deg, #FFF8E1 0%, #FFE0B2 50%, #FFCC80 100%);',
            '  display: flex; align-items: center; justify-content: space-between;',
            '  cursor: move; user-select: none;',
            '  font-weight: 700; font-size: 13px; color: #5D4037;',
            '}',
            '.sop-header .left { display: flex; align-items: center; gap: 7px; }',
            '.sop-header .icon { font-size: 15px; }',
            '.sop-header .badge {',
            '  background: rgba(255,152,0,0.25);',
            '  border-radius: 10px; padding: 1px 7px; font-size: 10px; color: #E65100;',
            '}',
            '.sop-header .close-btn {',
            '  background: rgba(255,87,34,0.15); border: none; color: #BF360C;',
            '  border-radius: 50%; width: 22px; height: 22px; cursor: pointer;',
            '  font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center;',
            '  transition: all .2s; padding: 0;',
            '}',
            '.sop-header .close-btn:hover { background: rgba(255,87,34,0.35); transform: rotate(90deg); }',
            '.sop-header .min-btn {',
            '  background: rgba(255,183,77,0.25); border: none; color: #5D4037;',
            '  border-radius: 50%; width: 22px; height: 22px; cursor: pointer;',
            '  font-size: 13px; line-height: 1; display: flex; align-items: center; justify-content: center;',
            '  transition: all .2s; padding: 0; margin-right: 4px;',
            '}',
            '.sop-header .min-btn:hover { background: rgba(255,183,77,0.45); }',
            '.sop-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }',
            '.sop-info {',
            '  padding: 6px 14px; background: rgba(255,224,178,0.3);',
            '  border-bottom: 1px solid rgba(255,183,77,0.2);',
            '  font-size: 10px; color: #795548; line-height: 1.6;',
            '}',
            '.sop-info .row { display: flex; gap: 12px; flex-wrap: wrap; }',
            '.sop-info b { color: #E65100; }',
            '.sop-section { padding: 10px 14px; border-bottom: 1px solid rgba(255,183,77,0.15); }',
            '.sop-section label { font-size: 12px; font-weight: 600; color: #5D4037; display: block; margin-bottom: 5px; }',
            '.sop-textarea {',
            '  width: 100%; min-height: 90px; max-height: 160px;',
            '  border: 1.5px solid rgba(255,183,77,0.4); border-radius: 10px;',
            '  padding: 8px 10px; font-size: 12px; font-family: inherit; resize: vertical;',
            '  background: rgba(255,253,231,0.8); color: #5D4037; outline: none;',
            '  line-height: 1.6; box-sizing: border-box;',
            '}',
            '.sop-textarea:focus { border-color: #FF9800; box-shadow: 0 0 0 3px rgba(255,152,0,0.12); }',
            '.sop-hint { font-size: 10px; color: #A1887F; margin-top: 3px; }',
            '.sop-btns { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }',
            '.sop-btn {',
            '  border: none; border-radius: 10px; padding: 7px 14px; cursor: pointer;',
            '  font-size: 12px; font-weight: 600; font-family: inherit;',
            '  transition: all .2s; display: flex; align-items: center; gap: 4px;',
            '}',
            '.sop-btn.primary {',
            '  background: linear-gradient(135deg, #FFB74D, #FF9800); color: #fff;',
            '  box-shadow: 0 3px 8px rgba(255,152,0,0.3);',
            '}',
            '.sop-btn.primary:hover { transform: translateY(-1px); }',
            '.sop-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }',
            '.sop-btn.danger { background: linear-gradient(135deg, #FFAB91, #FF7043); color: #fff; }',
            '.sop-btn.secondary { background: rgba(255,224,178,0.6); color: #5D4037; border: 1px solid rgba(255,183,77,0.3); }',
            '.sop-btn.success {',
            '  background: linear-gradient(135deg, #A5D6A7, #66BB6A); color: #fff;',
            '  box-shadow: 0 3px 8px rgba(102,187,106,0.3);',
            '}',
            '.sop-btn.success:hover { transform: translateY(-1px); }',
            '.sop-btn.success:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }',
            '.sop-progress {',
            '  padding: 7px 14px; background: rgba(255,224,178,0.2);',
            '  border-bottom: 1px solid rgba(255,183,77,0.15);',
            '}',
            '.sop-progress-bar-wrap {',
            '  height: 7px; background: rgba(255,183,77,0.2); border-radius: 4px; overflow: hidden; margin-bottom: 4px;',
            '}',
            '.sop-progress-bar {',
            '  height: 100%; background: linear-gradient(90deg, #FFB74D, #FF9800, #FB8C00);',
            '  border-radius: 4px; transition: width .3s; width: 0%;',
            '}',
            '.sop-progress-bar.pulse { animation: sop-bar-pulse 1.5s ease-in-out infinite; }',
            '@keyframes sop-bar-pulse { 0%,100%{opacity:1;} 50%{opacity:0.7;} }',
            '.sop-progress-text { font-size: 11px; color: #795548; display: flex; justify-content: space-between; }',
            '.sop-progress-text b { color: #E65100; }',
            '.sop-log {',
            '  max-height: 80px; overflow-y: auto; padding: 6px 14px;',
            '  font-size: 10px; font-family: "Consolas", "Monaco", monospace; line-height: 1.5;',
            '  border-bottom: 1px solid rgba(255,183,77,0.15);',
            '}',
            '.sop-results {',
            '  flex: 1; overflow-y: auto; padding: 6px 10px; max-height: 220px;',
            '}',
            '.sop-results::-webkit-scrollbar { width: 5px; }',
            '.sop-results::-webkit-scrollbar-thumb { background: #FFB74D; border-radius: 3px; }',
            '.sop-table { width: 100%; border-collapse: collapse; font-size: 11px; }',
            '.sop-table th {',
            '  background: rgba(255,183,77,0.15); color: #5D4037;',
            '  padding: 5px 6px; text-align: left; font-weight: 600;',
            '  border-bottom: 1.5px solid rgba(255,183,77,0.3); white-space: nowrap;',
            '  position: sticky; top: 0;',
            '}',
            '.sop-table td {',
            '  padding: 5px 6px; border-bottom: 1px solid rgba(255,183,77,0.1);',
            '  color: #5D4037; word-break: break-all; vertical-align: top;',
            '}',
            '.sop-table tr:hover td { background: rgba(255,224,178,0.2); }',
            '.sop-table .match-yes { color: #2e7d32; font-weight: 600; }',
            '.sop-table .match-no { color: #c62828; }',
            '.sop-table .match-err { color: #e65100; }',
            '.sop-table .id-cell { font-family: "Consolas", monospace; font-size: 10px; color: #4E342E; }',
            '.sop-empty { text-align: center; color: #BCAAA4; padding: 18px; font-size: 12px; }',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    /* ================ 构建小圆球 ================ */
    function buildFab() {
        if (fabEl) return;
        try {
            injectStyle();
            fabEl = document.createElement('div');
            fabEl.id = 'sop-fab';
            fabEl.title = '点击打开 / 拖动移动';
            fabEl.textContent = '🎬';
            (document.body || document.documentElement).appendChild(fabEl);
            console.log('%c[短剧ID获取] 小圆球已创建', 'color:#4caf50;font-weight:700;');

            var dragMoved = false;
            var sx, sy, sl, st, dragging = false;

            fabEl.addEventListener('mousedown', function(e) {
                dragging = true; dragMoved = false;
                var r = fabEl.getBoundingClientRect();
                sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
                fabEl.style.right = 'auto';
                fabEl.style.left = sl + 'px';
                fabEl.style.top = st + 'px';
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                var dx = Math.abs(e.clientX - sx);
                var dy = Math.abs(e.clientY - sy);
                if (dx > 4 || dy > 4) {
                    dragMoved = true;
                    fabEl.classList.add('dragging');
                    fabEl.style.left = (sl + e.clientX - sx) + 'px';
                    fabEl.style.top = (st + e.clientY - sy) + 'px';
                }
            });
            document.addEventListener('mouseup', function() {
                if (!dragging) return;
                dragging = false;
                fabEl.classList.remove('dragging');
                if (!dragMoved) {
                    openPanel();
                }
            });
        } catch (e) {
            console.error('[短剧ID获取] 创建小圆球失败:', e);
        }
    }

    function openPanel() {
        if (!panelEl) buildPanel();
        panelEl.classList.add('show');
        fabEl.style.display = 'none';
        detectPageInfo();
    }

    function closePanel() {
        if (state.isRunning) {
            if (!confirm('正在处理中，确认关闭面板？')) return;
            state.isRunning = false;
        }
        panelEl.classList.remove('show');
        fabEl.style.display = '';
    }

    /* ================ 构建主面板 ================ */
    function buildPanel() {
        if (panelEl) return;
        try {
            panelEl = document.createElement('div');
            panelEl.id = 'sop-panel';
            panelEl.innerHTML = '\
            <div class="sop-header" id="sop-drag-handle">\
                <div class="left">\
                    <span class="icon">🎬</span>\
                    <span>短剧漫剧ID获取</span>\
                    <span class="badge">v11.8.0</span>\
                </div>\
                <div style="display:flex;align-items:center;">\
                    <button class="min-btn" id="sop-min" title="折叠/展开">—</button>\
                    <button class="close-btn" id="sop-close" title="收起为小圆球">×</button>\
                </div>\
            </div>\
            <div class="sop-body">\
                <div class="sop-info" id="sop-info">\
                    <div class="row">\
                        <span>商品库ID: <b id="sop-pid">检测中...</b></span>\
                        <span>CSRF: <b id="sop-csrf">检测中...</b></span>\
                    </div>\
                </div>\
                <div class="sop-section">\
                    <label>📝 输入短剧漫剧名称（每行一个）</label>\
                    <textarea class="sop-textarea" id="sop-input" placeholder="在此粘贴剧名，每行一个\n支持直接从Excel复制粘贴"></textarea>\
                    <div class="sop-hint">支持从Excel粘贴（Tab分隔自动取第一列）</div>\
                    <div class="sop-btns">\
                        <button class="sop-btn primary" id="sop-start">🚀 开始获取</button>\
                        <button class="sop-btn danger" id="sop-stop" style="display:none;">⏹ 停止</button>\
                        <button class="sop-btn secondary" id="sop-clear-input">🗑 清空输入</button>\
                    </div>\
                </div>\
                <div class="sop-progress" id="sop-progress-wrap" style="display:none;">\
                    <div class="sop-progress-bar-wrap">\
                        <div class="sop-progress-bar pulse" id="sop-bar"></div>\
                    </div>\
                    <div class="sop-progress-text">\
                        <span>进度: <b id="sop-progress-text">0 / 0</b></span>\
                        <span>✅<b id="sop-matched">0</b> ❌<b id="sop-notfound">0</b></span>\
                    </div>\
                </div>\
                <div class="sop-log" id="sop-log" style="display:none;"></div>\
                <div class="sop-results" id="sop-results-wrap">\
                    <div class="sop-empty">等待输入剧名...</div>\
                </div>\
                <div class="sop-section" style="border-bottom:none;border-top:1px solid rgba(255,183,77,0.15);">\
                    <div class="sop-btns">\
                        <button class="sop-btn success" id="sop-export" disabled>📊 导出Excel</button>\
                        <button class="sop-btn secondary" id="sop-clear-results">清空结果</button>\
                    </div>\
                </div>\
            </div>';
            (document.body || document.documentElement).appendChild(panelEl);

            panelEl.querySelector('#sop-min').addEventListener('click', function() { panelEl.classList.toggle('minimized'); });
            panelEl.querySelector('#sop-close').addEventListener('click', closePanel);
            panelEl.querySelector('#sop-start').addEventListener('click', onStart);
            panelEl.querySelector('#sop-stop').addEventListener('click', onStop);
            panelEl.querySelector('#sop-clear-input').addEventListener('click', function() {
                panelEl.querySelector('#sop-input').value = '';
                panelEl.querySelector('#sop-input').focus();
            });
            panelEl.querySelector('#sop-export').addEventListener('click', exportExcel);
            panelEl.querySelector('#sop-clear-results').addEventListener('click', clearResults);

            makeDraggable(panelEl, panelEl.querySelector('#sop-drag-handle'));
            console.log('%c[短剧ID获取] 面板已创建', 'color:#4caf50;font-weight:700;');
        } catch (e) {
            console.error('[短剧ID获取] 创建面板失败:', e);
        }
    }

    function makeDraggable(el, handle) {
        var sx, sy, sl, st, drag = false;
        handle.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            drag = true;
            var r = el.getBoundingClientRect();
            sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
            el.style.right = 'auto'; el.style.left = sl + 'px'; el.style.top = st + 'px';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!drag) return;
            el.style.left = (sl + e.clientX - sx) + 'px';
            el.style.top = (st + e.clientY - sy) + 'px';
        });
        document.addEventListener('mouseup', function() { drag = false; });
    }

    function detectPageInfo() {
        state.platformId = extractPlatformId();
        state.ebpid = extractEbpId();
        state.csrfToken = getCsrfToken();
        var pidEl = panelEl.querySelector('#sop-pid');
        var csrfEl = panelEl.querySelector('#sop-csrf');
        pidEl.textContent = state.platformId || '❌';
        csrfEl.textContent = state.csrfToken ? '✅' : '⚠️';
        log('页面信息: 商品库ID=' + state.platformId + ', ebpid=' + state.ebpid + ', CSRF=' + (state.csrfToken ? '已获取' : '未获取'));
    }

    function updateButtons() {
        var startBtn = panelEl.querySelector('#sop-start');
        var stopBtn = panelEl.querySelector('#sop-stop');
        var exportBtn = panelEl.querySelector('#sop-export');
        if (state.isRunning) {
            startBtn.style.display = 'none';
            stopBtn.style.display = '';
            exportBtn.disabled = true;
        } else {
            startBtn.style.display = '';
            stopBtn.style.display = 'none';
            exportBtn.disabled = state.results.length === 0;
        }
    }

    function updateProgress() {
        var wrap = panelEl.querySelector('#sop-progress-wrap');
        var bar = panelEl.querySelector('#sop-bar');
        var txt = panelEl.querySelector('#sop-progress-text');
        var mEl = panelEl.querySelector('#sop-matched');
        var nfEl = panelEl.querySelector('#sop-notfound');
        var logWrap = panelEl.querySelector('#sop-log');
        wrap.style.display = '';
        logWrap.style.display = '';
        var pct = state.total > 0 ? (state.done / state.total * 100) : 0;
        bar.style.width = pct + '%';
        if (pct >= 100) bar.classList.remove('pulse');
        txt.textContent = state.done + ' / ' + state.total;
        mEl.textContent = state.matched;
        nfEl.textContent = state.notFound;
    }

    function updateResultsTable() {
        var wrap = panelEl.querySelector('#sop-results-wrap');
        if (state.results.length === 0) {
            wrap.innerHTML = '<div class="sop-empty">等待输入剧名...</div>';
            return;
        }
        var rows = state.results.map(function(r, i) {
            var matchCls = r.matchType.indexOf('精准') >= 0 ? 'match-yes' : r.matchType.indexOf('失败') >= 0 ? 'match-err' : 'match-no';
            return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(r.searchName) + '</td><td class="id-cell">' + (r.productID || '-') + '</td><td class="' + matchCls + '" title="' + escapeHtml(r.similarNames || '') + '">' + r.matchType + '</td></tr>';
        }).join('');
        wrap.innerHTML = '<table class="sop-table"><thead><tr><th>#</th><th>搜索剧名</th><th>短剧漫剧ID</th><th>匹配结果</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function onStart() {
        var input = panelEl.querySelector('#sop-input').value.trim();
        if (!input) { alert('请先输入剧名！'); return; }
        if (!state.platformId) {
            alert('未检测到商品库ID，请确保在短剧漫剧商品库页面！');
            detectPageInfo(); return;
        }
        var names = input.split(/\r?\n/)
            .map(function(line) { var parts = line.split(/\t/); return (parts[0] || '').trim(); })
            .filter(function(n) { return n.length > 0; });
        var unique = [];
        var seen = {};
        names.forEach(function(n) { if (!seen[n]) { seen[n] = true; unique.push(n); } });
        if (unique.length === 0) { alert('未解析到有效剧名！'); return; }
        if (unique.length !== names.length) log('输入 ' + names.length + ' 个，去重后 ' + unique.length + ' 个', 'warn');
        updateButtons();
        processBatch(unique);
    }

    function onStop() {
        state.isRunning = false;
        log('正在停止...', 'warn');
        updateButtons();
    }

    function clearResults() {
        if (state.results.length > 0 && !confirm('确认清空结果？')) return;
        state.results = [];
        state.done = 0; state.total = 0; state.matched = 0; state.notFound = 0;
        updateResultsTable();
        panelEl.querySelector('#sop-progress-wrap').style.display = 'none';
        panelEl.querySelector('#sop-log').style.display = 'none';
        panelEl.querySelector('#sop-log').innerHTML = '';
        updateButtons();
    }

    /* ================ 导出 ================ */
    async function exportExcel() {
        if (state.results.length === 0) return;
        try {
            await loadXlsx();
            var data = state.results.map(function(r, i) {
                return { '序号': i + 1, '短剧漫剧名称': r.searchName, '短剧漫剧ID': r.productID || '' };
            });
            var ws = XLSX.utils.json_to_sheet(data);
            ws['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 22 }];
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '短剧漫剧ID');
            var fname = '短剧漫剧ID_' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            log('已导出 ' + fname + '（' + data.length + ' 条）', 'success');
        } catch (e) {
            log('Excel导出失败，改用CSV: ' + e.message, 'warn');
            exportCSV();
        }
    }

    function exportCSV() {
        if (state.results.length === 0) return;
        var data = state.results.map(function(r, i) {
            return { '序号': i + 1, '短剧漫剧名称': r.searchName, '短剧漫剧ID': r.productID || '' };
        });
        var headers = Object.keys(data[0]);
        var csvLines = [headers.join(',')];
        data.forEach(function(row) {
            var vals = headers.map(function(h) {
                var v = String(row[h] || '').replace(/"/g, '""');
                return /[",\n]/.test(v) ? '"' + v + '"' : v;
            });
            csvLines.push(vals.join(','));
        });
        var csv = csvLines.join('\n');
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '短剧漫剧ID_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        log('已导出CSV（' + data.length + ' 条）', 'success');
    }

    /* ================ 启动 ================ */
    function start() {
        try {
            console.log('[短剧ID获取] start() 被调用, readyState=' + document.readyState);
            injectStyle();
            buildFab();
        } catch (e) {
            console.error('[短剧ID获取] start() 失败:', e);
        }
    }

    // 尽早启动
    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start);
        // 双保险：即使 DOMContentLoaded 没触发，2秒后也尝试启动
        setTimeout(start, 2000);
    }

    // URL 变化监听
    function setupObserver() {
        if (!document.body) { setTimeout(setupObserver, 200); return; }
        var lastUrl = location.href;
        var observer = new MutationObserver(function() {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                if (panelEl) setTimeout(detectPageInfo, 1000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    setupObserver();

    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'jl-id-tool';
    var _authPassed = false;
    console.log('%c[授权校验] v11.9.3 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
    function _showAuthError(msg) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
        d.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.3);"><div style="font-size:48px;margin-bottom:16px;">\u{1F512}</div><h3 style="color:#333;margin:0 0 12px;font-size:18px;">\u811A\u672C\u6388\u6743\u63D0\u793A</h3><p style="color:#666;font-size:14px;line-height:1.6;margin-bottom:16px;">' + msg + '</p><p style="color:#999;font-size:12px;">\u5982\u9700\u6388\u6743\u8BF7\u8054\u7CFB\u811A\u672C\u4F5C\u8005</p></div>';
        document.body.appendChild(d);
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://gitee.com/mlddr/script-toolkit-v2/raw/master/config.json?t=' + Date.now(),
        timeout: 10000,
        onload: function(response) {
            if (response.status === 200) {
                try {
                    var config = JSON.parse(response.responseText);
                    var sc = config[SCRIPT_ID];
                    if (!sc) { _showAuthError('\u672A\u627E\u5230\u811A\u672C\u6388\u6743\u4FE1\u606F\uFF0C\u8BF7\u8054\u7CFB\u4F5C\u8005\u83B7\u53D6\u6388\u6743'); return; }
                    if (sc.enabled === false) { _showAuthError(sc.msg || '\u6B64\u811A\u672C\u5DF2\u88AB\u7BA1\u7406\u5458\u8FDC\u7A0B\u505C\u7528'); return; }
                    _authPassed = true;
                    console.log('%c[授权校验] 已通过', 'color:#43a047;font-weight:bold');
                    main();
                } catch(e) { _showAuthError('\u6388\u6743\u9A8C\u8BC1\u5931\u8D25\uFF1A\u914D\u7F6E\u89E3\u6790\u5F02\u5E38'); }
            } else { _showAuthError('\u6388\u6743\u9A8C\u8BC1\u5931\u8D25\uFF1A\u670D\u52A1\u5668\u5F02\u5E38(status:' + response.status + ')'); }
        },
        onerror: function() { _showAuthError('\u6388\u6743\u9A8C\u8BC1\u5931\u8D25\uFF1A\u65E0\u6CD5\u8FDE\u63A5\u6388\u6743\u670D\u52A1\u5668'); },
        ontimeout: function() { _showAuthError('\u6388\u6743\u9A8C\u8BC1\u5931\u8D25\uFF1A\u8BF7\u6C42\u8D85\u65F6'); }
    });
})();