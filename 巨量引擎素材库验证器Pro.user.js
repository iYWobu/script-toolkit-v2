// ==UserScript==
// @name         巨量引擎素材库验证器 Pro
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      11.9.3
// @description  奶油黄主题 | API直连搜索 | 圆球浮动按钮 | 精致动画交互
// @author       You
// @match        https://business.oceanengine.com/*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {

    function main() {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        WAIT_TIME: 3000,
        API_BATCH_SIZE: 3,
        API_BATCH_DELAY: 500,
        PANEL_WIDTH: 440,
        MAX_RETRIES: 3,
    };

    // ==================== 状态 ====================
    const state = {
        isRunning: false,
        dramaList: [],
        results: [],
        abortFlag: false,
        csrfToken: null,
        apiConfig: null,
        panelOpen: false,
    };

    // ==================== CSRF 拦截 ====================
    function interceptCSRF() {
        const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (name.toLowerCase() === 'x-csrftoken' && value) {
                if (state.csrfToken !== value) {
                    state.csrfToken = value;
                    checkApiConfig();
                }
            }
            return originalSetHeader.call(this, name, value);
        };

        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
            const [resource, options = {}] = args;
            if (options.headers) {
                let headers = {};
                if (options.headers instanceof Headers) {
                    options.headers.forEach((v, k) => { headers[k] = v; });
                } else if (typeof options.headers === 'object') {
                    headers = { ...options.headers };
                }
                const token = headers['x-csrftoken'] || headers['X-CSRFToken'];
                if (token && state.csrfToken !== token) {
                    state.csrfToken = token;
                    checkApiConfig();
                }
            }
            return originalFetch.apply(this, args);
        };
    }

    function getEbpIdFromUrl() {
        try {
            return new URL(window.location.href).searchParams.get('ebpid') || '';
        } catch (e) { return ''; }
    }

    function checkApiConfig() {
        const ebpid = getEbpIdFromUrl();
        if (ebpid && state.csrfToken) {
            if (!state.apiConfig || state.apiConfig.ebpid !== ebpid) {
                state.apiConfig = { ebpid, csrfToken: state.csrfToken };
                updateModeIndicator();
            }
        }
    }

    function formatDateTime(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    // ==================== API 搜索 ====================
    async function searchByAPI(keyword) {
        if (!state.apiConfig) return null;
        const { ebpid, csrfToken } = state.apiConfig;

        const now = new Date();
        const end = new Date(now); end.setHours(23, 59, 59);
        const start = new Date(now); start.setFullYear(start.getFullYear() - 2); start.setHours(0, 0, 0);

        const body = {
            startTime: formatDateTime(start),
            endTime: formatDateTime(end),
            name: keyword,
            limit: 100, page: 1,
            orderBy: "create_time", orderType: 1,
            fields: ["stat_cost", "show_cnt", "click_cnt", "ctr"],
            imageModes: [], materialProperties: [],
            filterAuthEbpId: ebpid,
            isDirectAccountGroup: false,
        };

        try {
            const response = await fetch(`/api/ebp/video/list?ebpid=${ebpid}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*',
                    'x-csrftoken': csrfToken,
                },
                credentials: 'include',
                body: JSON.stringify(body),
            });
            const data = await response.json();
            if (data.code !== 0) return null;

            const list = data.data?.list || [];
            const total = data.data?.pagination?.total || 0;
            const matchingItems = list.filter(item => matchDramaName(item.file_name || item.name || '', keyword));
            const hasMaterial = matchingItems.length > 0 || (total > 0 && list.length > 0);

            return {
                hasMaterial,
                count: matchingItems.length || total,
                details: matchingItems.slice(0, 5).map(i => (i.file_name || '').substring(0, 80)),
                error: null,
            };
        } catch (e) { return null; }
    }

    // ==================== DOM 搜索（回退） ====================
    function setInputValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function searchByDOM(keyword) {
        return new Promise((resolve) => {
            const searchInput = findSearchInput();
            if (!searchInput) { resolve({ hasMaterial: false, count: 0, details: [], error: '未找到搜索框' }); return; }
            setInputValue(searchInput, keyword);
            setTimeout(() => {
                triggerEnter(searchInput);
                setTimeout(async () => {
                    await waitForLoading(5);
                    let afterCount = getTableRowCount();
                    let hasNoData = checkNoDataState();
                    if (afterCount > 0 && !hasNoData) {
                        const rows = getTableRows();
                        if (rows.filter(r => matchDramaName(r.innerText || '', keyword)).length === 0) {
                            await sleep(2000);
                            afterCount = getTableRowCount();
                            hasNoData = checkNoDataState();
                        }
                    }
                    const rows = getTableRows();
                    const matchingRows = rows.filter(r => matchDramaName(r.innerText || '', keyword));
                    const isEmpty = hasNoData || afterCount === 0;
                    resolve({ hasMaterial: !isEmpty, count: isEmpty ? 0 : (matchingRows.length || afterCount), details: matchingRows.slice(0, 5).map(r => r.innerText?.substring(0, 80) || ''), error: null });
                }, 3000);
            }, 200);
        });
    }

    function waitForLoading(maxSec) {
        return new Promise(resolve => {
            let c = 0;
            const check = () => {
                c++;
                if (!document.querySelector('[class*="loading"][class*="spin"], [class*="spinner"], .ovui-spin') || c >= maxSec) resolve();
                else setTimeout(check, 1000);
            };
            check();
        });
    }

    function matchDramaName(text, keyword) {
        if (!text || !keyword) return false;
        if (text.includes(keyword)) return true;
        const nt = text.replace(/\s+/g, ''), nk = keyword.replace(/\s+/g, '');
        if (nt.includes(nk)) return true;
        for (const seg of text.split(/[-_\-]/)) {
            if (seg.trim() === keyword.trim()) return true;
            if (seg.trim().length > 1 && (seg.includes(keyword) || keyword.includes(seg.trim()))) return true;
        }
        return false;
    }

    function triggerEnter(input) {
        ['keydown', 'keypress', 'keyup'].forEach(type => {
            input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        });
    }

    function findSearchInput() {
        for (const sel of ['input[placeholder*="视频名称"]', 'input[placeholder*="名称和ID"]', 'input[placeholder*="输入视频"]']) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function checkNoDataState() {
        const c = document.querySelector('[class*="ovui-table"], [class*="table-container"], [class*="video-table"]');
        const t = c ? c.innerText : document.body.innerText;
        return ['暂无搜索结果', '暂无数据', '暂无视频', '没有数据', '无结果', '未找到相关'].some(kw => t.includes(kw));
    }

    function getTableRows() {
        for (const sel of ['tr.ovui-tr.video-table-row', 'tr.video-table-row', 'tr.ovui-tr:not(.ovui-tr--head):not([class*="date"])', '.ant-table-tbody > tr', 'table tbody tr:not(:has(th))']) {
            const rows = Array.from(document.querySelectorAll(sel)).filter(r => (r.innerText?.trim() || '').length > 0 && !r.querySelector('th'));
            if (rows.length > 0) return rows;
        }
        return [];
    }

    function getTableRowCount() { return getTableRows().length; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ==================== 核心搜索 ====================
    async function runSearch() {
        if (state.dramaList.length === 0) { showToast('请先输入剧名列表'); return; }
        state.isRunning = true; state.results = []; state.abortFlag = false;
        checkApiConfig(); updateUIState(); updateModeIndicator();
        const useAPI = !!state.apiConfig;
        if (useAPI) await runBatchSearch(); else await runSequentialSearch();
        state.isRunning = false; updateUIState();
        updateProgress(state.dramaList.length, state.dramaList.length, '完成');
    }

    async function runBatchSearch() {
        for (let i = 0; i < state.dramaList.length; i += CONFIG.API_BATCH_SIZE) {
            if (state.abortFlag) break;
            const batch = state.dramaList.slice(i, i + CONFIG.API_BATCH_SIZE);
            updateProgress(Math.min(i + 1, state.dramaList.length), state.dramaList.length, `${batch[0]?.name} 等${batch.length}个`);
            const results = await Promise.all(batch.map(async (drama) => {
                let r = null;
                try { r = await searchByAPI(drama.name); } catch (e) { }
                if (!r) r = { hasMaterial: false, count: 0, details: [], error: 'API搜索失败' };
                return { name: drama.name, id: drama.id || '', hasMaterial: r.hasMaterial, count: r.count, details: r.details, error: r.error };
            }));
            state.results.push(...results);
            updateResultsTable();
            const completed = Math.min(i + CONFIG.API_BATCH_SIZE, state.dramaList.length);
            updateProgress(completed, state.dramaList.length, `已完成 ${completed}/${state.dramaList.length}`);
            if (completed < state.dramaList.length && !state.abortFlag) await sleep(CONFIG.API_BATCH_DELAY);
        }
    }

    async function runSequentialSearch() {
        for (let i = 0; i < state.dramaList.length; i++) {
            if (state.abortFlag) break;
            const drama = state.dramaList[i];
            updateProgress(i + 1, state.dramaList.length, drama.name);
            let result = null, retries = 0;
            while (!result && retries < CONFIG.MAX_RETRIES) {
                try { result = await searchByDOM(drama.name); } catch (e) { retries++; await sleep(1000); }
            }
            if (!result) result = { hasMaterial: false, count: 0, details: [], error: '搜索失败' };
            state.results.push({ name: drama.name, id: drama.id || '', hasMaterial: result.hasMaterial, count: result.count, details: result.details, error: result.error });
            updateResultsTable();
            if (i < state.dramaList.length - 1) await sleep(CONFIG.WAIT_TIME);
        }
    }

    // ==================== 样式 ====================
    function injectStyles() {
        const css = `
            /* ==================== 奶油黄主题变量 ==================== */
            :root {
                --bl-butter-50: #FFFEF8;
                --bl-butter-100: #FFF9E6;
                --bl-butter-200: #FFF3CC;
                --bl-butter-300: #FFEDA8;
                --bl-butter-400: #F5D67A;
                --bl-butter-500: #E8C252;
                --bl-caramel-400: #D4A437;
                --bl-caramel-500: #B8860B;
                --bl-caramel-600: #8B6914;
                --bl-cream: #FFF8E7;
                --bl-warm-white: #FFFDF5;
                --bl-text: #5C4A1E;
                --bl-text-soft: #8B7355;
                --bl-text-light: #B8A07A;
                --bl-shadow: rgba(184, 134, 11, 0.12);
                --bl-shadow-strong: rgba(184, 134, 11, 0.22);
                --bl-green: #7CB342;
                --bl-green-soft: #DCEDC8;
                --bl-red: #E57373;
                --bl-red-soft: #FFCDD2;
            }

            /* ==================== 浮动圆球 ==================== */
            #bl-fab {
                position: fixed;
                top: 24px;
                right: 24px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: radial-gradient(circle at 35% 30%, var(--bl-butter-200), var(--bl-butter-400) 50%, var(--bl-caramel-400) 100%);
                border: none;
                cursor: pointer;
                z-index: 999998;
                box-shadow:
                    0 6px 20px var(--bl-shadow-strong),
                    0 2px 8px rgba(184, 134, 11, 0.15),
                    inset 0 2px 4px rgba(255, 255, 255, 0.6),
                    inset 0 -2px 4px rgba(184, 134, 11, 0.15);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
                animation: bl-breathe 4s ease-in-out infinite;
                cursor: grab;
            }
            #bl-fab::before {
                content: '';
                position: absolute;
                top: 8px; left: 12px;
                width: 16px; height: 12px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.5);
                filter: blur(3px);
                pointer-events: none;
            }
            #bl-fab:hover {
                transform: scale(1.12) rotate(8deg);
                box-shadow:
                    0 10px 30px var(--bl-shadow-strong),
                    0 4px 12px rgba(184, 134, 11, 0.2),
                    inset 0 2px 4px rgba(255, 255, 255, 0.7),
                    inset 0 -2px 4px rgba(184, 134, 11, 0.2);
            }
            #bl-fab:active { transform: scale(0.95) rotate(-5deg); }
            #bl-fab .bl-fab-icon {
                font-size: 24px;
                color: var(--bl-caramel-600);
                text-shadow: 0 1px 2px rgba(255, 255, 255, 0.5);
                transition: transform 0.3s ease;
            }
            #bl-fab:hover .bl-fab-icon { transform: scale(1.15); }
            @keyframes bl-breathe {
                0%, 100% { box-shadow: 0 6px 20px var(--bl-shadow-strong), 0 2px 8px rgba(184, 134, 11, 0.15), inset 0 2px 4px rgba(255, 255, 255, 0.6), inset 0 -2px 4px rgba(184, 134, 11, 0.15), 0 0 0 0 rgba(245, 214, 122, 0.3); }
                50% { box-shadow: 0 6px 20px var(--bl-shadow-strong), 0 2px 8px rgba(184, 134, 11, 0.15), inset 0 2px 4px rgba(255, 255, 255, 0.6), inset 0 -2px 4px rgba(184, 134, 11, 0.15), 0 0 0 12px rgba(245, 214, 122, 0); }
            }
            #bl-fab .bl-fab-badge {
                position: absolute;
                top: -2px; right: -2px;
                min-width: 18px; height: 18px;
                border-radius: 9px;
                background: linear-gradient(135deg, #FF6B6B, #EE5A5A);
                color: white;
                font-size: 9px;
                font-weight: 700;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 0 5px;
                box-shadow: 0 2px 6px rgba(238, 90, 90, 0.4);
                font-family: 'Quicksand', sans-serif;
            }
            #bl-fab .bl-fab-badge.visible { display: flex; animation: bl-badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
            @keyframes bl-badge-pop {
                from { transform: scale(0); }
                to { transform: scale(1); }
            }

            /* ==================== 主面板 ==================== */
            #bl-panel {
                position: fixed;
                top: 24px;
                right: 24px;
                width: ${CONFIG.PANEL_WIDTH}px;
                max-height: 82vh;
                background: linear-gradient(145deg, rgba(255, 253, 245, 0.97), rgba(255, 248, 231, 0.95));
                backdrop-filter: blur(24px) saturate(1.2);
                -webkit-backdrop-filter: blur(24px) saturate(1.2);
                border-radius: 24px;
                box-shadow:
                    0 16px 48px var(--bl-shadow-strong),
                    0 4px 16px var(--bl-shadow),
                    0 0 0 1px rgba(255, 237, 168, 0.3);
                z-index: 999999;
                font-family: 'Nunito', 'Quicksand', -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
                font-size: 13px;
                color: var(--bl-text);
                overflow: hidden;
                display: none;
                flex-direction: column;
                opacity: 0;
                transform: scale(0.85) translateY(-10px);
                transform-origin: top right;
                transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            #bl-panel.bl-visible {
                display: flex;
                opacity: 1;
                transform: scale(1) translateY(0);
            }

            /* ==================== 面板头部 ==================== */
            .bl-header {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 16px 20px;
                background: linear-gradient(135deg, var(--bl-butter-200) 0%, var(--bl-butter-300) 50%, var(--bl-butter-400) 100%);
                border-radius: 24px 24px 0 0;
                position: relative;
                overflow: hidden;
            }
            .bl-header::after {
                content: '';
                position: absolute;
                bottom: 0; left: 0; right: 0;
                height: 1px;
                background: linear-gradient(90deg, transparent, rgba(184, 134, 11, 0.2), transparent);
            }
            .bl-header-icon {
                width: 32px; height: 32px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
            }
            .bl-title {
                font-family: 'Quicksand', sans-serif;
                font-weight: 700;
                font-size: 16px;
                color: var(--bl-caramel-600);
                flex: 1;
                letter-spacing: 0.3px;
            }
            .bl-mode-badge {
                font-size: 9px;
                font-weight: 700;
                padding: 3px 10px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.5);
                color: var(--bl-text-soft);
                white-space: nowrap;
                font-family: 'Quicksand', sans-serif;
                letter-spacing: 0.5px;
                transition: all 0.3s ease;
            }
            .bl-mode-badge.api {
                background: rgba(124, 179, 66, 0.25);
                color: #558B2F;
                animation: bl-mode-glow 2.5s ease-in-out infinite;
            }
            .bl-mode-badge.dom {
                background: rgba(212, 164, 55, 0.2);
                color: var(--bl-caramel-600);
            }
            @keyframes bl-mode-glow {
                0%, 100% { box-shadow: 0 0 0 0 rgba(124, 179, 66, 0.3); }
                50% { box-shadow: 0 0 0 6px rgba(124, 179, 66, 0); }
            }
            .bl-close {
                width: 30px; height: 30px;
                border: none;
                background: rgba(255, 255, 255, 0.35);
                color: var(--bl-caramel-600);
                border-radius: 50%;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.25s ease;
                flex-shrink: 0;
            }
            .bl-close:hover {
                background: rgba(255, 255, 255, 0.6);
                transform: rotate(90deg) scale(1.05);
            }
            .bl-close:active { transform: rotate(90deg) scale(0.9); }

            /* ==================== 面板内容 ==================== */
            .bl-body {
                padding: 18px;
                overflow-y: auto;
                max-height: calc(82vh - 70px);
                scrollbar-width: none;
                -ms-overflow-style: none;
            }
            .bl-body::-webkit-scrollbar { width: 0 !important; display: none; }

            .bl-section { margin-bottom: 16px; }
            .bl-label {
                display: block;
                font-family: 'Quicksand', sans-serif;
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--bl-text);
                font-size: 13px;
                letter-spacing: 0.3px;
            }
            .bl-textarea {
                width: 100%;
                height: 88px;
                padding: 12px 14px;
                border: 1.5px solid var(--bl-butter-300);
                border-radius: 14px;
                resize: vertical;
                font-size: 13px;
                line-height: 1.6;
                box-sizing: border-box;
                background: var(--bl-warm-white);
                color: var(--bl-text);
                transition: all 0.25s ease;
                font-family: 'Nunito', sans-serif;
            }
            .bl-textarea:focus {
                outline: none;
                border-color: var(--bl-butter-500);
                box-shadow: 0 0 0 4px rgba(245, 214, 122, 0.2);
                background: white;
            }
            .bl-hint {
                font-size: 11px;
                color: var(--bl-text-light);
                margin-top: 6px;
                font-style: italic;
            }

            /* ==================== 按钮 ==================== */
            .bl-controls {
                display: flex;
                gap: 8px;
                margin-bottom: 14px;
            }
            .bl-btn {
                flex: 1;
                padding: 11px 16px;
                border: none;
                border-radius: 14px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: 'Quicksand', sans-serif;
                letter-spacing: 0.3px;
                position: relative;
                overflow: hidden;
            }
            .bl-btn:disabled { opacity: 0.45; cursor: not-allowed; }
            .bl-btn::before {
                content: '';
                position: absolute;
                top: 0; left: -100%;
                width: 100%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
                transition: left 0.5s ease;
            }
            .bl-btn:hover:not(:disabled)::before { left: 100%; }
            .bl-btn-primary {
                background: linear-gradient(135deg, var(--bl-caramel-400), var(--bl-butter-500));
                color: white;
                box-shadow: 0 4px 14px rgba(184, 134, 11, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.3);
            }
            .bl-btn-primary:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 8px 24px rgba(184, 134, 11, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
            }
            .bl-btn-primary:active:not(:disabled) { transform: translateY(0) scale(0.97); }
            .bl-btn-secondary {
                background: var(--bl-butter-100);
                color: var(--bl-caramel-600);
                border: 1.5px solid var(--bl-butter-300);
            }
            .bl-btn-secondary:hover:not(:disabled) {
                background: var(--bl-butter-200);
                border-color: var(--bl-butter-400);
                transform: translateY(-1px);
            }
            .bl-btn-secondary:active:not(:disabled) { transform: translateY(0) scale(0.97); }
            .bl-btn-export {
                background: linear-gradient(135deg, var(--bl-green), #9CCC65);
                color: white;
                padding: 7px 16px;
                font-size: 12px;
                flex: none;
                box-shadow: 0 3px 10px rgba(124, 179, 66, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.3);
            }
            .bl-btn-export:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 18px rgba(124, 179, 66, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
            }
            .bl-btn-export:active { transform: translateY(0) scale(0.95); }

            /* ==================== 进度条 ==================== */
            .bl-progress { margin-bottom: 14px; }
            .bl-progress-bar {
                height: 10px;
                background: var(--bl-butter-100);
                border-radius: 5px;
                overflow: hidden;
                margin-bottom: 7px;
                box-shadow: inset 0 1px 3px rgba(184, 134, 11, 0.08);
            }
            .bl-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--bl-butter-400), var(--bl-caramel-400), var(--bl-butter-400));
                background-size: 200% 100%;
                border-radius: 5px;
                transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                animation: bl-progress-shimmer 2s linear infinite;
                box-shadow: 0 0 8px rgba(245, 214, 122, 0.4);
            }
            @keyframes bl-progress-shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            .bl-progress-text {
                font-size: 12px;
                color: var(--bl-text-soft);
                text-align: center;
                font-weight: 600;
            }

            /* ==================== 统计卡片 ==================== */
            .bl-stats {
                display: flex;
                gap: 8px;
                margin-bottom: 14px;
            }
            .bl-stat {
                flex: 1;
                background: linear-gradient(145deg, var(--bl-warm-white), var(--bl-butter-100));
                border-radius: 16px;
                padding: 12px 8px;
                text-align: center;
                border: 1px solid rgba(245, 214, 122, 0.25);
                box-shadow: 0 2px 8px rgba(184, 134, 11, 0.06);
                transition: transform 0.2s ease;
            }
            .bl-stat:hover { transform: translateY(-2px); }
            .bl-stat-num {
                display: block;
                font-family: 'Quicksand', sans-serif;
                font-size: 24px;
                font-weight: 700;
                color: var(--bl-caramel-500);
                line-height: 1.2;
                transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .bl-stat:hover .bl-stat-num { transform: scale(1.1); }
            .bl-stat-yes { color: var(--bl-green); }
            .bl-stat-no { color: var(--bl-red); }
            .bl-stat-label {
                font-size: 10px;
                color: var(--bl-text-light);
                margin-top: 3px;
                font-weight: 600;
                letter-spacing: 0.5px;
            }

            /* ==================== 结果表格 ==================== */
            .bl-results-section { margin-bottom: 0; }
            .bl-results-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .bl-results-wrap {
                max-height: 210px;
                overflow-y: auto;
                border-radius: 14px;
                border: 1px solid var(--bl-butter-200);
                background: var(--bl-warm-white);
                scrollbar-width: none;
                -ms-overflow-style: none;
            }
            .bl-results-wrap::-webkit-scrollbar { width: 0 !important; display: none; }
            .bl-results-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .bl-results-table th {
                background: linear-gradient(135deg, var(--bl-butter-100), var(--bl-butter-200));
                padding: 9px 10px;
                text-align: left;
                font-weight: 700;
                color: var(--bl-caramel-600);
                position: sticky;
                top: 0;
                font-family: 'Quicksand', sans-serif;
                font-size: 11px;
                letter-spacing: 0.3px;
                z-index: 1;
            }
            .bl-results-table td {
                padding: 9px 10px;
                border-bottom: 1px solid rgba(245, 214, 122, 0.15);
                color: var(--bl-text);
            }
            .bl-results-table tr { transition: background 0.15s ease; }
            .bl-results-table tr:hover td { background: var(--bl-butter-50); }
            .bl-results-table tr:last-child td { border-bottom: none; }
            .bl-results-table .bl-empty td {
                text-align: center;
                color: var(--bl-text-light);
                padding: 24px;
                font-style: italic;
            }
            .bl-badge {
                display: inline-block;
                padding: 3px 12px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 700;
                font-family: 'Quicksand', sans-serif;
            }
            .bl-badge-yes {
                background: var(--bl-green-soft);
                color: #558B2F;
            }
            .bl-badge-no {
                background: var(--bl-red-soft);
                color: #C62828;
            }

            /* ==================== Toast ==================== */
            .bl-toast {
                position: fixed;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%) scale(0.8);
                background: linear-gradient(135deg, var(--bl-caramel-500), var(--bl-butter-500));
                color: white;
                padding: 14px 32px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 700;
                font-family: 'Quicksand', sans-serif;
                z-index: 9999999;
                box-shadow: 0 12px 40px var(--bl-shadow-strong);
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                pointer-events: none;
            }
            .bl-toast.visible {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ==================== UI 构建 ====================
    function createUI() {
        // 浮动圆球
        const fab = document.createElement('button');
        fab.id = 'bl-fab';
        fab.innerHTML = `<span class="bl-fab-icon">🍯</span><span class="bl-fab-badge" id="bl-fab-badge"></span>`;
        fab.title = '素材验证器 Pro — 拖拽移动，点击展开';
        document.body.appendChild(fab);

        // 圆球拖拽（区分点击和拖拽）
        makeFabDraggable(fab);

        // 主面板
        const panel = document.createElement('div');
        panel.id = 'bl-panel';
        panel.innerHTML = `
            <div class="bl-header">
                <div class="bl-header-icon">🍯</div>
                <span class="bl-title">素材验证器 Pro</span>
                <span class="bl-mode-badge" id="bl-mode-badge">检测中</span>
                <button class="bl-close" id="bl-close">✕</button>
            </div>
            <div class="bl-body">
                <div class="bl-section">
                    <label class="bl-label">剧名列表（支持Excel直接粘贴）</label>
                    <textarea class="bl-textarea" id="bl-input" placeholder="从Excel复制粘贴到这里&#10;格式：剧名 或 剧名[Tab]ID&#10;每行一个"></textarea>
                    <div class="bl-hint">从Excel选中剧名列，Ctrl+C 复制，然后在此 Ctrl+V 粘贴</div>
                </div>
                <div class="bl-controls">
                    <button class="bl-btn bl-btn-primary" id="bl-start">开始验证</button>
                    <button class="bl-btn bl-btn-secondary" id="bl-stop" disabled>停止</button>
                    <button class="bl-btn bl-btn-secondary" id="bl-clear">清空</button>
                </div>
                <div class="bl-progress">
                    <div class="bl-progress-bar">
                        <div class="bl-progress-fill" id="bl-progress-fill" style="width:0%"></div>
                    </div>
                    <div class="bl-progress-text" id="bl-progress-text">准备就绪</div>
                </div>
                <div class="bl-stats">
                    <div class="bl-stat">
                        <span class="bl-stat-num" id="bl-stat-total">0</span>
                        <span class="bl-stat-label">总计</span>
                    </div>
                    <div class="bl-stat">
                        <span class="bl-stat-num bl-stat-yes" id="bl-stat-yes">0</span>
                        <span class="bl-stat-label">有素材</span>
                    </div>
                    <div class="bl-stat">
                        <span class="bl-stat-num bl-stat-no" id="bl-stat-no">0</span>
                        <span class="bl-stat-label">无素材</span>
                    </div>
                </div>
                <div class="bl-section bl-results-section">
                    <div class="bl-results-header">
                        <label class="bl-label">验证结果</label>
                        <button class="bl-btn bl-btn-export" id="bl-export">导出Excel</button>
                    </div>
                    <div class="bl-results-wrap">
                        <table class="bl-results-table">
                            <thead>
                                <tr>
                                    <th>序号</th>
                                    <th>剧名</th>
                                    <th>状态</th>
                                    <th>数量</th>
                                </tr>
                            </thead>
                            <tbody id="bl-results-tbody">
                                <tr class="bl-empty"><td colspan="4">暂无数据</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 事件绑定
        document.getElementById('bl-close').addEventListener('click', () => togglePanel(false));
        document.getElementById('bl-start').addEventListener('click', () => { parseInput(); runSearch(); });
        document.getElementById('bl-stop').addEventListener('click', () => { state.abortFlag = true; });
        document.getElementById('bl-clear').addEventListener('click', clearAll);
        document.getElementById('bl-export').addEventListener('click', exportExcel);

        document.getElementById('bl-input').addEventListener('paste', (e) => {
            setTimeout(() => {
                const ta = e.target;
                const lines = ta.value.split(/\r?\n/);
                ta.value = lines.map(l => l.split('\t').filter(p => p.trim()).join('\t')).filter(l => l.trim()).join('\n');
            }, 0);
        });

        // 拖拽
        makeDraggable();
    }

    function togglePanel(force) {
        const fab = document.getElementById('bl-fab');
        const panel = document.getElementById('bl-panel');
        const show = force !== undefined ? force : !state.panelOpen;
        if (show) {
            // 面板跟随圆球位置
            const rect = fab.getBoundingClientRect();
            const panelW = CONFIG.PANEL_WIDTH;
            let left = rect.right - panelW;
            let top = rect.bottom + 8;
            // 边界约束
            left = Math.max(8, Math.min(window.innerWidth - panelW - 8, left));
            top = Math.max(8, Math.min(window.innerHeight - 200, top));
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.classList.add('bl-visible');
            fab.style.transform = 'scale(0.6)';
            fab.style.opacity = '0.3';
            state.panelOpen = true;
        } else {
            panel.classList.remove('bl-visible');
            fab.style.transform = '';
            fab.style.opacity = '';
            state.panelOpen = false;
        }
    }

    // ==================== 圆球拖拽 ====================
    function makeFabDraggable(fab) {
        let isDragging = false;
        let hasMoved = false;
        let startX = 0, startY = 0;
        let startLeft = 0, startTop = 0;
        const DRAG_THRESHOLD = 5; // 超过5px才算拖拽

        fab.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 只处理左键
            isDragging = true;
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = fab.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            fab.style.transition = 'none';
            fab.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // 超过阈值才算真正拖拽
            if (!hasMoved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            hasMoved = true;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // 边界约束，防止拖出屏幕
            const fabSize = 56;
            newLeft = Math.max(4, Math.min(window.innerWidth - fabSize - 4, newLeft));
            newTop = Math.max(4, Math.min(window.innerHeight - fabSize - 4, newTop));

            fab.style.left = newLeft + 'px';
            fab.style.top = newTop + 'px';
            fab.style.right = 'auto';
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            fab.style.transition = '';
            fab.style.cursor = '';

            // 如果没有移动（是点击），则切换面板
            if (!hasMoved) {
                togglePanel();
            }
        });

        // 触摸支持
        fab.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            isDragging = true;
            hasMoved = false;
            startX = touch.clientX;
            startY = touch.clientY;
            const rect = fab.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            fab.style.transition = 'none';
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            if (!hasMoved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            hasMoved = true;
            let newLeft = startLeft + dx;
            let newTop = startTop + dy;
            const fabSize = 56;
            newLeft = Math.max(4, Math.min(window.innerWidth - fabSize - 4, newLeft));
            newTop = Math.max(4, Math.min(window.innerHeight - fabSize - 4, newTop));
            fab.style.left = newLeft + 'px';
            fab.style.top = newTop + 'px';
            fab.style.right = 'auto';
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            fab.style.transition = '';
            if (!hasMoved) togglePanel();
        });
    }

    function makeDraggable() {
        const panel = document.getElementById('bl-panel');
        const header = panel.querySelector('.bl-header');
        let isDragging = false, startX, startY, startLeft, startTop;
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.classList.contains('bl-mode-badge')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            panel.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) { isDragging = false; panel.style.transition = ''; }
        });
    }

    // ==================== 数据处理 ====================
    function parseInput() {
        const text = document.getElementById('bl-input').value.trim();
        if (!text) return;
        state.dramaList = text.split(/\r?\n/).map((line, idx) => {
            const parts = line.split('\t');
            return { name: parts[0]?.trim() || '', id: parts[1]?.trim() || '', lineNum: idx + 1 };
        }).filter(d => d.name);
    }

    function clearAll() {
        state.isRunning = false; state.dramaList = []; state.results = []; state.abortFlag = false;
        document.getElementById('bl-input').value = '';
        updateUIState(); updateResultsTable(); updateProgress(0, 0, '准备就绪');
    }

    // ==================== UI 更新 ====================
    function updateUIState() {
        document.getElementById('bl-start').disabled = state.isRunning;
        document.getElementById('bl-stop').disabled = !state.isRunning;
    }

    function updateModeIndicator() {
        const badge = document.getElementById('bl-mode-badge');
        const fabBadge = document.getElementById('bl-fab-badge');
        if (!badge) return;
        if (state.apiConfig) {
            badge.textContent = 'API模式';
            badge.className = 'bl-mode-badge api';
            if (fabBadge) { fabBadge.textContent = 'API'; fabBadge.classList.add('visible'); }
        } else {
            badge.textContent = 'DOM模式';
            badge.className = 'bl-mode-badge dom';
            if (fabBadge) { fabBadge.textContent = 'DOM'; fabBadge.classList.add('visible'); }
        }
    }

    function updateProgress(current, total, name) {
        const fill = document.getElementById('bl-progress-fill');
        const text = document.getElementById('bl-progress-text');
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        fill.style.width = pct + '%';
        text.textContent = total > 0 ? `${name} (${current}/${total}, ${pct}%)` : name;
        document.getElementById('bl-stat-total').textContent = state.results.length;
        document.getElementById('bl-stat-yes').textContent = state.results.filter(r => r.hasMaterial).length;
        document.getElementById('bl-stat-no').textContent = state.results.filter(r => !r.hasMaterial).length;
    }

    function updateResultsTable() {
        const tbody = document.getElementById('bl-results-tbody');
        if (state.results.length === 0) {
            tbody.innerHTML = '<tr class="bl-empty"><td colspan="4">暂无数据</td></tr>';
            return;
        }
        tbody.innerHTML = state.results.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td title="${r.name}">${r.name.length > 16 ? r.name.substring(0, 16) + '…' : r.name}</td>
                <td><span class="bl-badge ${r.hasMaterial ? 'bl-badge-yes' : 'bl-badge-no'}">${r.hasMaterial ? '有素材' : '无素材'}</span></td>
                <td>${r.count}</td>
            </tr>
        `).join('');
    }

    function showToast(msg) {
        const existing = document.querySelector('.bl-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'bl-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // ==================== 导出 ====================
    async function exportExcel() {
        if (state.results.length === 0) { showToast('没有数据可导出'); return; }
        const btn = document.getElementById('bl-export');
        const orig = btn.textContent;
        btn.textContent = '导出中...'; btn.disabled = true;
        try {
            const XLSX = await loadXLSX();
            const data = [['序号', '剧名', '是否有素材', '素材数量']];
            state.results.forEach((r, i) => data.push([i + 1, r.name, r.hasMaterial ? '是' : '否', r.count]));
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 12 }, { wch: 10 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '素材验证结果');
            XLSX.writeFile(wb, `素材验证结果_${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}.xlsx`);
            showToast('导出成功');
        } catch (e) {
            showToast('导出失败: ' + e.message);
        } finally {
            btn.textContent = orig; btn.disabled = false;
        }
    }

    function loadXLSX() {
        return new Promise((resolve, reject) => {
            if (window.XLSX) return resolve(window.XLSX);
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('加载失败'));
            s.onerror = () => reject(new Error('网络错误'));
            document.head.appendChild(s);
        });
    }

    // ==================== 初始化 ====================
    function init() {
        injectStyles();
        createUI();
        checkApiConfig();
        updateModeIndicator();
        let count = 0;
        const interval = setInterval(() => {
            checkApiConfig(); updateModeIndicator();
            if (++count > 20 || state.apiConfig) clearInterval(interval);
        }, 1000);
    }

    // ==================== SPA 路由 ====================
    const TARGET_KEYWORDS = ['material/management/video'];
    let initialized = false;

    function isTargetPage() {
        return TARGET_KEYWORDS.some(kw => window.location.pathname.includes(kw));
    }

    function tryInit() {
        if (!isTargetPage() || initialized || document.getElementById('bl-fab')) return;
        initialized = true;
        init();
    }

    function tryInitWithRetry(retries) {
        if (retries <= 0) return;
        tryInit();
        if (!initialized) setTimeout(() => tryInitWithRetry(retries - 1), 1000);
    }

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
            e.preventDefault();
            if (!document.getElementById('bl-fab')) { initialized = true; init(); }
            else togglePanel();
        }
    });

    function cleanup() {
        const fab = document.getElementById('bl-fab');
        const panel = document.getElementById('bl-panel');
        if (fab) fab.remove();
        if (panel) panel.remove();
        initialized = false;
    }

    // ==================== 启动 ====================
    interceptCSRF();

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        setTimeout(() => isTargetPage() ? tryInit() : cleanup(), 500);
    };
    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        setTimeout(() => isTargetPage() ? tryInit() : cleanup(), 500);
    };
    window.addEventListener('popstate', () => setTimeout(() => isTargetPage() ? tryInit() : cleanup(), 500));

    const observer = new MutationObserver(() => { if (isTargetPage()) tryInit(); });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => tryInitWithRetry(5));
    else tryInitWithRetry(5);
    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'jl-material-verify';
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
        url: 'https://cdn.jsdelivr.net/gh/iYWobu/script-toolkit-v2@main/config.json?t=' + Date.now(),
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