// ==UserScript==
// @name         巨量引擎-批量上传短剧 V5.1 API直传优化版
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      5.3.0
// @description  【API直传+智能容错】自动修复起始解锁集为0的已下架剧、异常剧自动跳过、重复ID去重、失败ID汇总导出。支持5000个专辑ID，速度提升10倍+。
// @author       AutoScript
// @match        https://business.oceanengine.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=oceanengine.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      gitee.com
// @updateURL   https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E-%E6%89%B9%E9%87%8F%E4%B8%8A%E4%BC%A0%E7%9F%AD%E5%89%A7V5.1API%E7%9B%B4%E4%BC%A0%E4%BC%98%E5%8C%96%E7%89%88.user.js
// @downloadURL https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E-%E6%89%B9%E9%87%8F%E4%B8%8A%E4%BC%A0%E7%9F%AD%E5%89%A7V5.1API%E7%9B%B4%E4%BC%A0%E4%BC%98%E5%8C%96%E7%89%88.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        copyrightOwner: '番茄',
        storeType: 43,              // 短剧漫剧库
        mode: 1,                    // 创建模式
        batchSize: 10,              // 每次API调用最多商品数
        maxTotal: 5000,             // 最多支持专辑ID数量
        apiDelay: 500,              // API调用间隔 ms
        parallelLimit: 5,           // 并行获取短剧信息的并发数
        retryMax: 2,                // API失败重试次数
        retryDelay: 2000,           // 重试间隔 ms
        minStartPayPlaylet: 1,      // 【V5.1】起始解锁集最小值，低于此值自动修正（解决已下架剧startPayPlaylet=0问题）
        autoFixStartPay: true,      // 【V5.1】是否自动修复起始解锁集
    };

    // ==================== 状态管理 ====================
    let state = {
        ids: [],
        currentIndex: 0,
        isRunning: false,
        isPaused: false,
        ebpid: null,
        platformId: null,
        stats: { success: 0, fail: 0, skip: 0, fixed: 0 },
        failedIds: [],    // 【V5.1】记录失败的专辑ID及原因
        skippedIds: [],   // 【V5.1】记录跳过的专辑ID及原因
    };

    // ==================== 工具 ====================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function log(msg, type) {
        type = type || 'info';
        console.log('[短剧助手V5.1] ' + msg);
        const el = document.getElementById('v5-log');
        if (el) {
            const t = new Date().toLocaleTimeString();
            const color = type === 'ok' ? '#52c41a' : type === 'err' ? '#ff4d4f' : type === 'step' ? '#7c3aed' : type === 'warn' ? '#fa8c16' : type === 'wait' ? '#faad14' : type === 'api' ? '#00ffff' : type === 'fix' ? '#13c2c2' : '#888';
            el.innerHTML += `<div style="color:${color}">${t} ${msg}</div>`;
            el.scrollTop = el.scrollHeight;
        }
    }

    function setStatus(text, type) {
        const el = document.getElementById('v5-status');
        if (!el) return;
        el.textContent = text;
        const colors = { ok: '#52c41a', err: '#ff4d4f', run: '#7c3aed', wait: '#fa8c16' };
        el.style.color = colors[type] || '#666';
    }

    function setProgress(cur, total) {
        const bar = document.getElementById('v5-bar');
        if (bar) bar.style.width = (total > 0 ? cur / total * 100 : 0) + '%';
        const txt = document.getElementById('v5-progress-text');
        if (txt) txt.textContent = total > 0 ? cur + '/' + total : '';
    }

    // ==================== 上下文提取 ====================
    function installContextExtractor() {
        if (unsafeWindow.__v5ContextExtractor) return;
        unsafeWindow.__v5ContextExtractor = true;

        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            extractFromUrl(url);
            return origOpen.call(this, method, url, ...args);
        };

        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            extractFromUrl(url);
            return origFetch.apply(this, arguments);
        };

        log('上下文提取器已安装，正在自动检测ebpid和platformId…', 'api');
    }

    function extractFromUrl(url) {
        if (!url) return;
        try {
            if (!state.ebpid) {
                const m1 = url.match(/[?&]ebpid=(\d+)/);
                if (m1) {
                    state.ebpid = m1[1];
                    updateContextDisplay();
                    log('✓ 自动检测到ebpid：' + state.ebpid, 'api');
                }
            }
            if (!state.platformId) {
                const m2 = url.match(/[?&]platformId=(\d+)/);
                if (m2) {
                    state.platformId = m2[1];
                    updateContextDisplay();
                    log('✓ 自动检测到platformId：' + state.platformId, 'api');
                }
            }
        } catch (e) { }
    }

    function extractFromPage() {
        extractFromUrl(location.href);
        if (!state.ebpid) {
            const m = document.cookie.match(/ebpid[=:](\d+)/);
            if (m) {
                state.ebpid = m[1];
                log('✓ 从Cookie检测到ebpid：' + state.ebpid, 'api');
            }
        }
        if (!state.platformId) {
            const params = new URLSearchParams(location.search);
            const pid = params.get('platformId') || params.get('platform_id');
            if (pid) {
                state.platformId = pid;
                log('✓ 从页面URL检测到platformId：' + state.platformId, 'api');
            }
        }
        updateContextDisplay();
    }

    function updateContextDisplay() {
        const ebpidEl = document.getElementById('v5-ebpid');
        const pidEl = document.getElementById('v5-platformid');
        if (ebpidEl) {
            ebpidEl.textContent = state.ebpid || '未检测到';
            ebpidEl.style.color = state.ebpid ? '#52c41a' : '#ff4d4f';
        }
        if (pidEl) {
            pidEl.textContent = state.platformId || '未检测到';
            pidEl.style.color = state.platformId ? '#52c41a' : '#fa8c16';
        }
    }

    // ==================== API调用函数 ====================

    function getPlayletInfo(albumId) {
        return new Promise((resolve, reject) => {
            if (!state.ebpid) { reject(new Error('ebpid未检测到')); return; }
            const url = `/api/ebp/macro_asset/platform_dpa/profession/get_playlet_info?ebpid=${state.ebpid}&playletId=${albumId}`;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try {
                        const resp = JSON.parse(xhr.responseText);
                        if (resp.code === 0 && resp.data) resolve(resp.data);
                        else reject(new Error(`API错误: code=${resp.code}, msg=${resp.msg || '未知'}`));
                    } catch (e) { reject(new Error('解析失败: ' + e.message)); }
                } else { reject(new Error(`HTTP ${xhr.status}`)); }
            };
            xhr.onerror = () => reject(new Error('网络失败'));
            xhr.ontimeout = () => reject(new Error('请求超时'));
            xhr.timeout = 15000;
            xhr.send();
        });
    }

    function saveProducts(products) {
        return new Promise((resolve, reject) => {
            if (!state.ebpid) { reject(new Error('ebpid未检测到')); return; }
            if (!state.platformId) { reject(new Error('platformId未检测到')); return; }
            const url = `/api/ebp/macro_asset/platform_dpa/product/save?ebpid=${state.ebpid}`;
            const body = {
                platformId: state.platformId,
                storeType: CONFIG.storeType,
                mode: CONFIG.mode,
                dpaProducts: products,
                otherFields: [],
            };
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try {
                        const resp = JSON.parse(xhr.responseText);
                        if (resp.code === 0) resolve(resp.data);
                        else reject(new Error(`保存失败: code=${resp.code}, msg=${resp.msg || '未知'}`));
                    } catch (e) { reject(new Error('解析保存响应失败: ' + e.message)); }
                } else { reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`)); }
            };
            xhr.onerror = () => reject(new Error('网络失败'));
            xhr.ontimeout = () => reject(new Error('保存超时'));
            xhr.timeout = 30000;
            xhr.send(JSON.stringify(body));
        });
    }

    async function callWithRetry(fn, ...args) {
        for (let i = 0; i <= CONFIG.retryMax; i++) {
            try { return await fn(...args); }
            catch (err) {
                if (i < CONFIG.retryMax) {
                    log(`  ⚠ 第${i + 1}次失败：${err.message}，${CONFIG.retryDelay / 1000}秒后重试…`, 'warn');
                    await sleep(CONFIG.retryDelay);
                } else throw err;
            }
        }
    }

    async function batchGetPlayletInfo(albumIds) {
        const results = [];
        const queue = [...albumIds];
        while (queue.length > 0 && !state.isPaused) {
            const batch = queue.splice(0, CONFIG.parallelLimit);
            const promises = batch.map(async (id) => {
                try {
                    const info = await callWithRetry(getPlayletInfo, id);
                    return { albumId: id, success: true, data: info };
                } catch (err) {
                    return { albumId: id, success: false, error: err.message };
                }
            });
            const batchResults = await Promise.all(promises);
            results.push(...batchResults);
            if (queue.length > 0) await sleep(CONFIG.apiDelay);
        }
        return results;
    }

    // ==================== 【V5.1优化】商品数据构建 + 异常检测 ====================

    /**
     * 【V5.1新增】检测短剧信息是否有效
     * 返回 { valid: bool, reason: string, fixed: bool }
     */
    function validatePlayletInfo(albumId, info) {
        // 检测剧名
        if (!info.name || info.name.trim().length === 0) {
            return { valid: false, reason: '剧名为空（可能已下架或数据异常）', fixed: false };
        }
        // 检测图片
        if (!info.image || !info.image.url || info.image.url.trim().length === 0) {
            return { valid: false, reason: '图片为空（可能已下架）', fixed: false };
        }
        // 检测类目
        if (!info.category || !info.category.firstCategory || !info.category.firstCategory.id) {
            return { valid: false, reason: '类目信息缺失', fixed: false };
        }
        return { valid: true, reason: '', fixed: false };
    }

    /**
     * 【V5.1优化】构建商品数据，自动修复异常字段
     */
    function buildProduct(albumId, playletInfo) {
        const p = playletInfo;
        let fixed = false;
        const fixes = [];

        // ===== 修复1：起始解锁集为0时自动改为1 =====
        let startPayPlaylet = p.startPayPlaylet;
        if (CONFIG.autoFixStartPay) {
            const rawVal = parseInt(startPayPlaylet);
            if (isNaN(rawVal) || rawVal < CONFIG.minStartPayPlaylet) {
                startPayPlaylet = CONFIG.minStartPayPlaylet;
                fixed = true;
                fixes.push(`起始解锁集 ${rawVal}→${startPayPlaylet}`);
            }
        }

        // ===== 修复2：集数为0时设为空字符串（避免校验失败）=====
        let playletNum = p.playletNum;
        if (parseInt(playletNum) === 0 || playletNum === '0') {
            playletNum = '';
            fixes.push('集数0→空');
        }

        // ===== 修复3：时长为0时设为空字符串 =====
        let playletDuration = p.playletDuration;
        if (parseInt(playletDuration) === 0 || playletDuration === '0') {
            playletDuration = '';
            fixes.push('时长0→空');
        }

        if (fixed || fixes.length > 0) {
            state.stats.fixed++;
            log(`  🔧 [${albumId}] 已修复：${fixes.join('、')}`, 'fix');
        }

        return {
            profession: {
                adCarrier: JSON.stringify(['端原生组件', '安卓/IOS应用']),
                playletGender: String(p.playletGender || ''),
                hasPaidContent: JSON.stringify(['流量变现', '付费变现']),
                playletId: String(albumId),
                playletNum: String(playletNum || ''),
                playletDuration: String(playletDuration || ''),
                startPayPlaylet: String(startPayPlaylet),
                copyrightOwner: CONFIG.copyrightOwner,
            },
            category: p.category || {},
            images: [],
            videos: [],
            landingUrl: {
                targetUrl: '',
                targetUrlMobile: '',
                targetUrlAndroidApp: '',
                targetUrlIosApp: '',
            },
            name: p.name || '',
            image: p.image || { url: '' },
        };
    }

    // ==================== 【V5.1新增】导出失败/跳过ID ====================
    function exportFailedIds() {
        const hasData = state.failedIds.length > 0 || state.skippedIds.length > 0;
        if (!hasData) {
            log('没有失败/跳过的记录可导出', 'warn');
            return;
        }

        const exportObj = {
            exportTime: new Date().toISOString(),
            scriptVersion: 'V5.1',
            summary: {
                total: state.ids.length,
                success: state.stats.success,
                fail: state.stats.fail,
                skip: state.stats.skip,
                fixed: state.stats.fixed,
            },
            failedIds: state.failedIds,
            skippedIds: state.skippedIds,
        };

        const jsonStr = JSON.stringify(exportObj, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const fname = `failed_ids_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
        const a = document.createElement('a');
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(`✓ 已导出失败记录：${fname}（失败${state.failedIds.length}个，跳过${state.skippedIds.length}个）`, 'ok');
    }

    // ==================== API直传主流程 ====================
    async function startApiUpload() {
        const textarea = document.getElementById('v5-ids');
        const raw = textarea.value.trim();
        if (!raw) { setStatus('请输入专辑ID', 'err'); return; }

        let ids = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (ids.length === 0) { setStatus('专辑ID列表为空', 'err'); return; }

        // ===== 【V5.1】去重处理 =====
        const beforeDedup = ids.length;
        const seen = new Set();
        ids = ids.filter(id => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        if (ids.length < beforeDedup) {
            log(`🗑 去重：${beforeDedup} → ${ids.length}（删除${beforeDedup - ids.length}个重复ID）`, 'warn');
        }

        if (ids.length > CONFIG.maxTotal) { log('已截取前 ' + CONFIG.maxTotal + ' 个'); ids.length = CONFIG.maxTotal; }

        if (!state.ebpid) {
            log('✗ 未检测到ebpid！请先在页面上操作一下（如点击商品库列表）', 'err');
            setStatus('ebpid未就绪', 'err'); return;
        }
        if (!state.platformId) {
            log('✗ 未检测到platformId！请先进入"添加短剧漫剧"页面一次', 'err');
            setStatus('platformId未就绪', 'err'); return;
        }

        state.ids = ids;
        state.currentIndex = 0;
        state.isRunning = true;
        state.isPaused = false;
        state.stats = { success: 0, fail: 0, skip: 0, fixed: 0 };
        state.failedIds = [];
        state.skippedIds = [];

        const goBtn = document.getElementById('v5-go');
        goBtn.disabled = true;
        const exportBtn = document.getElementById('v5-export-fail');
        if (exportBtn) exportBtn.disabled = true;

        log(`🚀 V5.1 API直传模式启动`, 'step');
        log(`   ebpid: ${state.ebpid}`, 'api');
        log(`   platformId: ${state.platformId}`, 'api');
        log(`   共 ${ids.length} 个专辑ID，每批 ${CONFIG.batchSize} 个`, 'step');
        log(`   智能容错：起始解锁集<${CONFIG.minStartPayPlaylet}自动修正、异常剧自动跳过`, 'info');
        setStatus('API直传中…', 'run');
        setProgress(0, ids.length);

        const startTime = Date.now();

        while (state.currentIndex < ids.length && !state.isPaused) {
            const remaining = ids.length - state.currentIndex;
            const batchSize = Math.min(remaining, CONFIG.batchSize);
            const batchIds = ids.slice(state.currentIndex, state.currentIndex + batchSize);
            const batchNum = Math.floor(state.currentIndex / CONFIG.batchSize) + 1;

            log(`━━━ 批次 ${batchNum}：处理 ${batchIds.length} 个（${state.currentIndex + 1}-${state.currentIndex + batchIds.length}）━━━`, 'step');

            // 步骤1：并行获取短剧信息
            log(`  📡 并行获取 ${batchIds.length} 个短剧信息…`, 'api');
            const infos = await batchGetPlayletInfo(batchIds);

            // 步骤2：构建商品数据（含异常检测和自动修复）
            const products = [];
            for (const result of infos) {
                if (result.success) {
                    // ===== 【V5.1】验证短剧信息有效性 =====
                    const validation = validatePlayletInfo(result.albumId, result.data);
                    if (!validation.valid) {
                        log(`  ⏭ [${result.albumId}] 跳过：${validation.reason}`, 'warn');
                        state.stats.skip++;
                        state.skippedIds.push({ albumId: result.albumId, name: result.data.name || '', reason: validation.reason });
                        continue;
                    }

                    const product = buildProduct(result.albumId, result.data);
                    products.push(product);
                    log(`  ✓ [${result.albumId}] ${result.data.name}`, 'ok');
                } else {
                    log(`  ✗ [${result.albumId}] 获取失败：${result.error}`, 'err');
                    state.stats.fail++;
                    state.failedIds.push({ albumId: result.albumId, reason: '获取信息失败: ' + result.error, stage: 'getPlayletInfo' });
                }
            }

            if (products.length === 0) {
                log('  ⚠ 本批次无有效商品，跳过', 'warn');
                state.currentIndex += batchIds.length;
                setProgress(state.currentIndex, ids.length);
                continue;
            }

            // 步骤3：调用保存API
            log(`  💾 保存 ${products.length} 个商品…`, 'api');
            try {
                const savedIds = await callWithRetry(saveProducts, products);
                log(`  ✓ 保存成功！返回 ${Array.isArray(savedIds) ? savedIds.length : 1} 个商品ID`, 'ok');
                state.stats.success += products.length;
            } catch (err) {
                log(`  ✗ 批量保存失败：${err.message}`, 'err');
                log('  🔄 降级为逐个保存…', 'warn');

                // ===== 【V5.1】批量失败时逐个保存，记录每个失败ID =====
                for (const product of products) {
                    const aid = product.profession.playletId;
                    try {
                        await callWithRetry(saveProducts, [product]);
                        log(`  ✓ [${aid}] 单独保存成功`, 'ok');
                        state.stats.success++;
                    } catch (e) {
                        log(`  ✗ [${aid}] 单独保存失败：${e.message}`, 'err');
                        state.stats.fail++;
                        state.failedIds.push({ albumId: aid, name: product.name, reason: '保存失败: ' + e.message, stage: 'save' });
                    }
                    await sleep(CONFIG.apiDelay);
                }
            }

            state.currentIndex += batchIds.length;
            setProgress(state.currentIndex, ids.length);
            if (state.currentIndex < ids.length) await sleep(CONFIG.apiDelay);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const msg = state.isPaused
            ? `已暂停！成功${state.stats.success} 失败${state.stats.fail} 跳过${state.stats.skip} 修复${state.stats.fixed}`
            : `完成！成功${state.stats.success} 失败${state.stats.fail} 跳过${state.stats.skip} 修复${state.stats.fixed} 耗时${elapsed}s`;
        log('═══ ' + msg + ' ═══', state.isPaused ? 'err' : 'ok');
        setStatus(msg, state.isPaused ? 'err' : 'ok');
        setProgress(ids.length, ids.length);
        state.isRunning = false;
        goBtn.disabled = false;

        // 启用导出按钮（有失败/跳过记录时）
        if (exportBtn && (state.failedIds.length > 0 || state.skippedIds.length > 0)) {
            exportBtn.disabled = false;
            log(`💡 可点击"导出失败ID"查看失败/跳过的专辑ID详情`, 'info');
        }
    }

    // ==================== UI ====================
    function createUI() {
        if (document.getElementById('v5-root')) return;

        GM_addStyle(`
            @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;600;700&display=swap');

            #v5-root {
                position: fixed; top: 60px; right: 16px; width: 420px;
                font-family: "Rajdhani", "Microsoft YaHei", sans-serif;
                z-index: 999999; user-select: none;
                filter: drop-shadow(0 0 20px rgba(0,255,255,0.15)) drop-shadow(0 4px 30px rgba(0,0,0,0.4));
            }
            .v5-header {
                background: linear-gradient(180deg, #0a0e17 0%, #111827 50%, #0d1321 100%);
                padding: 14px 18px; border-radius: 4px 4px 0 0;
                display: flex; justify-content: space-between; align-items: center;
                cursor: move; border: 1px solid rgba(0,255,255,0.2);
                border-bottom: 1px solid rgba(0,255,255,0.4);
                position: relative; overflow: hidden;
            }
            .v5-header::before {
                content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(0,255,255,0.6), transparent);
                animation: scanline 3s linear infinite;
            }
            @keyframes scanline { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            .v5-header h3 {
                margin: 0; font-size: 15px; font-weight: 900;
                font-family: "Orbitron", "Microsoft YaHei", sans-serif;
                color: #00ffff; letter-spacing: 2px;
                text-shadow: 0 0 10px rgba(0,255,255,0.5), 0 0 20px rgba(0,255,255,0.2);
            }
            .v5-header .v5-min {
                background: none; border: 1px solid rgba(0,255,255,0.3);
                color: #00ffff; font-size: 16px; cursor: pointer;
                line-height: 1; padding: 2px 8px; border-radius: 2px; transition: all 0.2s;
            }
            .v5-header .v5-min:hover { background: rgba(0,255,255,0.1); box-shadow: 0 0 8px rgba(0,255,255,0.3); }

            .v5-body {
                background: linear-gradient(180deg, #0d1321 0%, #111827 100%);
                border: 1px solid rgba(0,255,255,0.15); border-top: none;
                border-radius: 0 0 4px 4px; padding: 16px; position: relative;
            }
            .v5-body::before {
                content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.015) 2px, rgba(0,255,255,0.015) 4px);
                pointer-events: none; border-radius: 0 0 4px 4px;
            }

            .v5-context {
                background: rgba(0,10,20,0.6); border: 1px solid rgba(0,255,255,0.1);
                border-radius: 2px; padding: 10px 12px; margin-bottom: 12px;
                display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                font-size: 11px; font-family: "Rajdhani", sans-serif;
            }
            .v5-ctx-item { display: flex; flex-direction: column; gap: 2px; }
            .v5-ctx-label { color: rgba(0,255,255,0.4); font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; }
            .v5-ctx-value { color: #00ffff; font-weight: 700; font-family: "Orbitron", monospace; font-size: 12px; word-break: break-all; }

            .v5-body label {
                display: flex; align-items: center; gap: 8px;
                font-size: 13px; font-weight: 700; color: #00e5ff;
                margin-bottom: 8px; letter-spacing: 1px; text-transform: uppercase;
                font-family: "Rajdhani", sans-serif;
            }
            .v5-label-line { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(0,255,255,0.4), transparent); margin-left: 8px; }
            .v5-body textarea {
                width: 100%; height: 120px; border: 1px solid rgba(0,255,255,0.25);
                border-radius: 2px; padding: 10px 12px; font-size: 12px; resize: vertical; box-sizing: border-box;
                font-family: "Consolas", "SF Mono", "Courier New", monospace;
                color: #00ffcc; background: rgba(0,10,20,0.6); transition: all 0.2s;
            }
            .v5-body textarea:focus {
                outline: none; border-color: rgba(0,255,255,0.6);
                box-shadow: 0 0 12px rgba(0,255,255,0.15), inset 0 0 20px rgba(0,255,255,0.03);
            }
            .v5-body textarea::placeholder { color: rgba(0,255,255,0.25); }
            .v5-info {
                font-size: 11px; color: rgba(0,255,255,0.4); margin-top: 6px;
                display: flex; justify-content: space-between; align-items: center;
                font-family: "Rajdhani", sans-serif; letter-spacing: 0.5px;
            }
            .v5-info .v5-count-val { color: #00ffff; font-weight: 700; font-family: "Orbitron", monospace; text-shadow: 0 0 6px rgba(0,255,255,0.4); }
            .v5-info .v5-clear-ids-btn {
                color: #ff4081; font-size: 11px; cursor: pointer;
                border: 1px solid rgba(255,64,129,0.3); padding: 1px 8px; border-radius: 2px;
                background: transparent; transition: all 0.2s;
                font-family: "Rajdhani", sans-serif; letter-spacing: 0.5px;
            }
            .v5-info .v5-clear-ids-btn:hover { background: rgba(255,64,129,0.15); box-shadow: 0 0 8px rgba(255,64,129,0.3); border-color: rgba(255,64,129,0.6); }

            .v5-btns { display: flex; gap: 8px; margin-top: 14px; }
            .v5-btn {
                flex: 1; padding: 10px 0; border-radius: 2px;
                font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.15s; letter-spacing: 1px; text-transform: uppercase;
                font-family: "Rajdhani", sans-serif; position: relative; overflow: hidden;
            }
            .v5-btn:active { transform: scale(0.97); }
            .v5-btn-go {
                background: linear-gradient(180deg, rgba(0,255,255,0.15), rgba(0,255,255,0.05));
                color: #00ffff; border: 1px solid rgba(0,255,255,0.4);
                text-shadow: 0 0 8px rgba(0,255,255,0.3);
            }
            .v5-btn-go::before {
                content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(0,255,255,0.1), transparent);
                animation: btn-glow 2s ease-in-out infinite;
            }
            @keyframes btn-glow { 0%,100% { left: -100%; } 50% { left: 100%; } }
            .v5-btn-go:hover { background: linear-gradient(180deg, rgba(0,255,255,0.25), rgba(0,255,255,0.1)); box-shadow: 0 0 20px rgba(0,255,255,0.2); }
            .v5-btn-go:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }
            .v5-btn-go:disabled::before { animation: none; }
            .v5-btn-stop { background: rgba(255,255,255,0.03); color: #ff9800; border: 1px solid rgba(255,152,0,0.3); }
            .v5-btn-stop:hover { background: rgba(255,152,0,0.1); box-shadow: 0 0 12px rgba(255,152,0,0.15); }
            .v5-btn-clear { background: rgba(255,255,255,0.03); color: #ff4081; border: 1px solid rgba(255,64,129,0.3); }
            .v5-btn-clear:hover { background: rgba(255,64,129,0.1); box-shadow: 0 0 12px rgba(255,64,129,0.15); }

            .v5-btn-export {
                background: rgba(250,140,22,0.05); color: #fa8c16;
                border: 1px solid rgba(250,140,22,0.25); padding: 5px 12px; border-radius: 2px;
                font-size: 11px; font-weight: 700; cursor: pointer;
                font-family: "Rajdhani", sans-serif; letter-spacing: 0.5px; transition: all 0.2s;
            }
            .v5-btn-export:hover { background: rgba(250,140,22,0.12); box-shadow: 0 0 8px rgba(250,140,22,0.2); }
            .v5-btn-export:disabled { opacity: 0.3; cursor: not-allowed; }

            .v5-status-row {
                margin-top: 12px; padding: 8px 12px; border-radius: 2px;
                background: rgba(0,10,20,0.5); border: 1px solid rgba(0,255,255,0.1);
                font-size: 12px; color: rgba(0,255,255,0.6);
                display: flex; justify-content: space-between; align-items: center;
                font-family: "Rajdhani", sans-serif; letter-spacing: 0.5px;
            }
            .v5-progress-track { flex: 1; height: 3px; background: rgba(0,255,255,0.08); border-radius: 2px; margin: 0 8px; overflow: hidden; position: relative; }
            .v5-progress-fill {
                height: 100%; width: 0%; border-radius: 2px;
                background: linear-gradient(90deg, #00ffff, #00e5ff, #00b8d4);
                transition: width 0.3s; box-shadow: 0 0 8px rgba(0,255,255,0.5); position: relative;
            }
            .v5-progress-fill::after {
                content: ''; position: absolute; right: 0; top: -1px; bottom: -1px; width: 6px;
                background: #00ffff; border-radius: 2px;
                box-shadow: 0 0 10px rgba(0,255,255,0.8), 0 0 20px rgba(0,255,255,0.4);
            }

            .v5-stats { margin-top: 8px; display: flex; gap: 8px; font-size: 11px; font-family: "Rajdhani", sans-serif; }
            .v5-stat { flex: 1; text-align: center; padding: 4px; border-radius: 2px; background: rgba(0,10,20,0.4); }
            .v5-stat-ok { color: #52c41a; border: 1px solid rgba(82,196,26,0.2); }
            .v5-stat-fail { color: #ff4d4f; border: 1px solid rgba(255,77,79,0.2); }
            .v5-stat-skip { color: #fa8c16; border: 1px solid rgba(250,140,22,0.2); }
            .v5-stat-fix { color: #13c2c2; border: 1px solid rgba(19,194,194,0.2); }
            .v5-stat-val { font-family: "Orbitron", monospace; font-weight: 900; font-size: 16px; }

            #v5-log {
                margin-top: 12px; max-height: 240px; overflow-y: auto;
                background: rgba(0,5,15,0.8); color: rgba(0,255,200,0.7);
                padding: 10px 12px; border-radius: 2px; border: 1px solid rgba(0,255,255,0.1);
                font-size: 11px; line-height: 1.8;
                font-family: "Consolas", "SF Mono", "Courier New", monospace;
                scrollbar-width: thin; scrollbar-color: rgba(0,255,255,0.2) transparent;
            }
            #v5-log::-webkit-scrollbar { width: 4px; }
            #v5-log::-webkit-scrollbar-thumb { background: rgba(0,255,255,0.2); border-radius: 2px; }
            #v5-log::-webkit-scrollbar-track { background: transparent; }
            #v5-root.minimized .v5-body { display: none; }
            #v5-root.minimized { width: 48px; height: 48px; }
            #v5-root.minimized .v5-header { border-radius: 50%; padding: 0; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
            #v5-root.minimized .v5-header h3 { display: none; }
            #v5-root.minimized .v5-header .v5-min { display: none; }
            #v5-root.minimized .v5-header::before { display: none; }
            #v5-root.minimized .v5-header::after { content: 'D'; font-size: 22px; font-weight: 900; font-family: "Orbitron", monospace; color: #00ffff; text-shadow: 0 0 8px rgba(0,255,255,0.6); }
            #v5-root.minimized { animation: ball-pulse 2s ease-in-out infinite; }
            @keyframes ball-pulse { 0%,100% { box-shadow: 0 0 15px rgba(0,255,255,0.3); } 50% { box-shadow: 0 0 25px rgba(0,255,255,0.5); } }
            .v5-badge {
                display: inline-block; background: rgba(0,255,255,0.1);
                border: 1px solid rgba(0,255,255,0.3); color: #00ffff;
                font-size: 9px; padding: 1px 6px; border-radius: 2px; margin-left: 8px;
                font-weight: 700; font-family: "Orbitron", monospace; letter-spacing: 1px;
                text-shadow: 0 0 6px rgba(0,255,255,0.4);
            }
            .v5-corner-tl, .v5-corner-tr, .v5-corner-bl, .v5-corner-br {
                position: absolute; width: 8px; height: 8px; border-color: rgba(0,255,255,0.3); border-style: solid;
            }
            .v5-corner-tl { top: -1px; left: -1px; border-width: 1px 0 0 1px; }
            .v5-corner-tr { top: -1px; right: -1px; border-width: 1px 1px 0 0; }
            .v5-corner-bl { bottom: -1px; left: -1px; border-width: 0 0 1px 1px; }
            .v5-corner-br { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; }
        `);

        const root = document.createElement('div');
        root.id = 'v5-root';
    root.className = 'minimized';
        root.innerHTML = `
            <div class="v5-header">
                <h3>DRAMA-API <span class="v5-badge">V5.1</span></h3>
                <button class="v5-min" id="v5-min-btn">−</button>
            </div>
            <div class="v5-body" style="position:relative">
                <span class="v5-corner-tl"></span><span class="v5-corner-tr"></span>
                <span class="v5-corner-bl"></span><span class="v5-corner-br"></span>

                <div class="v5-context">
                    <div class="v5-ctx-item">
                        <span class="v5-ctx-label">EBPID (自动检测)</span>
                        <span class="v5-ctx-value" id="v5-ebpid">未检测到</span>
                    </div>
                    <div class="v5-ctx-item">
                        <span class="v5-ctx-label">PLATFORM ID (自动检测)</span>
                        <span class="v5-ctx-value" id="v5-platformid">未检测到</span>
                    </div>
                </div>

                <label><span>[INPUT]</span> ALBUM ID <span class="v5-label-line"></span> MAX:5000</label>
                <textarea id="v5-ids" placeholder="PASTE ALBUM IDS HERE, ONE PER LINE...&#10;也可直接粘贴Excel表格（Tab分隔）...">${GM_getValue('v5_ids', '')}</textarea>
                <div class="v5-info">
                    <span>COUNT: <span class="v5-count-val" id="v5-count">0</span> / 5000</span>
                    <button class="v5-clear-ids-btn" id="v5-clear-ids">[CLEAR IDS]</button>
                </div>

                <div class="v5-btns">
                    <button class="v5-btn v5-btn-go" id="v5-go">▶ API START</button>
                    <button class="v5-btn v5-btn-stop" id="v5-stop">■ STOP</button>
                    <button class="v5-btn v5-btn-clear" id="v5-clear">CLR LOG</button>
                </div>

                <div class="v5-status-row">
                    <span id="v5-status" style="flex-shrink:0">STANDBY...</span>
                    <div class="v5-progress-track"><div class="v5-progress-fill" id="v5-bar"></div></div>
                    <span id="v5-progress-text" style="flex-shrink:0;min-width:36px;text-align:right;font-family:'Orbitron',monospace;font-size:11px"></span>
                </div>

                <div class="v5-stats">
                    <div class="v5-stat v5-stat-ok"><div>成功</div><div class="v5-stat-val" id="v5-stat-ok">0</div></div>
                    <div class="v5-stat v5-stat-fail"><div>失败</div><div class="v5-stat-val" id="v5-stat-fail">0</div></div>
                    <div class="v5-stat v5-stat-skip"><div>跳过</div><div class="v5-stat-val" id="v5-stat-skip">0</div></div>
                    <div class="v5-stat v5-stat-fix"><div>修复</div><div class="v5-stat-val" id="v5-stat-fix">0</div></div>
                </div>

                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button class="v5-btn-export" id="v5-export-fail" disabled style="flex:1;">⬇ 导出失败/跳过ID</button>
                </div>

                <div id="v5-log"></div>
            </div>
        `;

        document.body.appendChild(root);

        function updateStats() {
            document.getElementById('v5-stat-ok').textContent = state.stats.success;
            document.getElementById('v5-stat-fail').textContent = state.stats.fail;
            document.getElementById('v5-stat-skip').textContent = state.stats.skip;
            document.getElementById('v5-stat-fix').textContent = state.stats.fixed;
        }
        setInterval(updateStats, 500);

        const textarea = document.getElementById('v5-ids');
        textarea.addEventListener('input', function () { GM_setValue('v5_ids', this.value); updateCount(); });
        textarea.addEventListener('paste', function (e) {
            setTimeout(() => {
                const val = this.value;
                if (val.includes('\t')) {
                    const lines = val.split('\n');
                    const ids = lines.map(line => line.split('\t')[0].trim()).filter(s => s.length > 0);
                    this.value = ids.join('\n');
                    GM_setValue('v5_ids', this.value);
                    updateCount();
                    log('检测到Excel表格粘贴，已自动提取第一列（' + ids.length + ' 个ID）', 'ok');
                }
            }, 100);
        });

        function updateCount() {
            const count = textarea.value.split('\n').map(s => s.trim()).filter(s => s.length > 0).length;
            document.getElementById('v5-count').textContent = count;
        }
        updateCount();

        document.getElementById('v5-clear-ids').addEventListener('click', function () {
            textarea.value = ''; GM_setValue('v5_ids', ''); updateCount();
            log('专辑ID已清空', 'warn');
        });
        document.getElementById('v5-min-btn').addEventListener('click', function (e) {
            e.stopPropagation(); root.classList.toggle('minimized');
        });
        root.querySelector('.v5-header').addEventListener('click', function (e) {
            if (root.classList.contains('minimized')) {
                root.classList.remove('minimized');
            }
        });
        document.getElementById('v5-go').addEventListener('click', startApiUpload);
        document.getElementById('v5-stop').addEventListener('click', function () {
            state.isPaused = true; log('已手动停止', 'err'); setStatus('STOPPED', 'err');
        });
        document.getElementById('v5-clear').addEventListener('click', function () {
            const logEl = document.getElementById('v5-log');
            if (logEl) logEl.innerHTML = '';
        });
        document.getElementById('v5-export-fail').addEventListener('click', exportFailedIds);

        drag(root, root.querySelector('.v5-header'));
    }

    function drag(el, handle) {
        let dx, dy, ox, oy;
        handle.addEventListener('mousedown', function (e) {
            if (e.target.id === 'v5-min-btn') return;
            dx = e.clientX; dy = e.clientY;
            const r = el.getBoundingClientRect();
            ox = r.left; oy = r.top;
            const move = function (e2) { el.style.left = ox + e2.clientX - dx + 'px'; el.style.top = oy + e2.clientY - dy + 'px'; el.style.right = 'auto'; };
            const up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    // ==================== 初始化 ====================
    async function init() {
        await new Promise(r => document.readyState === 'complete' ? r() : window.addEventListener('load', r));
        await sleep(2500);

        const url = window.location.href;
        if (url.includes('business.oceanengine.com')) {
            installContextExtractor();
            createUI();
            extractFromPage();
            log('🌸 短剧API直传助手 V5.1 已加载', 'ok');
            log('V5.1优化：自动修复起始解锁集、异常剧跳过、去重、失败导出', 'info');
            if (!state.ebpid) log('⚠ ebpid未检测到，请在页面上操作一下', 'warn');
            if (!state.platformId) log('⚠ platformId未检测到，请进入"添加短剧漫剧"页面一次', 'warn');
        }
    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'jl-batch-upload';
    var _authPassed = false;
    console.log('%c[授权校验] v5.3.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
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
