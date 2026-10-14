// ==UserScript==
// @name         营销云·一站式API数据获取助手
// @name:zh-CN   营销云·一站式API数据获取助手
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      12.0.0
// @description  营销云一站式API全面数据获取：任务列表、任务详情、产品包、DPA产品、素材列表等。支持移动面板、展开/关闭、搜索筛选、JSON/Excel导出。
// @author       You
// @match        https://usergrowth.com.cn/onestop*
// @match        https://usergrowth.vm.cn/onestop*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      gitee.com
// @connect      raw.giteeusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      *
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E4%B8%80%E7%AB%99%E5%BC%8FAPI%E6%95%B0%E6%8D%AE%E8%8E%B7%E5%8F%96%E5%8A%A9%E6%89%8B.user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E4%B8%80%E7%AB%99%E5%BC%8FAPI%E6%95%B0%E6%8D%AE%E8%8E%B7%E5%8F%96%E5%8A%A9%E6%89%8B.user.js
// ==/UserScript==

(function() {

function main() {
    'use strict';

    const VERSION = '12.0.0';
    const SCRIPT_ID = 'yx-api-fetcher';

    // ==================== 授权校验 ====================
    const AUTH_API = 'https://gitee.com/mlddr/script-toolkit-v2/raw/master/config.json';
    const ENC_AUTH = 'aHR0cHM6Ly9naXRlZS5jb20vbWxkZHIvc2NyaXB0LXRvb2xraXQtdjIvcmF3L21hc3Rlci9jb25maWcuanNvbg==';
    const ENC_CHECK = '6L+Q57uE5oqX6ZmF6K+I6K+I572q';

    function _0xd(s) {
        try { return decodeURIComponent(escape(atob(s))); } catch(e) { return ''; }
    }

    async function checkAuth() {
        console.log('%c[授权校验] v12.0.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
        return new Promise((resolve) => {
            const _0x4f = _0xd(ENC_AUTH);
            const _0x5a = _0xd(ENC_CHECK);
            if (typeof GM_xmlhttpRequest !== 'function') {
                console.log('%c[授权校验] GM_xmlhttpRequest 不可用', 'color:#f44336');
                resolve({ authorized: false, message: '脚本环境异常，请使用 Tampermonkey 安装' });
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: _0x4f,
                headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
                timeout: 15000,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const sc = data[SCRIPT_ID];
                        if (sc && sc.enabled === false) {
                            console.log('%c[授权校验] 脚本已被远程停用', 'color:#f44336');
                            resolve({ authorized: false, message: sc.message || '该脚本已被远程停用，请联系作者获取授权' });
                            return;
                        }
                        console.log('%c[授权校验] 通过', 'color:#4caf50');
                        resolve({ authorized: true });
                    } catch (e) {
                        console.log('%c[授权校验] 解析失败: ' + e.message, 'color:#ff9800');
                        resolve({ authorized: false, message: '授权配置解析失败，请稍后重试' });
                    }
                },
                onerror: function() {
                    console.log('%c[授权校验] 网络请求失败', 'color:#f44336');
                    resolve({ authorized: false, message: '授权校验网络请求失败，请检查网络连接' });
                },
                ontimeout: function() {
                    console.log('%c[授权校验] 请求超时', 'color:#f44336');
                    resolve({ authorized: false, message: '授权校验请求超时，请检查网络连接' });
                }
            });
        });
    }

    checkAuth().then(auth => {
        if (!auth.authorized) {
            showAuthBlock(auth.message);
            return;
        }
        initApp();
    });

    function showAuthBlock(msg) {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:999999;display:flex;align-items:center;justify-content:center;';
        div.innerHTML = `<div style="background:#fff;padding:32px 40px;border-radius:16px;text-align:center;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.3);"><div style="font-size:48px;margin-bottom:12px;">🔒</div><div style="font-size:16px;font-weight:700;color:#333;margin-bottom:8px;">脚本已被远程停用</div><div style="font-size:13px;color:#666;line-height:1.6;">${msg}</div></div>`;
        document.body.appendChild(div);
    }

    // ==================== 应用初始化 ====================
    function initApp() {
        if (document.getElementById('yx-api-widget')) return;
        if (!document.body) { setTimeout(initApp, 500); return; }
        createPanel();
    }

    // ==================== 状态 ====================
    const State = {
        logs: [],
        isFetching: false,
        currentTab: 'tasks',
        data: {
            tasks: [],
            taskDetail: null,
            products: [],
            dpaProducts: [],
            materials: [],
        },
        filters: {
            taskSearch: '',
            taskStatus: 'all',
        }
    };

    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN');
        State.logs.push({ time, msg, type });
        if (State.logs.length > 200) State.logs.shift();
        updateLogUI();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getCsrfToken() {
        const m = document.cookie.match(/csrf_token=([^;]+)/);
        return m ? m[1] : '';
    }

    // ==================== API请求 ====================
    async function apiRequest(url, method, body = null, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const opts = {
                    method,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                };
                const csrf = getCsrfToken();
                if (csrf) opts.headers['x-secsdk-csrf-token'] = csrf;
                if (body) opts.body = JSON.stringify(body);

                const resp = await fetch(url, opts);
                const text = await resp.text();
                try {
                    const json = JSON.parse(text);
                    if (json.code === 0 || json.status_code === 0) return json;
                    const isRateLimit = (json.code === 10006 || json.code === 777 ||
                        (json.message && json.message.includes('访问速度过快')));
                    if (isRateLimit && attempt < retries) {
                        const delay = 3000 * attempt;
                        log(`访问速度过快，${delay / 1000}秒后重试 (${attempt}/${retries})`, 'warn');
                        await sleep(delay);
                        continue;
                    }
                    log(`API错误: ${json.message || json.msg || '未知'} (code:${json.code})`, 'warn');
                    return json;
                } catch(e) {
                    if (resp.status === 204 || resp.status === 200) return { code: 0, data: null, raw: text };
                    throw new Error(`解析失败: ${text.slice(0, 200)}`);
                }
            } catch (err) {
                if (attempt < retries) await sleep(2000);
                else throw err;
            }
        }
    }

    // ==================== 数据获取 ====================
    async function fetchAllTasks() {
        log('开始获取任务列表...', 'info');
        const urlParams = new URLSearchParams(location.search);
        const appId = urlParams.get('_app_id') || 796433;
        const allTasks = [];
        let page = 1;
        const pageSize = 50;

        while (page <= 20) {
            const resp = await apiRequest('/advertising/api/v1/auto_create/task/list', 'POST', {
                app_ids: [parseInt(appId)],
                page: page,
                page_size: pageSize,
                ad_platform: ['toutiao'],
            });
            const dr = resp.data || {};
            let tasks = [];
            if (Array.isArray(dr.data?.data)) tasks = dr.data.data;
            else if (Array.isArray(dr.data)) tasks = dr.data;
            else if (Array.isArray(dr.list)) tasks = dr.list;
            else if (Array.isArray(dr.data?.list)) tasks = dr.data.list;

            if (tasks.length === 0) break;
            allTasks.push(...tasks);
            log(`第${page}页获取 ${tasks.length} 条任务`, 'ok');
            if (tasks.length < pageSize) break;
            page++;
            await sleep(500);
        }

        State.data.tasks = allTasks.map(t => ({
            taskId: t.task_id || t.id,
            name: t.name || t.task_name || '未命名',
            status: t.status || t.task_status,
            owner: t.owner || (t.owners || []).join(', '),
            createTime: t.create_time,
            updateTime: t.update_time,
            adPlatform: t.ad_platform,
            subtaskCount: t.subtask_count || 0,
            raw: t,
        }));
        log(`任务列表获取完成，共 ${allTasks.length} 条`, 'ok');
        renderTaskTable();
    }

    async function fetchTaskDetail(taskId) {
        log(`获取任务详情: ${taskId}...`, 'info');
        const resp = await apiRequest('/advertising/api/v1/auto_create/task/get', 'POST', {
            task_id: taskId,
            subtask_detail: true,
        });
        const taskInfo = resp.data?.data?.create_task_info;
        State.data.taskDetail = {
            taskId: taskId,
            baseInfo: taskInfo?.base_info || {},
            subtasks: taskInfo?.subtasks || [],
            settings: taskInfo?.settings || {},
            raw: taskInfo,
        };
        log(`任务详情获取完成，子任务数: ${State.data.taskDetail.subtasks.length}`, 'ok');
        renderTaskDetail();
    }

    async function fetchProductList() {
        log('开始获取产品包列表...', 'info');
        const urlParams = new URLSearchParams(location.search);
        const appId = urlParams.get('_app_id') || 796433;
        const resp = await apiRequest('/advertising/api/v1/product_manage/pack_list', 'POST', {
            app_id: parseInt(appId),
            page: 1,
            page_size: 100,
        });
        const dr = resp.data || {};
        let products = [];
        if (Array.isArray(dr.data?.data)) products = dr.data.data;
        else if (Array.isArray(dr.data)) products = dr.data;
        else if (Array.isArray(dr.list)) products = dr.list;

        State.data.products = products.map(p => ({
            id: p.id || p.pack_id,
            name: p.name || p.pack_name,
            type: p.type || p.pack_type,
            status: p.status,
            createTime: p.create_time,
            updateTime: p.update_time,
            raw: p,
        }));
        log(`产品包获取完成，共 ${products.length} 条`, 'ok');
        renderProductTable();
    }

    async function fetchDpaProducts(productPlatformId) {
        if (!productPlatformId) {
            log('请输入产品平台ID', 'warn');
            return;
        }
        log(`获取DPA产品列表: ${productPlatformId}...`, 'info');
        const resp = await apiRequest('/advertising/api/v1/auto_create/dpa/list_product', 'POST', {
            product_platform_id: productPlatformId,
            page: 1,
            page_size: 100,
        });
        const dr = resp.data || {};
        let products = [];
        if (Array.isArray(dr.data?.data)) products = dr.data.data;
        else if (Array.isArray(dr.data)) products = dr.data;
        else if (Array.isArray(dr.list)) products = dr.list;

        State.data.dpaProducts = products.map(p => ({
            id: p.id || p.product_id,
            name: p.name || p.product_name,
            outerId: p.outer_id,
            status: p.status,
            raw: p,
        }));
        log(`DPA产品获取完成，共 ${products.length} 条`, 'ok');
        renderDpaTable();
    }

    async function fetchMaterialList(dramaId) {
        if (!dramaId) {
            log('请输入剧目ID', 'warn');
            return;
        }
        log(`获取素材列表: ${dramaId}...`, 'info');
        const resp = await apiRequest('/advertising/api/v1/auto_create/material/list_preview', 'POST', {
            book_id: dramaId,
            page: 1,
            page_size: 100,
        });
        const dr = resp.data || {};
        let materials = [];
        if (Array.isArray(dr.data?.data)) materials = dr.data.data;
        else if (Array.isArray(dr.data)) materials = dr.data;
        else if (Array.isArray(dr.list)) materials = dr.list;

        State.data.materials = materials.map(m => ({
            id: m.id || m.material_id,
            name: m.name || m.material_name,
            type: m.type || m.material_type,
            url: m.url || m.preview_url,
            status: m.status,
            raw: m,
        }));
        log(`素材获取完成，共 ${materials.length} 条`, 'ok');
        renderMaterialTable();
    }

    // ==================== UI渲染 ====================
    function updateLogUI() {
        const logEl = document.getElementById('yx-api-logs');
        if (!logEl) return;
        const colors = { info: '#5D4E37', ok: '#2E7D32', warn: '#F57C00', er: '#C62828' };
        logEl.innerHTML = State.logs.slice(-50).map(l =>
            `<div style="font-size:11px;line-height:1.5;color:${colors[l.type] || colors.info};border-bottom:1px solid rgba(0,0,0,0.03);padding:2px 0;"><span style="opacity:0.5;">[${l.time}]</span> ${l.msg}</div>`
        ).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    function switchTab(tab) {
        State.currentTab = tab;
        document.querySelectorAll('.yx-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.yx-tab-panel').forEach(panel => {
            panel.style.display = panel.dataset.panel === tab ? 'block' : 'none';
        });
    }

    function renderTaskTable() {
        const el = document.getElementById('yx-task-table');
        if (!el) return;
        const { tasks } = State.data;
        const { taskSearch, taskStatus } = State.filters;

        let filtered = tasks;
        if (taskSearch) {
            const s = taskSearch.toLowerCase();
            filtered = filtered.filter(t => (t.name || '').toLowerCase().includes(s) || (t.taskId || '').includes(s));
        }
        if (taskStatus !== 'all') {
            filtered = filtered.filter(t => String(t.status) === taskStatus);
        }

        if (filtered.length === 0) {
            el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据</div>';
            return;
        }

        let html = `<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">
            <thead><tr style="background:rgba(255,224,178,0.3);">
                <th style="padding:6px;text-align:left;">任务ID</th>
                <th style="padding:6px;text-align:left;">任务名称</th>
                <th style="padding:6px;text-align:left;">状态</th>
                <th style="padding:6px;text-align:left;">子任务</th>
                <th style="padding:6px;text-align:left;">操作</th>
            </tr></thead><tbody>`;

        filtered.forEach(t => {
            const statusMap = { '0': '待创建', '1': '创建中', '2': '已完成', '3': '失败', '4': '已暂停' };
            const statusColor = { '0': '#999', '1': '#F57C00', '2': '#2E7D32', '3': '#C62828', '4': '#666' };
            html += `<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">
                <td style="padding:6px;font-family:monospace;">${t.taskId || '-'}</td>
                <td style="padding:6px;">${t.name || '-'}</td>
                <td style="padding:6px;color:${statusColor[String(t.status)] || '#999'};">${statusMap[String(t.status)] || t.status}</td>
                <td style="padding:6px;">${t.subtaskCount || 0}</td>
                <td style="padding:6px;"><button class="yx-btn-small" data-action="detail" data-id="${t.taskId}">详情</button></td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        el.innerHTML = html;

        el.querySelectorAll('[data-action="detail"]').forEach(btn => {
            btn.addEventListener('click', () => fetchTaskDetail(btn.dataset.id));
        });
    }

    function renderTaskDetail() {
        const el = document.getElementById('yx-task-detail');
        if (!el) return;
        const detail = State.data.taskDetail;
        if (!detail) {
            el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">点击任务列表的"详情"按钮查看</div>';
            return;
        }
        el.innerHTML = `<div style="max-height:300px;overflow-y:auto;font-size:11px;">
            <div style="margin-bottom:8px;"><b>任务ID:</b> ${detail.taskId}</div>
            <div style="margin-bottom:8px;"><b>任务名称:</b> ${detail.baseInfo.name || '-'}</div>
            <div style="margin-bottom:8px;"><b>子任务数:</b> ${detail.subtasks.length}</div>
            <div style="margin-bottom:8px;"><b>创建人:</b> ${(detail.baseInfo.owners || []).join(', ') || '-'}</div>
            <div style="margin-bottom:8px;"><b>投放平台:</b> ${detail.baseInfo.ad_platform || '-'}</div>
            <div style="margin-bottom:8px;"><b>投放日期:</b> ${detail.baseInfo.start_date || '-'} ~ ${detail.baseInfo.end_date || '-'}</div>
            <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:8px 0;">
            <div style="font-weight:700;margin-bottom:4px;">子任务列表:</div>
            ${detail.subtasks.map((s, i) => `
                <div style="padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.03);">
                    <span style="opacity:0.5;">#${i+1}</span> ${s.name || s.subtask_name || '未命名'}
                    <span style="color:#999;">(${s.status || '-'})</span>
                </div>
            `).join('')}
        </div>`;
    }

    function renderProductTable() {
        const el = document.getElementById('yx-product-table');
        if (!el) return;
        const { products } = State.data;
        if (products.length === 0) {
            el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据，点击"获取产品包"按钮</div>';
            return;
        }
        let html = `<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">
            <thead><tr style="background:rgba(255,224,178,0.3);">
                <th style="padding:6px;text-align:left;">ID</th>
                <th style="padding:6px;text-align:left;">名称</th>
                <th style="padding:6px;text-align:left;">类型</th>
                <th style="padding:6px;text-align:left;">状态</th>
            </tr></thead><tbody>`;
        products.forEach(p => {
            html += `<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">
                <td style="padding:6px;font-family:monospace;">${p.id || '-'}</td>
                <td style="padding:6px;">${p.name || '-'}</td>
                <td style="padding:6px;">${p.type || '-'}</td>
                <td style="padding:6px;">${p.status || '-'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    function renderDpaTable() {
        const el = document.getElementById('yx-dpa-table');
        if (!el) return;
        const { dpaProducts } = State.data;
        if (dpaProducts.length === 0) {
            el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据，输入产品平台ID后点击"获取DPA产品"</div>';
            return;
        }
        let html = `<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">
            <thead><tr style="background:rgba(255,224,178,0.3);">
                <th style="padding:6px;text-align:left;">ID</th>
                <th style="padding:6px;text-align:left;">名称</th>
                <th style="padding:6px;text-align:left;">外部ID</th>
                <th style="padding:6px;text-align:left;">状态</th>
            </tr></thead><tbody>`;
        dpaProducts.forEach(p => {
            html += `<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">
                <td style="padding:6px;font-family:monospace;">${p.id || '-'}</td>
                <td style="padding:6px;">${p.name || '-'}</td>
                <td style="padding:6px;">${p.outerId || '-'}</td>
                <td style="padding:6px;">${p.status || '-'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    function renderMaterialTable() {
        const el = document.getElementById('yx-material-table');
        if (!el) return;
        const { materials } = State.data;
        if (materials.length === 0) {
            el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据，输入剧目ID后点击"获取素材"</div>';
            return;
        }
        let html = `<div style="max-height:300px;overflow-y:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">
            <thead><tr style="background:rgba(255,224,178,0.3);">
                <th style="padding:6px;text-align:left;">ID</th>
                <th style="padding:6px;text-align:left;">名称</th>
                <th style="padding:6px;text-align:left;">类型</th>
                <th style="padding:6px;text-align:left;">预览</th>
            </tr></thead><tbody>`;
        materials.forEach(m => {
            html += `<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">
                <td style="padding:6px;font-family:monospace;">${m.id || '-'}</td>
                <td style="padding:6px;">${m.name || '-'}</td>
                <td style="padding:6px;">${m.type || '-'}</td>
                <td style="padding:6px;">${m.url ? `<a href="${m.url}" target="_blank" style="color:#1976d2;">查看</a>` : '-'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    // ==================== 导出 ====================
    function exportJSON() {
        const data = {
            exportTime: new Date().toISOString(),
            tasks: State.data.tasks,
            taskDetail: State.data.taskDetail,
            products: State.data.products,
            dpaProducts: State.data.dpaProducts,
            materials: State.data.materials,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yx-api-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        log('JSON导出成功', 'ok');
    }

    function exportExcel() {
        if (typeof XLSX === 'undefined') {
            alert('Excel库未加载，请刷新页面后重试');
            return;
        }
        const wb = XLSX.utils.book_new();

        if (State.data.tasks.length > 0) {
            const ws1 = XLSX.utils.json_to_sheet(State.data.tasks.map(t => ({
                任务ID: t.taskId, 任务名称: t.name, 状态: t.status,
                负责人: t.owner, 创建时间: t.createTime, 子任务数: t.subtaskCount,
            })));
            XLSX.utils.book_append_sheet(wb, ws1, '任务列表');
        }

        if (State.data.products.length > 0) {
            const ws2 = XLSX.utils.json_to_sheet(State.data.products.map(p => ({
                ID: p.id, 名称: p.name, 类型: p.type, 状态: p.status,
            })));
            XLSX.utils.book_append_sheet(wb, ws2, '产品包');
        }

        if (State.data.dpaProducts.length > 0) {
            const ws3 = XLSX.utils.json_to_sheet(State.data.dpaProducts.map(p => ({
                ID: p.id, 名称: p.name, 外部ID: p.outerId, 状态: p.status,
            })));
            XLSX.utils.book_append_sheet(wb, ws3, 'DPA产品');
        }

        if (State.data.materials.length > 0) {
            const ws4 = XLSX.utils.json_to_sheet(State.data.materials.map(m => ({
                ID: m.id, 名称: m.name, 类型: m.type, 链接: m.url,
            })));
            XLSX.utils.book_append_sheet(wb, ws4, '素材');
        }

        XLSX.writeFile(wb, `yx-api-data-${Date.now()}.xlsx`);
        log('Excel导出成功', 'ok');
    }

    // ==================== 创建面板 ====================
    function createPanel() {
        const widget = document.createElement('div');
        widget.id = 'yx-api-widget';
        widget.innerHTML = `
        <style>
            #yx-api-widget {
                position: fixed; z-index: 99999;
                font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
                right: 24px; bottom: 24px;
            }
            #yx-api-fab {
                width: 52px; height: 52px; border-radius: 50%;
                background: linear-gradient(135deg, #C8E6C9 0%, #81C784 100%);
                box-shadow: 0 4px 20px rgba(129, 199, 132, 0.4), 0 2px 8px rgba(0,0,0,0.06);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                position: relative; user-select: none;
                border: 2px solid rgba(255,255,255,0.6);
            }
            #yx-api-fab:hover { transform: scale(1.12) rotate(8deg); box-shadow: 0 6px 28px rgba(129, 199, 132, 0.5); }
            #yx-api-fab:active { transform: scale(0.95); }
            #yx-api-fab .fab-icon { font-size: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15)); }

            #yx-api-panel {
                position: absolute; bottom: 64px; right: 0;
                width: 520px; max-height: 85vh;
                background: rgba(255, 253, 245, 0.97);
                border-radius: 24px;
                box-shadow: 0 12px 48px rgba(120, 160, 80, 0.12), 0 4px 16px rgba(0,0,0,0.04);
                border: 1px solid rgba(200, 230, 201, 0.4);
                backdrop-filter: blur(24px) saturate(1.3);
                font-size: 13px; color: #5D4E37;
                display: none; flex-direction: column; overflow: hidden;
                transform-origin: bottom right;
                animation: yxPanelPopIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            #yx-api-panel.open { display: flex; }
            @keyframes yxPanelPopIn {
                from { opacity: 0; transform: scale(0.85) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            #yx-api-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px;
                background: linear-gradient(135deg, #C8E6C9 0%, #81C784 100%);
                color: #fff; border-radius: 24px 24px 0 0;
                font-weight: 700; font-size: 14px; flex-shrink: 0;
                cursor: grab; user-select: none; text-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            #yx-api-header:active { cursor: grabbing; }
            #yx-api-close-btn {
                width: 28px; height: 28px; border-radius: 50%;
                background: rgba(255,255,255,0.25); border: none;
                color: #fff; font-size: 16px; cursor: pointer;
                display: flex; align-items: center; justify-content: center; transition: all 0.2s;
            }
            #yx-api-close-btn:hover { background: rgba(255,255,255,0.4); transform: rotate(90deg); }

            #yx-api-body { overflow-y: auto; padding: 16px; flex: 1; scrollbar-width: none; }
            #yx-api-body::-webkit-scrollbar { width: 0; display: none; }

            .yx-section {
                margin-bottom: 14px;
                background: rgba(255, 248, 235, 0.6);
                border-radius: 16px; padding: 12px;
                border: 1px solid rgba(200, 230, 201, 0.25);
            }
            .yx-label {
                font-size: 11px; color: #388E3C; margin-bottom: 6px;
                font-weight: 700; display: flex; align-items: center; gap: 4px; letter-spacing: 0.5px;
            }
            .yx-input {
                width: 100%; padding: 9px 12px;
                border: 1.5px solid rgba(200, 230, 201, 0.4);
                border-radius: 12px; font-size: 12px; color: #5D4E37;
                background: rgba(255,255,255,0.85); transition: all 0.25s ease;
                box-sizing: border-box; outline: none;
            }
            .yx-input:focus { border-color: #81C784; box-shadow: 0 0 0 3px rgba(129, 199, 132, 0.12); background: #fff; }
            .yx-input::placeholder { color: #BCAAA4; }

            .yx-btn {
                padding: 8px 16px; border-radius: 10px; border: none;
                font-size: 12px; font-weight: 600; cursor: pointer;
                transition: all 0.2s; color: #fff;
                background: linear-gradient(135deg, #81C784 0%, #66BB6A 100%);
                box-shadow: 0 2px 8px rgba(129, 199, 132, 0.3);
            }
            .yx-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(129, 199, 132, 0.4); }
            .yx-btn:active { transform: scale(0.96); }
            .yx-btn-small {
                padding: 4px 10px; border-radius: 8px; border: none;
                font-size: 11px; cursor: pointer; color: #fff;
                background: linear-gradient(135deg, #81C784 0%, #66BB6A 100%);
            }
            .yx-btn-secondary {
                background: linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 100%);
                color: #E65100;
                box-shadow: 0 2px 8px rgba(255, 183, 77, 0.2);
            }
            .yx-btn-secondary:hover { box-shadow: 0 4px 12px rgba(255, 183, 77, 0.3); }

            .yx-tabs {
                display: flex; gap: 4px; margin-bottom: 10px;
                background: rgba(200, 230, 201, 0.2); padding: 4px;
                border-radius: 12px;
            }
            .yx-tab-btn {
                flex: 1; padding: 6px 0; border: none; border-radius: 10px;
                font-size: 11px; font-weight: 600; cursor: pointer;
                background: transparent; color: #666; transition: all 0.2s;
            }
            .yx-tab-btn.active { background: #fff; color: #388E3C; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }

            .yx-tab-panel { display: none; }
            .yx-tab-panel.active { display: block; }

            .yx-row { display: flex; gap: 8px; align-items: center; }
            .yx-row > * { flex: 1; }

            .yx-logs {
                max-height: 120px; overflow-y: auto;
                background: rgba(0,0,0,0.02); border-radius: 10px;
                padding: 8px; font-family: 'SF Mono', monospace;
            }
        </style>

        <div id="yx-api-fab"><span class="fab-icon">📊</span></div>

        <div id="yx-api-panel">
            <div id="yx-api-header">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span>📊</span> 营销云一站式API数据获取助手 v${VERSION}
                </div>
                <button id="yx-api-close-btn">✕</button>
            </div>

            <div id="yx-api-body">
                <!-- Tab切换 -->
                <div class="yx-tabs">
                    <button class="yx-tab-btn active" data-tab="tasks">📋 任务列表</button>
                    <button class="yx-tab-btn" data-tab="detail">📄 任务详情</button>
                    <button class="yx-tab-btn" data-tab="products">📦 产品/素材</button>
                </div>

                <!-- 任务列表面板 -->
                <div class="yx-tab-panel active" data-panel="tasks">
                    <div class="yx-section">
                        <div class="yx-row" style="margin-bottom:8px;">
                            <input type="text" id="yx-task-search" class="yx-input" placeholder="搜索任务名称/ID..." style="flex:2;">
                            <select id="yx-task-status" class="yx-input" style="flex:1;">
                                <option value="all">全部状态</option>
                                <option value="0">待创建</option>
                                <option value="1">创建中</option>
                                <option value="2">已完成</option>
                                <option value="3">失败</option>
                                <option value="4">已暂停</option>
                            </select>
                        </div>
                        <div class="yx-row">
                            <button class="yx-btn" id="yx-fetch-tasks" style="flex:2;">获取任务列表</button>
                            <button class="yx-btn yx-btn-secondary" id="yx-export-json" style="flex:1;">导出JSON</button>
                            <button class="yx-btn yx-btn-secondary" id="yx-export-excel" style="flex:1;">导出Excel</button>
                        </div>
                    </div>
                    <div class="yx-section">
                        <div class="yx-label">任务列表 (${State.data.tasks.length}条)</div>
                        <div id="yx-task-table"><div style="text-align:center;color:#999;padding:20px;">点击"获取任务列表"加载数据</div></div>
                    </div>
                </div>

                <!-- 任务详情面板 -->
                <div class="yx-tab-panel" data-panel="detail">
                    <div class="yx-section">
                        <div class="yx-row">
                            <input type="text" id="yx-detail-taskid" class="yx-input" placeholder="输入任务ID..." value="">
                            <button class="yx-btn" id="yx-fetch-detail">获取详情</button>
                        </div>
                    </div>
                    <div class="yx-section">
                        <div class="yx-label">任务详情</div>
                        <div id="yx-task-detail"><div style="text-align:center;color:#999;padding:20px;">输入任务ID后点击获取</div></div>
                    </div>
                </div>

                <!-- 产品/素材面板 -->
                <div class="yx-tab-panel" data-panel="products">
                    <div class="yx-section">
                        <div class="yx-label">产品包</div>
                        <div class="yx-row">
                            <button class="yx-btn" id="yx-fetch-products" style="flex:1;">获取产品包列表</button>
                        </div>
                        <div id="yx-product-table" style="margin-top:8px;"><div style="text-align:center;color:#999;padding:12px;">暂无数据</div></div>
                    </div>
                    <div class="yx-section">
                        <div class="yx-label">DPA产品</div>
                        <div class="yx-row">
                            <input type="text" id="yx-dpa-platform" class="yx-input" placeholder="产品平台ID..." style="flex:2;">
                            <button class="yx-btn" id="yx-fetch-dpa" style="flex:1;">获取DPA产品</button>
                        </div>
                        <div id="yx-dpa-table" style="margin-top:8px;"><div style="text-align:center;color:#999;padding:12px;">暂无数据</div></div>
                    </div>
                    <div class="yx-section">
                        <div class="yx-label">素材列表</div>
                        <div class="yx-row">
                            <input type="text" id="yx-material-dramaid" class="yx-input" placeholder="剧目ID..." style="flex:2;">
                            <button class="yx-btn" id="yx-fetch-materials" style="flex:1;">获取素材</button>
                        </div>
                        <div id="yx-material-table" style="margin-top:8px;"><div style="text-align:center;color:#999;padding:12px;">暂无数据</div></div>
                    </div>
                </div>

                <!-- 日志 -->
                <div class="yx-section">
                    <div class="yx-label">运行日志</div>
                    <div class="yx-logs" id="yx-api-logs"><div style="color:#999;">等待操作...</div></div>
                </div>
            </div>
        </div>`;

        document.body.appendChild(widget);

        // 展开/关闭
        const fab = widget.querySelector('#yx-api-fab');
        const panel = widget.querySelector('#yx-api-panel');
        const closeBtn = widget.querySelector('#yx-api-close-btn');
        const header = widget.querySelector('#yx-api-header');

        function openPanel() { panel.classList.add('open'); }
        function closePanel() { panel.classList.remove('open'); }
        fab.addEventListener('click', openPanel);
        closeBtn.addEventListener('click', closePanel);

        // 拖动
        let isDragging = false, dragStartX = 0, dragStartY = 0, widgetStartX = 0, widgetStartY = 0;
        function getWidgetPos() {
            const r = widget.getBoundingClientRect();
            return { x: r.left, y: r.top };
        }
        function setWidgetPos(x, y) {
            widget.style.right = 'auto'; widget.style.bottom = 'auto';
            widget.style.left = x + 'px'; widget.style.top = y + 'px';
        }
        function onDragStart(e, target) {
            if (target === 'header' && e.target.closest('#yx-api-close-btn')) return;
            isDragging = true;
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            dragStartX = cx; dragStartY = cy;
            const pos = getWidgetPos();
            widgetStartX = pos.x; widgetStartY = pos.y;
            document.body.style.userSelect = 'none';
        }
        function onDragMove(e) {
            if (!isDragging) return;
            e.preventDefault();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            let nx = widgetStartX + (cx - dragStartX);
            let ny = widgetStartY + (cy - dragStartY);
            nx = Math.max(4, Math.min(nx, window.innerWidth - 60));
            ny = Math.max(4, Math.min(ny, window.innerHeight - 60));
            setWidgetPos(nx, ny);
        }
        function onDragEnd() { isDragging = false; document.body.style.userSelect = ''; }

        fab.addEventListener('mousedown', e => onDragStart(e, 'fab'));
        fab.addEventListener('touchstart', e => onDragStart(e, 'fab'), { passive: false });
        header.addEventListener('mousedown', e => onDragStart(e, 'header'));
        header.addEventListener('touchstart', e => onDragStart(e, 'header'), { passive: false });
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchend', onDragEnd);

        // Tab切换
        widget.querySelectorAll('.yx-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // 按钮事件
        widget.querySelector('#yx-fetch-tasks').addEventListener('click', fetchAllTasks);
        widget.querySelector('#yx-fetch-detail').addEventListener('click', () => {
            const taskId = document.getElementById('yx-detail-taskid').value.trim();
            if (taskId) fetchTaskDetail(taskId);
        });
        widget.querySelector('#yx-fetch-products').addEventListener('click', fetchProductList);
        widget.querySelector('#yx-fetch-dpa').addEventListener('click', () => {
            const pid = document.getElementById('yx-dpa-platform').value.trim();
            if (pid) fetchDpaProducts(pid);
        });
        widget.querySelector('#yx-fetch-materials').addEventListener('click', () => {
            const dramaId = document.getElementById('yx-material-dramaid').value.trim();
            if (dramaId) fetchMaterialList(dramaId);
        });
        widget.querySelector('#yx-export-json').addEventListener('click', exportJSON);
        widget.querySelector('#yx-export-excel').addEventListener('click', exportExcel);

        // 搜索/筛选
        widget.querySelector('#yx-task-search').addEventListener('input', (e) => {
            State.filters.taskSearch = e.target.value;
            renderTaskTable();
        });
        widget.querySelector('#yx-task-status').addEventListener('change', (e) => {
            State.filters.taskStatus = e.target.value;
            renderTaskTable();
        });

        log('面板已加载，点击获取按钮开始获取数据', 'ok');
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}

main();

})();
