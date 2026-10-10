// ==UserScript==
// @name         畅读推广平台 - 短剧数据助手 (IAA极速版)
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      12.0.0
// @description  IAA极速版：4-10集全量取链+6并发创建+全部链接导出+XHR直调+ID/名称双模式搜索+180天链接查询+虚拟滚动支持5000条
// @author       Work Assistant
// @match        https://www.changdupingtai.com/*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      gitee.com
// @connect      raw.giteeusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      *
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E7%95%85%E8%AF%BB%E6%8E%A8%E5%B9%BF%E5%B9%B3%E5%8F%B0-%E7%9F%AD%E5%89%A7%E6%95%B0%E6%8D%AE%E5%8A%A9%E6%89%8B(IAA%E6%9E%81%E9%80%9F%E7%89%88).user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E7%95%85%E8%AF%BB%E6%8E%A8%E5%B9%BF%E5%B9%B3%E5%8F%B0-%E7%9F%AD%E5%89%A7%E6%95%B0%E6%8D%AE%E5%8A%A9%E6%89%8B(IAA%E6%9E%81%E9%80%9F%E7%89%88).user.js
// ==/UserScript==

(function () {
    'use strict';

    function main() {

    // ==================== 常量 ====================
    // ==================== 版本 ====================
    const VERSION = '12.0.0';
    const API_BASE = 'https://www.changdupingtai.com/novelsale/distributor';

    // ==================== 样式 ====================
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        #cd-dj-iaa-panel {
            position: fixed; top: 20px; right: 20px; width: 820px; max-height: 92vh;
            background: linear-gradient(135deg, #f0fff4 0%, #fff 40%, #f0f4ff 100%);
            border: 2px solid #c4e0c4; border-radius: 16px;
            box-shadow: 0 8px 40px rgba(100,160,100,.12), 0 2px 8px rgba(0,0,0,.04);
            z-index: 99999; overflow: hidden; display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            transition: all .3s ease;
        }
        #cd-dj-iaa-panel.minimized { width: 50px; height: 50px; max-height: 50px; border-radius: 50%; cursor: pointer; overflow: hidden; border-color: #43a047; }
        #cd-dj-iaa-panel.minimized *:not(#cd-toggle) { display: none !important; }
        #cd-toggle { position: absolute; top: 8px; right: 10px; width: 30px; height: 30px; border: none; background: rgba(76,175,80,.12); border-radius: 50%; color: #43a047; font-size: 18px; cursor: pointer; z-index: 10; display: flex; align-items: center; justify-content: center; transition: all .2s; }
        #cd-toggle:hover { background: rgba(76,175,80,.25); transform: scale(1.1); }
        .cd-header { padding: 14px 20px 10px; background: linear-gradient(90deg, rgba(144,238,144,.15) 0%, rgba(173,216,230,.12) 100%); border-bottom: 1px solid #d0e8d0; }
        .cd-header h3 { margin: 0; font-size: 16px; font-weight: 700; background: linear-gradient(135deg, #43a047, #66bb6a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .cd-header p { margin: 3px 0 0; font-size: 11px; color: #90a890; }
        .cd-search-area { padding: 14px 20px 10px; background: rgba(255,255,255,.6); border-bottom: 1px solid #e0f0e0; }
        .cd-search-row { display: flex; gap: 8px; align-items: center; }
        .cd-search-input { flex: 1; height: 38px; padding: 0 14px; border: 2px solid #c8dcc8; border-radius: 20px; font-size: 13px; color: #3a5a3a; outline: none; box-sizing: border-box; transition: all .2s; }
        .cd-search-input:focus { border-color: #43a047; box-shadow: 0 0 0 3px rgba(76,175,80,.12); }
        .cd-search-input::placeholder { color: #a8c8a8; }
        .cd-btn { height: 38px; padding: 0 18px; border: none; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .2s; white-space: nowrap; }
        .cd-btn:disabled { opacity: .45; cursor: not-allowed; }
        .cd-btn-primary { background: linear-gradient(135deg, #43a047, #66bb6a); color: #fff; box-shadow: 0 2px 8px rgba(76,175,80,.3); }
        .cd-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(76,175,80,.4); }
        .cd-btn-clear { background: rgba(160,200,160,.15); color: #80a080; }
        .cd-btn-clear:hover:not(:disabled) { background: rgba(160,200,160,.25); }
        .cd-btn-export { background: linear-gradient(135deg, #42a5f5, #1e88e5); color: #fff; box-shadow: 0 2px 8px rgba(33,150,243,.3); }
        .cd-btn-export:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(33,150,243,.4); }
        .cd-btn-icon { height: 38px; width: 38px; padding: 0; border: 2px solid #c8dcc8; border-radius: 20px; background: rgba(76,175,80,.08); color: #43a047; font-size: 16px; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; }
        .cd-btn-icon:hover { background: rgba(76,175,80,.18); border-color: #43a047; transform: scale(1.05); }
        .cd-btn-danger { background: linear-gradient(135deg, #ef5350, #e53935); color: #fff; box-shadow: 0 2px 8px rgba(239,83,80,.3); }
        .cd-btn-danger:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,83,80,.4); }
        .cd-btn-secondary { background: rgba(140,170,140,.12); color: #70a070; }
        .cd-btn-secondary:hover:not(:disabled) { background: rgba(140,170,140,.22); }
        .cd-hint { margin-top: 6px; font-size: 11px; color: #90a890; line-height: 1.5; }
        .cd-hint b { color: #43a047; font-weight: 500; }
        .cd-progress { margin-top: 8px; height: 4px; background: #e0f0e0; border-radius: 2px; overflow: hidden; display: none; }
        .cd-progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #43a047, #66bb6a); border-radius: 2px; transition: width .3s; }
        .cd-body { padding: 0; overflow-y: auto; flex: 1; }
        .cd-table-wrap { margin: 0; max-height: calc(92vh - 280px); overflow: auto; position: relative; }
        .cd-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
        .cd-table thead { position: sticky; top: 0; z-index: 2; }
        .cd-table th { padding: 10px 4px; text-align: left; font-weight: 600; font-size: 11px; color: #5a7a5a; background: linear-gradient(135deg, #f0fff0, #f0f4ff); border-bottom: 2px solid #c8dcc8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cd-table td { padding: 8px 4px; border-bottom: 1px solid #e0f0e0; color: #3a5a3a; word-break: break-all; vertical-align: top; overflow: hidden; }
        .cd-table tr { height: 44px; }
        .cd-table tr.cd-virtual-spacer { height: auto; }
        .cd-table tr.cd-virtual-spacer td { padding: 0; border: none; }
        .cd-table tr:hover td { background: rgba(76,175,80,.04); }
        .cd-table a { color: #43a047; text-decoration: none; transition: color .15s; }
        .cd-table a:hover { color: #2e7d32; text-decoration: underline; }
        .cd-iaa-link { display: block; margin: 2px 0; padding: 2px 8px; border-radius: 8px; background: linear-gradient(135deg, rgba(144,238,144,.12), rgba(173,216,230,.12)); border: 1px solid rgba(160,210,160,.25); font-size: 11px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cd-iaa-link .iaa-label { display: inline-block; background: rgba(76,175,80,.15); color: #2e7d32; padding: 0 6px; border-radius: 8px; font-size: 10px; margin-right: 4px; }
        .cd-footer-bar { padding: 10px 20px; background: rgba(255,255,255,.6); border-top: 1px solid #e0f0e0; display: flex; align-items: center; justify-content: space-between; }
        .cd-footer-left { font-size: 11px; color: #90a890; }
        .cd-footer-right { display: flex; gap: 8px; }
        .cd-status-bar { padding: 8px 20px; background: linear-gradient(135deg, rgba(76,175,80,.06), rgba(173,216,230,.06)); border-top: 1px solid #e0f0e0; font-size: 11px; color: #90a890; max-height: 60px; overflow-y: auto; line-height: 1.5; }
        .cd-status-bar.ok { color: #43a047; }
        .cd-status-bar.er { color: #ef5350; }
        .cd-status-bar.inf { color: #42a5f5; }
        .cd-empty { padding: 40px 20px; text-align: center; color: #c0d8c0; }
        .cd-empty-icon { font-size: 36px; margin-bottom: 8px; opacity: .6; }
        .cd-empty-text { font-size: 13px; }
        .cd-empty-sub { font-size: 11px; color: #c0d8c0; margin-top: 4px; }
        .cd-table-wrap::-webkit-scrollbar, .cd-body::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .cd-search-mode { position: relative; flex-shrink: 0; }
        .cd-mode-btn { height: 38px; padding: 0 12px; border: 2px solid #c8dcc8; border-radius: 20px; background: rgba(76,175,80,.08); color: #43a047; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all .2s; display: flex; align-items: center; gap: 4px; }
        .cd-mode-btn:hover { background: rgba(76,175,80,.18); border-color: #43a047; }
        .cd-mode-btn .cd-mode-arrow { font-size: 10px; transition: transform .2s; }
        .cd-mode-btn.open .cd-mode-arrow { transform: rotate(180deg); }
        .cd-mode-dropdown { position: absolute; top: 42px; left: 0; min-width: 130px; background: #fff; border: 1px solid #c8dcc8; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.1); display: none; z-index: 100; overflow: hidden; }
        .cd-mode-dropdown.show { display: block; animation: cdFadeIn .15s ease; }
        .cd-mode-option { padding: 8px 14px; font-size: 13px; color: #3a5a3a; cursor: pointer; transition: all .15s; }
        .cd-mode-option:hover { background: rgba(76,175,80,.08); }
        .cd-mode-option.active { background: rgba(76,175,80,.12); color: #43a047; font-weight: 600; }
        .cd-error-text { color: #ef5350; font-size: 11px; line-height: 1.4; }
        .cd-batch-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,.35); z-index: 100000; display: flex; align-items: center; justify-content: center; animation: cdFadeIn .2s ease; }
        .cd-batch-overlay.closing { animation: cdFadeOut .15s ease forwards; }
        @keyframes cdFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cdFadeOut { from { opacity: 1; } to { opacity: 0; } }
        .cd-batch-modal { width: 520px; background: #fff; border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.18); overflow: hidden; animation: cdSlideIn .25s ease; }
        .cd-batch-modal.closing { animation: cdSlideOut .15s ease forwards; }
        @keyframes cdSlideIn { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes cdSlideOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(20px) scale(.97); } }
        .cd-batch-header { padding: 16px 20px 12px; border-bottom: 1px solid #e0f0e0; display: flex; align-items: center; justify-content: space-between; }
        .cd-batch-header h4 { margin: 0; font-size: 15px; font-weight: 600; color: #3a5a3a; }
        .cd-batch-header .cd-batch-counter { font-size: 12px; color: #90a890; }
        .cd-batch-header .cd-batch-close { width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(160,200,160,.12); color: #80a080; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .cd-batch-header .cd-batch-close:hover { background: rgba(160,200,160,.25); }
        .cd-batch-hint { padding: 10px 20px 8px; font-size: 12px; color: #90a890; line-height: 1.5; }
        .cd-batch-hint b { color: #43a047; font-weight: 500; }
        .cd-batch-textarea-wrap { padding: 0 20px; }
        .cd-batch-textarea { width: 100%; height: 200px; padding: 12px 14px; border: 2px solid #c8dcc8; border-radius: 12px; font-size: 13px; color: #3a5a3a; line-height: 1.6; resize: vertical; outline: none; font-family: inherit; box-sizing: border-box; transition: border-color .2s; }
        .cd-batch-textarea:focus { border-color: #43a047; box-shadow: 0 0 0 3px rgba(76,175,80,.12); }
        .cd-batch-textarea::placeholder { color: #c0d8c0; }
        .cd-batch-footer { padding: 12px 20px 16px; display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
        /* Additional classes for turbo functionality with light theme */
        .cd-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; }
        .cd-badge-ok { background: rgba(67,160,71,.12); color: #43a047; }
        .cd-badge-err { background: rgba(239,83,80,.12); color: #ef5350; }
        .cd-badge-warn { background: rgba(255,193,7,.12); color: #f57f17; }
        .cd-badge-info { background: rgba(66,165,245,.12); color: #1976d2; }
        .cd-btn-disabled-inline { height: 28px; padding: 0 10px; font-size: 11px; border: 1px solid #d0e8d0; border-radius: 14px; background: rgba(160,200,160,.08); color: #a0c0a0; cursor: not-allowed; display: inline-flex; align-items: center; white-space: nowrap; }
    `;
    document.head.appendChild(styleEl);

    // ==================== 创建面板 ====================
    const panel = document.createElement('div');
    panel.id = 'cd-dj-iaa-panel';
    panel.innerHTML = `
        <button id="cd-toggle" title="最小化/展开">−</button>
        <div class="cd-header">
            <h3>短剧数据助手 v12.0.0 极速版 (IAA)</h3>
        </div>
        <div class="cd-search-area">
            <div class="cd-search-row">
                <div class="cd-search-mode" id="cd-search-mode">
                    <button class="cd-mode-btn" id="cd-mode-btn">名称 <span class="cd-mode-arrow">▼</span></button>
                    <div class="cd-mode-dropdown" id="cd-mode-dropdown">
                        <div class="cd-mode-option active" data-mode="name">按名称</div>
                        <div class="cd-mode-option" data-mode="id">按剧目ID</div>
                    </div>
                </div>
                <input class="cd-search-input" id="cd-search-input" placeholder="输入短剧名称搜索（支持批量，每行一个）" autocomplete="off" />
                <button class="cd-btn cd-btn-icon" id="cd-batch-search-btn" title="批量输入">☰</button>
                <button class="cd-btn cd-btn-primary" id="cd-search-btn">极速搜索</button>
                <button class="cd-btn cd-btn-clear" id="cd-clear-input-btn">清空</button>
            </div>
            <div class="cd-progress" id="cd-progress"><div class="cd-progress-fill" id="cd-progress-fill"></div></div>
        </div>
        <div class="cd-body">
            <div class="cd-empty" id="cd-empty"><div class="cd-empty-icon">⚡</div><div class="cd-empty-text">暂无数据</div><div class="cd-empty-sub">输入短剧名称或ID，点击极速搜索</div></div>
            <div class="cd-table-wrap" id="cd-table-wrap" style="display:none"><table class="cd-table"><thead id="cd-thead"></thead><tbody id="cd-tbody"></tbody></table></div>
        </div>
        <div class="cd-footer-bar">
            <div class="cd-footer-left" id="cd-footer-info">共 0 部短剧</div>
            <div class="cd-footer-right">
                <button class="cd-btn cd-btn-danger" id="cd-stop-btn" style="display:none">停止</button>
                <button class="cd-btn cd-btn-export" id="cd-export-btn" disabled>导出 Excel</button>
                <button class="cd-btn cd-btn-secondary" id="cd-clear-all-btn" disabled>清空全部</button>
            </div>
        </div>
        <div class="cd-status-bar" id="cd-status">极速版v12.0.0已启动，等待搜索...</div>
    `;
    document.body.appendChild(panel);

    // ==================== 状态 ====================
    let dramaMap = {};
    let isWorking = false;
    let stopRequested = false;
    let searchMode = 'name'; // 'name' or 'id'

    // ==================== 虚拟滚动配置 ====================
    const VIRTUAL_CONFIG = {
        maxItems: 5000,       // 最大支持条目数
        rowHeight: 44,        // 每行高度（px），需与CSS一致
        bufferRows: 30,       // 上下预加载缓冲行数
    };
    const virtualState = {
        startIndex: 0,
        endIndex: 0,
        scrollTop: 0,
        _rafId: null,
    };
    // 从页面拦截获取的认证信息
    let authInfo = {
        appid: '',
        apptype: '',
        distributorId: '',
        adUserId: '',
        AgwJsConv: 'str'
    };

    const searchInput = document.getElementById('cd-search-input');
    const searchBtn = document.getElementById('cd-search-btn');
    const clearInputBtn = document.getElementById('cd-clear-input-btn');
    const progressEl = document.getElementById('cd-progress');
    const progressFill = document.getElementById('cd-progress-fill');
    const emptyEl = document.getElementById('cd-empty');
    const tableWrap = document.getElementById('cd-table-wrap');
    const thead = document.getElementById('cd-thead');
    const tbody = document.getElementById('cd-tbody');
    const footerInfo = document.getElementById('cd-footer-info');
    const exportBtn = document.getElementById('cd-export-btn');
    const clearAllBtn = document.getElementById('cd-clear-all-btn');
    const stopBtn = document.getElementById('cd-stop-btn');
    const statusEl = document.getElementById('cd-status');
    const batchBtn = document.getElementById('cd-batch-search-btn');
    const modeBtn = document.getElementById('cd-mode-btn');
    const modeDropdown = document.getElementById('cd-mode-dropdown');

    function log(msg, type) { statusEl.textContent = msg; statusEl.className = 'cd-status-bar ' + (type || ''); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ==================== XHR拦截：提取认证头 ====================
    (function interceptXHR() {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._cdUrl = url;
            return origOpen.call(this, method, url, ...args);
        };
        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            // 拦截认证头
            const lname = name.toLowerCase();
            if (lname === 'appid') authInfo.appid = value;
            else if (lname === 'apptype') authInfo.apptype = value;
            else if (lname === 'distributorid') authInfo.distributorId = value;
            else if (lname === 'aduserid') authInfo.adUserId = value;
            else if (lname === 'agw-js-conv') authInfo.AgwJsConv = value;
            return origSetHeader.call(this, name, value);
        };
        XMLHttpRequest.prototype.send = function(body) {
            return origSend.call(this, body);
        };
    })();

    // ==================== API调用器（使用XHR，安全SDK自动添加msToken/a_bogus签名） ====================
    function apiHeaders() {
        const h = {
            'Accept': 'application/json, text/plain, */*'
        };
        if (authInfo.appid) h['appid'] = authInfo.appid;
        if (authInfo.apptype) h['apptype'] = authInfo.apptype;
        if (authInfo.distributorId) h['distributorId'] = authInfo.distributorId;
        if (authInfo.adUserId) h['adUserId'] = authInfo.adUserId;
        if (authInfo.AgwJsConv) h['Agw-Js-Conv'] = authInfo.AgwJsConv;
        return h;
    }

    function xhrRequest(method, path, params, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(API_BASE + path, location.origin);
            if (method === 'GET' && params) {
                for (const [k, v] of Object.entries(params)) {
                    url.searchParams.set(k, v);
                }
            }
            url.searchParams.set('aweme_user_new_version', 'true');
            // 不手动添加msToken/a_bogus - 安全SDK会自动为XHR请求添加签名

            const xhr = new XMLHttpRequest();
            xhr.open(method, url.toString());
            xhr.timeout = 15000;

            const headers = apiHeaders();
            for (const [k, v] of Object.entries(headers)) {
                try { xhr.setRequestHeader(k, v); } catch(e) {}
            }
            if (method === 'POST' && body) {
                try { xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8'); } catch(e) {}
            }

            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch(e) {
                        reject(new Error('JSON解析失败: ' + xhr.responseText.substring(0, 100)));
                    }
                } else {
                    reject(new Error(`API ${xhr.status}: ${xhr.statusText}`));
                }
            };
            xhr.onerror = function() { reject(new Error('网络错误')); };
            xhr.ontimeout = function() { reject(new Error('请求超时(15s)')); };

            if (method === 'POST' && body) {
                xhr.send(JSON.stringify(body));
            } else {
                xhr.send();
            }
        });
    }

    async function apiGet(path, params = {}) {
        return xhrRequest('GET', path, params, null);
    }

    async function apiPost(path, body = {}) {
        return xhrRequest('POST', path, null, body);
    }

    // ==================== 并发控制 ====================
    async function batchConcurrent(items, concurrency, fn) {
        const results = [];
        let index = 0;
        let completed = 0;
        async function worker() {
            while (index < items.length && !stopRequested) {
                const i = index++;
                try {
                    results[i] = await fn(items[i], i);
                } catch(e) {
                    results[i] = { error: e.message };
                }
                completed++;
                if (progressEl.style.display !== 'none') {
                    progressFill.style.width = (completed / items.length * 100) + '%';
                }
            }
        }
        const workers = Array(Math.min(concurrency, items.length)).fill(0).map(() => worker());
        await Promise.all(workers);
        return results;
    }

    // ==================== 搜索API ====================
    async function searchDramaRaw(query, retryCount = 0, searchType = 2) {
        try {
            const data = await apiGet('/content/series/list/v1/', {
                search_type: searchType,
                query: query,
                sort_type: 1,
                sort_field: 8,
                page_index: 0,
                page_size: 10
            });
            if (data.code === 4009 && retryCount < 4) {
                const waitMs = 1000 * (retryCount + 1);
                console.log(`[搜索:${query}] 频率限制(4009)，${waitMs/1000}s后重试(${retryCount + 1}/4)`);
                await sleep(waitMs);
                return searchDramaRaw(query, retryCount + 1, searchType);
            }
            if (data.code === 4000 && retryCount < 2) {
                console.log(`[搜索:${query}] 参数错误(4000)，可能认证头未就绪，1s后重试(${retryCount + 1}/2)`);
                await sleep(1000);
                return searchDramaRaw(query, retryCount + 1, searchType);
            }
            return data;
        } catch(e) {
            if (retryCount < 3) {
                const waitMs = 1000 * (retryCount + 1);
                console.log(`[搜索:${query}] 网络异常，${waitMs/1000}s后重试(${retryCount + 1}/3): ${e.message}`);
                await sleep(waitMs);
                return searchDramaRaw(query, retryCount + 1, searchType);
            }
            throw e;
        }
    }

    // ==================== ID搜索 ====================
    async function searchDramaById(bookId) {
        try {
            const data = await searchDramaRaw(bookId, 0, 1);
            console.log(`[ID搜索:${bookId}] code=${data.code}, msg=${data.message || ''}`);
            if (data.code !== 0) {
                return { error: data.message || `搜索失败(code=${data.code})` };
            }
            let list = data.data?.data || data.data?.list || data.data?.series_list || [];
            if (!list || list.length === 0) {
                return { error: '不存在' };
            }
            const match = list.find(item => String(item.book_id) === String(bookId)) || list[0];
            const av = match.aweme_version_book_data || {};
            return {
                bookId: String(match.book_id || bookId),
                name: match.series_name || `ID:${bookId}`,
                totalEpisodes: match.episode_amount || 0,
                publishStatus: av.publish_status ?? 0,
                deliveryStatus: av.delivery_status ?? false,
                permissionStatus: match.permission_status ?? 0,
                awemeUserId: av.playlet_id || '',
                publishName: av.publish_aweme_user?.nick_name || '',
                douyinId: av.publish_aweme_user?.douyin_id || '',
                gender: match.gender || 0,
                categoryText: match.category_text || '',
                cover: match.thumb_url || ''
            };
        } catch(e) {
            console.error(`[ID搜索:${bookId}] 异常:`, e.message);
            return { error: e.message };
        }
    }

    async function searchDrama(name) {
        try {
            let data = await searchDramaRaw(name);
            console.log(`[搜索:${name}] code=${data.code}, msg=${data.message || ''}`);

            if (data.code !== 0) {
                return { error: data.message || `搜索失败(code=${data.code})` };
            }

            let list = data.data?.data || data.data?.list || data.data?.series_list || [];

            // 如果精确搜索没结果，尝试去掉标点符号模糊搜索
            if ((!list || list.length === 0) && name.length > 2) {
                const cleanName = name.replace(/[，,。.！!？?：:、；;""''《》【】()（）\s]/g, '');
                if (cleanName !== name && cleanName.length > 1) {
                    console.log(`[搜索:${name}] 精确搜索无结果，尝试去标点: ${cleanName}`);
                    data = await searchDramaRaw(cleanName);
                    if (data.code === 0) {
                        list = data.data?.data || data.data?.list || data.data?.series_list || [];
                    }
                }
            }

            // 如果去标点还是没结果，尝试只搜索前半部分（按逗号分割）
            if ((!list || list.length === 0) && name.includes('，')) {
                const parts = name.split('，');
                for (const part of parts) {
                    if (part.trim().length > 1) {
                        console.log(`[搜索:${name}] 尝试分段搜索: ${part.trim()}`);
                        data = await searchDramaRaw(part.trim());
                        if (data.code === 0) {
                            list = data.data?.data || data.data?.list || data.data?.series_list || [];
                            if (list && list.length > 0) break;
                        }
                    }
                }
            }

            if (!list || list.length === 0) {
                return { error: '不存在' };
            }

            // 解析所有搜索结果
            const allResults = list.map(item => {
                const av = item.aweme_version_book_data || {};
                return {
                    bookId: String(item.book_id || ''),
                    name: item.series_name || name,
                    totalEpisodes: item.episode_amount || 0,
                    publishStatus: av.publish_status ?? 0,
                    deliveryStatus: av.delivery_status ?? false,
                    permissionStatus: item.permission_status ?? 0,
                    awemeUserId: av.playlet_id || '',
                    publishName: av.publish_aweme_user?.nick_name || '',
                    douyinId: av.publish_aweme_user?.douyin_id || '',
                    gender: item.gender || 0,
                    categoryText: item.category_text || '',
                    cover: item.thumb_url || ''
                };
            });

            // 【v13.0】统一标点后匹配：全角转半角再去标点，解决":""："等差异
            const normPunc = (s) => String(s).trim()
                .replace(/：/g, ':').replace(/，/g, ',').replace(/；/g, ';').replace(/！/g, '!').replace(/？/g, '?')
                .replace(/（/g, '(').replace(/）/g, ')').replace(/【/g, '[').replace(/】/g, ']')
                .replace(/[""]/g, '"').replace(/['']/g, "'")
                .replace(/[\s,。.!！?？:：、；;""''《》【】()（）\-\/]/g, '');

            const searchNorm = normPunc(name);

            // 1. 精确匹配（统一标点后完全相等）
            const exactMatches = allResults.filter(r => normPunc(r.name) === searchNorm);
            if (exactMatches.length === 1) {
                const match = exactMatches[0];
                console.log(`[搜索:${name}] 精确匹配:`, match.name, 'book_id:', match.bookId);
                return match;
            }
            if (exactMatches.length > 1) {
                console.log(`[搜索:${name}] 发现${exactMatches.length}个精确匹配，等待用户选择`);
                return { multiple: true, results: exactMatches, searchName: name };
            }

            // 2. 无精确匹配，检查第一个结果是否相关（统一标点后互相包含）
            const firstNorm = normPunc(allResults[0].name);
            if (firstNorm.includes(searchNorm) || searchNorm.includes(firstNorm)) {
                console.log(`[搜索:${name}] 模糊匹配:`, allResults[0].name, 'book_id:', allResults[0].bookId);
                return allResults[0];
            }

            console.log(`[搜索:${name}] 搜索结果不匹配，API返回${allResults.length}条但无匹配项:`, allResults.map(r => r.name).join(', '));
            return { error: '不存在' };
        } catch(e) {
            console.error(`[搜索:${name}] 异常:`, e.message);
            return { error: e.message };
        }
    }

    // ==================== 模板API：获取可用推广模板 ====================
    async function getTemplates(bookId) {
        const data = await apiGet('/template/get_aweme_native_purchase_panel/v1/', { book_id: bookId });
        if (data.code !== 0) return [];
        const list = data.data?.ad_panel_details?.panel_list || [];
        return list.map(p => ({
            templateId: String(p.panel_template_id || ''),
            templateName: p.panel_name || '',
            startEpisode: p.start_episode || 0,
            canCreate: p.can_create_promotion || false
        }));
    }

    // ==================== 创建推广链API（含重试） ====================
    async function createPromoLink(bookId, templateId, promoName, retryCount = 0) {
        try {
            const data = await apiPost('/promotion/aweme_native/create/v2/', {
                book_id: String(bookId),
                promotion_name: promoName,
                purchase_panel_template_id: String(templateId)
            });
            // 4009频率限制 → 自动重试
            if (data.code === 4009 && retryCount < 3) {
                const waitMs = 1000 * (retryCount + 1);
                console.log(`[创建推广链:${bookId}] 频率限制(4009)，${waitMs/1000}s后重试(${retryCount + 1}/3)`);
                await sleep(waitMs);
                return createPromoLink(bookId, templateId, promoName, retryCount + 1);
            }
            // 网络偶发错误 → 自动重试
            if (data.code !== 0 && data.code !== 4009 && retryCount < 2) {
                console.log(`[创建推广链:${bookId}] 创建失败(code=${data.code})，1.5s后重试(${retryCount + 1}/2): ${data.message || ''}`);
                await sleep(1000);
                return createPromoLink(bookId, templateId, promoName, retryCount + 1);
            }
            if (data.code !== 0) return { error: data.message || `创建失败(code=${data.code})` };
            const info = data.data?.promotion_info || {};
            return {
                promoId: info.promotion_id || '',
                promoName: info.promotion_name || promoName,
                link: info.promotion_url || '',
                templateId: templateId
            };
        } catch(e) {
            if (retryCount < 2) {
                console.log(`[创建推广链:${bookId}] 网络异常，1.5s后重试(${retryCount + 1}/2): ${e.message}`);
                await sleep(1000);
                return createPromoLink(bookId, templateId, promoName, retryCount + 1);
            }
            return { error: e.message || '网络异常' };
        }
    }

    // ==================== 推广链列表API ====================
    // 【v12.9修复】参照老版本v15.4：1.添加book_id+日期参数(否则返回全账号数据极慢) 2.移除book_id filter(大数精度丢失)
    // 【v12.9关键修复】日期跨度不能超过180天，否则API返回4009"推广链时间跨度不能超过180天"
    async function getPromoLinks(bookId, retryCount = 0) {
        const now = new Date();
        const end = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const beginDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        const begin = `${beginDate.getFullYear()}-${String(beginDate.getMonth()+1).padStart(2,'0')}-${String(beginDate.getDate()).padStart(2,'0')}`;

        try {
            const data = await apiGet('/promotion/list/v1/', {
                aweme_user_new_version: 'true',
                book_id: String(bookId || ''),
                begin_date: begin,
                end_date: end,
                page_index: 0,
                page_size: 200
            });
            // 4009频率限制：重试
            if (data.code === 4009 && retryCount < 3) {
                const waitMs = 1000 * (retryCount + 1);
                console.log(`[推广链查询:${bookId}] 频率限制(4009)，${waitMs/1000}s后重试(${retryCount + 1}/3)`);
                await sleep(waitMs);
                return getPromoLinks(bookId, retryCount + 1);
            }
            // 其他错误码：不重试，直接返回空数组
            if (data.code !== 0) {
                console.log(`[推广链查询:${bookId}] API错误 code=${data.code} msg=${data.message || ''}，跳过不重试`);
                return [];
            }
            const list = data.data || [];
            if (!Array.isArray(list)) return [];
            console.log(`[推广链查询:${bookId}] API返回${list.length}条推广链`);
            // 【v12.9关键修复】移除book_id filter！大数精度丢失导致String(bid) !== String(bookId)
            // API请求中已传book_id参数，返回的数据就是该剧的推广链
            return list.map(p => {
                const promoUrl = p.aweme_info?.aweme_promotion_url || '';
                if (!promoUrl) return null;
                const panelName = p.pay_panel_info?.panel_name || p.ad_panel_info?.panel_name || '';
                const startEpisode = p.pay_panel_info?.start_episode || p.ad_panel_info?.start_episode || 0;
                const label = startEpisode > 0 ? `第${startEpisode}集起广` : (panelName || 'IAA');
                return {
                    promoId: p.promotion_info?.promotion_id || '',
                    promoName: p.promotion_info?.promotion_name || label,
                    link: promoUrl,
                    startEpisode: startEpisode,
                    templateId: p.ad_panel_info?.panel_id || p.pay_panel_info?.panel_id || '',
                    panelName: label,
                    createTime: p.promotion_info?.create_time || '',
                    awemeName: p.aweme_info?.aweme_work_name || ''
                };
            }).filter(p => p !== null);
        } catch(e) {
            console.log(`[推广链查询:${bookId}] 网络异常: ${e.message}`);
            if (retryCount < 1) {
                await sleep(1000);
                return getPromoLinks(bookId, retryCount + 1);
            }
            return [];
        }
    }

    // ==================== 状态文本转换 ====================
    // publish_status: 1=未发布, 2=已发布, 3=已下架
    function publishStatusText(status) {
        const map = { 1: '未发布', 2: '已发布', 3: '已下架', 0: '未知' };
        return map[status] ?? '未知';
    }
    function publishStatusBadge(status) {
        const text = publishStatusText(status);
        if (status === 2) return `<span class="cd-badge cd-badge-ok">${text}</span>`;
        if (status === 1) return `<span class="cd-badge cd-badge-warn">${text}</span>`;
        if (status === 3) return `<span class="cd-badge cd-badge-err">${text}</span>`;
        return `<span class="cd-badge cd-badge-info">${text}</span>`;
    }
    // permission_status: 2=无授权, 4=有授权(普通授权)
    function authStatusText(perm) {
        const map = { 2: '无授权', 4: '普通授权' };
        return map[perm] ?? '未知';
    }
    function authStatusBadge(perm) {
        const text = authStatusText(perm);
        if (perm === 4) return `<span class="cd-badge cd-badge-ok">${text}</span>`;
        if (perm === 2) return `<span class="cd-badge cd-badge-err">${text}</span>`;
        return `<span class="cd-badge cd-badge-info">${text}</span>`;
    }

    // ==================== 渲染表格（虚拟滚动） ====================
    function renderTable() {
        const dramas = Object.values(dramaMap);
        const total = dramas.length;
        if (total === 0) {
            emptyEl.style.display = '';
            tableWrap.style.display = 'none';
            footerInfo.textContent = '共 0 部短剧';
            exportBtn.disabled = true;
            clearAllBtn.disabled = true;
            virtualState.startIndex = 0;
            virtualState.endIndex = 0;
            return;
        }
        emptyEl.style.display = 'none';
        tableWrap.style.display = '';
        exportBtn.disabled = false;
        clearAllBtn.disabled = false;

        thead.innerHTML = `<tr>
            <th style="width:3%">#</th>
            <th style="width:13%">短剧名称</th>
            <th style="width:10%">短剧ID</th>
            <th style="width:10%">抖音作品ID</th>
            <th style="width:4%">总集数</th>
            <th style="width:5%">发布状态</th>
            <th style="width:5%">授权状态</th>
            <th style="width:28%">IAA推广链接</th>
            <th style="width:7%">操作</th>
        </tr>`;

        // 计算可见范围
        const viewportHeight = tableWrap.clientHeight || 600;
        const { rowHeight, bufferRows } = VIRTUAL_CONFIG;
        const scrollTop = tableWrap.scrollTop || 0;

        let startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
        let endIdx = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + bufferRows);

        // 初次渲染或数据变化时重置
        if (virtualState.endIndex === 0) {
            virtualState.startIndex = startIdx;
            virtualState.endIndex = endIdx;
        }

        const visibleDramas = dramas.slice(startIdx, endIdx);
        const topSpacerHeight = startIdx * rowHeight;
        const bottomSpacerHeight = (total - endIdx) * rowHeight;

        let html = '';

        // 顶部spacer
        if (topSpacerHeight > 0) {
            html += `<tr class="cd-virtual-spacer" style="height:${topSpacerHeight}px"><td colspan="9"></td></tr>`;
        }

        // 可见行
        for (let j = 0; j < visibleDramas.length; j++) {
            const d = visibleDramas[j];
            const i = startIdx + j;
            const links = (d.promoLinks || []).map(p => {
                const epLabel = p.startEpisode ? `${p.startEpisode}集起广` : '推广链';
                const linkText = p.link ? (p.link.length > 50 ? p.link.substring(0, 50) + '...' : p.link) : (p.promoName || p.promoId || '链接');
                return `<div class="cd-iaa-link" title="${p.link || ''}"><span class="iaa-label">${epLabel}</span>${p.link ? `<a href="${p.link}" target="_blank">${linkText}</a>` : linkText}</div>`;
            }).join('') || (d.error ? `<span class="cd-error-text">${d.error}</span>` : '<span style="color:#ccc">无</span>');

            const canCreate = d.publishStatus === 2 && d.permissionStatus === 4;
            const hasLinks = d.promoLinks && d.promoLinks.length > 0;
            let actionBtn;
            if (d.bookId === '-' || (d.bookId || '').startsWith('err_')) {
                actionBtn = `<span class="cd-btn-disabled-inline" title="${d.error || '不存在'}">${d.error || '不存在'}</span>`;
            } else if (hasLinks) {
                actionBtn = `<span class="cd-btn-disabled-inline" title="已有推广链">已有链接</span>`;
            } else if (canCreate) {
                actionBtn = `<button class="cd-btn cd-btn-primary" style="height:28px;padding:0 12px;font-size:11px" onclick="window.__cdDjIaaCreateLink('${d.bookId}')">取链接</button>`;
            } else {
                let reason = [];
                if (d.publishStatus === 3) reason.push('已下架');
                else if (d.publishStatus === 1) reason.push('未发布');
                else if (d.publishStatus !== 2) reason.push('状态未知');
                if (d.permissionStatus === 2) reason.push('无授权');
                else if (d.permissionStatus !== 4 && d.publishStatus === 2) reason.push('无授权');
                const reasonText = reason.length > 0 ? reason.join('+') : '不可创建';
                actionBtn = `<span class="cd-btn-disabled-inline" title="${reasonText}，按钮灰色">${reasonText}</span>`;
            }

            html += `<tr data-index="${i}">
                <td>${i + 1}</td>
                <td title="${d.name}">${d.name || '-'}</td>
                <td style="font-family:monospace;font-size:11px">${d.bookId || '-'}</td>
                <td style="font-family:monospace;font-size:11px">${d.awemeUserId || '-'}</td>
                <td>${d.totalEpisodes || '-'}</td>
                <td>${publishStatusBadge(d.publishStatus)}</td>
                <td>${authStatusBadge(d.permissionStatus)}</td>
                <td>${links}</td>
                <td>${actionBtn}</td>
            </tr>`;
        }

        // 底部spacer
        if (bottomSpacerHeight > 0) {
            html += `<tr class="cd-virtual-spacer" style="height:${bottomSpacerHeight}px"><td colspan="9"></td></tr>`;
        }

        tbody.innerHTML = html;
        virtualState.startIndex = startIdx;
        virtualState.endIndex = endIdx;
        footerInfo.textContent = `共 ${total} 部短剧（虚拟滚动，显示 ${startIdx + 1}-${endIdx}）`;
    }

    // 虚拟滚动：防抖更新
    function onVirtualScroll() {
        if (virtualState._rafId) return;
        virtualState._rafId = requestAnimationFrame(() => {
            virtualState._rafId = null;
            const dramas = Object.values(dramaMap);
            if (dramas.length === 0) return;
            const { rowHeight, bufferRows } = VIRTUAL_CONFIG;
            const scrollTop = tableWrap.scrollTop;
            const viewportHeight = tableWrap.clientHeight;
            const total = dramas.length;

            const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
            const endIdx = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + bufferRows);

            // 只有当可见范围变化时才重渲染
            if (startIdx !== virtualState.startIndex || endIdx !== virtualState.endIndex) {
                renderTable();
            }
        });
    }

    // 初始化虚拟滚动监听
    function initVirtualScroll() {
        tableWrap.addEventListener('scroll', onVirtualScroll, { passive: true });
    }

    // ==================== 自动创建推广链（核心逻辑） ====================
    async function autoCreatePromoLink(bookId) {
        const drama = dramaMap[bookId];
        if (!drama) return;

        // 检查状态
        if (drama.publishStatus !== 2) {
            log(`${drama.name} - ${publishStatusText(drama.publishStatus)}，无法创建推广链`, 'er');
            return;
        }
        if (drama.permissionStatus !== 4) {
            log(`${drama.name} - ${authStatusText(drama.permissionStatus)}，无法创建推广链`, 'er');
            return;
        }

        log(`正在获取 ${drama.name} 的可用模板...`, 'inf');
        // 获取可用模板
        const templates = await getTemplates(bookId);
        if (templates.length === 0) {
            log(`${drama.name} - 无可用模板`, 'er');
            drama.error = '无可用模板';
            return;
        }

        // 筛选可创建的模板，按集数从小到大排序
        const available = templates.filter(t => t.canCreate).sort((a, b) => a.startEpisode - b.startEpisode);
        if (available.length === 0) {
            log(`${drama.name} - 所有模板链接已被取完`, 'er');
            drama.error = '链接已被取完';
            return;
        }

        // 选择第4-10集起广的模板
        const episodeRange = [4, 5, 6, 7, 8, 9, 10];

        // 先查询已有推广链（180天范围），取回已创建的4-10集链接
        log(`${drama.name} - 查询已有推广链...`, 'inf');
        const existingLinks = await getPromoLinks(bookId);
        const existingIn410 = existingLinks.filter(l => episodeRange.includes(l.startEpisode));
        if (existingIn410.length > 0) {
            log(`${drama.name} - 已有 ${existingIn410.length} 条推广链（4-10集）`, 'ok');
        }

        // 找出已有链接的集数，这些不需要再创建
        const existingEpisodes = new Set(existingIn410.map(l => l.startEpisode));

        // 筛选可创建且在4-10集范围内且尚未有链接的模板
        const targetTemplates = available.filter(t =>
            episodeRange.includes(t.startEpisode) && !existingEpisodes.has(t.startEpisode)
        );

        const allLinks = [...existingIn410];
        let successCount = 0;
        let failCount = 0;

        if (targetTemplates.length === 0 && existingIn410.length === 0) {
            log(`${drama.name} - 4-10集无可用模板，跳过创建`, 'war');
            drama.error = '4-10集无可用模板';
            return;
        }

        if (targetTemplates.length > 0) {
            log(`${drama.name} - 需创建 ${targetTemplates.length} 个新链接（4-10集），开始批量创建...`, 'inf');
            const now = new Date();
            const promoName = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

            for (const template of targetTemplates) {
                log(`${drama.name} - 创建第${template.startEpisode}集起广模板: ${template.templateName}`, 'inf');
                const result = await createPromoLink(bookId, template.templateId, promoName);
                if (result.error) {
                    log(`${drama.name} - 第${template.startEpisode}集创建失败: ${result.error}`, 'er');
                    failCount++;
                } else {
                    allLinks.push({
                        promoId: result.promoId,
                        promoName: result.promoName,
                        link: result.link,
                        startEpisode: template.startEpisode,
                        templateId: template.templateId,
                        createTime: now.toISOString()
                    });
                    successCount++;
                    log(`${drama.name} - 第${template.startEpisode}集创建成功`, 'ok');
                    renderTable();
                }
                await sleep(200);
            }
        }

        // 按集数排序
        allLinks.sort((a, b) => (a.startEpisode || 0) - (b.startEpisode || 0));
        drama.promoLinks = allLinks;

        const totalCount = allLinks.length;
        const existingCount = existingIn410.length;
        if (totalCount > 0) {
            log(`${drama.name} - 完成：${existingCount}已有 + ${successCount}新建 = ${totalCount}条链接（${failCount}失败）`, 'ok');
        } else {
            drama.error = '所有模板创建失败';
            log(`${drama.name} - 所有模板创建失败`, 'er');
        }
        renderTable();
    }

    // ==================== 【v13.0】重名剧目选择弹窗 ====================
    function showMultiSelectModal(multiResults) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'cd-batch-overlay';
            let html = `<div class="cd-batch-modal" style="width:620px;max-height:80vh;overflow-y:auto">
                <div class="cd-batch-header">
                    <h4>搜索发现多个相关结果，请选择</h4>
                    <button class="cd-batch-close">✕</button>
                </div>
                <div class="cd-batch-hint">
                    以下短剧与搜索词<b>相关</b>，请选择您需要的版本。每部短剧选择一个后点击确认。
                </div>
                <div style="padding:0 20px 8px">`;
            multiResults.forEach((mr, idx) => {
                html += `<div style="margin-bottom:14px">
                    <div style="font-weight:600;margin-bottom:6px;color:#3a5a3a;font-size:13px">${idx + 1}. ${mr.searchName}</div>`;
                mr.results.forEach((drama, di) => {
                    const pubText = publishStatusText(drama.publishStatus);
                    const authText = authStatusText(drama.permissionStatus);
                    const checked = di === 0 ? 'checked' : '';
                    html += `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border:1px solid #c8dcc8;border-radius:8px;margin-bottom:4px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='#43a047'" onmouseout="this.style.borderColor='#c8dcc8'">
                        <input type="radio" name="multi_${idx}" value="${di}" ${checked} style="margin-top:3px" />
                        <div style="flex:1">
                            <div style="font-size:13px;color:#3a5a3a">${drama.name} <span style="color:#90a890;font-size:11px">(ID: ${drama.bookId})</span></div>
                            <div style="font-size:11px;color:#90a890;margin-top:2px">总集数: ${drama.totalEpisodes} | ${pubText} | ${authText}${drama.awemeUserId ? ' | 抖音ID: ' + drama.awemeUserId : ''}</div>
                        </div>
                    </label>`;
                });
                html += `</div>`;
            });
            html += `</div>
                <div class="cd-batch-footer">
                    <button class="cd-btn cd-btn-secondary" id="cd-multi-cancel">取消(默认选第一个)</button>
                    <button class="cd-btn cd-btn-primary" id="cd-multi-confirm">确认选择</button>
                </div>
            </div>`;
            overlay.innerHTML = html;
            document.body.appendChild(overlay);
            function getSelected() {
                const selected = [];
                multiResults.forEach((mr, idx) => {
                    const checked = overlay.querySelector(`input[name="multi_${idx}"]:checked`);
                    selected.push(checked ? mr.results[parseInt(checked.value)] : mr.results[0]);
                });
                return selected;
            }
            function close() { overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 150); }
            document.getElementById('cd-multi-confirm').onclick = () => { const s = getSelected(); close(); resolve(s); };
            document.getElementById('cd-multi-cancel').onclick = () => { const s = getSelected(); close(); resolve(s); };
            overlay.querySelector('.cd-batch-close').onclick = () => { const s = getSelected(); close(); resolve(s); };
            overlay.onclick = (e) => { if (e.target === overlay) { const s = getSelected(); close(); resolve(s); } };
        });
    }

    // ==================== 主流程：极速批量获取 ====================
    async function turboSearch(items) {
        if (items.length === 0) return;
        isWorking = true;
        stopRequested = false;
        stopBtn.style.display = '';
        progressEl.style.display = '';
        progressFill.style.width = '0%';

        // 清除上一次搜索的错误条目
        for (const key of Object.keys(dramaMap)) {
            if (key.startsWith('err_')) delete dramaMap[key];
        }

        // 等待认证信息就绪
        let waitCount = 0;
        while (!authInfo.appid && waitCount < 30) {
            log(`正在获取认证信息... (appid:${authInfo.appid ? '✓' : '✗'})`, 'inf');
            await sleep(500);
            waitCount++;
        }
        if (!authInfo.appid) {
            log('未能获取认证信息(appid)，请先在页面左侧短剧列表中搜索一次任意剧名', 'er');
            finishWork();
            return;
        }
        log(`认证就绪: appid=${authInfo.appid}, distributor=${authInfo.distributorId}`, 'ok');

        const modeLabel = searchMode === 'id' ? 'ID' : '名称';
        log(`[1/4] 批量并发搜索 ${items.length} 部短剧（${modeLabel}模式，5并发）...`, 'inf');
        const searchResults = await batchConcurrent(items, 5, async (item, idx) => {
            await sleep(idx % 5 * 50);
            try {
                return searchMode === 'id' ? await searchDramaById(item) : await searchDrama(item);
            } catch(e) {
                return { error: e.message, name: item };
            }
        });

        // 处理搜索结果：区分单结果、多结果(重名)和错误
        const multiResults = [];
        for (let i = 0; i < items.length; i++) {
            const r = searchResults[i];
            if (r && r.multiple) {
                multiResults.push(r);
            } else if (r && !r.error && r.bookId) {
                dramaMap[r.bookId] = {
                    ...dramaMap[r.bookId],
                    ...r,
                    searchName: items[i],
                    promoLinks: dramaMap[r.bookId]?.promoLinks || []
                };
            } else {
                const tempId = 'err_' + i;
                const errMsg = r?.error || '搜索失败';
                console.log(`[搜索结果] 第${i+1}部「${items[i]}」失败: ${errMsg}`);
                dramaMap[tempId] = {
                    bookId: '-',
                    name: items[i],
                    publishStatus: 0,
                    permissionStatus: 0,
                    error: errMsg,
                    promoLinks: []
                };
            }
        }
        renderTable();

        if (multiResults.length > 0) {
            log(`[1/4] 发现 ${multiResults.length} 部重名短剧，请选择...`, 'inf');
            const selectedDramas = await showMultiSelectModal(multiResults);
            for (const drama of selectedDramas) {
                if (drama && drama.bookId) {
                    dramaMap[drama.bookId] = {
                        ...dramaMap[drama.bookId],
                        ...drama,
                        promoLinks: dramaMap[drama.bookId]?.promoLinks || []
                    };
                }
            }
            renderTable();
            log(`[1/4] 重名选择完成`, 'ok');
        }

        const found = Object.values(dramaMap).filter(d => d.bookId && !d.bookId.startsWith('err_')).length;
        log(`[1/4] 搜索完成：${found}/${items.length} 部找到`, 'ok');

        if (stopRequested) { finishWork(); return; }

        // 第2步：为已发布+有授权的剧自动创建推广链
        const needCreate = Object.values(dramaMap).filter(d =>
            d.bookId && !d.bookId.startsWith('err_') &&
            d.publishStatus === 2 && d.permissionStatus === 4
        );

        if (needCreate.length > 0) {
            log(`[2/4] 为 ${needCreate.length} 部短剧自动创建推广链（6并发）...`, 'inf');
            let createdCount = 0;
            await batchConcurrent(needCreate, 6, async (drama, idx) => {
                if (stopRequested) return;
                await sleep(idx % 6 * 40);
                try {
                    await autoCreatePromoLink(drama.bookId);
                    if (drama.promoLinks && drama.promoLinks.length > 0) createdCount++;
                } catch(e) {
                    console.error(`[创建链接:${drama.name}] 异常:`, e.message);
                }
            });

            const failedDramas = needCreate.filter(d => !d.promoLinks || d.promoLinks.length === 0);
            if (failedDramas.length > 0 && !stopRequested) {
                log(`[2/4] ${failedDramas.length} 部创建失败，2s后重试一次...`, 'inf');
                await sleep(2000);
                let retryCount = 0;
                await batchConcurrent(failedDramas, 6, async (drama, idx) => {
                    if (stopRequested) return;
                    await sleep(idx % 6 * 40);
                    try {
                        await autoCreatePromoLink(drama.bookId);
                        if (drama.promoLinks && drama.promoLinks.length > 0) retryCount++;
                    } catch(e) {
                        console.error(`[重试创建:${drama.name}] 异常:`, e.message);
                    }
                });
                createdCount += retryCount;
            }

            renderTable();
            log(`[2/4] 推广链创建完成：${createdCount}/${needCreate.length} 部成功`, 'ok');
        }

        if (stopRequested) { finishWork(); return; }

        // 第3步：为创建失败的剧查询已有推广链（180天范围）
        const needQuery = needCreate.filter(d =>
            !d.promoLinks || d.promoLinks.length === 0
        );

        if (needQuery.length > 0) {
            log(`[3/4] 为 ${needQuery.length} 部短剧查询已有推广链（180天范围）...`, 'inf');
            await batchConcurrent(needQuery, 5, async (drama, idx) => {
                if (stopRequested) return;
                await sleep(idx % 5 * 50);
                try {
                    const existingLinks = await getPromoLinks(drama.bookId);
                    if (existingLinks && existingLinks.length > 0) {
                        drama.promoLinks = existingLinks;
                    }
                } catch(e) {
                    console.error(`[查询链接:${drama.name}] 异常:`, e.message);
                }
            });
            renderTable();
            const linkedCount = Object.values(dramaMap).filter(d => d.promoLinks && d.promoLinks.length > 0).length;
            log(`[3/4] 推广链查询完成：${linkedCount} 部已有链接`, 'ok');
        }

        if (stopRequested) { finishWork(); return; }

        // 第4步：补漏验证 - 为仍无链接的可创建剧目做最后尝试
        const stillMissing = needCreate.filter(d =>
            (!d.promoLinks || d.promoLinks.length === 0) && !d.error
        );
        if (stillMissing.length > 0) {
            log(`[4/4] 补漏验证：${stillMissing.length} 部仍无链接，最后尝试查询...`, 'inf');
            await sleep(2000);
            await batchConcurrent(stillMissing, 3, async (drama) => {
                if (stopRequested) return;
                try {
                    const existingLinks = await getPromoLinks(drama.bookId);
                    if (existingLinks && existingLinks.length > 0) {
                        drama.promoLinks = existingLinks;
                        drama.error = null;
                    } else if (!drama.error) {
                        drama.error = '创建失败且无已有链接';
                    }
                } catch(e) {
                    console.error(`[补漏查询:${drama.name}] 异常:`, e.message);
                }
            });
            renderTable();
        }

        finishWork();
    }

    function finishWork() {
        isWorking = false;
        stopBtn.style.display = 'none';
        progressEl.style.display = 'none';
        const total = Object.keys(dramaMap).length;
        const linked = Object.values(dramaMap).filter(d => d.promoLinks && d.promoLinks.length > 0).length;
        log(`全部完成！共获取 ${total} 部短剧数据，${linked} 部有推广链`, 'ok');
    }

    // ==================== 手动取链接 ====================
    unsafeWindow.__cdDjIaaCreateLink = async function(bookId) {
        if (isWorking) {
            log('正在执行批量任务，请等待完成', 'er');
            return;
        }
        log(`正在为 ${dramaMap[bookId]?.name || bookId} 创建推广链...`, 'inf');
        await autoCreatePromoLink(bookId);
        renderTable();
    };

    // ==================== Excel导出 ====================
    function exportExcel() {
        const dramas = Object.values(dramaMap);
        if (dramas.length === 0) return;

        // 按名称排序
        dramas.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));

        // 每部剧一行，4-10集各占一列
        const episodes = [4, 5, 6, 7, 8, 9, 10];
        const sheetData = dramas.map((d, i) => {
            const links = d.promoLinks || [];
            let statusText = '正常';
            if (d.publishStatus === 3) statusText = '已下架';
            else if (d.publishStatus === 1) statusText = '未发布';
            else if (d.publishStatus === 0 && d.error) statusText = d.error;

            const row = {
                '序号': i + 1,
                '名称': d.name || '',
                'ID': d.bookId && !d.bookId.startsWith('err_') ? d.bookId : '-',
                '抖音作品ID': d.awemeUserId || '-',
            };
            for (const ep of episodes) {
                const link = links.find(l => l.startEpisode === ep);
                row[`${ep}集`] = link?.link || '-';
            }
            row['状态'] = statusText;
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(sheetData);
        const colWidths = [{wch:5},{wch:30},{wch:22},{wch:22}];
        for (let i = 0; i < episodes.length; i++) colWidths.push({wch:80});
        colWidths.push({wch:10});
        ws['!cols'] = colWidths;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '数据');
        const now = new Date();
        const fname = `IAA数据_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`;
        XLSX.writeFile(wb, fname);
        log(`已导出 ${sheetData.length} 条数据到 ${fname}`, 'ok');
    }

    // ==================== 批量输入弹窗 ====================
    function showBatchModal() {
        const isIdMode = searchMode === 'id';
        const inputLabel = isIdMode ? '短剧ID' : '短剧名称';
        const placeholder = isIdMode
            ? '每行一个短剧ID&#10;例如：&#10;7673026892231871512&#10;7673026892231871513'
            : '每行一个短剧名称&#10;例如：&#10;真假继承人&#10;嫁给前夫的上司后&#10;龙父虎子闹盛夏';
        const overlay = document.createElement('div');
        overlay.className = 'cd-batch-overlay';
        overlay.innerHTML = `
            <div class="cd-batch-modal" id="cd-batch-modal-inner">
                <div class="cd-batch-header">
                    <h4>批量输入${inputLabel}</h4>
                    <div>
                        <span class="cd-batch-counter" id="cd-batch-counter">0 个</span>
                        <button class="cd-batch-close" id="cd-batch-close-btn">✕</button>
                    </div>
                </div>
                <div class="cd-batch-hint">
                    每行输入一个${inputLabel}，支持从Excel复制粘贴（Tab分隔的数据自动取第一列）。最多<b>5000个</b>。
                </div>
                <div class="cd-batch-textarea-wrap">
                    <textarea class="cd-batch-textarea" id="cd-batch-textarea" placeholder="${placeholder}"></textarea>
                </div>
                <div class="cd-batch-footer">
                    <button class="cd-btn cd-btn-secondary" id="cd-batch-clear-btn">清空</button>
                    <button class="cd-btn cd-btn-primary" id="cd-batch-do-btn">开始极速搜索</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const textarea = document.getElementById('cd-batch-textarea');
        const counter = document.getElementById('cd-batch-counter');
        const clearBtn = document.getElementById('cd-batch-clear-btn');
        const okBtn = document.getElementById('cd-batch-do-btn');
        const closeBtn = document.getElementById('cd-batch-close-btn');

        function updateCount() {
            const lines = textarea.value.split('\n').map(l => l.trim().split('\t')[0].trim()).filter(l => l);
            counter.textContent = `${lines.length} 个`;
        }
        textarea.addEventListener('input', updateCount);

        function close() {
            overlay.classList.add('closing');
            const inner = document.getElementById('cd-batch-modal-inner');
            if (inner) inner.classList.add('closing');
            setTimeout(() => overlay.remove(), 160);
        }
        clearBtn.onclick = () => { textarea.value = ''; textarea.dispatchEvent(new Event('input')); textarea.focus(); };
        closeBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        okBtn.onclick = () => {
            const lines = textarea.value.split('\n').map(l => l.trim().split('\t')[0].trim()).filter(l => l);
            if (lines.length === 0) return;
            close();
            turboSearch(lines.slice(0, VIRTUAL_CONFIG.maxItems));
        };

        textarea.focus();
    }

    // ==================== 事件绑定 ====================
    initVirtualScroll();
    searchBtn.addEventListener('click', () => {
        const val = searchInput.value.trim();
        if (!val) return;
        if (isWorking) return;
        const names = val.split('\n').map(l => l.trim().split('\t')[0].trim()).filter(l => l);
        if (names.length === 0) return;
        turboSearch(names.slice(0, VIRTUAL_CONFIG.maxItems));
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            searchBtn.click();
        }
    });

    clearInputBtn.addEventListener('click', () => { searchInput.value = ''; searchInput.focus(); });
    batchBtn.addEventListener('click', showBatchModal);
    stopBtn.addEventListener('click', () => { stopRequested = true; log('正在停止...', 'er'); });
    exportBtn.addEventListener('click', exportExcel);
    clearAllBtn.addEventListener('click', () => {
        dramaMap = {};
        renderTable();
        log('已清空全部数据', '');
    });

    // 搜索模式切换
    modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeDropdown.classList.toggle('show');
        modeBtn.classList.toggle('open');
    });
    modeDropdown.querySelectorAll('.cd-mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
            searchMode = opt.dataset.mode;
            modeDropdown.querySelectorAll('.cd-mode-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            modeBtn.innerHTML = searchMode === 'id'
                ? 'ID <span class="cd-mode-arrow">▼</span>'
                : '名称 <span class="cd-mode-arrow">▼</span>';
            searchInput.placeholder = searchMode === 'id'
                ? '输入短剧ID搜索（支持批量，每行一个）'
                : '输入短剧名称搜索（支持批量，每行一个）';
            modeDropdown.classList.remove('show');
            modeBtn.classList.remove('open');
        });
    });
    document.addEventListener('click', () => {
        modeDropdown.classList.remove('show');
        modeBtn.classList.remove('open');
    });

    // 最小化
    document.getElementById('cd-toggle').addEventListener('click', () => {
        panel.classList.toggle('minimized');
        document.getElementById('cd-toggle').textContent = panel.classList.contains('minimized') ? '+' : '−';
    });

    console.log('[短剧数据助手 v12.0.0 极速版 IAA] 已加载 - 4-10集全量取链·6并发创建·全部链接导出·XHR直调·5并发搜索·ID/名称双模式·180天链接查询·虚拟滚动');
    console.log('[认证信息拦截] 等待页面XHR请求自动捕获appid/distributorId等认证头...');
    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'dj-iaa';
    var _authPassed = false;
    console.log('%c[授权校验] v12.0.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
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