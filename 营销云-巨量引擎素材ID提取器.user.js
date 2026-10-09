// ==UserScript==
// @name         巨量引擎素材ID提取器
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      4.12.0
// @description  一键提取巨量引擎广告创建页面素材列表中的所有ID数据，支持复制ID/名称、后台排队下载视频
// @author       You
// @match        https://usergrowth.com.cn/onestop/ad/ad_create/*
// @match        https://usergrowth.com.cn/onestop/ad/ad_create_copy/*
// @match        https://www.usergrowth.com.cn/onestop/ad/ad_create/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @connect      usergrowth.com.cn
// @connect      www.usergrowth.com.cn
// @connect      chameleon.bytedance.com
// @connect      *.bytedance.com
// @connect      *
// @run-at       document-end
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E%E7%B4%A0%E6%9D%90ID%E6%8F%90%E5%8F%96%E5%99%A8.user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E%E7%B4%A0%E6%9D%90ID%E6%8F%90%E5%8F%96%E5%99%A8.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ===================== API 拦截 - 视频URL缓存 =====================
    // 拦截 list_preview 接口，直接从响应中获取视频URL，比DOM滚动快100倍
    var apiVideoUrlCache = {}; // { cid: { video_url, file_name, image_url } }
    var apiSearchKey = null;
    var apiTotalCount = 0;
    var _apiPrefetchAbortController = null; // API预取的AbortController，用于跳过立即中止

    // Hook XHR
    (function hookXHR() {
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._apiUrl = url;
            return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            var self = this;
            this.addEventListener('load', function() {
                try {
                    if (self._apiUrl && self._apiUrl.indexOf('material/list_preview') >= 0) {
                        var resp = JSON.parse(self.responseText);
                        if (resp.code === 0 && resp.data && resp.data.creative_list) {
                            var list = resp.data.creative_list;
                            var added = 0;
                            for (var i = 0; i < list.length; i++) {
                                var item = list[i];
                                if (item.cid && item.video_url) {
                                    if (!apiVideoUrlCache[item.cid]) {
                                        apiVideoUrlCache[item.cid] = {
                                            video_url: item.video_url,
                                            file_name: item.file_name,
                                            image_url: item.image_url
                                        };
                                        added++;
                                    }
                                }
                            }
                            if (resp.data.total) apiTotalCount = resp.data.total;
                            console.log('%c[API拦截] list_preview 返回 ' + list.length + ' 条，新增缓存 ' + added + ' 个视频URL，总计 ' + Object.keys(apiVideoUrlCache).length + ' 个', 'color:#10b981;font-weight:bold');
                        }
                    }
                    
                    // 同时拦截 material/preview 获取 search_key
                    if (self._apiUrl && self._apiUrl.indexOf('material/preview') >= 0) {
                        var resp2 = JSON.parse(self.responseText);
                        if (resp2.code === 0 && resp2.data && resp2.data.search_key) {
                            apiSearchKey = resp2.data.search_key;
                            console.log('%c[API拦截] material/preview search_key: ' + apiSearchKey, 'color:#6366f1;font-weight:bold');
                        }
                    }
                } catch(e) {}
            });
            return origSend.apply(this, arguments);
        };
    })();

    // Hook Fetch
    (function hookFetch() {
        if (!window.fetch) return;
        var origFetch = window.fetch;
        window.fetch = function(input, init) {
            var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            var promise = origFetch.apply(this, arguments);
            promise.then(function(response) {
                try {
                    if (url.indexOf('material/list_preview') >= 0 || url.indexOf('material/preview') >= 0) {
                        var cloned = response.clone();
                        cloned.json().then(function(data) {
                            try {
                                if (url.indexOf('material/list_preview') >= 0 && data.code === 0 && data.data && data.data.creative_list) {
                                    var list = data.data.creative_list;
                                    var added = 0;
                                    for (var i = 0; i < list.length; i++) {
                                        var item = list[i];
                                        if (item.cid && item.video_url) {
                                            if (!apiVideoUrlCache[item.cid]) {
                                                apiVideoUrlCache[item.cid] = {
                                                    video_url: item.video_url,
                                                    file_name: item.file_name,
                                                    image_url: item.image_url
                                                };
                                                added++;
                                            }
                                        }
                                    }
                                    if (data.data.total) apiTotalCount = data.data.total;
                                    console.log('%c[API拦截-Fetch] list_preview 返回 ' + list.length + ' 条，新增缓存 ' + added + ' 个视频URL，总计 ' + Object.keys(apiVideoUrlCache).length + ' 个', 'color:#10b981;font-weight:bold');
                                }
                                if (url.indexOf('material/preview') >= 0 && data.code === 0 && data.data && data.data.search_key) {
                                    apiSearchKey = data.data.search_key;
                                    console.log('%c[API拦截-Fetch] material/preview search_key: ' + apiSearchKey, 'color:#6366f1;font-weight:bold');
                                }
                            } catch(e) {}
                        }).catch(function() {});
                    }
                } catch(e) {}
                return response;
            }).catch(function() {});
            return promise;
        };
    })();

    // 从API缓存中获取视频URL
    function getVideoUrlFromApiCache(materialId) {
        if (!materialId || !apiVideoUrlCache[materialId]) return null;
        return apiVideoUrlCache[materialId].video_url;
    }

    // 主动调用API获取更多页的素材URL
    // 支持超时和中止，防止卡死
    async function fetchAllApiVideoUrls() {
        if (!apiSearchKey) {
            console.log('[API预取] 无 search_key，跳过');
            return 0;
        }
        
        var pageSize = 100; // 一次拿100条，减少请求次数
        var totalFetched = Object.keys(apiVideoUrlCache).length;
        var totalPages = Math.ceil(apiTotalCount / pageSize) || 10; // 默认最多10页防止死循环
        var maxPages = Math.min(totalPages, 20); // 最多20页=2000条，足够了
        
        var addedCount = 0;
        // 每次调用创建新的AbortController（15秒超时 + 可手动中止）
        if (_apiPrefetchAbortController) {
            try { _apiPrefetchAbortController.abort(); } catch(e) {}
        }
        _apiPrefetchAbortController = new AbortController();
        var signal = _apiPrefetchAbortController.signal;

        for (var page = 1; page <= maxPages; page++) {
            // 如果这一页已经有缓存了（说明页面已经加载过），跳过
            var expectedStart = (page - 1) * pageSize;
            if (expectedStart < totalFetched && totalFetched >= page * pageSize) continue;
            
            // 检查是否被中止
            if (signal.aborted) {
                console.log('[API预取] 已中止');
                break;
            }

            try {
                // 15秒超时 + 可手动中止
                var timeoutId = setTimeout(function() {
                    try { _apiPrefetchAbortController.abort(); } catch(e) {}
                }, 15000);

                var resp = await fetch('/advertising/api/v1/auto_create/material/list_preview', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        search_key: apiSearchKey,
                        pagination: {
                            page_num: page,
                            page_size: pageSize
                        }
                    }),
                    signal: signal
                });
                clearTimeout(timeoutId);

                var data = await resp.json();
                if (data.code === 0 && data.data && data.data.creative_list) {
                    var list = data.data.creative_list;
                    if (list.length === 0) break; // 没有更多了
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        if (item.cid && item.video_url && !apiVideoUrlCache[item.cid]) {
                            apiVideoUrlCache[item.cid] = {
                                video_url: item.video_url,
                                file_name: item.file_name,
                                image_url: item.image_url
                            };
                            addedCount++;
                        }
                    }
                    if (list.length < pageSize) break; // 最后一页
                } else {
                    break;
                }
            } catch(e) {
                if (e.name === 'AbortError') {
                    console.log('[API预取] 请求被中止（超时或手动跳过）');
                } else {
                    console.warn('[API预取] 第 ' + page + ' 页失败:', e);
                }
                break;
            }
        }
        
        _apiPrefetchAbortController = null;
        console.log('%c[API预取] 完成，新增 ' + addedCount + ' 个视频URL，总计 ' + Object.keys(apiVideoUrlCache).length + ' 个', 'color:#10b981;font-weight:bold');
        return addedCount;
    }

    // ===================== 可爱商务风 UI =====================
    GM_addStyle(`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        /* ---------- 浮动按钮 ---------- */
        #material-id-extractor-btn {
            position: fixed;
            bottom: 36px;
            right: 28px;
            z-index: 999999;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: #fff;
            border: none;
            border-radius: 50%;
            width: 54px;
            height: 54px;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35), 0 2px 6px rgba(0,0,0,0.08);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        #material-id-extractor-btn::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(255,255,255,0.2), transparent);
            pointer-events: none;
        }
        #material-id-extractor-btn:hover {
            transform: translateY(-3px) rotate(-5deg);
            box-shadow: 0 12px 32px rgba(99, 102, 241, 0.45);
        }
        #material-id-extractor-btn:active {
            transform: scale(0.9);
            transition: all 0.1s ease;
        }
        .mie-fab-svg {
            width: 24px;
            height: 24px;
            stroke: #fff;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        /* ---------- 遮罩 ---------- */
        .mie-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            z-index: 9999998;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            animation: mie-fadeIn 0.25s ease;
        }

        /* ---------- 面板 ---------- */
        #material-id-extractor-panel {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 24px 70px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15,23,42,0.03);
            width: 620px;
            max-width: 92vw;
            max-height: 82vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
            animation: mie-panelIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes mie-panelIn {
            from { opacity: 0; transform: translate(-50%, -46%) scale(0.95); }
            to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes mie-fadeIn {
            from { opacity: 0; } to { opacity: 1; }
        }

        /* ---------- 顶部装饰条 ---------- */
        .mie-topbar {
            height: 5px;
            background: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899, #8b5cf6, #6366f1);
            background-size: 200% 100%;
            animation: mie-shimmer 3s linear infinite;
            flex-shrink: 0;
        }
        @keyframes mie-shimmer {
            0% { background-position: 0% 0; }
            100% { background-position: 200% 0; }
        }

        /* ---------- 头部 ---------- */
        .mie-header {
            padding: 20px 24px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        .mie-header-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .mie-header-icon {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            background: linear-gradient(135deg, #eef2ff, #f3e8ff);
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #e0e7ff;
        }
        .mie-header-icon svg {
            width: 20px;
            height: 20px;
            stroke: #8b5cf6;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .mie-header h3 {
            margin: 0;
            font-size: 17px;
            color: #0f172a;
            font-weight: 700;
            letter-spacing: -0.4px;
            line-height: 1.3;
        }
        .mie-header-sub {
            font-size: 12px;
            color: #94a3b8;
            font-weight: 400;
            margin-top: 2px;
            letter-spacing: 0.2px;
        }
        .mie-close {
            background: #f1f5f9;
            border: none;
            color: #64748b;
            cursor: pointer;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 10px;
            transition: all 0.2s ease;
            font-family: inherit;
            font-weight: 600;
            font-size: 18px;
            line-height: 1;
            padding: 0;
        }
        .mie-close:hover {
            background: #e2e8f0;
            color: #0f172a;
            transform: rotate(90deg);
        }

        /* ---------- 主体 ---------- */
        .mie-body {
            padding: 4px 24px 16px;
            overflow-y: auto;
            flex: 1;
        }
        .mie-body::-webkit-scrollbar { width: 5px; }
        .mie-body::-webkit-scrollbar-track { background: transparent; }
        .mie-body::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 3px; }
        .mie-body::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }

        /* ---------- 统计卡片 ---------- */
        .mie-stats {
            display: flex;
            gap: 10px;
            margin-bottom: 18px;
        }
        .mie-stat-card {
            flex: 1;
            background: #f8fafc;
            border-radius: 14px;
            padding: 14px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            border: 1px solid #f1f5f9;
            transition: all 0.25s ease;
            position: relative;
            overflow: hidden;
        }
        .mie-stat-card::before {
            content: '';
            position: absolute;
            left: 0; top: 0; bottom: 0;
            width: 4px;
            border-radius: 14px 0 0 14px;
        }
        .mie-stat-card.mie-stat-all::before { background: linear-gradient(180deg, #6366f1, #8b5cf6); }
        .mie-stat-card.mie-stat-video::before { background: linear-gradient(180deg, #ec4899, #f43f5e); }
        .mie-stat-card.mie-stat-image::before { background: linear-gradient(180deg, #06b6d4, #0ea5e9); }
        .mie-stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(15,23,42,0.08);
            background: #ffffff;
        }
        .mie-stat-icon {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }
        .mie-stat-card.mie-stat-all .mie-stat-icon { stroke: #8b5cf6; }
        .mie-stat-card.mie-stat-video .mie-stat-icon { stroke: #ec4899; }
        .mie-stat-card.mie-stat-image .mie-stat-icon { stroke: #06b6d4; }
        .mie-stat-info { flex: 1; min-width: 0; }
        .mie-stat-number {
            font-size: 24px;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.1;
            letter-spacing: -0.8px;
        }
        .mie-stat-label {
            font-size: 11.5px;
            color: #94a3b8;
            margin-top: 2px;
            font-weight: 500;
        }

        /* ---------- 剧名输入区 ---------- */
        .mie-drama-section {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
            padding: 12px 16px;
            background: linear-gradient(135deg, #f8fafc, #f5f3ff);
            border-radius: 12px;
            border: 1px solid #e2e8f0;
        }
        .mie-drama-icon {
            width: 18px;
            height: 18px;
            stroke: #8b5cf6;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
            flex-shrink: 0;
        }
        .mie-drama-label {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            white-space: nowrap;
        }
        .mie-drama-input-field {
            flex: 1;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 13px;
            color: #334155;
            outline: none;
            font-family: inherit;
            transition: all 0.2s ease;
            background: #fff;
            min-width: 0;
        }
        .mie-drama-input-field:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }
        .mie-drama-input-field::placeholder {
            color: #cbd5e1;
        }

        @keyframes mie-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* ---------- 表格 ---------- */
        .mie-table-wrap {
            background: #ffffff;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid #f1f5f9;
        }
        .mie-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .mie-table th {
            padding: 11px 14px;
            text-align: left;
            font-weight: 600;
            color: #94a3b8;
            font-size: 11px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            border-bottom: 1px solid #f1f5f9;
            white-space: nowrap;
            background: #f8fafc;
        }
        .mie-table td {
            padding: 11px 14px;
            color: #334155;
            vertical-align: middle;
            border-bottom: 1px solid #f8fafc;
        }
        .mie-table tr:last-child td { border-bottom: none; }
        .mie-table tbody tr { transition: all 0.15s ease; }
        .mie-table tbody tr:hover td { background: #f5f3ff; }
        .mie-idx-cell {
            font-size: 12px;
            color: #cbd5e1;
            font-weight: 700;
            text-align: center;
        }
        .mie-check-label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            font-size: 12px;
            color: #475569;
            user-select: none;
        }
        .mie-check-label input[type="checkbox"] {
            margin: 0;
            cursor: pointer;
            accent-color: #6366f1;
            width: 14px;
            height: 14px;
        }
        .mie-row-checkbox {
            cursor: pointer;
            accent-color: #6366f1;
            width: 14px;
            height: 14px;
            vertical-align: middle;
        }
        .mie-id-cell {
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            font-size: 11.5px;
            color: #6366f1;
            background: #eef2ff;
            padding: 3px 10px;
            border-radius: 7px;
            word-break: break-all;
            letter-spacing: 0.1px;
            font-weight: 500;
            display: inline-block;
        }
        .mie-name-cell {
            max-width: 240px;
            word-break: break-all;
            line-height: 1.5;
            font-size: 12.5px;
            color: #475569;
        }
        .mie-type-tag {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 7px;
            font-size: 11px;
            font-weight: 600;
        }
        .mie-type-tag svg {
            width: 12px;
            height: 12px;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .mie-type-video {
            background: #fce7f3;
            color: #db2777;
        }
        .mie-type-video svg { stroke: #db2777; }
        .mie-type-image {
            background: #cffafe;
            color: #0891b2;
        }
        .mie-type-image svg { stroke: #0891b2; }
        .mie-type-unknown {
            background: #f1f5f9;
            color: #94a3b8;
        }

        .mie-queue-failed-list {
            margin-top: 8px;
            padding: 8px 10px;
            background: #fef2f2;
            border-radius: 8px;
            border-left: 3px solid #ef4444;
        }
        .mie-queue-failed-title {
            font-size: 11px;
            font-weight: 700;
            color: #dc2626;
            margin-bottom: 6px;
        }
        .mie-queue-failed-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            color: #991b1b;
            padding: 3px 0;
            border-bottom: 1px solid rgba(239,68,68,0.1);
        }
        .mie-queue-failed-item:last-child { border-bottom: none; }
        .mie-queue-failed-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; }
        .mie-queue-failed-reason { flex-shrink: 0; color: #b91c1c; font-size: 10px; }
        .mie-retry-btn {
            margin-top: 8px;
            width: 100%;
            background: linear-gradient(135deg, #8b5cf6, #6366f1);
            color: #fff;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }
        .mie-retry-btn:hover { opacity: 0.9; }

        /* ---------- 展开详情 ---------- */
        .mie-expand-btn {
            font-size: 11px;
            padding: 3px 8px;
        }
        .mie-queue-details {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            animation: mie-fadeIn 0.2s ease;
        }
        .mie-queue-detail-title {
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            margin-bottom: 6px;
        }
        .mie-video-progress-list {
            max-height: 240px;
            overflow-y: auto;
        }
        .mie-video-progress-list::-webkit-scrollbar { width: 4px; }
        .mie-video-progress-list::-webkit-scrollbar-track { background: transparent; }
        .mie-video-progress-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        .mie-video-progress-item {
            padding: 5px 0;
            border-bottom: 1px solid #f1f5f9;
        }
        .mie-video-progress-item:last-child { border-bottom: none; }
        .mie-video-progress-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 3px;
        }
        .mie-video-progress-name {
            font-size: 11px;
            color: #334155;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            margin-right: 8px;
        }
        .mie-video-progress-status {
            font-size: 10px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .mie-video-progress-status.v-success { color: #059669; }
        .mie-video-progress-status.v-failed { color: #dc2626; }
        .mie-video-progress-status.v-downloading { color: #6366f1; }
        .mie-video-progress-status.v-waiting { color: #94a3b8; }
        .mie-video-progress-bar {
            height: 4px;
            background: #e2e8f0;
            border-radius: 2px;
            overflow: hidden;
            margin-bottom: 2px;
        }
        .mie-video-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #8b5cf6);
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        .mie-video-progress-bytes {
            font-size: 10px;
            color: #94a3b8;
            text-align: right;
        }

        /* ---------- 行内迷你按钮 ---------- */
        .mie-row-actions {
            display: flex;
            gap: 4px;
            justify-content: center;
            align-items: center;
        }
        .mie-row-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #64748b;
            cursor: pointer;
            border-radius: 6px;
            width: 26px;
            height: 26px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            padding: 0;
            font-family: inherit;
        }
        .mie-row-btn svg {
            width: 13px;
            height: 13px;
            stroke: #64748b;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .mie-row-btn:hover {
            background: #eef2ff;
            border-color: #c7d2fe;
            color: #6366f1;
            transform: translateY(-1px);
        }
        .mie-row-btn:hover svg { stroke: #6366f1; }
        .mie-row-btn:active { transform: scale(0.9); }
        .mie-row-btn.mie-row-btn-name:hover {
            background: #fce7f3;
            border-color: #f9a8d4;
            color: #ec4899;
        }
        .mie-row-btn.mie-row-btn-name:hover svg { stroke: #ec4899; }
        .mie-row-btn.mie-row-btn-download:hover {
            background: #ecfdf5;
            border-color: #6ee7b7;
            color: #10b981;
        }
        .mie-row-btn.mie-row-btn-download:hover svg { stroke: #10b981; }
        .mie-row-btn.mie-row-btn-download:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }
        .mie-row-btn.mie-row-btn-download:disabled:hover {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #64748b;
            transform: none;
        }
        .mie-row-btn.mie-row-btn-download:disabled:hover svg { stroke: #64748b; }

        .mie-tip {
            font-size: 12px;
            color: #94a3b8;
            margin-top: 12px;
            line-height: 1.5;
            text-align: center;
        }

        /* ---------- Tab切换 ---------- */
        .mie-tabs {
            display: flex;
            border-bottom: 1px solid #f1f5f9;
            flex-shrink: 0;
            padding: 0 24px;
        }
        .mie-tab {
            padding: 12px 16px;
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .mie-tab:hover {
            color: #475569;
        }
        .mie-tab.mie-tab-active {
            color: #6366f1;
            border-bottom-color: #6366f1;
        }
        .mie-tab-badge {
            background: #e0e7ff;
            color: #6366f1;
            font-size: 11px;
            padding: 1px 7px;
            border-radius: 10px;
            font-weight: 700;
            min-width: 18px;
            text-align: center;
        }
        .mie-tab-badge.has-active {
            background: #10b981;
            color: #fff;
            animation: mie-pulse 2s ease-in-out infinite;
        }
        @keyframes mie-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        /* ---------- 下载队列 ---------- */
        .mie-queue-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .mie-queue-item {
            background: #fff;
            border: 1px solid #f1f5f9;
            border-radius: 10px;
            padding: 14px 16px;
            transition: all 0.2s;
        }
        .mie-queue-item:hover {
            border-color: #e0e7ff;
            box-shadow: 0 2px 8px rgba(99,102,241,0.08);
        }
        .mie-queue-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        .mie-queue-status-icon {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }
        .mie-queue-status-icon.status-downloading { stroke: #6366f1; animation: mie-spin 1s linear infinite; }
        .mie-queue-status-icon.status-queued { stroke: #f59e0b; }
        .mie-queue-status-icon.status-paused { stroke: #8b5cf6; }
        .mie-queue-status-icon.status-completed { stroke: #10b981; }
        .mie-queue-title {
            font-size: 13px;
            font-weight: 600;
            color: #334155;
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mie-queue-meta {
            font-size: 11.5px;
            color: #94a3b8;
            flex-shrink: 0;
        }
        .mie-queue-progress-bar {
            height: 5px;
            background: #f1f5f9;
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 8px;
        }
        .mie-queue-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #8b5cf6);
            border-radius: 3px;
            transition: width 0.3s ease;
            width: 0%;
        }
        .mie-queue-item.status-completed .mie-queue-progress-fill {
            background: linear-gradient(90deg, #10b981, #059669);
        }
        .mie-queue-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11.5px;
            color: #64748b;
        }
        .mie-queue-actions {
            display: flex;
            gap: 6px;
        }
        .mie-queue-btn {
            background: none;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 3px 10px;
            font-size: 11.5px;
            color: #64748b;
            cursor: pointer;
            transition: all 0.2s;
        }
        .mie-queue-btn:hover {
            border-color: #cbd5e1;
            color: #334155;
            background: #f8fafc;
        }
        .mie-queue-btn.danger:hover {
            border-color: #fecaca;
            color: #ef4444;
            background: #fef2f2;
        }
        .mie-queue-clear-bar {
            display: flex;
            justify-content: flex-end;
            padding: 4px 0 8px;
        }

        /* ---------- 恢复下载提示条 ---------- */
        .mie-resume-banner {
            background: linear-gradient(135deg, #fef3c7, #fde68a);
            border: 1px solid #fcd34d;
            border-radius: 10px;
            padding: 12px 14px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .mie-resume-icon {
            font-size: 24px;
            flex-shrink: 0;
        }
        .mie-resume-text {
            flex: 1;
            font-size: 12px;
            color: #92400e;
            line-height: 1.4;
        }
        .mie-resume-text strong {
            color: #78350f;
            font-size: 13px;
        }
        .mie-resume-btn {
            background: #f59e0b;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 7px 14px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            flex-shrink: 0;
            transition: all 0.2s;
        }
        .mie-resume-btn:hover {
            background: #d97706;
            transform: translateY(-1px);
        }

        /* ---------- 底部 ---------- */
        .mie-footer {
            padding: 14px 24px 20px;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            flex-wrap: wrap;
            flex-shrink: 0;
            border-top: 1px solid #f1f5f9;
        }
        .mie-btn {
            padding: 10px 20px;
            border-radius: 12px;
            border: 1px solid transparent;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            font-weight: 600;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            letter-spacing: -0.1px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }
        .mie-btn:active { transform: scale(0.95); }
        .mie-btn svg {
            width: 14px;
            height: 14px;
            stroke-width: 2;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
            flex-shrink: 0;
        }
        .mie-btn-ghost {
            background: #ffffff;
            color: #64748b;
            border-color: #e2e8f0;
        }
        .mie-btn-ghost svg { stroke: #64748b; }
        .mie-btn-ghost:hover {
            background: #f8fafc;
            color: #334155;
            border-color: #cbd5e1;
        }
        .mie-btn-ghost:hover svg { stroke: #334155; }
        .mie-btn-accent {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
        }
        .mie-btn-accent svg { stroke: #fff; }
        .mie-btn-accent:hover {
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
            transform: translateY(-1px);
        }
        .mie-btn-success {
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
        }
        .mie-btn-success svg { stroke: #fff; }
        .mie-btn-success:hover {
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
            transform: translateY(-1px);
        }
        .mie-btn-ghost#mie-download-all svg { stroke: #10b981; }
        .mie-btn-ghost#mie-download-all:hover {
            background: #ecfdf5;
            color: #059669;
            border-color: #6ee7b7;
        }
        .mie-btn-ghost#mie-download-all:hover svg { stroke: #059669; }

        /* ---------- Toast ---------- */
        .mie-toast {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.9);
            background: #0f172a;
            color: #fff;
            padding: 13px 26px;
            border-radius: 14px;
            font-size: 14px;
            z-index: 99999999;
            pointer-events: none;
            opacity: 0;
            transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            font-weight: 600;
            box-shadow: 0 12px 36px rgba(0,0,0,0.25);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mie-toast.show {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        .mie-toast svg {
            width: 16px;
            height: 16px;
            stroke: #10b981;
            stroke-width: 2.5;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        /* ---------- 空状态 ---------- */
        .mie-empty {
            text-align: center;
            padding: 50px 20px;
        }
        .mie-empty-icon {
            width: 48px;
            height: 48px;
            margin: 0 auto 14px;
            stroke: #cbd5e1;
            stroke-width: 1.5;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
            animation: mie-bounce 2s ease-in-out infinite;
        }
        @keyframes mie-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
        }
        .mie-empty-title {
            font-size: 16px;
            font-weight: 700;
            color: #475569;
            margin-bottom: 6px;
        }
        .mie-empty-desc {
            font-size: 13px;
            color: #94a3b8;
            line-height: 1.6;
            max-width: 300px;
            margin: 0 auto;
        }
    `);

    // ===================== SVG 图标（线条风） =====================
    const ICONS = {
        // 浮动按钮图标 - 列表提取
        fab: '<svg class="mie-fab-svg" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/><path d="m16 17 2 2 4-4"/></svg>',
        // 头部图标 - 素材/列表
        header: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>',
        // 统计 - 全部
        statAll: '<svg class="mie-stat-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        // 统计 - 视频
        statVideo: '<svg class="mie-stat-icon" viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/></svg>',
        // 统计 - 图片
        statImage: '<svg class="mie-stat-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
        // 类型标签 - 视频
        typeVideo: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        // 类型标签 - 图片
        typeImage: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
        // 按钮 - 复制
        copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        // 按钮 - 名称/文字
        names: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
        // Toast - 对勾
        check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
        // 空状态 - 搜索
        search: '<svg class="mie-empty-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
        // 按钮 - 下载
        download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        // 行内 - 下载
        rowDownload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        // 剧名输入 - 文件图标
        drama: '<svg class="mie-drama-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>'
    };

    // ===================== 核心逻辑 =====================

    function isElementVisible(el) {
        if (!el || !el.offsetParent) return false;
        var style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return true;
    }

    // 判断元素是否在视口内（真正能被用户看到）
    function isInViewport(el) {
        if (!isElementVisible(el)) return false;
        var rect = el.getBoundingClientRect();
        var viewH = window.innerHeight || document.documentElement.clientHeight;
        var viewW = window.innerWidth || document.documentElement.clientWidth;
        // 至少有 10% 的面积在视口内才算
        var overlapTop = Math.max(0, rect.top);
        var overlapBottom = Math.min(rect.bottom, viewH);
        var overlapLeft = Math.max(0, rect.left);
        var overlapRight = Math.min(rect.right, viewW);
        var overlapH = Math.max(0, overlapBottom - overlapTop);
        var overlapW = Math.max(0, overlapRight - overlapLeft);
        var overlapArea = overlapH * overlapW;
        var totalArea = rect.width * rect.height;
        if (totalArea === 0) return false;
        return (overlapArea / totalArea) > 0.1;
    }

    function extractMaterials() {
        var allRows = document.querySelectorAll('tr.arco-table-tr');
        var materials = [];
        var seen = {};

        // 优先从激活的 tab pane 里找表格
        var activePane = document.querySelector('.arco-tabs-content-pane-active, [aria-hidden="false"].arco-tabs-content-pane');
        var tables = [];
        if (activePane) {
            tables = activePane.querySelectorAll('.arco-table');
        }
        // 如果激活 tab 里没找到，再全局找
        if (tables.length === 0) {
            tables = document.querySelectorAll('.arco-table');
        }

        // 在所有表格中，选"在视口内且面积最大"的那个
        var activeTable = null;
        var maxArea = 0;
        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            if (!isInViewport(tbl)) continue;
            var rect = tbl.getBoundingClientRect();
            var area = rect.width * rect.height;
            if (area > maxArea) {
                maxArea = area;
                activeTable = tbl;
            }
        }

        // 如果都不在视口内，回退到找第一个可见且有行的表格
        if (!activeTable) {
            for (var t2 = 0; t2 < tables.length; t2++) {
                if (isElementVisible(tables[t2]) && tables[t2].querySelector('tr.arco-table-tr')) {
                    activeTable = tables[t2];
                    break;
                }
            }
        }

        var rows = activeTable ? activeTable.querySelectorAll('tr.arco-table-tr') : allRows;

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            // 只处理可见的行
            if (!isElementVisible(row)) continue;
            const checkbox = row.querySelector('input[type="checkbox"]');
            const idFromCheckbox = checkbox ? checkbox.value : null;

            const idEl = row.querySelector('.arco-typography-secondary');
            let idFromText = null;
            if (idEl) {
                const match = idEl.textContent.match(/ID:([a-f0-9]+)/i);
                if (match) idFromText = match[1];
            }

            const nameEl = row.querySelector('.text-ellipsis');
            const name = nameEl ? nameEl.textContent.trim() : '';

            const video = row.querySelector('video');
            const img = row.querySelector('img');
            let type = 'unknown';
            let videoId = null;
            let videoUrl = null;

            if (video) {
                type = 'video';
                const src = video.getAttribute('src') || '';
                const vm = src.match(/video_id=([^&]+)/);
                if (vm) videoId = vm[1];
                videoUrl = src || null;
                if (!videoUrl) {
                    var sourceEl = video.querySelector('source');
                    if (sourceEl) videoUrl = sourceEl.getAttribute('src') || null;
                }
            } else {
                // Scan all elements for video URL patterns (video_id=, .mp4, chameleon)
                var urlEls = row.querySelectorAll('[src], [data-src], [data-video-url], [data-video], [data-url], [data-preview-url], [href]');
                for (var k = 0; k < urlEls.length; k++) {
                    var el = urlEls[k];
                    var attrNames = ['src', 'data-src', 'data-video-url', 'data-video', 'data-url', 'data-preview-url', 'href'];
                    for (var a = 0; a < attrNames.length; a++) {
                        var val = el.getAttribute(attrNames[a]) || '';
                        if (!val) continue;
                        var vm = val.match(/video_id=([^&]+)/);
                        if (vm) {
                            videoId = vm[1];
                            videoUrl = val;
                            type = 'video';
                            break;
                        }
                        if (/chameleon\.bytedance.*video/i.test(val) || /\.mp4(\?|$)/i.test(val)) {
                            videoUrl = val;
                            type = 'video';
                            break;
                        }
                    }
                    if (type === 'video') break;
                }

                // Look for play button icons (Arco Design + generic)
                if (type === 'unknown') {
                    var playSelectors = '.arco-icon-play-circle, .arco-icon-play, [class*="play-icon"], [class*="PlayIcon"], [class*="video-play"], [class*="VideoPlay"], [class*="icon-play"]';
                    if (row.querySelector(playSelectors)) {
                        type = 'video';
                    }
                }

                // Look for video container class names
                if (type === 'unknown') {
                    var containerSelectors = '[class*="video-preview"], [class*="VideoPreview"], [class*="video-thumb"], [class*="VideoThumb"], [class*="video-cover"], [class*="VideoCover"], [class*="video-card"], [class*="VideoCard"]';
                    if (row.querySelector(containerSelectors)) {
                        type = 'video';
                    }
                }

                // If no video indicators found but there's an image
                if (type === 'unknown' && img) {
                    type = 'image';
                }
            }

            var materialId = idFromText || idFromCheckbox;

            if (materialId && name && name !== '素材/cid' && !seen[materialId]) {
                seen[materialId] = true;

                // 优先从API缓存获取视频URL（比DOM提取快100倍）
                var cidForLookup = materialId;
                // 如果有单独的cid字段，也尝试用cid查找
                if (idFromCheckbox && idFromCheckbox !== materialId) {
                    cidForLookup = idFromCheckbox;
                }
                var apiUrl = getVideoUrlFromApiCache(cidForLookup) || getVideoUrlFromApiCache(materialId);
                if (apiUrl) {
                    videoUrl = apiUrl;
                    var vm = apiUrl.match(/video_id=([^&]+)/);
                    if (vm) videoId = vm[1];
                    type = 'video';
                }

                materials.push({
                    id: materialId,
                    name: name,
                    type: type,
                    videoId: videoId,
                    videoUrl: videoUrl,
                    cid: idFromCheckbox && idFromCheckbox !== materialId ? idFromCheckbox : null
                });
            }
        }

        return materials;
    }

    function showToast(msg) {
        let toast = document.getElementById('mie-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mie-toast';
            toast.className = 'mie-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = ICONS.check + '<span>' + msg + '</span>';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function copyText(text) {
        GM_setClipboard(text, 'text');
        showToast('已复制到剪贴板');
    }

    function getDramaName() {
        var labels = document.querySelectorAll('.arco-form-item-label, .arco-form-item-label-text, label');
        for (var i = 0; i < labels.length; i++) {
            var text = labels[i].textContent.trim();
            if (text.indexOf('内容名称') !== -1 || text.indexOf('内容') !== -1) {
                var container = labels[i].closest('.arco-form-item');
                if (container) {
                    var valueEl = container.querySelector('.arco-form-item-content, .arco-select-view-value, .arco-select-view-single-value, .arco-input, input, .arco-typography');
                    if (valueEl) {
                        var raw = valueEl.textContent.trim() || valueEl.value || '';
                        if (raw) {
                            return raw.replace(/\s*\d+\s*$/, '').trim();
                        }
                    }
                }
            }
        }
        var allLabels = document.querySelectorAll('.arco-form-item-label, label, .arco-typography');
        for (var j = 0; j < allLabels.length; j++) {
            var t = allLabels[j].textContent.trim();
            if (t.indexOf('内容名称') !== -1) {
                var parent = allLabels[j].closest('.arco-form-item') || allLabels[j].parentElement;
                if (parent) {
                    var sib = parent.querySelector('.arco-form-item-content') || parent.nextElementSibling;
                    if (sib) {
                        var v = sib.textContent.trim() || sib.value || '';
                        if (v) return v.replace(/\s*\d+\s*$/, '').trim();
                    }
                }
            }
        }
        return '未命名剧目';
    }

    function sanitizeFileName(name) {
        return name.replace(/[\/\\:\*\?"<>\|]/g, '_').trim();
    }

    // ===================== 后台下载队列管理器 ====================
    var DownloadQueue = (function() {
        var STORAGE_KEY = 'mie_download_queue';
        var CONCURRENCY = 10;
        var isRunning = false;
        var listeners = [];
        var _skipIds = {}; // 需要跳过的任务id集合
        var _activeXhrs = {}; // 活跃XHR集合，用于跳过中止: { taskId: [xhr1, xhr2, ...] }
        var _sleepTimers = {}; // 活跃的等待定时器，用于跳过立即唤醒: { taskId: [timerId1, ...] }

        // 可取消的等待（跳过立即返回true，正常等待完返回false）
        function sleepWithCancel(taskId, ms) {
            return new Promise(function(resolve) {
                var timer = setTimeout(function() {
                    // 正常结束，从列表移除
                    if (_sleepTimers[taskId]) {
                        var idx = _sleepTimers[taskId].indexOf(timer);
                        if (idx >= 0) _sleepTimers[taskId].splice(idx, 1);
                    }
                    resolve(false);
                }, ms);
                if (!_sleepTimers[taskId]) _sleepTimers[taskId] = [];
                _sleepTimers[taskId].push(timer);
            });
        }

        // 取消任务的所有等待定时器
        function cancelTaskSleeps(taskId) {
            if (_sleepTimers[taskId]) {
                _sleepTimers[taskId].forEach(function(t) {
                    try { clearTimeout(t); } catch(e) {}
                });
                _sleepTimers[taskId] = [];
            }
        }
        var cachedDirHandle = null; // 缓存用户选择的根目录，后续任务复用
        var pendingDirPromise = null; // 正在进行的目录选择 Promise，避免重复弹窗

        // 队列缓存：避免同一 tick 内多次 GM_getValue
        var _cachedQueue = null;
        var _cachedQueueTs = 0;

        function getQueue() {
            var now = Date.now();
            if (_cachedQueue && (now - _cachedQueueTs < 500)) return _cachedQueue;
            try {
                _cachedQueue = GM_getValue(STORAGE_KEY, { tasks: [] });
                _cachedQueueTs = now;
                return _cachedQueue;
            } catch(e) {
                return { tasks: [] };
            }
        }

        function saveQueue(queue) {
            try {
                GM_setValue(STORAGE_KEY, queue);
                _cachedQueue = queue;
                _cachedQueueTs = Date.now();
            } catch(e) {
                console.error('[下载队列] 保存失败:', e);
            }
        }

        function notify() {
            var q = getQueue();
            listeners.forEach(function(fn) {
                try { fn(q); } catch(e) {}
            });
        }

        function onChange() {
            notify();
        }

        // 监听其他标签页的队列变化
        try {
            GM_addValueChangeListener(STORAGE_KEY, onChange);
        } catch(e) {}

        // 获取或请求目录句柄（必须在用户交互事件中调用才会成功）
        async function requestDirHandle() {
            // 已经有缓存了，直接返回
            if (cachedDirHandle) return cachedDirHandle;
            // 已经在弹窗了，等结果
            if (pendingDirPromise) return pendingDirPromise;
            // 不支持 FSA
            if (typeof window.showDirectoryPicker !== 'function') return null;

            pendingDirPromise = (async function() {
                try {
                    var handle = await window.showDirectoryPicker();
                    cachedDirHandle = handle;
                    pendingDirPromise = null;
                    return handle;
                } catch(e) {
                    pendingDirPromise = null;
                    return null;
                }
            })();
            return pendingDirPromise;
        }

        // 清除缓存的目录（用户想换目录时用）
        function clearCachedDir() {
            cachedDirHandle = null;
        }

        function addTask(dramaName, materials) {
            var q = getQueue();
            var taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

            // 添加任务时立即批量查找URL（趁用户还在当前页面，DOM是对的）
            var pendingIds = [];
            for (var mi = 0; mi < materials.length; mi++) {
                if (!materials[mi].videoUrl) {
                    pendingIds.push(materials[mi].id);
                }
            }
            if (pendingIds.length > 0 && typeof batchFindUrls === 'function') {
                var batchUrls = batchFindUrls(pendingIds);
                for (var bi = 0; bi < materials.length; bi++) {
                    if (!materials[bi].videoUrl && batchUrls[materials[bi].id]) {
                        materials[bi].videoUrl = batchUrls[materials[bi].id];
                    }
                }
            }

            var taskItems = materials.map(function(m, i) {
                return {
                    id: m.id,
                    name: m.name,
                    videoUrl: m.videoUrl || '',
                    index: i,
                    status: 'waiting' // waiting, downloading, success, failed
                };
            });
            var task = {
                id: taskId,
                dramaName: dramaName,
                items: taskItems,
                total: taskItems.length,
                successCount: 0,
                failCount: 0,
                currentIndex: 0,
                status: 'queued', // queued, downloading, completed, failed
                createdAt: Date.now()
            };
            q.tasks.push(task);
            saveQueue(q);
            notify();
            startProcessing();
            return taskId;
        }

        function removeTask(taskId) {
            var q = getQueue();
            q.tasks = q.tasks.filter(function(t) { return t.id !== taskId; });
            saveQueue(q);
            notify();
        }

        function clearCompleted() {
            var q = getQueue();
            q.tasks = q.tasks.filter(function(t) { return t.status !== 'completed'; });
            saveQueue(q);
            notify();
        }

        // 重试失败视频（把已完成任务中失败的重置为等待，重新排队下载）
        function retryFailed(taskId) {
            var q = getQueue();
            var ti = q.tasks.findIndex(function(t) { return t.id === taskId; });
            if (ti < 0) return;
            var task = q.tasks[ti];
            if (!task.items) return;

            var hasRetry = false;
            for (var i = 0; i < task.items.length; i++) {
                var it = task.items[i];
                if (it.status === 'failed' && it.error !== '无视频URL') {
                    it.status = 'waiting';
                    it.error = null;
                    it.downloadedSize = 0;
                    hasRetry = true;
                }
            }

            if (!hasRetry) return;

            // 重新计数
            var s = 0, f = 0;
            for (var j = 0; j < task.items.length; j++) {
                if (task.items[j].status === 'success') s++;
                else if (task.items[j].status === 'failed') f++;
            }
            task.successCount = s;
            task.failCount = f;
            task.status = 'queued';
            task._downloadedBytes = 0;
            task._totalBytes = 0;

            saveQueue(q);
            notify();
            startProcessing();
        }

        // 中止任务的所有活跃XHR
        function abortTaskXhrs(taskId) {
            if (_activeXhrs[taskId]) {
                _activeXhrs[taskId].forEach(function(xhr) {
                    try { xhr.abort(); } catch(e) {}
                });
                _activeXhrs[taskId] = [];
            }
        }

        // 跳过任务（把未完成的标记为失败，任务标记为完成）
        function skipTask(taskId) {
            // 先中止所有正在进行的请求和等待，实现立即跳过
            abortTaskXhrs(taskId);
            cancelTaskSleeps(taskId);
            // 中止API预取（如果在跑的话）
            if (typeof _apiPrefetchAbortController !== 'undefined' && _apiPrefetchAbortController) {
                try { _apiPrefetchAbortController.abort(); } catch(e) {}
            }
            // 标记跳过（内存里正在运行的processTask会检测）
            _skipIds[taskId] = true;
            var q = getQueue();
            var ti = q.tasks.findIndex(function(t) { return t.id === taskId; });
            if (ti < 0) return;
            var task = q.tasks[ti];
            // 未完成的标记为跳过
            var s = 0, f = 0;
            for (var i = 0; i < task.items.length; i++) {
                if (task.items[i].status === 'success') {
                    s++;
                } else {
                    if (task.items[i].status !== 'failed') {
                        task.items[i].status = 'failed';
                        task.items[i].error = '手动跳过';
                    }
                    f++;
                }
            }
            task.status = 'completed';
            task.successCount = s;
            task.failCount = f;
            q.tasks[ti] = task;
            saveQueue(q);
            notify();
        }

        async function processTask(task) {
            if (task.status === 'completed') return;

            var safeName = sanitizeFileName(task.dramaName);
            var items = task.items;
            var total = items.length;

            // 统计已完成的（崩溃恢复用）
            function countStatus() {
                var s = 0, f = 0;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].status === 'success') s++;
                    else if (items[i].status === 'failed') f++;
                }
                return { success: s, failed: f, done: s + f };
            }

            // 格式化字节数
            function formatSize(bytes) {
                if (!bytes || bytes <= 0) return '0 MB';
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
                if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
                return (bytes / 1073741824).toFixed(2) + ' GB';
            }

            // 统计总下载字节（从 recordBytes 的运行时数据 + 已完成的）
            function countBytes() {
                var downloaded = 0;
                var total = 0;
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    if (it.totalSize) total += it.totalSize;
                    if (it.status === 'success' && it.totalSize) {
                        downloaded += it.totalSize;
                    } else if (it.downloadedSize) {
                        downloaded += it.downloadedSize;
                    }
                }
                // 加上运行中的实时数据
                if (recordBytes._perItem) {
                    for (var k in recordBytes._perItem) {
                        // 运行中的 downloadedSize 可能已在 items 里，也可能没，取最大值
                    }
                }
                return { downloaded: downloaded, total: total };
            }

            // 保存进度到持久化存储（节流：存储每次都写，UI 通知最多每 1.5 秒一次）
            var lastNotifyTime = 0;
            var notifyPending = false;
            function saveProgress() {
                try {
                    var q = getQueue();
                    var ti = q.tasks.findIndex(function(t) { return t.id === task.id; });
                    if (ti >= 0) {
                        var cnt = countStatus();
                        var bytes = countBytes();
                        q.tasks[ti].items = items;
                        q.tasks[ti].successCount = cnt.success;
                        q.tasks[ti].failCount = cnt.failed;
                        // 如果任务被标记为跳过，保持 completed 状态，不要用本地 task.status 覆盖
                        if (_skipIds[task.id]) {
                            q.tasks[ti].status = 'completed';
                        } else {
                            q.tasks[ti].status = task.status;
                        }
                        q.tasks[ti]._speed = task._speed || '';
                        q.tasks[ti]._downloadedBytes = bytes.downloaded;
                        q.tasks[ti]._totalBytes = bytes.total;
                        saveQueue(q); // 存储每次都写（保证崩溃不丢数据）
                        // UI 通知节流
                        var now = Date.now();
                        if (now - lastNotifyTime > 1500) {
                            lastNotifyTime = now;
                            notify();
                        } else {
                            if (!notifyPending) {
                                notifyPending = true;
                                setTimeout(function() {
                                    notifyPending = false;
                                    lastNotifyTime = Date.now();
                                    notify();
                                }, 1500);
                            }
                        }
                    }
                } catch(e) {}
            }

            // 生成随机数（如果是新任务）
            var randomNum = task.randomNum;
            if (!randomNum) {
                randomNum = Math.floor(Math.random() * 10000);
                task.randomNum = randomNum;
            }

            // 使用缓存的根目录（在用户点击下载时已经选好了）
            var dirHandle = cachedDirHandle;
            var subDirHandle = null;
            if (dirHandle) {
                try {
                    subDirHandle = await dirHandle.getDirectoryHandle(safeName, { create: true });
                } catch(e) {
                    subDirHandle = null;
                }
            }

            task.status = 'downloading';
            saveProgress();

            // 下载速度追踪（滑动窗口，记录每秒字节增量）
            var speedWindow = []; // [{time: timestamp, bytes: totalBytes}]
            var speedTimer = null;
            var currentSpeed = 0; // MB/s
            task._speed = '0.0';

            // 每秒计算一次最近3秒的平均速度
            function startSpeedMonitor() {
                if (speedTimer) return;
                speedTimer = setInterval(function() {
                    var now = Date.now();
                    // 统计当前所有正在下载的视频的总字节数
                    // 从 speedWindow 中取最近3秒的数据
                    var threeSecAgo = now - 3000;
                    var recent = speedWindow.filter(function(p) { return p.time >= threeSecAgo; });
                    if (recent.length >= 2) {
                        var first = recent[0];
                        var last = recent[recent.length - 1];
                        var elapsed = (last.time - first.time) / 1000;
                        var bytesDelta = last.bytes - first.bytes;
                        if (elapsed > 0 && bytesDelta >= 0) {
                            currentSpeed = bytesDelta / 1048576 / elapsed;
                        }
                    }
                    task._speed = currentSpeed.toFixed(1);
                    saveProgress();
                    // 清理超过5秒的旧数据
                    var fiveSecAgo = now - 5000;
                    while (speedWindow.length > 0 && speedWindow[0].time < fiveSecAgo) {
                        speedWindow.shift();
                    }
                }, 1000);
            }

            function stopSpeedMonitor() {
                if (speedTimer) {
                    clearInterval(speedTimer);
                    speedTimer = null;
                }
            }

            // 分片大小：20MB（减少请求次数，提升吞吐量，充分利用带宽）
            var CHUNK_SIZE = 20 * 1024 * 1024;
            // 每片超时：60秒（网络拥堵时给更多时间）
            var CHUNK_TIMEOUT = 60000;
            // 最大重试次数（单分片）
            var MAX_CHUNK_RETRIES = 5;
            // 单视频并行分片数：3（相当于给每个视频开3条连接，突破单连接限速）
            var PARALLEL_CHUNKS = 3;

            // 记录某个视频当前已下载字节数（累加所有并发）
            function recordBytes(itemId, loaded, totalSize) {
                if (!recordBytes._perItem) recordBytes._perItem = {};
                recordBytes._perItem[itemId] = loaded;
                // 同时记录总大小（用于显示总字节）
                if (!recordBytes._totalSize) recordBytes._totalSize = {};
                if (totalSize) recordBytes._totalSize[itemId] = totalSize;
                var total = 0;
                for (var k in recordBytes._perItem) {
                    total += recordBytes._perItem[k] || 0;
                }
                var now = Date.now();
                speedWindow.push({ time: now, bytes: total });
            }

            function clearItemBytes(itemId) {
                if (recordBytes._perItem) {
                    delete recordBytes._perItem[itemId];
                }
                if (recordBytes._totalSize) {
                    delete recordBytes._totalSize[itemId];
                }
            }

            // 获取视频总大小（HEAD请求，验证Range支持）
            function getVideoSize(videoUrl) {
                return new Promise(function(resolve, reject) {
                    var xhr = null;
                    var timeoutId = setTimeout(function() {
                        if (xhr) xhr.abort();
                        // 从活跃列表移除
                        if (_activeXhrs[task.id]) {
                            var xi = _activeXhrs[task.id].indexOf(xhr);
                            if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                        }
                        reject(new Error('获取视频大小超时'));
                    }, 30000);
                    xhr = GM_xmlhttpRequest({
                        method: 'HEAD',
                        url: videoUrl,
                        headers: { 'Referer': location.href },
                        onload: function(res) {
                            clearTimeout(timeoutId);
                            // 从活跃列表移除
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            if (res.status >= 200 && res.status < 300) {
                                var len = parseInt(res.responseHeaders.match(/content-length:\s*(\d+)/i)?.[1] || '0');
                                var acceptRanges = /accept-ranges:\s*bytes/i.test(res.responseHeaders);
                                resolve({ size: len, supportRange: acceptRanges });
                            } else {
                                reject(new Error('HTTP ' + res.status));
                            }
                        },
                        onerror: function() {
                            clearTimeout(timeoutId);
                            // 从活跃列表移除
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            reject(new Error('获取视频大小失败'));
                        }
                    });
                    // 注册到活跃XHR列表
                    if (!_activeXhrs[task.id]) _activeXhrs[task.id] = [];
                    _activeXhrs[task.id].push(xhr);
                });
            }

            // 下载单个分片，返回 { data, headers, status }
            // headers 用于从第一个分片提取总大小（省掉一次HEAD请求）
            function downloadChunk(videoUrl, start, end) {
                return new Promise(function(resolve, reject) {
                    var xhr = null;
                    var timeoutId = setTimeout(function() {
                        if (xhr) xhr.abort();
                        if (_activeXhrs[task.id]) {
                            var xi = _activeXhrs[task.id].indexOf(xhr);
                            if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                        }
                        reject(new Error('分片下载超时'));
                    }, CHUNK_TIMEOUT);
                    xhr = GM_xmlhttpRequest({
                        method: 'GET',
                        url: videoUrl,
                        responseType: 'arraybuffer',
                        headers: {
                            'Referer': location.href,
                            'Range': 'bytes=' + start + '-' + end
                        },
                        onload: function(res) {
                            clearTimeout(timeoutId);
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            if (res.status === 206 || res.status === 200) {
                                resolve({
                                    data: res.response,
                                    headers: res.responseHeaders,
                                    status: res.status
                                });
                            } else {
                                reject(new Error('HTTP ' + res.status));
                            }
                        },
                        onerror: function() {
                            clearTimeout(timeoutId);
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            reject(new Error('分片下载失败'));
                        }
                    });
                    if (!_activeXhrs[task.id]) _activeXhrs[task.id] = [];
                    _activeXhrs[task.id].push(xhr);
                });
            }

            // 回退：全量下载buffer（当不支持Range时用）
            function downloadVideoBuffer(videoUrl, itemId) {
                return new Promise(function(resolve, reject) {
                    var xhr = null;
                    var timeoutId = setTimeout(function() {
                        if (xhr) xhr.abort();
                        // 从活跃列表移除
                        if (_activeXhrs[task.id]) {
                            var xi = _activeXhrs[task.id].indexOf(xhr);
                            if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                        }
                        reject(new Error('下载超时(300s)'));
                    }, 300000);
                    xhr = GM_xmlhttpRequest({
                        method: 'GET',
                        url: videoUrl,
                        responseType: 'arraybuffer',
                        headers: { 'Referer': location.href },
                        onprogress: function(res) {
                            if (res.lengthComputable) {
                                recordBytes(itemId, res.loaded);
                            }
                        },
                        onload: function(res) {
                            clearTimeout(timeoutId);
                            // 从活跃列表移除
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            if (res.status >= 200 && res.status < 300) {
                                resolve(res.response);
                            } else {
                                reject(new Error('HTTP ' + res.status));
                            }
                        },
                        onerror: function() {
                            clearTimeout(timeoutId);
                            // 从活跃列表移除
                            if (_activeXhrs[task.id]) {
                                var xi = _activeXhrs[task.id].indexOf(xhr);
                                if (xi >= 0) _activeXhrs[task.id].splice(xi, 1);
                            }
                            reject(new Error('下载失败'));
                        }
                    });
                    // 注册到活跃XHR列表
                    if (!_activeXhrs[task.id]) _activeXhrs[task.id] = [];
                    _activeXhrs[task.id].push(xhr);
                });
            }

            // 回退：写入视频文件到FSA目录
            async function writeVideoFile(buffer, fileName, item) {
                var fileHandle = await subDirHandle.getFileHandle(fileName, { create: true });
                var writable = await fileHandle.createWritable();
                await writable.write(buffer);
                await writable.close();
                clearItemBytes(item.id);
                item.status = 'success';
                item.totalSize = buffer.byteLength;
                item.downloadedSize = buffer.byteLength;
                saveProgress();
                console.log('%c[下载] ✓ ' + fileName + ' (' + (buffer.byteLength / 1048576).toFixed(1) + ' MB)', 'color:#10b981');
            }

            // Range 分片并行下载 + 写入（极速模式）
            // 优化点：
            // 1. 去掉HEAD请求，从第一个分片的Content-Range头拿总大小
            // 2. 单视频PARALLEL_CHUNKS个分片并行下载，突破单连接限速
            // 3. 20MB大分片，减少请求次数
            async function downloadVideoStreaming(videoUrl, fileName, item) {
                // 先下载第一个分片，同时获取总大小（省掉一次HEAD请求）
                var firstChunkEnd = CHUNK_SIZE - 1;
                var firstResult = null;
                var lastErr = null;
                for (var retry = 0; retry < MAX_CHUNK_RETRIES; retry++) {
                    try {
                        firstResult = await downloadChunk(videoUrl, 0, firstChunkEnd);
                        break;
                    } catch (e) {
                        lastErr = e;
                        if (_skipIds[task.id]) break;
                        if (retry < MAX_CHUNK_RETRIES - 1) {
                            var cancelled = await sleepWithCancel(task.id, Math.pow(2, retry + 1) * 1000);
                            if (cancelled || _skipIds[task.id]) break;
                        }
                    }
                }
                if (!firstResult) {
                    throw new Error('首个分片下载失败: ' + (lastErr ? lastErr.message : '未知错误'));
                }

                // 从响应头解析总大小（Content-Range: bytes 0-20971519/104857600）
                var totalSize = 0;
                var supportRange = firstResult.status === 206;
                if (supportRange) {
                    var crMatch = firstResult.headers.match(/content-range:\s*bytes\s+\d+-\d+\/(\d+)/i);
                    if (crMatch) totalSize = parseInt(crMatch[1]);
                }

                // 不支持Range或大小为0 → 回退全量下载
                if (!supportRange || totalSize === 0) {
                    console.log('%c[下载] 不支持Range，回退全量下载: ' + fileName, 'color:#f59e0b');
                    var buf = await downloadVideoBuffer(videoUrl, item.id);
                    await writeVideoFile(buf, fileName, item);
                    return;
                }

                item.totalSize = totalSize;
                item.downloadedSize = firstResult.data.byteLength;
                recordBytes(item.id, item.downloadedSize, totalSize);

                // 创建文件和 writable
                var fileHandle = await subDirHandle.getFileHandle(fileName, { create: true });
                var writable = await fileHandle.createWritable();

                // 先写入第一个分片
                await writable.write({ type: 'write', data: firstResult.data, position: 0 });
                firstResult.data = null;

                // 总分片数
                var totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

                // 下载单个分片（带重试），返回 { index, data, byteLength, error }
                async function downloadChunkWithRetry(chunkIdx) {
                    var start = chunkIdx * CHUNK_SIZE;
                    var end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
                    var chunkBuf = null;
                    var chunkErr = null;
                    for (var r = 0; r < MAX_CHUNK_RETRIES; r++) {
                        if (_skipIds[task.id]) return { index: chunkIdx, error: new Error('已跳过') };
                        try {
                            var result = await downloadChunk(videoUrl, start, end);
                            chunkBuf = result.data;
                            break;
                        } catch (e) {
                            chunkErr = e;
                            if (r < MAX_CHUNK_RETRIES - 1) {
                                var cancelled = await sleepWithCancel(task.id, Math.pow(2, r + 1) * 1000);
                                if (cancelled || _skipIds[task.id]) {
                                    return { index: chunkIdx, error: new Error('已跳过') };
                                }
                            }
                        }
                    }
                    if (chunkBuf) {
                        return { index: chunkIdx, data: chunkBuf, byteLength: chunkBuf.byteLength };
                    } else {
                        return { index: chunkIdx, error: chunkErr || new Error('未知错误') };
                    }
                }

                try {
                    // 滑动窗口并行下载：启动 PARALLEL_CHUNKS 个 worker
                    // 每个 worker 抢下一个分片，下载完写入文件
                    var chunkQueueIdx = 1; // 第0片已经下完了
                    var failedChunk = null;

                    async function chunkWorker() {
                        while (chunkQueueIdx < totalChunks && !failedChunk && !_skipIds[task.id]) {
                            var myIdx = chunkQueueIdx++;
                            var result = await downloadChunkWithRetry(myIdx);
                            if (result.error) {
                                failedChunk = result;
                                return;
                            }
                            // 按位置写入文件（不依赖顺序）
                            var pos = myIdx * CHUNK_SIZE;
                            await writable.write({ type: 'write', data: result.data, position: pos });
                            result.data = null;
                            // 更新进度（累加，因为多worker并行，用+=）
                            item.downloadedSize += result.byteLength;
                            recordBytes(item.id, item.downloadedSize, totalSize);
                        }
                    }

                    var workers = [];
                    var workerCount = Math.min(PARALLEL_CHUNKS, totalChunks - 1);
                    for (var w = 0; w < workerCount; w++) {
                        workers.push(chunkWorker());
                    }
                    await Promise.all(workers);

                    if (_skipIds[task.id]) throw new Error('已跳过');
                    if (failedChunk) throw new Error('分片下载失败: ' + (failedChunk.error ? failedChunk.error.message : '未知错误'));

                    await writable.close();
                    writable = null;

                    clearItemBytes(item.id);
                    item.status = 'success';
                    saveProgress();
                    console.log('%c[下载] ✓ ' + fileName + ' (' + (totalSize / 1048576).toFixed(1) + ' MB)', 'color:#10b981');
                } catch (e) {
                    try { if (writable) await writable.close(); } catch (e2) {}
                    clearItemBytes(item.id);
                    item.status = 'failed';
                    item.error = e.message || '下载失败';
                    try { await subDirHandle.removeEntry(fileName); } catch (e3) {}
                    saveProgress();
                    console.log('%c[下载] ✗ ' + fileName + ' - ' + (e.message || '未知错误'), 'color:#ef4444');
                }
            }

            // GM_download 模式（直接保存到默认下载目录）
            function gmDownloadItem(item, fileName) {
                return new Promise(function(resolve) {
                    var timeoutId = null;
                    var resolved = false;
                    function done(status, err) {
                        if (resolved) return;
                        resolved = true;
                        if (timeoutId) clearTimeout(timeoutId);
                        item.status = status;
                        if (err) item.error = err;
                        if (status === 'success') {
                            console.log('%c[下载] ✓ ' + fileName + ' (已保存到默认下载目录)', 'color:#10b981');
                        } else {
                            console.log('%c[下载] ✗ ' + fileName + ' - ' + (err || '未知错误'), 'color:#ef4444');
                        }
                        saveProgress();
                        resolve();
                    }
                    timeoutId = setTimeout(function() {
                        done('failed', '下载超时(20s)');
                    }, 20000);
                    try {
                        GM_download({
                            url: item.videoUrl,
                            name: fileName,
                            saveAs: false,
                            onload: function() { done('success'); },
                            onerror: function(err) {
                                var errMsg = err && err.error ? err.error : '下载失败';
                                done('failed', errMsg);
                            }
                        });
                    } catch(e) {
                        done('failed', e.message || '下载失败');
                    }
                });
            }

            async function downloadItem(item) {
                if (item.status === 'success' || item.status === 'downloading') return;

                // 标记为下载中，防止其他worker重复下载
                item.status = 'downloading';

                // 查找视频URL
                if (!item.videoUrl) {
                    item.videoUrl = await findVideoUrlForMaterial(item.id, -1);
                }

                if (!item.videoUrl) {
                    item.status = 'failed';
                    item.error = '无视频URL';
                    saveProgress();
                    return;
                }

                var fileName = safeName + '-' + randomNum + '-' + (item.index + 1) + '.mp4';

                if (subDirHandle) {
                    // FSA 模式：Range 分片流式下载
                    await downloadVideoStreaming(item.videoUrl, fileName, item);
                } else {
                    await gmDownloadItem(item, fileName);
                }
            }

            // 找出第一个未完成的索引
            var startIdx = 0;
            for (var si = 0; si < items.length; si++) {
                if (items[si].status !== 'success') {
                    startIdx = si;
                    break;
                }
            }

            // === 第0步：API预取（最快，毫秒级）===
            // 如果拦截到了 search_key，直接调用API拿所有页的URL
            var apiPendingIds = [];
            for (var api_pi = 0; api_pi < items.length; api_pi++) {
                if (items[api_pi].status !== 'success' && items[api_pi].status !== 'failed' && !items[api_pi].videoUrl) {
                    apiPendingIds.push(items[api_pi].id);
                }
            }
            if (apiPendingIds.length > 0 && apiSearchKey) {
                console.log('%c[下载队列] 开始API预取所有视频URL...', 'color:#6366f1;font-weight:bold');
                try {
                    await fetchAllApiVideoUrls();
                    // 预取完成后，再批量从缓存中取
                    var apiBatchFound = 0;
                    for (var api_bi = 0; api_bi < items.length; api_bi++) {
                        if (!items[api_bi].videoUrl) {
                            var apiUrl = getVideoUrlFromApiCache(items[api_bi].id);
                            if (apiUrl) {
                                items[api_bi].videoUrl = apiUrl;
                                apiBatchFound++;
                            }
                        }
                    }
                    if (apiBatchFound > 0) {
                        console.log('%c[下载队列] API预取找到 ' + apiBatchFound + ' 个URL', 'color:#10b981;font-weight:bold');
                    }
                } catch(e) {
                    console.warn('[下载队列] API预取失败，回退到DOM方式:', e);
                }
            }

            // === 第一步：快速获取URL（批量预扫 + 滚动预热 + 再批量扫）===
            // 策略：先扫当前可见的 → 滚一遍触发懒加载 → 再扫一遍
            // 比逐个滚动查找快 3-5 倍
            var pendingIds = [];
            for (var pi = 0; pi < items.length; pi++) {
                if (items[pi].status !== 'success' && items[pi].status !== 'failed' && !items[pi].videoUrl) {
                    pendingIds.push(items[pi].id);
                }
            }

            if (pendingIds.length > 0) {
                // 1. 先批量预扫当前可见的（也会优先查API缓存）
                var batchUrls = batchFindUrls(pendingIds);
                var batchFound = 0;
                for (var bi = 0; bi < items.length; bi++) {
                    if (batchUrls[items[bi].id] && !items[bi].videoUrl) {
                        items[bi].videoUrl = batchUrls[items[bi].id];
                        batchFound++;
                    }
                }
                if (batchFound > 0) {
                    console.log('%c[下载队列] 批量预扫找到 ' + batchFound + ' 个URL', 'color:#10b981;font-weight:bold');
                }

                // 2. 滚动预热（触发所有懒加载）
                var remainingNoUrl = 0;
                for (var ri = 0; ri < items.length; ri++) {
                    if (items[ri].status !== 'success' && items[ri].status !== 'failed' && !items[ri].videoUrl) {
                        remainingNoUrl++;
                    }
                }
                if (remainingNoUrl > 0 && typeof scrollWarmup === 'function') {
                    await scrollWarmup();
                    // 3. 再批量扫一遍
                    var remainingIds = [];
                    for (var ri2 = 0; ri2 < items.length; ri2++) {
                        if (items[ri2].status !== 'success' && items[ri2].status !== 'failed' && !items[ri2].videoUrl) {
                            remainingIds.push(items[ri2].id);
                        }
                    }
                    if (remainingIds.length > 0) {
                        var batchUrls2 = batchFindUrls(remainingIds);
                        var batchFound2 = 0;
                        for (var bi2 = 0; bi2 < items.length; bi2++) {
                            if (batchUrls2[items[bi2].id] && !items[bi2].videoUrl) {
                                items[bi2].videoUrl = batchUrls2[items[bi2].id];
                                batchFound2++;
                            }
                        }
                        if (batchFound2 > 0) {
                            console.log('%c[下载队列] 滚动预热后再找到 ' + batchFound2 + ' 个URL', 'color:#10b981;font-weight:bold');
                        }
                    }
                }
            }

            // === URL预查找 + 下载 流水线（边找边下，不用等全部找完）===
            // 就绪队列：已经有URL、可以下载的视频索引
            var readyQueue = [];
            var urlLookupFinished = false;

            // 已经有URL的视频直接入队
            for (var ri = 0; ri < items.length; ri++) {
                if (items[ri].status !== 'success' && items[ri].status !== 'failed' && items[ri].status !== 'downloading' && items[ri].videoUrl) {
                    readyQueue.push(ri);
                }
            }

            // 后台URL预查找（找到一个就往就绪队列放一个）
            // 注意：URL查找用低并发（2），因为需要滚动DOM触发懒加载，并发高了会互相抢滚动条反而更慢
            var urlLookupPromise = (async function() {
                var pendingUrlItems = items.filter(function(it) {
                    return it.status !== 'success' && it.status !== 'failed' && it.status !== 'downloading' && !it.videoUrl;
                });
                if (pendingUrlItems.length === 0) {
                    urlLookupFinished = true;
                    return;
                }
                console.log('%c[下载队列] 后台查找 ' + pendingUrlItems.length + ' 个视频URL', 'color:#6366f1;font-weight:bold');
                var urlIdx = 0;
                async function urlWorker() {
                    while (urlIdx < pendingUrlItems.length) {
                        if (_skipIds[task.id]) break;
                        var i = urlIdx++;
                        var it = pendingUrlItems[i];
                        // 如果已经被其他worker开始下载了，跳过
                        if (it.status === 'downloading' || it.status === 'success' || it.status === 'failed') continue;
                        it.videoUrl = await findVideoUrlForMaterial(it.id, -1);
                        // 找到后立即加入就绪队列
                        if (it.status !== 'success' && it.status !== 'failed' && it.status !== 'downloading' && it.videoUrl) {
                            readyQueue.push(items.indexOf(it));
                        }
                    }
                }
                var urlWorkers = [];
                // URL查找用4并发（批量预热后剩下的不多，4并发比2快一倍）
                var urlConc = Math.min(4, pendingUrlItems.length);
                for (var uw = 0; uw < urlConc; uw++) {
                    urlWorkers.push(urlWorker());
                }
                await Promise.all(urlWorkers);
                urlLookupFinished = true;
                saveProgress(); // 持久化已找到的URL（崩溃恢复用）
            })();

            startSpeedMonitor();

            if (subDirHandle) {
                // === FSA模式：流水线下载，从就绪队列取任务 ===
                async function slotWorker() {
                    while (true) {
                        if (_skipIds[task.id]) break;

                        // 从就绪队列取一个
                        var myIdx = readyQueue.shift();

                        if (myIdx === undefined) {
                            // 队列为空
                            if (urlLookupFinished) {
                                // URL全部找完了，再确认一遍有没有遗漏（防御性检查）
                                var leftover = -1;
                                for (var li = 0; li < items.length; li++) {
                                    if (items[li].status !== 'success' && items[li].status !== 'failed' && items[li].status !== 'downloading' && items[li].videoUrl) {
                                        leftover = li;
                                        break;
                                    }
                                }
                                if (leftover < 0) break; // 真的全部完成了
                                readyQueue.push(leftover);
                                continue;
                            } else {
                                // URL还在后台查找，稍等一下
                                await new Promise(function(r) { setTimeout(r, 200); });
                                continue;
                            }
                        }

                        var it = items[myIdx];
                        if (it.status === 'success' || it.status === 'failed' || it.status === 'downloading') continue;

                        // 兜底：预查找没找到的，worker自己再试一次
                        if (!it.videoUrl) {
                            it.videoUrl = await findVideoUrlForMaterial(it.id, -1);
                        }
                        if (!it.videoUrl) {
                            it.status = 'failed';
                            it.error = '无视频URL';
                            saveProgress();
                            continue;
                        }

                        await downloadItem(it);
                    }
                }

                var workers = [];
                var pendingCount = items.filter(function(it) { return it.status !== 'success' && it.status !== 'failed'; }).length;
                var conc = Math.min(CONCURRENCY, Math.max(1, pendingCount));
                for (var w = 0; w < conc; w++) {
                    workers.push(slotWorker());
                }
                await Promise.all(workers);

                // 确保URL查找也结束了
                await urlLookupPromise;

            } else {
                // === GM_download模式：流水线下载，从就绪队列取任务 ===
                async function gmWorker() {
                    while (true) {
                        if (_skipIds[task.id]) break;

                        var myIdx = readyQueue.shift();
                        if (myIdx === undefined) {
                            if (urlLookupFinished) {
                                var leftover = -1;
                                for (var li = 0; li < items.length; li++) {
                                    if (items[li].status !== 'success' && items[li].status !== 'failed' && items[li].status !== 'downloading' && items[li].videoUrl) {
                                        leftover = li;
                                        break;
                                    }
                                }
                                if (leftover < 0) break;
                                readyQueue.push(leftover);
                                continue;
                            } else {
                                await new Promise(function(r) { setTimeout(r, 200); });
                                continue;
                            }
                        }

                        var it = items[myIdx];
                        if (it.status === 'success' || it.status === 'failed' || it.status === 'downloading') continue;

                        if (!it.videoUrl) {
                            it.videoUrl = await findVideoUrlForMaterial(it.id, -1);
                        }
                        if (!it.videoUrl) {
                            it.status = 'failed';
                            it.error = '无视频URL';
                            saveProgress();
                            continue;
                        }

                        await downloadItem(it);
                    }
                }
                var gmWorkers = [];
                var pendingCount = items.filter(function(it) { return it.status !== 'success' && it.status !== 'failed'; }).length;
                var gmConc = Math.min(CONCURRENCY, Math.max(1, pendingCount));
                for (var gw = 0; gw < gmConc; gw++) {
                    gmWorkers.push(gmWorker());
                }
                await Promise.all(gmWorkers);

                // 确保URL查找也结束了
                await urlLookupPromise;
            }

            // 重试失败的（最多 5 轮，每轮间隔 2 秒，3 个并发）
            var MAX_RETRY_ROUNDS = 5;
            for (var round = 1; round <= MAX_RETRY_ROUNDS; round++) {
                if (_skipIds[task.id]) break; // 被跳过了直接退出
                var failedList = items.filter(function(it) { return it.status === 'failed' && it.error !== '无视频URL' && it.error !== '已跳过' && it.error !== '手动跳过'; });
                if (failedList.length === 0) break;
                console.log('%c[下载队列] 第 ' + round + ' 轮重试，共 ' + failedList.length + ' 个失败视频', 'color:#f59e0b;font-weight:bold');
                var retryIdx = 0;
                async function retryWorker() {
                    while (retryIdx < failedList.length) {
                        if (_skipIds[task.id]) break;
                        var ri = retryIdx++;
                        failedList[ri].status = 'waiting';
                        await downloadItem(failedList[ri]);
                    }
                }
                var retryWorkers = [];
                var retryConcurrent = Math.min(3, failedList.length);
                for (var rw = 0; rw < retryConcurrent; rw++) {
                    retryWorkers.push(retryWorker());
                }
                await Promise.all(retryWorkers);
                // 如果还有失败的，间隔 2 秒再下一轮
                var stillFailed = items.filter(function(it) { return it.status === 'failed' && it.error !== '无视频URL'; });
                if (stillFailed.length > 0 && round < MAX_RETRY_ROUNDS) {
                    await sleepWithCancel(task.id, 2000);
                    if (_skipIds[task.id]) break;
                }
            }

            // 更新最终状态
            stopSpeedMonitor();
            task._speed = '0.0';
            task.status = 'completed';
            // 如果是被跳过的，统一标记未完成的为"手动跳过"
            if (_skipIds[task.id]) {
                for (var si = 0; si < items.length; si++) {
                    if (items[si].status !== 'success') {
                        items[si].status = 'failed';
                        items[si].error = '手动跳过';
                    }
                }
            }
            var finalCnt = countStatus();
            task.successCount = finalCnt.success;
            task.failCount = finalCnt.failed;
            task.items = items;
            saveProgress();
            // 清理：移除跳过标记和活跃XHR记录
            delete _skipIds[task.id];
            delete _activeXhrs[task.id];
            delete _sleepTimers[task.id];
        }

        async function startProcessing() {
            if (isRunning) return;
            isRunning = true;

            try {
                while (true) {
                    var q = getQueue();
                    var nextTask = q.tasks.find(function(t) { return t.status === 'queued' || t.status === 'downloading'; });
                    if (!nextTask) break;
                    await processTask(nextTask);
                }
            } catch(e) {
                console.error('[下载队列] 处理出错:', e);
            }

            isRunning = false;
            notify();
        }

        function subscribe(fn) {
            listeners.push(fn);
            return function() {
                var idx = listeners.indexOf(fn);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        }

        // 页面加载时自动恢复下载
        function autoResume() {
            var q = getQueue();
            var hasPending = q.tasks.some(function(t) { return t.status === 'queued' || t.status === 'downloading'; });
            if (!hasPending) return;

            if (cachedDirHandle) {
                // 有缓存目录，直接恢复
                console.log('%c[下载队列] 检测到未完成任务，自动恢复下载', 'color:#6366f1;font-weight:bold');
                startProcessing();
            } else {
                // 没有缓存目录 → 标记为暂停，等用户手动选择目录后再继续
                console.log('%c[下载队列] 检测到未完成任务，已暂停（等待选择保存目录）', 'color:#f59e0b;font-weight:bold');
                var q2 = getQueue();
                for (var i = 0; i < q2.tasks.length; i++) {
                    if (q2.tasks[i].status === 'queued' || q2.tasks[i].status === 'downloading') {
                        q2.tasks[i].status = 'paused';
                    }
                }
                saveQueue(q2);
                notify();
            }
        }

        // 选择目录后恢复下载
        async function resumeWithDir() {
            await requestDirHandle();
            // 把所有 paused 的任务改回 queued
            var q = getQueue();
            for (var i = 0; i < q.tasks.length; i++) {
                if (q.tasks[i].status === 'paused') {
                    q.tasks[i].status = 'queued';
                }
            }
            saveQueue(q);
            notify();
            startProcessing();
        }

        // 延迟自动恢复（等页面加载完成）
        setTimeout(autoResume, 2000);

        return {
            addTask: addTask,
            removeTask: removeTask,
            clearCompleted: clearCompleted,
            retryFailed: retryFailed,
            skipTask: skipTask,
            getQueue: getQueue,
            subscribe: subscribe,
            startProcessing: startProcessing,
            requestDirHandle: requestDirHandle,
            clearCachedDir: clearCachedDir,
            resumeWithDir: resumeWithDir,
            hasCachedDir: function() { return !!cachedDirHandle; }
        };
    })();

    // 行映射缓存：materialId → { row, ts }
    var _rowMapCache = null;
    var _rowMapTs = 0;

    function getRowMap() {
        // 缓存 1 秒内的行映射（缩短缓存时间，避免切换剧目后用旧数据）
        var now = Date.now();
        if (_rowMapCache && (now - _rowMapTs < 1000)) return _rowMapCache;

        _rowMapCache = {};
        _rowMapTs = now;

        // 优先从激活 tab + 视口内的表格里找行
        var activePane = document.querySelector('.arco-tabs-content-pane-active, [aria-hidden="false"].arco-tabs-content-pane');
        var tables = [];
        if (activePane) {
            tables = activePane.querySelectorAll('.arco-table');
        }
        if (tables.length === 0) {
            tables = document.querySelectorAll('.arco-table');
        }

        // 选视口内面积最大的表格
        var activeTable = null;
        var maxArea = 0;
        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            if (!isInViewport(tbl)) continue;
            var rect = tbl.getBoundingClientRect();
            var area = rect.width * rect.height;
            if (area > maxArea) {
                maxArea = area;
                activeTable = tbl;
            }
        }

        var rows = activeTable ? activeTable.querySelectorAll('tr.arco-table-tr') : document.querySelectorAll('tr.arco-table-tr');
        for (var i = 0; i < rows.length; i++) {
            // 只缓存可见的行
            if (!isElementVisible(rows[i])) continue;
            var idEl = rows[i].querySelector('.arco-typography-secondary');
            if (!idEl) continue;
            var match = idEl.textContent.match(/ID:([a-f0-9]+)/i);
            if (match) _rowMapCache[match[1]] = rows[i];
        }
        return _rowMapCache;
    }

    async function findVideoUrlForMaterial(materialId) {
        // 0. 优先从API缓存获取（毫秒级，比DOM查找快100倍）
        var cachedUrl = getVideoUrlFromApiCache(materialId);
        if (cachedUrl) {
            return cachedUrl;
        }

        // 最多尝试 2 次查找 URL（批量预热后剩下的大多是加载失败的，不浪费时间）
        var MAX_ATTEMPTS = 2;
        for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) {
                await new Promise(function(r) { setTimeout(r, 800); });
            }

            var rowMap = getRowMap();
            var targetRow = rowMap[materialId] || null;

            if (targetRow) {
                // 0. 滚动行到可视区域，触发懒加载
                try {
                    targetRow.scrollIntoView({ block: 'nearest', behavior: 'auto' });
                } catch(e) {}

                // 1. 查找 video 标签及其 src / source
                var video = targetRow.querySelector('video');
                if (video) {
                    var src = video.getAttribute('src') || video.src || '';
                    if (src && src.indexOf('blob:') !== 0) return src;
                    var sourceEl = video.querySelector('source');
                    if (sourceEl) {
                        var sSrc = sourceEl.getAttribute('src') || '';
                        if (sSrc) return sSrc;
                    }
                    // video 标签存在但无 src？等下一轮再查（可能还在加载）
                    if (attempt < MAX_ATTEMPTS - 1) continue;
                }

                // 2. 遍历行内所有元素的所有属性，找视频URL特征
                var allEls = targetRow.querySelectorAll('*');
                for (var j = 0; j < allEls.length; j++) {
                    var el = allEls[j];
                    // 属性
                    for (var k = 0; k < el.attributes.length; k++) {
                        var val = el.attributes[k].value;
                        if (!val || val.length < 10) continue;
                        if (isVideoUrl(val)) return val;
                    }
                    // dataset
                    try {
                        var ds = el.dataset;
                        for (var dk in ds) {
                            var dv = ds[dk];
                            if (dv && typeof dv === 'string' && dv.length > 10 && isVideoUrl(dv)) return dv;
                        }
                    } catch(e) {}
                }

                // 3. 查下一行（展开详情行）
                var nextRow = targetRow.nextElementSibling;
                if (nextRow && nextRow.classList.contains('arco-table-tr')) {
                    var nextVideo = nextRow.querySelector('video[src]');
                    if (nextVideo) {
                        var ns = nextVideo.getAttribute('src') || '';
                        if (ns && ns.indexOf('blob:') !== 0) return ns;
                    }
                    var nextEls = nextRow.querySelectorAll('*');
                    for (var j2 = 0; j2 < nextEls.length; j2++) {
                        for (var k2 = 0; k2 < nextEls[j2].attributes.length; k2++) {
                            var val2 = nextEls[j2].attributes[k2].value;
                            if (!val2 || val2.length < 10) continue;
                            if (isVideoUrl(val2)) return val2;
                        }
                    }
                }

                // 4. 查 background-image 样式
                var bgEls = targetRow.querySelectorAll('[style*="background"]');
                for (var j3 = 0; j3 < bgEls.length; j3++) {
                    var style = bgEls[j3].getAttribute('style') || '';
                    var bgMatch = style.match(/url\(["']?([^"')]+)["']?\)/);
                    if (bgMatch) {
                        var bgUrl = bgMatch[1];
                        if (isVideoUrl(bgUrl)) return bgUrl;
                    }
                }

                // 5. 从元素的 __vue__ / React fiber 中尝试找视频数据
                try {
                    var vueEl = targetRow.querySelector('[data-v-]') || targetRow;
                    for (var vk in vueEl) {
                        if (vk.indexOf('__vue') === 0 || vk === '_vnode') {
                            var vData = vueEl[vk];
                            var vStr = JSON.stringify(vData);
                            var vMatch = vStr.match(/"(https?:\/\/[^"\\]+\.mp4[^"]*)"/i);
                            if (vMatch) return vMatch[1];
                            break;
                        }
                    }
                } catch(e) {}
            }

            // 注意：已移除 Performance API 回退逻辑
            // 之前用 performance.getEntriesByType('resource') 拿最近的视频URL，
            // 但这会导致严重的"串剧"问题——当当前视频加载失败时，
            // 会返回上一个剧目加载过的视频URL，下载错误的素材。
            // 安全优先，宁可下载失败也不能下错剧。

            // 如果有行但 video 标签存在无 src，多等一轮
            if (targetRow && targetRow.querySelector('video') && attempt < MAX_ATTEMPTS - 1) {
                continue;
            }
        }

        return null;
    }

    // 批量快速查找URL：扫描当前DOM中所有可见行，一次性提取能拿到的URL
    // 比逐个滚动查找快得多，用于下载开始前的快速预热
    function batchFindUrls(materialIds) {
        var found = {};
        try {
            // 0. 优先从API缓存批量获取（毫秒级）
            var apiFoundCount = 0;
            for (var mi0 = 0; mi0 < materialIds.length; mi0++) {
                var mid0 = materialIds[mi0];
                var cached = getVideoUrlFromApiCache(mid0);
                if (cached) {
                    found[mid0] = cached;
                    apiFoundCount++;
                }
            }
            if (apiFoundCount > 0) {
                console.log('[批量查找URL] API缓存命中 ' + apiFoundCount + ' 个');
            }
            // 如果全部命中，直接返回，不用查DOM了
            if (apiFoundCount === materialIds.length) {
                return found;
            }

            var rowMap = getRowMap();
            for (var mi = 0; mi < materialIds.length; mi++) {
                var mid = materialIds[mi];
                // 已经从API缓存拿到了，跳过DOM查找
                if (found[mid]) continue;
                
                var row = rowMap[mid];
                if (!row) continue;

                // 找video标签
                var video = row.querySelector('video');
                if (video) {
                    var src = video.getAttribute('src') || video.src || '';
                    if (src && src.indexOf('blob:') !== 0 && isVideoUrl(src)) {
                        found[mid] = src;
                        continue;
                    }
                    var sourceEl = video.querySelector('source');
                    if (sourceEl) {
                        var sSrc = sourceEl.getAttribute('src') || '';
                        if (sSrc && isVideoUrl(sSrc)) {
                            found[mid] = sSrc;
                            continue;
                        }
                    }
                }

                // 遍历行内所有元素属性找视频URL
                var allEls = row.querySelectorAll('*');
                var foundUrl = null;
                for (var j = 0; j < allEls.length && !foundUrl; j++) {
                    var el = allEls[j];
                    for (var k = 0; k < el.attributes.length && !foundUrl; k++) {
                        var val = el.attributes[k].value;
                        if (val && val.length > 10 && isVideoUrl(val)) {
                            foundUrl = val;
                        }
                    }
                    // dataset
                    try {
                        var ds = el.dataset;
                        for (var dk in ds) {
                            var dv = ds[dk];
                            if (dv && typeof dv === 'string' && dv.length > 10 && isVideoUrl(dv)) {
                                foundUrl = dv;
                                break;
                            }
                        }
                    } catch(e) {}
                }
                if (foundUrl) {
                    found[mid] = foundUrl;
                    continue;
                }

                // 查下一行（展开详情行）
                var nextRow = row.nextElementSibling;
                if (nextRow && nextRow.classList.contains('arco-table-tr')) {
                    var nextVideo = nextRow.querySelector('video[src]');
                    if (nextVideo) {
                        var ns = nextVideo.getAttribute('src') || '';
                        if (ns && ns.indexOf('blob:') !== 0 && isVideoUrl(ns)) {
                            found[mid] = ns;
                            continue;
                        }
                    }
                }
            }
        } catch(e) {
            console.warn('[批量查找URL] 出错:', e);
        }
        return found;
    }

    // 滚动预热：从上到下滚一遍表格，触发所有视频的懒加载
    // 比逐个滚动查找快得多，一次滚动就能让所有视频加载出来
    async function scrollWarmup() {
        try {
            // 找到当前活动表格
            var activePane = document.querySelector('.arco-tabs-content-pane-active, [aria-hidden="false"].arco-tabs-content-pane');
            var tables = activePane ? activePane.querySelectorAll('.arco-table') : document.querySelectorAll('.arco-table');

            var activeTable = null;
            var maxArea = 0;
            for (var t = 0; t < tables.length; t++) {
                var tbl = tables[t];
                if (!isElementVisible(tbl)) continue;
                var rect = tbl.getBoundingClientRect();
                var area = rect.width * rect.height;
                if (area > maxArea) {
                    maxArea = area;
                    activeTable = tbl;
                }
            }
            if (!activeTable) return 0;

            // 获取表格容器（可滚动的父元素）
            var scrollContainer = activeTable.parentElement;
            while (scrollContainer && scrollContainer !== document.body) {
                var overflowY = window.getComputedStyle(scrollContainer).overflowY;
                if (overflowY === 'auto' || overflowY === 'scroll') break;
                scrollContainer = scrollContainer.parentElement;
            }
            if (!scrollContainer || scrollContainer === document.body) {
                scrollContainer = window;
            }

            var rows = activeTable.querySelectorAll('tr.arco-table-tr');
            if (rows.length === 0) return 0;

            // 从上到下逐个滚，每步停留 150ms 给懒加载时间
            var visibleCount = 0;
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                if (!isElementVisible(row)) continue;
                visibleCount++;
                try {
                    row.scrollIntoView({ block: 'center', behavior: 'auto' });
                } catch(e) {}
                await new Promise(function(r) { setTimeout(r, 100); });
            }

            // 滚回顶部
            if (rows[0]) {
                try { rows[0].scrollIntoView({ block: 'start', behavior: 'auto' }); } catch(e) {}
            }

            console.log('%c[滚动预热] 滚过 ' + visibleCount + ' 行，完成懒加载预热', 'color:#10b981;font-weight:bold');
            return visibleCount;
        } catch(e) {
            console.warn('[滚动预热] 出错:', e);
            return 0;
        }
    }

    // 判断一个字符串是否是视频URL
    function isVideoUrl(str) {
        if (!str || typeof str !== 'string' || str.length < 10) return false;
        if (str.indexOf('blob:') === 0) return false;
        // 直接视频文件
        if (/\.mp4(\?|$)/i.test(str)) return true;
        if (/\.webm(\?|$)/i.test(str)) return true;
        // 巨量引擎视频CDN
        if (/chameleon\.bytedance.*video/i.test(str)) return true;
        if (/video_id=([^&]+)/.test(str)) return true;
        if (/tos-cdn-.*\.byteimg\.com.*video/i.test(str)) return true;
        if (/v\d+-default\.byteimg\.com/i.test(str)) return true;
        if (/p\d+-default\.byteimg\.com.*\.mp4/i.test(str)) return true;
        // 常见视频CDN域名
        if (/bytedance.*\.mp4/i.test(str)) return true;
        if (/byteimg\.com.*\.mp4/i.test(str)) return true;
        return false;
    }

    function openPanel() {
        const materials = extractMaterials();
        var detectedDramaName = getDramaName();

        const overlay = document.createElement('div');
        overlay.className = 'mie-overlay';
        overlay.id = 'mie-overlay';
        overlay.onclick = closePanel;
        document.body.appendChild(overlay);

        const panel = document.createElement('div');
        panel.id = 'mie-panel';
        panel.innerHTML = `
            <div id="material-id-extractor-panel">
                <div class="mie-topbar"></div>
                <div class="mie-header">
                    <div class="mie-header-title">
                        <div class="mie-header-icon">${ICONS.header}</div>
                        <div>
                            <h3>素材ID提取结果</h3>
                            <div class="mie-header-sub">Material ID Extractor</div>
                        </div>
                    </div>
                    <button class="mie-close" onclick="document.getElementById('mie-close-btn').click()">&#xd7;</button>
                </div>
                <div class="mie-tabs">
                    <div class="mie-tab mie-tab-active" data-tab="materials">素材列表</div>
                    <div class="mie-tab" data-tab="queue">下载队列 <span class="mie-tab-badge" id="mie-queue-badge">0</span></div>
                </div>
                <div class="mie-body mie-tab-content" data-tab-content="materials">
                    <div class="mie-stats">
                        <div class="mie-stat-card mie-stat-all">
                            ${ICONS.statAll}
                            <div class="mie-stat-info">
                                <div class="mie-stat-number">${materials.length}</div>
                                <div class="mie-stat-label">全部素材</div>
                            </div>
                        </div>
                        <div class="mie-stat-card mie-stat-video">
                            ${ICONS.statVideo}
                            <div class="mie-stat-info">
                                <div class="mie-stat-number">${materials.filter(m => m.type === 'video').length}</div>
                                <div class="mie-stat-label">视频素材</div>
                            </div>
                        </div>
                        <div class="mie-stat-card mie-stat-image">
                            ${ICONS.statImage}
                            <div class="mie-stat-info">
                                <div class="mie-stat-number">${materials.filter(m => m.type === 'image').length}</div>
                                <div class="mie-stat-label">图片素材</div>
                            </div>
                        </div>
                    </div>
                    <div class="mie-drama-section">
                        ${ICONS.drama}
                        <label class="mie-drama-label">剧名</label>
                        <input type="text" id="mie-drama-name" class="mie-drama-input-field" placeholder="请输入剧名（用于视频命名）" value="${detectedDramaName}">
                    </div>
                    ${materials.length === 0 ? `
                        <div class="mie-empty">
                            ${ICONS.search}
                            <div class="mie-empty-title">未检测到素材数据</div>
                            <div class="mie-empty-desc">请确保当前页面已加载素材列表，<br>如果页面是动态加载的，请等待列表出现后再点击提取</div>
                        </div>
                    ` : `
                        <div class="mie-table-wrap">
                            <table class="mie-table">
                                <thead>
                                    <tr>
                                        <th style="width:44px;text-align:center">
                                            <label class="mie-check-label">
                                                <input type="checkbox" id="mie-select-all" checked>
                                                <span>全选</span>
                                            </label>
                                        </th>
                                        <th style="width:190px">素材ID</th>
                                        <th>素材名称</th>
                                        <th style="width:66px;text-align:center">类型</th>
                                        <th style="width:96px;text-align:center">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${materials.map((m, i) => `
                                        <tr>
                                            <td style="text-align:center">
                                                <input type="checkbox" class="mie-row-checkbox" data-index="${i}" checked>
                                            </td>
                                            <td><span class="mie-id-cell">${m.id}</span></td>
                                            <td class="mie-name-cell">${m.name}</td>
                                            <td style="text-align:center">
                                                <span class="mie-type-tag mie-type-${m.type}">
                                                    ${m.type === 'video' ? ICONS.typeVideo + ' 视频' : (m.type === 'image' ? ICONS.typeImage + ' 图片' : '未知')}
                                                </span>
                                            </td>
                                            <td>
                                                <div class="mie-row-actions">
                                                    <button class="mie-row-btn" data-action="copy-id" data-index="${i}" title="复制此ID">${ICONS.copy}</button>
                                                    <button class="mie-row-btn mie-row-btn-name" data-action="copy-name" data-index="${i}" title="复制此名称">${ICONS.names}</button>
                                                    <button class="mie-row-btn mie-row-btn-download" data-action="download" data-index="${i}" title="下载此视频">${ICONS.rowDownload}</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="mie-tip">点击「复制全部ID」可快速获取所有素材ID，每行一个</div>
                    `}
                </div>
                <div class="mie-body mie-tab-content" data-tab-content="queue" style="display:none">
                    <div class="mie-queue-list" id="mie-queue-list">
                        <div class="mie-empty">
                            <svg class="mie-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <div class="mie-empty-title">暂无下载任务</div>
                            <div class="mie-empty-desc">在「素材列表」中选择视频并点击下载<br>下载任务会自动加入队列后台运行</div>
                        </div>
                    </div>
                </div>
                <div class="mie-footer">
                    ${materials.length > 0 ? `
                        <button class="mie-btn mie-btn-ghost" id="mie-copy-ids">${ICONS.copy} 复制全部ID</button>
                        <button class="mie-btn mie-btn-ghost" id="mie-copy-names">${ICONS.names} 复制全部名称</button>
                        <button class="mie-btn mie-btn-ghost" id="mie-download-all" style="color:#10b981;border-color:#a7f3d0">${ICONS.download} <span id="mie-download-count">下载选中(${materials.length})</span></button>
                    ` : ''}
                    <button class="mie-btn mie-btn-accent" id="mie-close-btn">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('mie-close-btn').onclick = closePanel;
        if (materials.length > 0) {
            document.getElementById('mie-copy-ids').onclick = () => {
                copyText(materials.map(m => m.id).join('\n'));
            };
            document.getElementById('mie-copy-names').onclick = () => {
                copyText(materials.map(m => m.name).join('\n'));
            };
            panel.querySelectorAll('.mie-row-btn[data-action="copy-id"]').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var idx = parseInt(this.getAttribute('data-index'));
                    copyText(materials[idx].id);
                };
            });
            panel.querySelectorAll('.mie-row-btn[data-action="copy-name"]').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var idx = parseInt(this.getAttribute('data-index'));
                    copyText(materials[idx].name);
                };
            });
            panel.querySelectorAll('.mie-row-btn[data-action="download"]').forEach(function(btn) {
                btn.onclick = async function(e) {
                    e.stopPropagation();
                    var idx = parseInt(this.getAttribute('data-index'));
                    var m = materials[idx];
                    var dramaNameInput = document.getElementById('mie-drama-name');
                    var dramaName = dramaNameInput ? dramaNameInput.value.trim() : '';
                    if (!dramaName) dramaName = '未命名剧目';
                    // 在用户点击时请求目录选择
                    await DownloadQueue.requestDirHandle();
                    DownloadQueue.addTask(dramaName, [m]);
                    showToast('已加入下载队列: ' + m.name);
                    switchTab('queue');
                };
            });
            var downloadAllBtn = document.getElementById('mie-download-all');
            if (downloadAllBtn) {
                downloadAllBtn.onclick = async function() {
                    var dramaNameInput = document.getElementById('mie-drama-name');
                    var dramaName = dramaNameInput ? dramaNameInput.value.trim() : '';
                    if (!dramaName) dramaName = '未命名剧目';
                    var checkedBoxes = panel.querySelectorAll('.mie-row-checkbox:checked');
                    var selectedMaterials = [];
                    checkedBoxes.forEach(function(cb) {
                        var idx = parseInt(cb.getAttribute('data-index'));
                        selectedMaterials.push(materials[idx]);
                    });
                    if (selectedMaterials.length === 0) {
                        showToast('请先选择要下载的素材');
                        return;
                    }
                    // 在用户点击时请求目录选择（有用户交互，浏览器才允许弹窗）
                    // 如果已经选过了，直接复用，不弹第二次
                    await DownloadQueue.requestDirHandle();
                    DownloadQueue.addTask(dramaName, selectedMaterials);
                    showToast('已加入下载队列: ' + dramaName + ' (' + selectedMaterials.length + '个)');
                    // 切换到队列 tab
                    switchTab('queue');
                };
            }

            // Tab 切换
            function switchTab(tabName) {
                panel.querySelectorAll('.mie-tab').forEach(function(t) {
                    t.classList.toggle('mie-tab-active', t.getAttribute('data-tab') === tabName);
                });
                panel.querySelectorAll('.mie-tab-content').forEach(function(c) {
                    c.style.display = c.getAttribute('data-tab-content') === tabName ? 'block' : 'none';
                });
                if (tabName === 'queue') {
                    renderQueue();
                }
            }
            panel.querySelectorAll('.mie-tab').forEach(function(tab) {
                tab.onclick = function() {
                    switchTab(this.getAttribute('data-tab'));
                };
            });

            // 渲染队列
            function renderQueue(q) {
                if (!q) q = DownloadQueue.getQueue();
                var queueList = document.getElementById('mie-queue-list');
                if (!queueList) return;

                // 更新 badge
                var badge = document.getElementById('mie-queue-badge');
                if (badge) {
                    var activeCount = q.tasks.filter(function(t) { return t.status === 'downloading' || t.status === 'queued' || t.status === 'paused'; }).length;
                    badge.textContent = q.tasks.length;
                    badge.classList.toggle('has-active', activeCount > 0);
                }

                if (q.tasks.length === 0) {
                    queueList.innerHTML = '<div class="mie-empty"><svg class="mie-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><div class="mie-empty-title">暂无下载任务</div><div class="mie-empty-desc">在「素材列表」中选择视频并点击下载<br>下载任务会自动加入队列后台运行</div></div>';
                    return;
                }

                // 尝试增量更新：如果已有相同数量的队列项，只更新数据不重建 DOM
                var existingItems = queueList.querySelectorAll('.mie-queue-item');
                var sortedTasks = q.tasks.slice().reverse();
                var canIncremental = existingItems.length === sortedTasks.length;

                if (canIncremental) {
                    // 验证 task ID 是否匹配
                    for (var ci = 0; ci < sortedTasks.length; ci++) {
                        if (!existingItems[ci] || existingItems[ci].getAttribute('data-task-id') !== sortedTasks[ci].id) {
                            canIncremental = false;
                            break;
                        }
                    }
                }

                if (canIncremental) {
                    // 增量更新：只改数据，不重建 DOM
                    // 更新 resume banner 可见性
                    var hasPausedOrPending = q.tasks.some(function(t) { return t.status === 'downloading' || t.status === 'queued' || t.status === 'paused'; });
                    var shouldShowBanner = hasPausedOrPending && !DownloadQueue.hasCachedDir();
                    var existingBanner = queueList.querySelector('#mie-resume-banner');
                    if (shouldShowBanner && !existingBanner) {
                        // 需要显示但没有，重建
                        fullRenderQueue();
                        return;
                    } else if (!shouldShowBanner && existingBanner) {
                        // 不需要显示但有，重建
                        fullRenderQueue();
                        return;
                    }

                    // 逐个更新已有 item
                    sortedTasks.forEach(function(task, idx) {
                        var item = existingItems[idx];
                        var doneCount = task.successCount;
                        var pct = task.total > 0 ? Math.round((doneCount / task.total) * 100) : 0;
                        var statusText = '';
                        var statusClass = '';
                        var iconSvg = '';
                        var bytesText = '';
                        if (task._totalBytes && task._totalBytes > 0) {
                            var dl = task._downloadedBytes || 0;
                            var tot = task._totalBytes;
                            var dlStr = dl < 1048576 ? (dl / 1024).toFixed(0) + ' KB' : (dl / 1048576).toFixed(1) + ' MB';
                            var totStr = tot < 1048576 ? (tot / 1024).toFixed(0) + ' KB' : (tot / 1048576).toFixed(1) + ' MB';
                            bytesText = ' | ' + dlStr + ' / ' + totStr;
                        }
                        if (task.status === 'downloading') {
                            var speedText = task._speed ? ' (' + task._speed + ' MB/s)' : '';
                            statusText = '下载中' + speedText + bytesText;
                            statusClass = 'downloading';
                            iconSvg = '<svg class="mie-queue-status-icon status-downloading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
                        } else if (task.status === 'queued') {
                            statusText = '等待中';
                            statusClass = 'queued';
                            iconSvg = '<svg class="mie-queue-status-icon status-queued" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
                        } else if (task.status === 'paused') {
                            statusText = '已暂停（点击选择目录继续）';
                            statusClass = 'paused';
                            iconSvg = '<svg class="mie-queue-status-icon status-paused" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                        } else {
                            statusText = task.failCount > 0 ? ('成功' + task.successCount + '/失败' + task.failCount) : '全部完成';
                            statusClass = 'completed';
                            iconSvg = '<svg class="mie-queue-status-icon status-completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
                        }

                        // 更新 class
                        item.className = 'mie-queue-item status-' + statusClass;
                        // 更新图标
                        var iconEl = item.querySelector('.mie-queue-status-icon');
                        if (iconEl) {
                            var iconParent = iconEl.parentElement;
                            if (iconParent) {
                                iconParent.innerHTML = iconSvg + iconParent.querySelector('.mie-queue-title').outerHTML + '<div class="mie-queue-meta">' + statusText + '</div>';
                            }
                        }
                        // 更新 meta 文字
                        var metaEl = item.querySelector('.mie-queue-meta');
                        if (metaEl) metaEl.textContent = statusText;
                        // 更新进度条
                        var fillEl = item.querySelector('.mie-queue-progress-fill');
                        if (fillEl) fillEl.style.width = pct + '%';
                        // 更新计数
                        var footerSpan = item.querySelector('.mie-queue-footer span');
                        if (footerSpan) footerSpan.textContent = '成功 ' + doneCount + ' / ' + task.total + ' 个视频';

                        // 状态变化时更新按钮（确保展开按钮存在）
                        var actionsDiv = item.querySelector('.mie-queue-actions');
                        if (actionsDiv) {
                            var expandBtn = actionsDiv.querySelector('[data-action="toggle-expand"]');
                            var expandHtml = expandBtn ? expandBtn.outerHTML : '<button class="mie-queue-btn mie-expand-btn" data-action="toggle-expand" title="查看详情">▼ 详情</button>';
                            var hasSkip = !!actionsDiv.querySelector('[data-action="skip-task"]');
                            var hasRetry = !!actionsDiv.querySelector('[data-action="retry-failed"]');
                            var expectedHtml = '';
                            if (task.status === 'completed') {
                                // 已完成：有失败显示重试，否则只显示删除
                                var retryHtml = (task.failCount > 0) ? '<button class="mie-queue-btn mie-retry-btn" data-action="retry-failed" title="重新下载失败的视频">🔄 重试</button>' : '';
                                expectedHtml = expandHtml + retryHtml + '<button class="mie-queue-btn danger" data-action="remove-task">删除</button>';
                                if (hasSkip || (task.failCount > 0 && !hasRetry) || (task.failCount === 0 && hasRetry)) {
                                    actionsDiv.innerHTML = expectedHtml;
                                    bindQueueEvents(queueList);
                                }
                            } else {
                                // 未完成：显示跳过+移除
                                expectedHtml = expandHtml + '<button class="mie-queue-btn" data-action="skip-task" title="跳过未完成的，标记为已完成">跳过</button><button class="mie-queue-btn danger" data-action="remove-task">移除</button>';
                                if (!hasSkip) {
                                    actionsDiv.innerHTML = expectedHtml;
                                    bindQueueEvents(queueList);
                                }
                            }
                        }

                        // 增量更新展开的详情：单个视频进度条
                        var detailsEl = item.querySelector('.mie-queue-details');
                        if (detailsEl && detailsEl.style.display !== 'none' && task.items) {
                            var videoItems = detailsEl.querySelectorAll('.mie-video-progress-item');
                            for (var vi = 0; vi < videoItems.length; vi++) {
                                var vItem = videoItems[vi];
                                var vIdx = parseInt(vItem.getAttribute('data-index'));
                                if (isNaN(vIdx) || !task.items[vIdx]) continue;
                                var vData = task.items[vIdx];
                                var vStatus = vData.status || 'waiting';
                                // 更新状态文字
                                var vStatusEl = vItem.querySelector('.mie-video-progress-status');
                                var vStatusText = '';
                                var vStatusClass = '';
                                if (vStatus === 'success') {
                                    vStatusText = '✓ 完成';
                                    vStatusClass = 'v-success';
                                } else if (vStatus === 'failed') {
                                    vStatusText = '✗ ' + (vData.error || '失败');
                                    vStatusClass = 'v-failed';
                                } else if (vStatus === 'downloading') {
                                    vStatusText = '下载中';
                                    vStatusClass = 'v-downloading';
                                } else {
                                    vStatusText = '等待中';
                                    vStatusClass = 'v-waiting';
                                }
                                if (vStatusEl) {
                                    vStatusEl.textContent = vStatusText;
                                    vStatusEl.className = 'mie-video-progress-status ' + vStatusClass;
                                }
                                // 更新行class
                                vItem.className = 'mie-video-progress-item status-' + vStatus;
                                // 更新进度条（所有视频都有进度条元素）
                                var vFill = vItem.querySelector('.mie-video-progress-fill');
                                var vBytesEl = vItem.querySelector('.mie-video-progress-bytes');
                                if (vData.totalSize && vData.totalSize > 0) {
                                    var vDl = vData.downloadedSize || 0;
                                    var vTot = vData.totalSize;
                                    var vPct = Math.round((vDl / vTot) * 100);
                                    if (vFill) vFill.style.width = vPct + '%';
                                    if (vBytesEl) {
                                        var vDlStr = (vDl / 1048576).toFixed(1);
                                        var vTotStr = (vTot / 1048576).toFixed(1);
                                        vBytesEl.textContent = vDlStr + ' / ' + vTotStr + ' MB';
                                    }
                                } else {
                                    // 没有总大小，进度条0%，显示"等待中"
                                    if (vFill) vFill.style.width = '0%';
                                    if (vBytesEl) vBytesEl.textContent = '等待中';
                                }
                            }
                        }
                    });
                    return;
                }

                fullRenderQueue();
            }

            function bindQueueEvents(queueList) {
                queueList.querySelectorAll('[data-action="remove-task"]').forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        var item = this.closest('.mie-queue-item');
                        if (item) {
                            var taskId = item.getAttribute('data-task-id');
                            DownloadQueue.removeTask(taskId);
                        }
                    };
                });
                queueList.querySelectorAll('[data-action="skip-task"]').forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        var item = this.closest('.mie-queue-item');
                        if (item) {
                            var taskId = item.getAttribute('data-task-id');
                            showSkipConfirm(taskId, item);
                        }
                    };
                });
                // 展开/收起详情
                queueList.querySelectorAll('[data-action="toggle-expand"]').forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        var item = this.closest('.mie-queue-item');
                        if (item) {
                            var details = item.querySelector('.mie-queue-details');
                            if (details) {
                                if (details.style.display === 'none') {
                                    details.style.display = 'block';
                                    this.textContent = '▲ 收起';
                                    // 展开时强制刷新一次详情数据（确保状态准确）
                                    renderQueue();
                                } else {
                                    details.style.display = 'none';
                                    this.textContent = '▼ 详情';
                                }
                            }
                        }
                    };
                });
                // 重试失败视频
                queueList.querySelectorAll('[data-action="retry-failed"]').forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        var item = this.closest('.mie-queue-item');
                        if (item) {
                            var taskId = item.getAttribute('data-task-id');
                            DownloadQueue.retryFailed(taskId);
                            showToast('已重新加入下载队列');
                        }
                    };
                });
                var clearBtn = document.getElementById('mie-clear-completed');
                if (clearBtn) {
                    clearBtn.onclick = function() {
                        DownloadQueue.clearCompleted();
                    };
                }
                var changeDirBtn = document.getElementById('mie-change-dir');
                if (changeDirBtn) {
                    changeDirBtn.onclick = async function() {
                        DownloadQueue.clearCachedDir();
                        await DownloadQueue.requestDirHandle();
                        showToast('保存目录已更换');
                        renderQueue();
                    };
                }
                var resumeDirBtn = document.getElementById('mie-resume-dir-btn');
                if (resumeDirBtn) {
                    resumeDirBtn.onclick = async function() {
                        await DownloadQueue.resumeWithDir();
                        showToast('已切换到指定目录下载');
                        renderQueue();
                    };
                }
            }

            function showSkipConfirm(taskId, item) {
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.4);z-index:99999999;backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:mie-fadeIn 0.2s ease';
                overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:28px 32px;max-width:340px;text-align:center;box-shadow:0 24px 70px rgba(15,23,42,0.18);font-family:Inter,sans-serif">' +
                    '<div style="width:48px;height:48px;margin:0 auto 16px;background:#fef3c7;border-radius:50%;display:flex;align-items:center;justify-content:center">' +
                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                    '</div>' +
                    '<h3 style="font-size:16px;color:#0f172a;margin:0 0 8px;font-weight:700">确认跳过？</h3>' +
                    '<p style="font-size:13px;color:#64748b;margin:0 0 20px;line-height:1.5">未完成的视频将标记为失败，任务标记为已完成。</p>' +
                    '<div style="display:flex;gap:8px;justify-content:center">' +
                    '<button id="mie-skip-cancel" style="padding:9px 20px;border:1px solid #e2e8f0;background:#fff;color:#64748b;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">取消</button>' +
                    '<button id="mie-skip-ok" style="padding:9px 20px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">确认跳过</button>' +
                    '</div></div>';
                document.body.appendChild(overlay);
                overlay.querySelector('#mie-skip-cancel').onclick = function() { overlay.remove(); };
                overlay.querySelector('#mie-skip-ok').onclick = function() {
                    overlay.remove();
                    DownloadQueue.skipTask(taskId);
                };
                overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
            }

            function fullRenderQueue() {
                var q = DownloadQueue.getQueue();
                var queueList = document.getElementById('mie-queue-list');
                if (!queueList) return;

                var scrollTop = queueList.scrollTop;

                var html = '';
                var hasPausedOrPending = q.tasks.some(function(t) { return t.status === 'downloading' || t.status === 'queued' || t.status === 'paused'; });
                if (hasPausedOrPending && !DownloadQueue.hasCachedDir()) {
                    var hasPaused = q.tasks.some(function(t) { return t.status === 'paused'; });
                    var bannerTitle = hasPaused ? '下载已暂停，等待选择保存目录' : '检测到未完成的下载';
                    var bannerDesc = hasPaused ? '点击右侧按钮选择保存位置，继续下载到指定文件夹' : '选择目录后下载到指定文件夹（自动创建剧名子目录）';
                    html += '<div class="mie-resume-banner" id="mie-resume-banner">';
                    html += '<div class="mie-resume-icon">' + (hasPaused ? '⏸' : '⚡') + '</div>';
                    html += '<div class="mie-resume-text"><strong>' + bannerTitle + '</strong><br>' + bannerDesc + '</div>';
                    html += '<button class="mie-resume-btn" id="mie-resume-dir-btn">' + (hasPaused ? '选择目录继续' : '选择保存目录') + '</button>';
                    html += '</div>';
                }
                html += '<div class="mie-queue-clear-bar" style="justify-content:space-between"><button class="mie-queue-btn" id="mie-change-dir">📁 更换保存目录</button><button class="mie-queue-btn" id="mie-clear-completed">清除已完成</button></div>';
                var sortedTasks = q.tasks.slice().reverse();
                sortedTasks.forEach(function(task) {
                    var doneCount = task.successCount;
                    var pct = task.total > 0 ? Math.round((doneCount / task.total) * 100) : 0;
                    var statusText = '';
                    var statusClass = '';
                    var iconSvg = '';
                    var bytesText = '';
                    if (task._totalBytes && task._totalBytes > 0) {
                        var dl = task._downloadedBytes || 0;
                        var tot = task._totalBytes;
                        var dlStr = dl < 1048576 ? (dl / 1024).toFixed(0) + ' KB' : (dl / 1048576).toFixed(1) + ' MB';
                        var totStr = tot < 1048576 ? (tot / 1024).toFixed(0) + ' KB' : (tot / 1048576).toFixed(1) + ' MB';
                        bytesText = ' | ' + dlStr + ' / ' + totStr;
                    }
                    if (task.status === 'downloading') {
                        var speedText = task._speed ? ' (' + task._speed + ' MB/s)' : '';
                        statusText = '下载中' + speedText + bytesText;
                        statusClass = 'downloading';
                        iconSvg = '<svg class="mie-queue-status-icon status-downloading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
                    } else if (task.status === 'queued') {
                        statusText = '等待中';
                        statusClass = 'queued';
                        iconSvg = '<svg class="mie-queue-status-icon status-queued" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
                    } else if (task.status === 'paused') {
                        statusText = '已暂停（点击选择目录继续）';
                        statusClass = 'paused';
                        iconSvg = '<svg class="mie-queue-status-icon status-paused" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                    } else {
                        statusText = task.failCount > 0 ? ('成功' + task.successCount + '/失败' + task.failCount) : '全部完成';
                        statusClass = 'completed';
                        iconSvg = '<svg class="mie-queue-status-icon status-completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
                    }

                    var expandId = 'mie-expand-' + task.id;

                    html += '<div class="mie-queue-item status-' + statusClass + '" data-task-id="' + task.id + '">';
                    html += '<div class="mie-queue-header">';
                    html += iconSvg;
                    html += '<div class="mie-queue-title">' + task.dramaName + '</div>';
                    html += '<div class="mie-queue-meta">' + statusText + '</div>';
                    html += '</div>';
                    html += '<div class="mie-queue-progress-bar"><div class="mie-queue-progress-fill" style="width:' + pct + '%"></div></div>';
                    html += '<div class="mie-queue-footer">';
                    html += '<span>成功 ' + doneCount + ' / ' + task.total + ' 个视频</span>';
                    html += '<div class="mie-queue-actions">';
                    // 展开按钮
                    html += '<button class="mie-queue-btn mie-expand-btn" data-action="toggle-expand" title="查看详情">▼ 详情</button>';
                    if (task.status !== 'completed') {
                        html += '<button class="mie-queue-btn" data-action="skip-task" title="跳过未完成的，标记为已完成">跳过</button>';
                        html += '<button class="mie-queue-btn danger" data-action="remove-task">移除</button>';
                    } else {
                        // 已完成且有失败的，显示重试按钮
                        if (task.failCount > 0) {
                            html += '<button class="mie-queue-btn mie-retry-btn" data-action="retry-failed" title="重新下载失败的视频">🔄 重试</button>';
                        }
                        html += '<button class="mie-queue-btn danger" data-action="remove-task">删除</button>';
                    }
                    html += '</div></div>';

                    // 展开详情区
                    html += '<div class="mie-queue-details" id="' + expandId + '" style="display:none">';

                    // 每个视频的进度列表（只在下载中或完成后显示）
                    if (task.items && task.items.length > 0) {
                        html += '<div class="mie-queue-detail-title">视频进度（' + task.items.length + '）</div>';
                        html += '<div class="mie-video-progress-list">';
                        for (var vi = 0; vi < task.items.length; vi++) {
                            var it = task.items[vi];
                            var vStatus = it.status || 'waiting';
                            var vStatusText = '';
                            var vStatusClass = '';
                            if (vStatus === 'success') {
                                vStatusText = '✓ 完成';
                                vStatusClass = 'v-success';
                            } else if (vStatus === 'failed') {
                                vStatusText = '✗ ' + (it.error || '失败');
                                vStatusClass = 'v-failed';
                            } else if (vStatus === 'downloading') {
                                vStatusText = '下载中';
                                vStatusClass = 'v-downloading';
                            } else {
                                vStatusText = '等待中';
                                vStatusClass = 'v-waiting';
                            }

                            var vPct = 0;
                            var vBytesText = '';
                            var hasSize = it.totalSize && it.totalSize > 0;
                            if (hasSize) {
                                var vDl = it.downloadedSize || 0;
                                vPct = Math.round((vDl / it.totalSize) * 100);
                                vBytesText = (vDl / 1048576).toFixed(1) + ' / ' + (it.totalSize / 1048576).toFixed(1) + ' MB';
                            }

                            var vName = (it.name || it.id || '视频' + (vi + 1));
                            if (vName.length > 20) vName = vName.substring(0, 18) + '...';

                            html += '<div class="mie-video-progress-item status-' + vStatus + '" data-index="' + vi + '">';
                            html += '<div class="mie-video-progress-header">';
                            html += '<span class="mie-video-progress-name" title="' + (it.name || it.id || '') + '">' + vName + '</span>';
                            html += '<span class="mie-video-progress-status ' + vStatusClass + '">' + vStatusText + '</span>';
                            html += '</div>';
                            // 所有视频都显示进度条（等待中的显示0%占位）
                            html += '<div class="mie-video-progress-bar"><div class="mie-video-progress-fill" style="width:' + vPct + '%"></div></div>';
                            if (hasSize) {
                                html += '<div class="mie-video-progress-bytes">' + vBytesText + '</div>';
                            } else {
                                html += '<div class="mie-video-progress-bytes">等待中</div>';
                            }
                            html += '</div>';
                        }
                        html += '</div>';
                    }

                    // 失败视频列表
                    if (task.status === 'completed' && task.failCount > 0 && task.items) {
                        var failedItems = task.items.filter(function(it) { return it.status === 'failed'; });
                        if (failedItems.length > 0) {
                            html += '<div class="mie-queue-failed-list">';
                            html += '<div class="mie-queue-failed-title">失败视频（' + failedItems.length + '）</div>';
                            failedItems.forEach(function(fi) {
                                html += '<div class="mie-queue-failed-item"><span class="mie-queue-failed-name">' + (fi.name || fi.id || '未知') + '</span><span class="mie-queue-failed-reason">' + (fi.error || '未知错误') + '</span></div>';
                            });
                            html += '</div>';
                        }
                    }

                    html += '</div>'; // end of details

                    html += '</div>';
                });

                queueList.innerHTML = html;
                queueList.scrollTop = scrollTop;
                bindQueueEvents(queueList);
            }

            // 订阅队列变化
            DownloadQueue.subscribe(function(q) {
                // 如果队列 tab 可见，刷新渲染
                var queueTab = panel.querySelector('.mie-tab[data-tab="queue"]');
                if (queueTab && queueTab.classList.contains('mie-tab-active')) {
                    renderQueue(q);
                }
                // 更新 badge
                var badge = document.getElementById('mie-queue-badge');
                if (badge) {
                    var activeCount = q.tasks.filter(function(t) { return t.status === 'downloading' || t.status === 'queued' || t.status === 'paused'; }).length;
                    badge.textContent = q.tasks.length;
                    badge.classList.toggle('has-active', activeCount > 0);
                }
            });

            // 全选/取消全选
            var selectAllCb = document.getElementById('mie-select-all');
            var rowCheckboxes = panel.querySelectorAll('.mie-row-checkbox');
            function updateDownloadCount() {
                var checkedCount = panel.querySelectorAll('.mie-row-checkbox:checked').length;
                var countEl = document.getElementById('mie-download-count');
                if (countEl) {
                    countEl.textContent = '下载选中(' + checkedCount + ')';
                }
            }
            if (selectAllCb) {
                selectAllCb.onchange = function() {
                    var checked = this.checked;
                    rowCheckboxes.forEach(function(cb) { cb.checked = checked; });
                    updateDownloadCount();
                };
            }
            rowCheckboxes.forEach(function(cb) {
                cb.onchange = function() {
                    var totalCount = rowCheckboxes.length;
                    var checkedCount = panel.querySelectorAll('.mie-row-checkbox:checked').length;
                    if (selectAllCb) {
                        selectAllCb.checked = checkedCount === totalCount;
                        selectAllCb.indeterminate = checkedCount > 0 && checkedCount < totalCount;
                    }
                    updateDownloadCount();
                };
            });
        }
    }

    function closePanel() {
        const panel = document.getElementById('mie-panel');
        const overlay = document.getElementById('mie-overlay');
        if (panel) {
            panel.style.transition = 'all 0.25s ease';
            panel.style.opacity = '0';
            panel.style.transform = 'translate(-50%, -48%) scale(0.95)';
            setTimeout(() => panel.remove(), 250);
        }
        if (overlay) {
            overlay.style.transition = 'opacity 0.25s ease';
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 250);
        }
    }

    function createButton() {
        if (document.getElementById('material-id-extractor-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'material-id-extractor-btn';
        btn.innerHTML = ICONS.fab;
        btn.title = '提取素材ID';
        btn.onclick = openPanel;
        document.body.appendChild(btn);
    }

    // ===================== 远程授权校验 ====================
    var SCRIPT_ID = 'material-id-extractor';
    console.log('%c[授权校验] v4.5.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');

    function showDisablePopup() {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:2px solid #e53935;border-radius:12px;padding:30px 40px 30px 40px;z-index:999999;font-family:sans-serif;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.2)';
        d.innerHTML = '<div id="__auth_close" style="position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.05);color:#999;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;line-height:1">\u00d7</div><h3 style="color:#e53935;margin:0 0 10px;padding-right:24px">脚本已停用</h3><p style="color:#666;margin:0">此脚本已被管理员远程停用</p>';
        document.body.appendChild(d);
        var closeBtn = d.querySelector('#__auth_close');
        closeBtn.addEventListener('click', function() { d.remove(); });
        closeBtn.addEventListener('mouseover', function() { this.style.background = 'rgba(229,57,53,.12)'; this.style.color = '#e53935'; });
        closeBtn.addEventListener('mouseout', function() { this.style.background = 'rgba(0,0,0,.05)'; this.style.color = '#999'; });
    }

    function main() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createButton);
        } else {
            createButton();
        }

        var observer = new MutationObserver(function() {
            if (!document.getElementById('material-id-extractor-btn')) {
                createButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        console.log('[素材ID提取器 v4.8.2] 已加载');
    }

    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://raw.giteeusercontent.com/mlddr/script-toolkit-v2/raw/master/config.json?t=' + Date.now(),
        timeout: 10000,
        onload: function(response) {
            if (response.status === 200) {
                try {
                    var config = JSON.parse(response.responseText);
                    if (config[SCRIPT_ID] && config[SCRIPT_ID].enabled === false) {
                        console.log('%c[授权校验] 脚本已被停用', 'color:#e53935;font-weight:bold;font-size:14px');
                        showDisablePopup();
                    } else {
                        console.log('%c[授权校验] 已通过', 'color:#43a047;font-weight:bold');
                        main();
                    }
                } catch(e) {
                    console.log('%c[授权校验] 配置解析失败，放行', 'color:#ff9800;font-weight:bold');
                    main();
                }
            } else {
                console.log('%c[授权校验] 网络异常(status:' + response.status + ')，放行', 'color:#ff9800;font-weight:bold');
                main();
            }
        },
        onerror: function() {
            console.log('%c[授权校验] 网络错误，放行', 'color:#ff9800;font-weight:bold');
            main();
        },
        ontimeout: function() {
            console.log('%c[授权校验] 请求超时，放行', 'color:#ff9800;font-weight:bold');
            main();
        }
    });
})();
