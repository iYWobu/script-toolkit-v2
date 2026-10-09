// ==UserScript==
// @name         营销云·全域投放搭建助手
// @name:zh-CN   营销云·全域投放搭建助手
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      11.10.0
// @description  全域投放API批量搭建，支持Excel上传(剧名/剧目ID/短剧漫剧ID/iAA链接/IAP链接)，固定ROI系数，is_omni_delivery模式，自动继承源任务内容题材(漫剧/短剧)
// @author       You
// @match        https://usergrowth.com.cn/onestop/ad_create*
// @match        https://usergrowth.vm.cn/onestop/ad_create*
// @match        https://usergrowth.com.cn/onestop/ad/ad_create*
// @match        https://usergrowth.vm.cn/onestop/ad/ad_create*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @updateURL   https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E8%90%A5%E9%94%80%E4%BA%91-%E5%85%A8%E5%9F%9F%E6%8A%95%E6%94%BE%E6%90%AD%E5%BB%BA%E5%8A%A9%E6%89%8B.user.js
// @downloadURL https://raw.githubusercontent.com/iYWobu/script-toolkit-v2/main/%E8%90%A5%E9%94%80%E4%BA%91-%E5%85%A8%E5%9F%9F%E6%8A%95%E6%94%BE%E6%90%AD%E5%BB%BA%E5%8A%A9%E6%89%8B.user.js
// ==/UserScript==

(function() {

    function main() {
    'use strict';

    // ==================== 全局配置 ====================
    const CONFIG = {
        version: '11.9.0',
        defaultRoiCoefficient: '0.98',   // 全域投放：固定ROI系数（非区间）
        accountsPerGroup: 15,
        dramasPerGroup: 8,
        delayBetweenTasks: 1000,         // 任务间延迟（ms）
        delayBetweenDramas: 300,         // 剧目查询/素材检查间延迟（ms）
        maxRetries: 5,                   // 最大重试次数
        retryDelay: 2000,                // 普通错误重试延迟（ms）
        rateLimitDelays: [3000, 5000, 8000, 12000, 20000], // 10006限频递增退避（ms）
        UI_VALUES_KEY: 'omni_dba_v1_ui_values',
    };

    // ==================== 状态 ====================
    const State = {
        isRunning: false,
        isPaused: false,
        currentIndex: 0,
        currentGroup: 0,
        successCount: 0,
        skipCount: 0,
        failCount: 0,
        skippedDramas: [],
        data: {
            accounts: [],
            dramas: [],          // 每项: {name, dramaId, playletId, iaaLink, iapLink}
            roiCoefficient: CONFIG.defaultRoiCoefficient,
            execStartDate: formatDate(new Date()),
            execEndDate: formatDate(new Date()),
            productPlatformId: '',
            accountsPerGroup: CONFIG.accountsPerGroup,
            dramasPerGroup: CONFIG.dramasPerGroup,
            subtaskCount: 1,
        },
        logs: [],
        templateTaskInfo: null,
        sourceTaskId: null,
        appInfo: {},
        excelFileName: '',
    };

    // ==================== 工具函数 ====================
    function formatDate(d) {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function dateToTimestamp(dateStr) {
        const d = new Date(dateStr + 'T00:00:00+08:00');
        return Math.floor(d.getTime() / 1000);
    }

    function sleep(ms) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { clearInterval(checkInterval); resolve(); }, ms);
            const checkInterval = setInterval(() => {
                if (!State.isRunning) { clearTimeout(timer); clearInterval(checkInterval); reject(new Error('__STOP__')); }
            }, 300);
        });
    }

    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN');
        State.logs.push({ time, msg, type });
        if (State.logs.length > 500) State.logs.shift();
        updateStepUI();
    }

    function getAccountsPerGroup() { return State.data.accountsPerGroup || CONFIG.accountsPerGroup; }
    function getDramasPerGroup() { return State.data.dramasPerGroup || CONFIG.dramasPerGroup; }
    function getSubtaskCount() { return Math.min(10, Math.max(1, State.data.subtaskCount || 1)); }
    function randomDelay() { return Math.floor(Math.random() * 500 + 300); }
    function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
    function cleanId(s) { return String(s || '').replace(/\s+/g, ''); }

    // ==================== API 核心封装 ====================

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="x-secsdk-csrf-token"]');
        if (meta) return meta.content;
        const match = document.cookie.match(/x-secsdk-csrf-token=([^;]+)/);
        if (match) return match[1];
        return null;
    }

    async function apiRequest(url, method, body = null, retries = CONFIG.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            if (!State.isRunning) throw new Error('__STOP__');
            try {
                const opts = {
                    method,
                    headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
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

                    // 10006: 访问速度过快 / 777: 请求过于频繁 — 递增退避重试
                    const isRateLimit = (json.code === 10006 || json.code === 777 ||
                        (json.message && (json.message.includes('访问速度过快') || json.message.includes('请求过于频繁'))) ||
                        (json.msg && (json.msg.includes('访问速度过快') || json.msg.includes('请求过于频繁'))));
                    if (isRateLimit && attempt < retries) {
                        const delay = CONFIG.rateLimitDelays[Math.min(attempt - 1, CONFIG.rateLimitDelays.length - 1)];
                        log(`⚠️ 访问速度过快，${(delay / 1000).toFixed(0)}秒后重试 (${attempt}/${retries})`, 'warn');
                        await sleep(delay);
                        continue;
                    }

                    log(`API错误: ${json.message || json.msg || '未知'} (code:${json.code})`, 'warn');
                    if (attempt < retries) { await sleep(CONFIG.retryDelay); continue; }
                    return json;
                } catch(e) {
                    if (resp.status === 204 || resp.status === 200) return { code: 0, data: null, raw: text };
                    throw new Error(`解析失败: ${text.slice(0, 200)}`);
                }
            } catch (err) {
                if (err.message === '__STOP__') throw err;
                if (attempt < retries) await sleep(CONFIG.retryDelay);
                else throw err;
            }
        }
    }

    // 获取复制源任务ID
    async function fetchTaskList() {
        if (State.appInfo.sourceTaskId) return State.appInfo.sourceTaskId;

        const urlParams = new URLSearchParams(location.search);
        const appId = urlParams.get('_app_id') || State.appInfo.app_id || 796433;
        const resp = await apiRequest('/advertising/api/v1/auto_create/task/list', 'POST', {
            app_ids: [parseInt(appId)],
            owners: State.appInfo.owners || [],
            page: 1, page_size: 10, ad_platform: ['toutiao'],
        });

        let tasks = [];
        const dr = resp.data || {};
        if (Array.isArray(dr.data?.data)) tasks = dr.data.data;
        else if (Array.isArray(dr.data)) tasks = dr.data;
        else if (Array.isArray(dr.list)) tasks = dr.list;
        else if (Array.isArray(dr.data?.list)) tasks = dr.data.list;

        if (tasks.length === 0) throw new Error('任务列表为空，请在复制页面打开');
        const t = tasks[0];
        const taskId = t.task_id || t.id || t.create_task_info?.base_info?.master_id;
        if (!taskId) throw new Error('未找到task_id');
        return taskId;
    }

    // 获取任务模板
    async function fetchTaskDetail(taskId) {
        const resp = await apiRequest('/advertising/api/v1/auto_create/task/get', 'POST', {
            task_id: taskId, subtask_detail: true,
        });
        const taskInfo = resp.data?.data?.create_task_info;
        if (!taskInfo) throw new Error('无法获取任务配置');
        if (taskInfo.base_info?.owners?.length > 0 && (!State.appInfo.owners?.length)) {
            State.appInfo.owners = taskInfo.base_info.owners;
        }
        return taskInfo;
    }

    // ==================== 剧目信息查询（继承源任务模板的内容题材） ====================

    const bookInfoCache = new Map();

    /**
     * 通过剧目ID查询剧目信息，提取 playlet_id（用于素材检测的 book_id 和子任务 book_info.book_id）
     *
     * 查询策略：
     * 1. 先按源任务模板的 product_genre 查询（漫剧=205，短剧=其他值）
     * 2. 若未命中或没返回 playlet_id，则不限 genre 按 product_id 重查（兼容所有剧目类型）
     * 3. 必须带 filters(publish_status=2) 才能返回 playlet_id 字段
     * 4. playlet_id 是独立的第三种ID，既不是Excel的剧目ID，也不是Excel的短剧漫剧ID
     *
     * @param {string} dramaId - 剧目ID（用户Excel中的剧目id列）
     * @param {string} dramaName - 剧名（用于日志）
     * @param {number|null} templateGenre - 源任务模板的 product_genre（漫剧=205，短剧=其他值），null时默认205
     * @returns {Object} { productId, playletId, bookName, verified }
     */
    async function fetchBookInfo(dramaId, dramaName, templateGenre) {
        const cacheKey = String(dramaId);
        if (bookInfoCache.has(cacheKey)) {
            return bookInfoCache.get(cacheKey);
        }

        // 读取 playlet_id：兼容多种字段类型（string_value/int64_value/value 等）
        const readPlayletId = (fields) => {
            if (!fields || !fields.playlet_id) return null;
            const p = fields.playlet_id;
            const v = p.string_value ?? p.int64_value ?? p.value ?? p.text_value ?? '';
            return v ? cleanId(v) : null;
        };

        // 处理返回产品列表：提取 playlet_id，缺失时打印诊断信息（真实genre + 可用字段名）便于定位
        const processProducts = (products, genreLabel) => {
            if (!products || products.length === 0) return null;
            const product = products[0];
            const productId = cleanId(product.product_id || dramaId);
            const fields = product.fields || {};
            const playletId = readPlayletId(fields);
            const bookName = fields.book_name?.string_value || product.product_name || dramaName || '';
            const realGenre = product.product_genre ?? fields.product_genre?.int64_value ?? null;
            if (playletId) {
                log(`📖 [剧目查询] ${bookName} → playlet_id=${playletId}${realGenre != null ? ` (genre=${realGenre})` : ''}`, 'info');
            } else {
                const fieldKeys = Object.keys(fields).join(',') || '(无fields)';
                log(`⚠️ [剧目查询] ${bookName} → 未返回playlet_id (genre=${realGenre ?? genreLabel}, 字段: ${fieldKeys})`, 'warn');
            }
            return { productId, playletId, bookName, verified: !!playletId };
        };

        // 构造查询体：genre 为 null 时不带 product_genre，按 product_id 精确查（兼容漫剧/真人剧等）
        const buildBody = (genre) => {
            const body = {
                app_id: State.appInfo.app_id || 796433,
                product_ids: [cleanId(dramaId)],
                pagination: { page_size: 30, page_num: 1 },
                business_type: 1,
                all_fields: true,
                filters: { logic_op: 1, children: [{ logic_op: 1, condition: { operator: 1, field: 'publish_status', int64_value: 2 } }] },
            };
            if (genre != null) body.product_genre = genre;
            return body;
        };

        try {
            // 第一次：使用源任务模板的 product_genre 查询（漫剧=205，短剧=其他值）
            const primaryGenre = templateGenre ?? 205;
            let resp = await apiRequest('/advertising/api/v1/product_manage/pack_list', 'POST', buildBody(primaryGenre), 2);
            let info = processProducts(resp.data?.products || [], String(primaryGenre));

            // 兜底：模板genre没结果或没 playlet_id → 不限 genre 按 product_id 重查（兼容所有剧目类型）
            if (!info || !info.playletId) {
                log(`🔍 [剧目查询] 「${dramaName}」genre=${primaryGenre} 未命中 playlet_id，尝试不限genre按ID查询...`, 'info');
                resp = await apiRequest('/advertising/api/v1/product_manage/pack_list', 'POST', buildBody(null), 2);
                const info2 = processProducts(resp.data?.products || [], '不限');
                if (info2) info = info2;
            }

            if (info) {
                bookInfoCache.set(cacheKey, info);
                return info;
            }

            log(`⚠️ [剧目查询] 未找到剧目ID ${dramaId}`, 'warn');
            const fallback = { productId: cleanId(dramaId), playletId: null, bookName: dramaName, verified: false };
            bookInfoCache.set(cacheKey, fallback);
            return fallback;
        } catch (err) {
            log(`❌ [剧目查询] 查询失败(${dramaId}): ${err.message}`, 'error');
            const fallback = { productId: cleanId(dramaId), playletId: null, bookName: dramaName, verified: false };
            bookInfoCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    // ==================== DPA 商品列表 ====================

    /**
     * 从商品库中获取商品列表并随机选一个
     * 全域投放同样需要开启DPA
     */
    async function fetchProductList(productPlatformId) {
        if (!productPlatformId) return null;
        const cleanPlatformId = cleanId(productPlatformId);

        try {
            const resp = await apiRequest('/advertising/api/v1/auto_create/dpa/list_product', 'POST', {
                page: 1,
                page_size: 30,
                app_id: State.appInfo.app_id || 796433,
                ad_platform: 1,
                product_platform_id: cleanPlatformId,
            }, 1);

            const products = resp?.data?.data?.list || resp?.data?.list || [];
            if (products.length === 0) {
                log(`⚠️ 商品库 ${cleanPlatformId} 中没有商品`, 'warn');
                return null;
            }

            const randomIdx = Math.floor(Math.random() * products.length);
            const selected = products[randomIdx];
            const productId = cleanId(selected.product_id || selected.id);

            return productId;
        } catch (err) {
            log(`⚠️ 获取商品列表失败: ${err.message}`, 'warn');
            return null;
        }
    }

    // ==================== 素材检查 ====================

    async function checkMaterialForDrama(drama, template, bookInfo) {
        const subtask = template.create_stage?.combine_strategy?.subtasks?.[0];
        if (!subtask) {
            log(`⚠️ [素材检查] ${drama.name} - 模板无subtask，跳过`, 'warn');
            return { hasMaterial: true, reason: '无subtask' };
        }

        const apiPlayletId = bookInfo?.playletId;
        log(`🔍 [素材检查] 「${drama.name}」开始检测 (playlet_id=${apiPlayletId || 'null'}, 剧目ID=${drama.dramaId})`, 'warn');

        const productInfo = deepClone(subtask.product_info);
        if (productInfo.book_info) {
            if (apiPlayletId) {
                productInfo.book_info.book_id = apiPlayletId;
                log(`🔍 [素材检查] 「${drama.name}」使用book_id=${apiPlayletId}请求素材预览`, 'warn');
            } else {
                log(`❌ [素材检查] 「${drama.name}」API未返回playlet_id，无法检测素材（剧目ID=${drama.dramaId}）`, 'error');
                return { hasMaterial: false, reason: 'API未返回playlet_id' };
            }
            productInfo.book_info.book_name = bookInfo?.bookName || drama.name;
            delete productInfo.book_info.real_book_id;
        }
        // 保留源任务模板的 product_genre（漫剧=205，短剧=其他值），不覆盖

        const materialStrategy = subtask.material_strategy || {};
        const body = {
            app_id: template.base_info.app_id,
            promotion_purpose: template.base_info.promotion_purpose,
            promotion_content: template.base_info.promotion_content,
            product_list: [productInfo],
            customer_id: template.base_info.customer_id,
            ad_platform: template.base_info.ad_platform,
            material_strategy: materialStrategy,
        };

        // 素材检查最多重试5次，每次调用apiRequest自带5次限频退避
        const maxMaterialRetries = 5;
        let lastError = '';
        for (let attempt = 1; attempt <= maxMaterialRetries; attempt++) {
            try {
                // apiRequest 内部会自动处理限频退避（code 10006/777）
                const resp = await apiRequest('/advertising/api/v1/auto_create/material/preview', 'POST', body, 5);

                // 检查API返回码：非0说明是接口错误（如限频未恢复）
                if (resp.code !== 0 && resp.status_code !== 0) {
                    lastError = resp.message || resp.msg || `code:${resp.code}`;
                    if (attempt < maxMaterialRetries) {
                        const waitMs = 3000 + attempt * 2000;
                        log(`⚠️ [素材检查] 「${drama.name}」API返回错误(${lastError})，${(waitMs/1000).toFixed(0)}秒后重试 (${attempt + 1}/${maxMaterialRetries})`, 'warn');
                        await sleep(waitMs);
                        continue;
                    }
                    // 重试用完仍报错 → 跳过该剧目（避免无素材误建）
                    log(`⏭️ [素材检查] 「${drama.name}」API多次错误(${lastError})，跳过避免误建 (playlet_id=${apiPlayletId})`, 'warn');
                    return { hasMaterial: false, reason: `API错误:${lastError}，跳过` };
                }

                // preview API 返回 recall_cid_num 和 search_key
                const recallNum = resp.data?.recall_cid_num ?? -1;
                const searchKey = resp.data?.search_key || '';

                // recall_cid_num === 0 → 确认无素材
                if (recallNum === 0) {
                    // 二次确认：调用 list_preview 获取实际素材总数
                    if (searchKey) {
                        try {
                            const listResp = await apiRequest('/advertising/api/v1/auto_create/material/list_preview', 'POST', {
                                search_key: searchKey,
                                pagination: { page_num: 1, page_size: 10 }
                            }, 3);
                            const totalItems = listResp.data?.total ?? -1;
                            if (totalItems === 0) {
                                log(`⏭️ [素材检查] 「${drama.name}」素材为空，跳过 (preview召回=0, list确认=0, playlet_id=${apiPlayletId})`, 'warn');
                                return { hasMaterial: false, reason: `素材为空(preview+list双重确认, playlet_id=${apiPlayletId})` };
                            } else if (totalItems > 0) {
                                log(`✅ [素材检查] 「${drama.name}」素材充足 (preview召回=0但list=${totalItems}条, playlet_id=${apiPlayletId})`, 'success');
                                return { hasMaterial: true, reason: `素材充足(list=${totalItems}条)` };
                            }
                            // total === -1（未知），继续走默认逻辑
                        } catch (listErr) {
                            if (listErr.message === '__STOP__') throw listErr;
                            log(`⚠️ [素材检查] 「${drama.name}」list_preview查询异常(${listErr.message})，仅凭preview结果判定`, 'warn');
                        }
                    }
                    // 无 search_key 或 list 确认失败 → preview 已确认 recall=0，判定无素材
                    if (attempt < maxMaterialRetries) {
                        log(`🔍 [素材检查] 「${drama.name}」preview召回为0，重试确认 (${attempt + 1}/${maxMaterialRetries})`, 'warn');
                        await sleep(2000);
                        continue;
                    }
                    log(`⏭️ [素材检查] 「${drama.name}」素材为空，跳过 (召回数=0, playlet_id=${apiPlayletId})`, 'warn');
                    return { hasMaterial: false, reason: `素材为空(playlet_id=${apiPlayletId})` };
                }

                // recall_cid_num > 0 → 有素材
                if (recallNum > 0) {
                    log(`✅ [素材检查] 「${drama.name}」素材充足 (召回数=${recallNum}, playlet_id=${apiPlayletId})`, 'success');
                    return { hasMaterial: true, reason: `素材充足(${recallNum}条)` };
                }

                // recall_cid_num === -1（字段不存在）→ 兼容旧逻辑，检查 layer_distinct_num
                const layerNum = resp.data?.layer_distinct_num ?? 0;
                if (layerNum > 0) {
                    log(`✅ [素材检查] 「${drama.name}」素材充足 (层级数=${layerNum}, playlet_id=${apiPlayletId})`, 'success');
                    return { hasMaterial: true, reason: `素材充足(层级=${layerNum})` };
                }
                // 两者都不存在或都为0 → 重试确认
                if (attempt < maxMaterialRetries) {
                    log(`🔍 [素材检查] 「${drama.name}」素材字段为空，重试确认 (${attempt + 1}/${maxMaterialRetries})`, 'warn');
                    await sleep(2000);
                    continue;
                }
                log(`⏭️ [素材检查] 「${drama.name}」素材为空，跳过 (无召回数据, playlet_id=${apiPlayletId})`, 'warn');
                return { hasMaterial: false, reason: `素材为空(无召回数据, playlet_id=${apiPlayletId})` };
            } catch (err) {
                if (err.message === '__STOP__') throw err;
                lastError = err.message;
                if (attempt < maxMaterialRetries) {
                    const waitMs = 3000 + attempt * 2000;
                    log(`⚠️ [素材检查] 「${drama.name}」请求异常(${err.message})，${(waitMs/1000).toFixed(0)}秒后重试 ${attempt + 1}/${maxMaterialRetries}`, 'warn');
                    await sleep(waitMs);
                    continue;
                }
                // 请求异常重试用完 → 跳过该剧目（避免无素材误建）
                log(`⏭️ [素材检查] 「${drama.name}」请求异常: ${err.message}，跳过避免误建 (playlet_id=${apiPlayletId})`, 'error');
                return { hasMaterial: false, reason: `请求异常:${err.message}，跳过` };
            }
        }
        // 兜底：跳过（安全策略）
        log(`⏭️ [素材检查] 「${drama.name}」重试兜底，跳过 (playlet_id=${apiPlayletId})`, 'warn');
        return { hasMaterial: false, reason: `重试兜底，跳过(playlet_id=${apiPlayletId})` };
    }

    // 提交任务
    async function submitTask(taskInfo) {
        const resp = await apiRequest('/advertising/api/v1/auto_create/task/upsert', 'POST', {
            create_task_info: taskInfo,
        });
        return resp.data?.task_id || null;
    }

    // ==================== 全域投投放子任务调整核心逻辑 ====================

    /**
     * 调整子任务数量并修改每个子任务的剧目信息（全域投放专用）
     *
     * 与标准版的关键区别：
     * 1. base_info.is_omni_delivery = true
     * 2. bid_info.omni_roi_coefficient = 固定值（非roi_goal_range区间）
     * 3. content_promotion.promotion_strategy 包含 iap_promotion_link 和 iaa_promotion_link（从Excel获取）
     * 4. product_info.product_genre 保留源任务模板的值（漫剧=205，短剧=其他值）
     * 5. book_info.book_id = API返回的playlet_id（独立ID，非Excel的剧目ID也非短剧漫剧ID）
     * 6. DPA商品 product_ids = Excel的短剧漫剧ID
     * 7. 无需 purchase_panel_template_id（链接直接从Excel来）
     *
     * @param {Object} template - 源任务模板
     * @param {Array} dramas - 本批次的剧目数组（每项含name/dramaId/playletId/iaaLink/iapLink）
     * @param {Array} groupAccounts - 本组账户
     * @param {Map} bookInfoMap - dramaId → { productId, bookName, verified } 的映射
     * @param {string} productPlatformId - 商品库ID
     * @param {string} selectedProductId - 随机选中的商品ID
     * @returns {Object} 修改后的 taskInfo
     */
    function adjustSubtasks(template, dramas, groupAccounts, bookInfoMap, productPlatformId) {
        const task = deepClone(template);
        const sourceSubtasks = task.create_stage?.combine_strategy?.subtasks || [];
        const targetCount = dramas.length;

        // 1. 修改基础信息
        const firstDrama = dramas[0];
        const cleanName = firstDrama.name.replace(/-副本$/, '').replace(/-第.*$/, '');
        task.base_info.name = cleanName;

        // ★ 全域投放标记
        task.base_info.is_omni_delivery = true;

        // 日期
        const tsStart = dateToTimestamp(State.data.execStartDate);
        const tsEnd = dateToTimestamp(State.data.execEndDate || State.data.execStartDate);
        if (task.base_info.schedule_strategy) {
            task.base_info.schedule_strategy.schedule_start_time = tsStart;
            task.base_info.schedule_strategy.schedule_end_time = tsEnd;
        }
        task.base_info.status = 'enable';

        // owners/creator
        if (!task.base_info.owners?.length) task.base_info.owners = State.appInfo.owners || [];
        if (!task.base_info.creator && State.appInfo.owners?.[0]) task.base_info.creator = State.appInfo.owners[0];

        // 清除旧ID
        delete task.base_info.master_id;
        delete task.base_info.ctime;
        delete task.base_info.create_time;
        delete task.base_info.update_time;

        // 2. 调整子任务数组
        const accountList = groupAccounts.map(a => ({ account_id: cleanId(a.id) }));
        const accountListInfo = groupAccounts.map(a => ({
            account_id: cleanId(a.id),
            account_name: a.name || '',
            media_customer_id: a.media_customer_id || '',
        }));

        const roiCoeff = parseFloat(State.data.roiCoefficient);

        const newSubtasks = [];
        for (let i = 0; i < targetCount; i++) {
            const drama = dramas[i];
            const dCleanName = drama.name.replace(/-副本$/, '').replace(/-第.*$/, '');

            // 选择克隆源
            const sourceIdx = i < sourceSubtasks.length ? i : (i % Math.max(1, sourceSubtasks.length));
            const st = deepClone(sourceSubtasks[sourceIdx]);

            // 删除旧子任务标识
            delete st.subtask_id;
            delete st.opt_status;

            // 修改子任务名称
            st.subtask_name = dCleanName;
            st.subtask_status = 'enable';

            // ★★★ 全域投放：book_info 设置 ★★★
            // book_id = API返回的playlet_id（独立的第三种ID）
            // 既不是Excel的剧目ID，也不是Excel的短剧漫剧ID
            // 短剧漫剧ID只用于商品(DPA)位置
            const bookInfo = bookInfoMap?.get(cleanId(drama.dramaId));
            if (st.product_info?.book_info) {
                const apiPlayletId = bookInfo?.playletId;
                if (apiPlayletId) {
                    st.product_info.book_info.book_id = apiPlayletId;
                } else {
                    log(`❌ [子任务] 「${dCleanName}」API未返回playlet_id，book_id无法设置`, 'error');
                    st.product_info.book_info.book_id = '';
                }
                st.product_info.book_info.book_name = bookInfo?.bookName || dCleanName;
                delete st.product_info.book_info.real_book_id;
            }
            // 保留源任务模板的 product_genre（漫剧=205，短剧=其他值），不覆盖

            // ★★★ 全域投放：bid_info 设置（固定ROI系数，非区间） ★★★
            if (st.bid_info) {
                st.bid_info.omni_roi_coefficient = roiCoeff;
                // 删除标准版的 roi_goal_range（全域不用区间）
                delete st.bid_info.roi_goal_range;
            }

            // ★★★ 全域投放：content_promotion 设置（IAP/IAA链接从Excel获取） ★★★
            if (!st.content_promotion) st.content_promotion = {};
            if (!st.content_promotion.promotion_strategy) st.content_promotion.promotion_strategy = {};
            st.content_promotion.promotion_strategy.promotion_link_source = 0;
            // IAP链接和IAA链接从Excel直接获取（这是绝对不能搞错的）
            st.content_promotion.promotion_strategy.iap_promotion_link = String(drama.iapLink || '').trim();
            st.content_promotion.promotion_strategy.iaa_promotion_link = String(drama.iaaLink || '').trim();
            // 全域投放不需要 purchase_panel_template_id
            delete st.content_promotion.promotion_strategy.purchase_panel_template_id;

            // ★★★ DPA 配置：每个子任务用各自的短剧漫剧ID作为商品ID ★★★
            // 全域投放：短剧漫剧ID从Excel获取，用于"商品"位置
            if (st.account_info) {
                const dramaPlayletId = cleanId(drama.playletId);
                if (productPlatformId && dramaPlayletId) {
                    st.account_info.enable_dpa = true;
                    st.account_info.account_dpa = {
                        product_platform_id: cleanId(productPlatformId),
                        product_rec_type: 3,
                        product_ids: [dramaPlayletId],
                    };
                } else if (!dramaPlayletId) {
                    log(`⚠️ [DPA] 「${dCleanName}」缺少短剧漫剧ID`, 'warn');
                }
                // 账户列表
                st.account_info.account_list = accountList;
                st.account_info.account_list_info = accountListInfo;
            }

            newSubtasks.push(st);
        }

        task.create_stage.combine_strategy.subtasks = newSubtasks;

        // 3. 顶层必需字段
        if (task.growth_method === undefined) task.growth_method = 0;
        if (task.star_delivery_enabled === undefined) task.star_delivery_enabled = false;

        return task;
    }

    // ==================== 核心批量执行 ====================
    async function runBatchBuild() {
        if (!State.isRunning) return;
        const { dramas, accounts } = State.data;
        if (dramas.length === 0) { log('没有剧目数据，请先上传Excel', 'error'); stopAutomation(); return; }
        if (accounts.length === 0) { log('没有账户数据', 'error'); stopAutomation(); return; }

        const apg = getAccountsPerGroup();
        const dpg = getDramasPerGroup();
        const stc = getSubtaskCount();
        const totalGroups = Math.max(1, Math.ceil(accounts.length / apg));
        log(`🚀 开始全域投放搭建！共${dramas.length}部剧，${accounts.length}个账户，${totalGroups}组，每任务${stc}个子任务`, 'success');

        // Step 1: 获取源任务ID
        try {
            State.sourceTaskId = await fetchTaskList();
        } catch (err) {
            log(`获取任务ID失败: ${err.message}`, 'error');
            stopAutomation(); return;
        }

        // Step 2: 获取任务模板
        try {
            State.templateTaskInfo = await fetchTaskDetail(State.sourceTaskId);
        } catch (err) {
            log(`获取任务模板失败: ${err.message}`, 'error');
            stopAutomation(); return;
        }

        const sourceSubtaskCount = State.templateTaskInfo.create_stage?.combine_strategy?.subtasks?.length || 0;
        log(`📋 模板子任务数: ${sourceSubtaskCount} → 目标: ${stc}`, 'info');

        // ★ 提取源任务模板的内容题材（product_genre）：漫剧=205，短剧=其他值
        const templateGenre = State.templateTaskInfo?.create_stage?.combine_strategy?.subtasks?.[0]?.product_info?.product_genre ?? null;
        if (templateGenre != null) {
            const genreLabel = templateGenre === 205 ? '漫剧' : '短剧/其他';
            log(`🎭 源任务内容题材: product_genre=${templateGenre}（${genreLabel}）`, 'info');
        } else {
            log(`⚠️ 源任务模板未设置 product_genre，默认按漫剧(205)查询`, 'warn');
        }

        // Step 2.5: 预查询剧目信息 + 获取DPA商品
        const bookInfoMap = new Map();

        // 获取商品库ID
        const templateDpa = State.templateTaskInfo?.create_stage?.combine_strategy?.subtasks?.[0]?.account_info?.account_dpa;
        const templateProductPlatformId = cleanId(templateDpa?.product_platform_id || '');
        const userProductPlatformId = cleanId(State.data.productPlatformId);
        const productPlatformId = userProductPlatformId || templateProductPlatformId;

        if (productPlatformId) {
            log(`🏪 商品库ID: ${productPlatformId}（${userProductPlatformId ? '用户指定' : '模板默认'}）`, 'info');
        } else {
            log(`⚠️ 未找到商品库ID，DPA将保留模板配置`, 'warn');
        }

        // 剧目信息（playlet_id）改为即时查询：在下方素材检查时按需获取并缓存，避免一次性预查询全部剧目造成长时间空等

        // Step 3: 批量创建
        for (let g = 0; g < totalGroups; g++) {
            if (!State.isRunning) return;
            State.currentGroup = g;
            const groupAccounts = accounts.slice(g * apg, (g + 1) * apg);
            if (groupAccounts.length === 0) break;

            const groupStart = g * dpg;
            const groupEnd = Math.min(groupStart + dpg, dramas.length);
            if (groupStart >= dramas.length) break;

            log(`━━━ 第${g + 1}/${totalGroups}组 (${groupAccounts.length}个账户) ━━━`, 'success');

            // 按子任务数量分批处理剧目
            for (let d = groupStart; d < groupEnd; d += stc) {
                if (!State.isRunning) return;
                if (State.isPaused) { log('已暂停', 'warn'); await waitForResume(); }

                const batchEnd = Math.min(d + stc, groupEnd);
                const batchDramas = [];
                for (let i = d; i < batchEnd; i++) {
                    batchDramas.push(dramas[i]);
                }

                // 逐个检查素材
                const validDramas = [];
                for (let i = 0; i < batchDramas.length; i++) {
                    if (!State.isRunning) return;
                    const drama = batchDramas[i];
                    State.currentIndex = d + i;
                    updateProgressUI();

                    // 即时查询剧目信息（playlet_id）：命中缓存直接复用，未命中才请求 API
                    let bookInfo = bookInfoMap.get(cleanId(drama.dramaId));
                    if (!bookInfo && drama.dramaId) {
                        bookInfo = await fetchBookInfo(drama.dramaId, drama.name, templateGenre);
                        if (bookInfo) bookInfoMap.set(cleanId(drama.dramaId), bookInfo);
                    }
                    const materialResult = await checkMaterialForDrama(drama, State.templateTaskInfo, bookInfo);
                    if (materialResult.hasMaterial) {
                        validDramas.push(drama);
                    } else {
                        State.skipCount++;
                        State.skippedDramas.push({
                            name: drama.name,
                            dramaId: drama.dramaId,
                            playletId: bookInfo?.playletId || 'null',
                            reason: materialResult.reason || '未知',
                        });
                        updateProgressUI();
                    }
                    if (i < batchDramas.length - 1) await sleep(CONFIG.delayBetweenDramas);
                }

                if (validDramas.length === 0) {
                    log(`⏭️ 本批次全部无素材，跳过`, 'warn');
                    await sleep(CONFIG.delayBetweenTasks);
                    continue;
                }

                // 构建任务
                const taskInfo = adjustSubtasks(State.templateTaskInfo, validDramas, groupAccounts, bookInfoMap, productPlatformId);

                try {
                    const newTaskId = await submitTask(taskInfo);
                    if (newTaskId) {
                        State.successCount++;
                        const names = validDramas.map(x => x.name).join('、');
                        log(`✅ ${names} 全域投放搭建成功 (${validDramas.length}个子任务, ID: ${newTaskId})`, 'success');
                    } else {
                        State.failCount++;
                        log(`❌ 提交失败`, 'error');
                    }
                } catch (err) {
                    if (err.message === '__STOP__') { log('已停止', 'warn'); stopAutomation(); return; }
                    State.failCount++;
                    log(`❌ 失败: ${err.message}`, 'error');
                }

                updateProgressUI();
                await sleep(CONFIG.delayBetweenTasks + randomDelay());
            }
            log(`第${g + 1}组完成`, 'info');
        }

        log(`🎉 全部完成！成功:${State.successCount} 跳过:${State.skipCount} 失败:${State.failCount}`, 'success');

        // 输出被跳过的剧目汇总，方便用户查找
        if (State.skippedDramas.length > 0) {
            log(`📋 以下${State.skippedDramas.length}个剧目被跳过：`, 'warn');
            State.skippedDramas.forEach((d, i) => {
                log(`  ${i + 1}. 「${d.name}」→ ${d.reason}`, 'warn');
            });
        }

        stopAutomation();
    }

    function waitForResume() {
        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                if (!State.isRunning) { clearInterval(interval); reject(new Error('__STOP__')); return; }
                if (!State.isPaused) { clearInterval(interval); resolve(); }
            }, 500);
        });
    }

    // ==================== Excel 上传与解析 ====================

    /**
     * 解析Excel文件，提取剧目数据
     * Excel列：剧名 | 剧目id | 短剧漫剧ID | iAA链接 | IAP链接
     * 支持灵活的表头匹配
     */
    function parseExcelFile(file) {
        return new Promise((resolve, reject) => {
            if (typeof XLSX === 'undefined') {
                log('❌ [Excel] XLSX库未加载，请刷新页面重试', 'error');
                reject(new Error('Excel解析库未加载，请刷新页面重试'));
                return;
            }
            log(`📊 [Excel] 开始解析: ${file.name}`, 'info');

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                    if (rows.length < 2) {
                        log(`❌ [Excel] 数据行不足，只有${rows.length}行`, 'error');
                        reject(new Error('Excel内容为空或只有表头'));
                        return;
                    }

                    const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase());
                    const colMap = findColumnIndices(headerRow);

                    // 检查必要列是否都找到了
                    const missing = [];
                    if (colMap.name === -1) missing.push('剧名');
                    if (colMap.dramaId === -1) missing.push('剧目ID');
                    if (colMap.playletId === -1) missing.push('短剧漫剧ID');
                    if (colMap.iaaLink === -1) missing.push('iAA链接');
                    if (colMap.iapLink === -1) missing.push('IAP链接');
                    if (missing.length > 0) {
                        log(`❌ [Excel] 缺少必要列: ${missing.join('、')}`, 'error');
                        reject(new Error(`Excel缺少必要列: ${missing.join('、')}`));
                        return;
                    }

                    const dramas = [];
                    let skippedCount = 0;
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const name = String(row[colMap.name] || '').trim();
                        const dramaId = cleanId(row[colMap.dramaId]);
                        const playletId = cleanId(row[colMap.playletId]);
                        const iaaLink = String(row[colMap.iaaLink] || '').trim();
                        const iapLink = String(row[colMap.iapLink] || '').trim();

                        if (!name && !dramaId && !playletId) {
                            skippedCount++;
                            continue;
                        }

                        if (!name) {
                            log(`⚠️ [Excel] 第${i + 1}行缺少剧名，跳过`, 'warn');
                            skippedCount++;
                            continue;
                        }
                        if (!dramaId) {
                            log(`⚠️ [Excel] 第${i + 1}行「${name}」缺少剧目ID，跳过`, 'warn');
                            skippedCount++;
                            continue;
                        }
                        if (!playletId) {
                            log(`⚠️ [Excel] 第${i + 1}行「${name}」缺少短剧漫剧ID，跳过`, 'warn');
                            skippedCount++;
                            continue;
                        }
                        if (!iaaLink) {
                            log(`⚠️ [Excel] 第${i + 1}行「${name}」缺少iAA链接`, 'warn');
                        }
                        if (!iapLink) {
                            log(`⚠️ [Excel] 第${i + 1}行「${name}」缺少IAP链接`, 'warn');
                        }

                        dramas.push({ name, dramaId, playletId, iaaLink, iapLink });
                    }

                    log(`📊 [Excel] 解析完成: 有效${dramas.length}条, 跳过${skippedCount}条`, dramas.length > 0 ? 'success' : 'warn');

                    if (dramas.length === 0) {
                        reject(new Error('Excel中没有有效数据行'));
                        return;
                    }

                    resolve(dramas);
                } catch (err) {
                    reject(new Error('Excel解析失败: ' + err.message));
                }
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * 灵活匹配Excel表头列索引
     * 支持多种表头写法
     */
    function findColumnIndices(headerRow) {
        const map = { name: -1, dramaId: -1, playletId: -1, iaaLink: -1, iapLink: -1 };

        for (let i = 0; i < headerRow.length; i++) {
            const h = headerRow[i];
            if (!h) continue;

            if (map.name === -1 && (h.includes('剧名') || h.includes('名称') || h === 'name' || h.includes('drama_name'))) {
                map.name = i;
            }
            if (map.dramaId === -1 && (h.includes('剧目') && h.includes('id') || h === '剧目id' || h === '剧目ID'.toLowerCase())) {
                map.dramaId = i;
            }
            if (map.playletId === -1 && (h.includes('漫剧') || h.includes('短剧') && h.includes('id') || h.includes('playlet') || h.includes('book_id') || h === '短剧漫剧id')) {
                map.playletId = i;
            }
            if (map.iaaLink === -1 && (h.includes('iaa') || h.includes('iaa链接') || h.includes('iaa_link'))) {
                map.iaaLink = i;
            }
            if (map.iapLink === -1 && (h.includes('iap') || h.includes('iap链接') || h.includes('iap_link'))) {
                map.iapLink = i;
            }
        }

        // 精确匹配失败时按默认列顺序假设
        if (map.name === -1) map.name = 0;
        if (map.dramaId === -1) map.dramaId = 1;
        if (map.playletId === -1) map.playletId = 2;
        if (map.iaaLink === -1) map.iaaLink = 3;
        if (map.iapLink === -1) map.iapLink = 4;

        return map;
    }

    // ==================== 输入解析 ====================
    function parseAccounts(text) {
        return text.trim().split(/[\n,，\s]+/).filter(s => s.trim()).map(s => ({ id: cleanId(s), name: '', media_customer_id: '' }));
    }

    function readFormData() {
        const $ = id => document.getElementById(id);
        const v = id => $(id)?.value;
        if ($('omni-account-input')) State.data.accounts = parseAccounts(v('omni-account-input'));
        if (v('omni-roi-coeff')) State.data.roiCoefficient = v('omni-roi-coeff');
        if (v('omni-subtask-count')) State.data.subtaskCount = parseInt(v('omni-subtask-count')) || 1;
        if (v('omni-date-start')) State.data.execStartDate = v('omni-date-start');
        if (v('omni-date-end')) State.data.execEndDate = v('omni-date-end');
        if (v('omni-product-platform-id') !== undefined) State.data.productPlatformId = v('omni-product-platform-id').trim();
        if (v('omni-apg')) State.data.accountsPerGroup = parseInt(v('omni-apg')) || CONFIG.accountsPerGroup;
        if (v('omni-dpg')) State.data.dramasPerGroup = parseInt(v('omni-dpg')) || CONFIG.dramasPerGroup;
        if (v('omni-source-id')?.trim()) State.appInfo.sourceTaskId = parseInt(v('omni-source-id').trim());
        saveUIValues();
    }

    function saveUIValues() {
        try {
            localStorage.setItem(CONFIG.UI_VALUES_KEY, JSON.stringify({
                roiCoefficient: State.data.roiCoefficient,
                execStartDate: State.data.execStartDate, execEndDate: State.data.execEndDate,
                productPlatformId: State.data.productPlatformId,
                accountsPerGroup: State.data.accountsPerGroup, dramasPerGroup: State.data.dramasPerGroup,
                subtaskCount: State.data.subtaskCount,
            }));
        } catch(e) {}
    }

    function loadUIValues() {
        try {
            const v = JSON.parse(localStorage.getItem(CONFIG.UI_VALUES_KEY) || '{}');
            if (v.roiCoefficient) State.data.roiCoefficient = v.roiCoefficient;
            if (v.execStartDate) State.data.execStartDate = v.execStartDate;
            else State.data.execStartDate = formatDate(new Date());
            if (v.execEndDate) State.data.execEndDate = v.execEndDate;
            else State.data.execEndDate = State.data.execStartDate;
            if (v.productPlatformId !== undefined) State.data.productPlatformId = v.productPlatformId;
            if (v.accountsPerGroup) State.data.accountsPerGroup = v.accountsPerGroup;
            if (v.dramasPerGroup) State.data.dramasPerGroup = v.dramasPerGroup;
            if (v.subtaskCount) State.data.subtaskCount = v.subtaskCount;
        } catch(e) {}
    }

    // ==================== 控制 ====================
    function startAutomation() {
        extractAppInfo();
        readFormData();
        if (State.data.dramas.length === 0) { alert('请先上传Excel文件！'); return; }
        if (State.data.accounts.length === 0) { alert('请先输入账户ID！'); return; }

        State.isRunning = true;
        State.isPaused = false;
        State.currentIndex = 0;
        State.currentGroup = 0;
        State.successCount = 0;
        State.skipCount = 0;
        State.failCount = 0;
        State.skippedDramas = [];
        State.logs = [];
        State.templateTaskInfo = null;
        State.sourceTaskId = null;

        updateButtonState('running');
        const p = document.getElementById('omni-panel');
        if (p) p.classList.add('omni-running');
        const fab = document.getElementById('omni-fab');
        if (fab) fab.classList.add('has-log');
        runBatchBuild();
    }

    function stopAutomation() {
        State.isRunning = false;
        State.isPaused = false;
        updateButtonState('stopped');
        const p = document.getElementById('omni-panel');
        if (p) p.classList.remove('omni-running');
        const fab = document.getElementById('omni-fab');
        if (fab) fab.classList.remove('has-log');
    }

    function togglePause() {
        State.isPaused = !State.isPaused;
        const btn = document.getElementById('omni-pause-btn');
        if (btn) btn.textContent = State.isPaused ? '▶ 继续' : '⏸ 暂停';
    }

    // ==================== UI ====================
    function updateStepUI() {
        const el = document.getElementById('omni-step-status');
        if (!el) return;
        const colors = { error: '#E53935', success: '#43A047', warn: '#FDD835', info: '#9E9E9E' };
        const last = State.logs[State.logs.length - 1];
        if (last) { el.textContent = last.msg; el.style.color = colors[last.type] || '#9E9E9E'; }
    }

    function updateProgressUI() {
        const el = document.getElementById('omni-progress');
        if (!el) return;
        const total = State.data.dramas.length;
        const current = State.currentIndex + 1;
        el.innerHTML = `
            <span class="count-main">${current}/${total}</span>
            <span class="count-sub count-success">✅${State.successCount}</span>
            <span class="count-sub count-skip">⏭️${State.skipCount}</span>
            <span class="count-sub count-fail">❌${State.failCount}</span>
        `;
    }

    function updateButtonState(state) {
        const $ = id => document.getElementById(id);
        if (state === 'running') {
            $('omni-start-btn').disabled = true;
            $('omni-stop-btn').disabled = false;
            $('omni-pause-btn').disabled = false;
        } else {
            $('omni-start-btn').disabled = false;
            $('omni-stop-btn').disabled = true;
            $('omni-pause-btn').disabled = true;
            $('omni-pause-btn').textContent = '⏸ 暂停';
        }
    }

    function createPanel() {
        if (document.getElementById('omni-widget')) return;
        if (!document.body) { setTimeout(createPanel, 500); return; }

        loadUIValues();

        const widget = document.createElement('div');
        widget.id = 'omni-widget';
        widget.innerHTML = `
        <style>
            /* ===== 外层容器 ===== */
            #omni-widget {
                position: fixed;
                z-index: 99999;
                font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
                right: 24px;
                bottom: 24px;
            }

            /* ===== 小圆球 FAB ===== */
            #omni-fab {
                width: 52px; height: 52px;
                border-radius: 50%;
                background: linear-gradient(135deg, #FFE0B2 0%, #FFB74D 100%);
                box-shadow: 0 4px 20px rgba(255, 183, 77, 0.4), 0 2px 8px rgba(0,0,0,0.06);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
                transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                position: relative; user-select: none;
                border: 2px solid rgba(255,255,255,0.6);
            }
            #omni-fab:hover {
                transform: scale(1.12) rotate(8deg);
                box-shadow: 0 6px 28px rgba(255, 183, 77, 0.5);
            }
            #omni-fab:active { transform: scale(0.95); }
            #omni-fab .fab-icon { font-size: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15)); }
            #omni-fab .fab-dot {
                position: absolute; top: 6px; right: 6px;
                width: 10px; height: 10px;
                background: #FF6B6B; border-radius: 50%;
                border: 2px solid #fff; display: none;
            }
            #omni-fab.has-log .fab-dot { display: block; animation: fabBlink 1.5s ease-in-out infinite; }
            @keyframes fabBlink { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

            /* ===== 主面板 ===== */
            #omni-panel {
                position: absolute;
                bottom: 64px; right: 0;
                width: 400px; max-height: 80vh;
                background: rgba(255, 248, 235, 0.96);
                border-radius: 24px;
                box-shadow: 0 12px 48px rgba(180, 140, 60, 0.12), 0 4px 16px rgba(0,0,0,0.04);
                border: 1px solid rgba(255, 224, 178, 0.4);
                backdrop-filter: blur(24px) saturate(1.3);
                font-size: 13px; color: #5D4E37;
                display: none; flex-direction: column; overflow: hidden;
                transform-origin: bottom right;
                animation: panelPopIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            #omni-panel.open { display: flex; }
            @keyframes panelPopIn {
                from { opacity: 0; transform: scale(0.85) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            /* ===== 标题栏 ===== */
            #omni-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px;
                background: linear-gradient(135deg, #FFE0B2 0%, #FFB74D 100%);
                color: #fff;
                border-radius: 24px 24px 0 0;
                font-weight: 700; font-size: 14px;
                flex-shrink: 0; cursor: grab; user-select: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                letter-spacing: 0.3px;
            }
            #omni-header:active { cursor: grabbing; }
            #omni-header .header-title { display: flex; align-items: center; gap: 8px; }
            #omni-close-btn {
                width: 28px; height: 28px; border-radius: 50%;
                background: rgba(255,255,255,0.25); border: none;
                color: #fff; font-size: 16px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            #omni-close-btn:hover { background: rgba(255,255,255,0.4); transform: rotate(90deg); }

            /* ===== 内容区 ===== */
            #omni-body {
                overflow-y: auto; padding: 16px; flex: 1;
                scrollbar-width: none;
            }
            #omni-body::-webkit-scrollbar { width: 0; display: none; }

            /* ===== 区块 ===== */
            .omni-section {
                margin-bottom: 14px;
                background: rgba(255, 243, 224, 0.6);
                border-radius: 16px; padding: 12px;
                border: 1px solid rgba(255, 224, 178, 0.25);
            }
            .omni-label {
                font-size: 11px; color: #F57C00; margin-bottom: 6px;
                font-weight: 700; display: flex; align-items: center; gap: 4px;
                letter-spacing: 0.5px;
            }
            .omni-input {
                width: 100%; padding: 9px 12px;
                border: 1.5px solid rgba(255, 224, 178, 0.4);
                border-radius: 12px; font-size: 12px; color: #5D4E37;
                background: rgba(255,255,255,0.85);
                transition: all 0.25s ease; box-sizing: border-box; outline: none;
            }
            .omni-input::placeholder { color: #BCAAA4; }
            .omni-input:focus { border-color: #FFB74D; box-shadow: 0 0 0 3px rgba(255, 183, 77, 0.12); background: #fff; }
            textarea.omni-input { resize: vertical; min-height: 56px; font-family: 'SF Mono', monospace; line-height: 1.5; }
            .omni-row { display: flex; gap: 8px; }
            .omni-row > * { flex: 1; }

            /* ===== 进度 ===== */
            .omni-progress-box {
                text-align: center; padding: 14px 10px;
                background: linear-gradient(135deg, rgba(255,224,178,0.25), rgba(255,183,77,0.12));
                border-radius: 16px; margin-bottom: 12px;
                border: 1px solid rgba(255, 224, 178, 0.25);
            }
            .omni-progress-box .count-main { font-size: 22px; font-weight: 800; color: #F57C00; }
            .omni-progress-box .count-sub { margin-left: 10px; font-size: 13px; font-weight: 600; }
            .count-success { color: #43A047; }
            .count-skip { color: #FDD835; }
            .count-fail { color: #E53935; }

            /* ===== 状态 & 日志 ===== */
            #omni-step-status {
                font-size: 11px; color: #9E9E9E; text-align: center;
                padding: 8px; margin-bottom: 10px;
                background: rgba(255, 243, 224, 0.7); border-radius: 10px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                font-weight: 500; border: 1px dashed rgba(255, 224, 178, 0.3);
            }
            /* ===== 按钮 ===== */
            .omni-btn-row { display: flex; gap: 8px; margin-top: 12px; }
            .omni-btn {
                flex: 1; padding: 11px; border: none; border-radius: 14px;
                font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.25s ease; letter-spacing: 0.5px;
            }
            .omni-btn:disabled { opacity: 0.45; cursor: not-allowed; filter: grayscale(0.3); }
            .omni-btn-start {
                background: linear-gradient(135deg, #FFE0B2, #FFB74D);
                color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                box-shadow: 0 3px 12px rgba(255, 183, 77, 0.25);
            }
            .omni-btn-start:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255, 183, 77, 0.4); }
            .omni-btn-stop { background: linear-gradient(135deg, #FFCDD2, #EF9A9A); color: #C62828; }
            .omni-btn-stop:not(:disabled):hover { background: linear-gradient(135deg, #EF9A9A, #E57373); color: #fff; }
            .omni-btn-pause { background: linear-gradient(135deg, #FFF8E1, #FFE082); color: #E65100; }
            .omni-btn-pause:not(:disabled):hover { background: linear-gradient(135deg, #FFE082, #FFCA28); }

            /* ===== 徽标 ===== */
            .omni-badge {
                display: inline-block; padding: 3px 10px; border-radius: 20px;
                background: rgba(255,255,255,0.3); color: #fff;
                font-size: 10px; font-weight: 800;
                backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2);
            }

            /* ===== 运行中动画 ===== */
            #omni-panel.omni-running .omni-btn-start { animation: btnPulse 1.8s ease-in-out infinite; }
            @keyframes btnPulse {
                0%,100% { opacity: 1; box-shadow: 0 3px 12px rgba(255, 183, 77, 0.25); }
                50% { opacity: 0.85; box-shadow: 0 4px 20px rgba(255, 183, 77, 0.45); }
            }

            /* ===== 输入提示 ===== */
            .omni-hint {
                font-size: 10px; color: #BCAAA4; margin-top: 3px; line-height: 1.4;
            }
            .omni-field-group { margin-bottom: 8px; }
            .omni-field-group:last-child { margin-bottom: 0; }
            .omni-field-label {
                font-size: 10px; color: #F57C00; font-weight: 600; margin-bottom: 3px;
                display: flex; align-items: center; gap: 3px;
            }

            /* ===== 清除按钮 ===== */
            .omni-clear-btn {
                position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
                width: 20px; height: 20px; border-radius: 50%;
                background: rgba(255,107,107,0.12); border: none;
                color: #E57373; font-size: 11px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s; opacity: 0;
            }
            .omni-clear-btn:hover { background: rgba(255,107,107,0.25); transform: translateY(-50%) scale(1.15); }
            .omni-input-wrap { position: relative; }
            .omni-input-wrap:hover .omni-clear-btn { opacity: 1; }
            .omni-input-wrap .omni-clear-btn.always-show { opacity: 0.6; }

            /* ===== 导入按钮 ===== */
            .omni-import-btn {
                width: 100%; padding: 10px;
                border: 1.5px dashed rgba(255, 183, 77, 0.5);
                border-radius: 12px; font-size: 13px; font-weight: 700;
                color: #F57C00; background: rgba(255, 243, 224, 0.5);
                cursor: pointer; transition: all 0.25s ease;
                display: flex; align-items: center; justify-content: center; gap: 6px;
            }
            .omni-import-btn:hover {
                border-color: #FFB74D; background: rgba(255, 224, 178, 0.4);
                transform: translateY(-1px);
            }
            .omni-file-info {
                margin-top: 8px; padding: 8px 12px;
                background: rgba(255, 224, 178, 0.2);
                border-radius: 10px; font-size: 11px;
                color: #5D4E37; display: none;
                align-items: center; justify-content: space-between;
            }
            .omni-file-info.show { display: flex; }
            .omni-file-name { font-weight: 600; color: #F57C00; }
            .omni-file-count { font-size: 10px; color: #9E9E9E; }
            .omni-file-clear {
                width: 20px; height: 20px; border-radius: 50%;
                background: rgba(255,107,107,0.12); border: none;
                color: #E57373; font-size: 11px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            .omni-file-clear:hover { background: rgba(255,107,107,0.25); }

            /* ===== 导入弹窗 ===== */
            .omni-modal-mask {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.45); z-index: 100002;
                display: none; align-items: center; justify-content: center;
                animation: maskFadeIn 0.2s ease;
            }
            .omni-modal-mask.open { display: flex; }
            @keyframes maskFadeIn { from { opacity: 0; } to { opacity: 1; } }
            .omni-modal {
                background: #fff; border-radius: 16px;
                width: 420px; max-width: 90vw;
                box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08);
                overflow: hidden;
                animation: modalPopIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            @keyframes modalPopIn {
                from { opacity: 0; transform: scale(0.9) translateY(20px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .omni-modal-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 16px 20px; border-bottom: 1px solid #f0f0f0;
            }
            .omni-modal-title { font-size: 15px; font-weight: 700; color: #262626; }
            .omni-modal-close {
                width: 28px; height: 28px; border-radius: 50%;
                background: transparent; border: none;
                color: #999; font-size: 16px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .omni-modal-close:hover { background: #f5f5f5; color: #333; }
            .omni-modal-body { padding: 20px; }
            .omni-modal-row { margin-bottom: 18px; }
            .omni-modal-row:last-child { margin-bottom: 0; }
            .omni-modal-label { font-size: 13px; color: #595959; font-weight: 600; margin-bottom: 8px; }
            .omni-modal-action {
                display: flex; align-items: center; gap: 10px;
            }
            .omni-modal-btn {
                padding: 7px 16px; border: none; border-radius: 8px;
                font-size: 12px; font-weight: 600; cursor: pointer;
                transition: all 0.2s; white-space: nowrap;
            }
            .omni-modal-btn-primary {
                background: linear-gradient(135deg, #FFE0B2, #FFB74D);
                color: #fff; box-shadow: 0 2px 8px rgba(255, 183, 77, 0.3);
            }
            .omni-modal-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(255, 183, 77, 0.4); }
            .omni-modal-btn-outline {
                background: #fff; border: 1.5px solid #FFB74D; color: #F57C00;
            }
            .omni-modal-btn-outline:hover { background: #FFF8E1; }
            .omni-modal-hint { font-size: 11px; color: #999; }
            .omni-modal-selected {
                margin-top: 8px; padding: 8px 12px;
                background: #FFF8E1; border-radius: 8px;
                font-size: 12px; color: #5D4E37; display: none;
                align-items: center; justify-content: space-between;
            }
            .omni-modal-selected.show { display: flex; }
            .omni-modal-filename { font-weight: 600; color: #F57C00; }
            .omni-modal-footer {
                display: flex; justify-content: flex-end; gap: 10px;
                padding: 14px 20px; border-top: 1px solid #f0f0f0;
            }
            .omni-modal-footer .omni-modal-btn { min-width: 80px; }
            .omni-modal-btn-cancel {
                background: #fff; border: 1px solid #d9d9d9; color: #595959;
            }
            .omni-modal-btn-cancel:hover { border-color: #FFB74D; color: #F57C00; }

            /* ===== 自定义日期选择器 ===== */
            .omni-date-input {
                width: 100%; padding: 9px 12px 9px 34px;
                border: 1.5px solid rgba(255, 224, 178, 0.4);
                border-radius: 12px; font-size: 12px; color: #5D4E37;
                background: rgba(255,255,255,0.85);
                transition: all 0.25s ease; box-sizing: border-box; outline: none;
                cursor: pointer; user-select: none;
            }
            .omni-date-input:focus { border-color: #FFB74D; box-shadow: 0 0 0 3px rgba(255, 183, 77, 0.12); background: #fff; }
            .omni-date-input:hover { border-color: rgba(255, 183, 77, 0.6); }
            .omni-date-wrap { position: relative; }
            .omni-date-icon {
                position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
                font-size: 14px; pointer-events: none; opacity: 0.6;
            }

            /* 日历弹窗（挂到 body 用 fixed 定位，避免被面板 overflow 裁切） */
            .omni-calendar {
                position: fixed; z-index: 100001;
                background: #fff; border-radius: 16px;
                box-shadow: 0 12px 40px rgba(180, 140, 60, 0.18), 0 4px 12px rgba(0,0,0,0.06);
                border: 1px solid rgba(255, 224, 178, 0.3);
                padding: 14px; width: 260px;
                display: none;
                animation: calPopIn 0.2s ease;
            }
            @keyframes calPopIn {
                from { opacity: 0; transform: scale(0.92) translateY(-6px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .omni-calendar.open { display: block; }
            .omni-cal-header {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 10px;
            }
            .omni-cal-title { font-size: 13px; font-weight: 700; color: #5D4E37; }
            .omni-cal-nav {
                width: 26px; height: 26px; border-radius: 8px; border: none;
                background: rgba(255,243,224,0.8); color: #F57C00;
                cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .omni-cal-nav:hover { background: #FFE0B2; color: #fff; }
            .omni-cal-grid {
                display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
            }
            .omni-cal-weekday {
                text-align: center; font-size: 10px; color: #BCAAA4; font-weight: 600; padding: 4px 0;
            }
            .omni-cal-day {
                text-align: center; font-size: 11px; padding: 6px 0; border-radius: 8px;
                cursor: pointer; transition: all 0.15s; color: #5D4E37;
            }
            .omni-cal-day:hover { background: rgba(255,224,178,0.3); }
            .omni-cal-day.other-month { color: #D7CCC8; }
            .omni-cal-day.today { font-weight: 700; color: #F57C00; }
            .omni-cal-day.selected {
                background: linear-gradient(135deg, #FFE0B2, #FFB74D); color: #fff;
                font-weight: 700; box-shadow: 0 2px 8px rgba(255, 183, 77, 0.3);
            }
            .omni-cal-footer {
                display: flex; justify-content: space-between; align-items: center;
                margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,224,178,0.2);
            }
            .omni-cal-today-btn {
                font-size: 11px; color: #F57C00; border: none; background: none;
                cursor: pointer; font-weight: 600;
            }
            .omni-cal-today-btn:hover { text-decoration: underline; }
            .omni-cal-clear-btn {
                font-size: 11px; color: #E57373; border: none; background: none;
                cursor: pointer; font-weight: 600;
            }
            .omni-cal-clear-btn:hover { text-decoration: underline; }

            .omni-date-wrap { position: relative; }
        </style>

        <!-- 小圆球 -->
        <div id="omni-fab">
            <span class="fab-icon">🌟</span>
            <span class="fab-dot"></span>
        </div>

        <!-- 主面板 -->
        <div id="omni-panel">
            <div id="omni-header">
                <span class="header-title">
                    <span>🌟</span>
                    <span>全域投放搭建 <span class="omni-badge">v${CONFIG.version}</span></span>
                </span>
                <button id="omni-close-btn">✕</button>
            </div>
            <div id="omni-body">
                <div class="omni-section">
                    <div class="omni-label">📋 参数配置</div>
                    <div class="omni-field-group">
                        <div class="omni-field-label">🔗 复制源任务ID</div>
                        <div class="omni-input-wrap">
                            <input class="omni-input" id="omni-source-id" placeholder="自动填入，也可手动输入" value="">
                            <button class="omni-clear-btn" data-target="omni-source-id" title="清除">✕</button>
                        </div>
                        <div class="omni-hint">从复制页面自动获取，无需手动填写</div>
                    </div>
                    <div class="omni-field-group">
                        <div class="omni-row" style="gap:6px;">
                            <div style="flex:1;">
                                <div class="omni-field-label">💰 ROI 系数（固定值）</div>
                                <input class="omni-input" id="omni-roi-coeff" placeholder="如 0.98" value="${State.data.roiCoefficient}">
                            </div>
                            <div style="flex:1;">
                                <div class="omni-field-label">📦 子任务数</div>
                                <input class="omni-input" id="omni-subtask-count" type="number" min="1" max="10" value="${State.data.subtaskCount}">
                            </div>
                            <div style="flex:1;">
                                <div class="omni-field-label">🏪 商品库ID</div>
                                <div class="omni-input-wrap">
                                    <input class="omni-input" id="omni-product-platform-id" placeholder="留空用模板" value="${State.data.productPlatformId}">
                                    <button class="omni-clear-btn" data-target="omni-product-platform-id" title="清除">✕</button>
                                </div>
                            </div>
                        </div>
                        <div class="omni-hint">全域投放ROI为固定系数（非区间）｜子任务数=每任务含几部剧(1-10)</div>
                    </div>
                    <div class="omni-field-group">
                        <div class="omni-row" style="gap:6px;">
                            <div style="flex:1;">
                                <div class="omni-field-label">📅 投放起始日期</div>
                                <div class="omni-date-wrap">
                                    <span class="omni-date-icon">📅</span>
                                    <input class="omni-date-input" id="omni-date-start" readonly value="${State.data.execStartDate}" placeholder="选择日期">
                                </div>
                            </div>
                            <div style="flex:1;">
                                <div class="omni-field-label">📅 投放截止日期</div>
                                <div class="omni-date-wrap">
                                    <span class="omni-date-icon">📅</span>
                                    <input class="omni-date-input" id="omni-date-end" readonly value="${State.data.execEndDate}" placeholder="选择日期">
                                </div>
                            </div>
                        </div>
                        <div class="omni-hint">任务投放的起止日期范围</div>
                    </div>
                </div>

                <div class="omni-section">
                    <div class="omni-label">👥 分组配置</div>
                    <div class="omni-row" style="gap:6px;">
                        <div style="flex:1;">
                            <div class="omni-field-label">每组账户数</div>
                            <input class="omni-input" id="omni-apg" type="number" value="${State.data.accountsPerGroup}">
                        </div>
                        <div style="flex:1;">
                            <div class="omni-field-label">每组剧数</div>
                            <input class="omni-input" id="omni-dpg" type="number" value="${State.data.dramasPerGroup}">
                        </div>
                    </div>
                    <div class="omni-hint">账户按每组数量分批，每组处理指定剧数</div>
                </div>

                <div class="omni-section">
                    <div class="omni-label">📊 搭建信息导入</div>
                    <button class="omni-import-btn" id="omni-import-btn">📥 导入搭建信息</button>
                    <div class="omni-file-info" id="omni-file-info">
                        <div>
                            <span class="omni-file-name" id="omni-file-name"></span>
                            <span class="omni-file-count" id="omni-file-count"></span>
                        </div>
                        <button class="omni-file-clear" id="omni-file-clear" title="清除">✕</button>
                    </div>
                </div>

                <div class="omni-section">
                    <div class="omni-field-label">📝 账户ID（每行一个）</div>
                    <div class="omni-input-wrap">
                        <textarea class="omni-input" id="omni-account-input" placeholder="粘贴账户ID，每行一个" style="min-height:64px;"></textarea>
                        <button class="omni-clear-btn always-show" data-target="omni-account-input" title="清空" style="top:14px;transform:none;">✕</button>
                    </div>
                </div>

                <div class="omni-progress-box" id="omni-progress">
                    <span class="count-main">0/0</span>
                    <span class="count-sub count-success">✅0</span>
                    <span class="count-sub count-skip">⏭️0</span>
                    <span class="count-sub count-fail">❌0</span>
                </div>

                <div id="omni-step-status">就绪</div>

                <div class="omni-btn-row">
                    <button class="omni-btn omni-btn-start" id="omni-start-btn">🚀 开始</button>
                    <button class="omni-btn omni-btn-pause" id="omni-pause-btn" disabled>⏸ 暂停</button>
                    <button class="omni-btn omni-btn-stop" id="omni-stop-btn" disabled>⏹ 停止</button>
                </div>
            </div>
        </div>
        `;

        document.body.appendChild(widget);

        const fab = widget.querySelector('#omni-fab');
        const panel = widget.querySelector('#omni-panel');
        const header = widget.querySelector('#omni-header');
        const closeBtn = widget.querySelector('#omni-close-btn');

        // 展开/收起
        function openPanel() {
            panel.classList.add('open');
            fab.style.transform = 'scale(0)';
            fab.style.opacity = '0';
        }
        function closePanel() {
            panel.classList.remove('open');
            fab.style.transform = '';
            fab.style.opacity = '';
        }
        fab.addEventListener('click', openPanel);
        closeBtn.addEventListener('click', closePanel);

        // 拖拽
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
            if (target === 'header' && e.target.closest('#omni-close-btn')) return;
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

        // 按钮
        widget.querySelector('#omni-start-btn').addEventListener('click', startAutomation);
        widget.querySelector('#omni-stop-btn').addEventListener('click', stopAutomation);
        widget.querySelector('#omni-pause-btn').addEventListener('click', togglePause);

        // 清除按钮
        widget.querySelectorAll('.omni-clear-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = btn.dataset.target;
                const target = document.getElementById(targetId);
                if (target) {
                    target.value = '';
                    target.focus();
                }
            });
        });

        // ===== 导入弹窗 =====
        const importBtn = widget.querySelector('#omni-import-btn');
        const fileInfo = widget.querySelector('#omni-file-info');
        const fileNameEl = widget.querySelector('#omni-file-name');
        const fileCountEl = widget.querySelector('#omni-file-count');
        const fileClear = widget.querySelector('#omni-file-clear');

        // 模板下载：用 SheetJS 生成 xlsx 文件
        function downloadTemplate() {
            if (typeof XLSX === 'undefined') {
                alert('Excel库未加载，请刷新页面后重试');
                return;
            }
            // 模板数据：表头 + 一行示例
            const templateData = [
                ['剧名', '剧目ID', '短剧漫剧ID', 'iAA链接', 'IAP链接'],
                ['示例剧名', '7669411242029385780', '7669388555646404643', 'aweme://playlet?playlet_id=xxx&version=2', 'aweme://playlet?playlet_id=xxx&version=2'],
            ];
            const ws = XLSX.utils.aoa_to_sheet(templateData);
            // 设置列宽
            ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 60 }, { wch: 60 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '搭建信息');
            XLSX.writeFile(wb, '全域投放搭建信息模板.xlsx');
            log('📋 模板已下载，请填写后上传', 'info');
        }

        // 已选择的文件（弹窗内临时存储）
        let modalSelectedFile = null;

        // 创建弹窗DOM
        function createImportModal() {
            // 如果已存在则移除
            const existing = document.getElementById('omni-modal-mask');
            if (existing) existing.remove();

            const mask = document.createElement('div');
            mask.id = 'omni-modal-mask';
            mask.className = 'omni-modal-mask';
            mask.innerHTML = `
                <div class="omni-modal">
                    <div class="omni-modal-header">
                        <span class="omni-modal-title">📥 导入搭建信息</span>
                        <button class="omni-modal-close" id="omni-modal-close">✕</button>
                    </div>
                    <div class="omni-modal-body">
                        <div class="omni-modal-row">
                            <div class="omni-modal-label">获取模板文件</div>
                            <div class="omni-modal-action">
                                <button class="omni-modal-btn omni-modal-btn-primary" id="omni-modal-download">📥 点击下载模板</button>
                                <span class="omni-modal-hint">下载后填写剧目信息</span>
                            </div>
                        </div>
                        <div class="omni-modal-row">
                            <div class="omni-modal-label">导入文件</div>
                            <div class="omni-modal-action">
                                <button class="omni-modal-btn omni-modal-btn-outline" id="omni-modal-upload">📤 上传文件</button>
                                <span class="omni-modal-hint">目前仅支持 xlsx 文件格式</span>
                            </div>
                            <input type="file" id="omni-modal-file" accept=".xlsx,.xls" style="display:none;">
                            <div class="omni-modal-selected" id="omni-modal-selected">
                                <span class="omni-modal-filename" id="omni-modal-filename"></span>
                                <button class="omni-file-clear" id="omni-modal-fileclear" title="移除">✕</button>
                            </div>
                        </div>
                    </div>
                    <div class="omni-modal-footer">
                        <button class="omni-modal-btn omni-modal-btn-cancel" id="omni-modal-cancel">取消</button>
                        <button class="omni-modal-btn omni-modal-btn-primary" id="omni-modal-confirm">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(mask);

            const modalFile = mask.querySelector('#omni-modal-file');
            const modalSelected = mask.querySelector('#omni-modal-selected');
            const modalFilename = mask.querySelector('#omni-modal-filename');
            const modalFileclear = mask.querySelector('#omni-modal-fileclear');

            // 关闭弹窗
            function closeModal() {
                mask.classList.remove('open');
                modalSelectedFile = null;
                modalFile.value = '';
                modalSelected.classList.remove('show');
                setTimeout(() => mask.remove(), 200);
            }

            mask.querySelector('#omni-modal-close').addEventListener('click', closeModal);
            mask.querySelector('#omni-modal-cancel').addEventListener('click', closeModal);
            // 点击遮罩关闭
            mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });

            // 下载模板
            mask.querySelector('#omni-modal-download').addEventListener('click', downloadTemplate);

            // 上传文件
            mask.querySelector('#omni-modal-upload').addEventListener('click', () => modalFile.click());
            modalFile.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    const f = e.target.files[0];
                    if (!f.name.match(/\.(xlsx|xls)$/i)) {
                        alert('请上传 .xlsx 或 .xls 格式的Excel文件');
                        return;
                    }
                    modalSelectedFile = f;
                    modalFilename.textContent = f.name;
                    modalSelected.classList.add('show');
                }
            });

            // 移除已选文件
            modalFileclear.addEventListener('click', () => {
                modalSelectedFile = null;
                modalFile.value = '';
                modalSelected.classList.remove('show');
            });

            // 确定按钮：解析文件
            mask.querySelector('#omni-modal-confirm').addEventListener('click', async () => {
                if (!modalSelectedFile) {
                    alert('请先上传文件');
                    return;
                }
                try {
                    const dramas = await parseExcelFile(modalSelectedFile);
                    State.data.dramas = dramas;
                    State.excelFileName = modalSelectedFile.name;

                    fileNameEl.textContent = modalSelectedFile.name;
                    fileCountEl.textContent = `（${dramas.length}部剧）`;
                    fileInfo.classList.add('show');

                    const preview = dramas.slice(0, 3).map(d => d.name).join('、');
                    log(`✅ Excel导入成功: ${dramas.length}部剧 (${preview}${dramas.length > 3 ? '...' : ''})`, 'success');

                    closeModal();
                } catch (err) {
                    log(`❌ Excel解析失败: ${err.message}`, 'error');
                    alert('Excel解析失败: ' + err.message);
                }
            });

            // 打开弹窗
            requestAnimationFrame(() => mask.classList.add('open'));
        }

        // 导入按钮点击 → 打开弹窗
        importBtn.addEventListener('click', createImportModal);

        // 清除Excel数据
        fileClear.addEventListener('click', () => {
            State.data.dramas = [];
            State.excelFileName = '';
            fileInfo.classList.remove('show');
            log('已清除导入数据', 'info');
        });

        // ===== 自定义日期选择器 =====
        function createDatePicker(inputId, onChange) {
            const input = document.getElementById(inputId);
            if (!input) return;

            const wrap = input.closest('.omni-date-wrap');
            let calendar = null;
            let viewDate = input.value ? new Date(input.value + 'T00:00:00') : new Date();

            function pad(n) { return String(n).padStart(2, '0'); }
            function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
            function parseDate(s) { try { return new Date(s + 'T00:00:00'); } catch(e) { return new Date(); } }

            function renderCalendar() {
                if (!calendar) return;
                const year = viewDate.getFullYear();
                const month = viewDate.getMonth();
                const today = fmt(new Date());
                const selectedVal = input.value;

                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const startWeekday = (firstDay.getDay() + 6) % 7;
                const daysInMonth = lastDay.getDate();
                const prevMonthDays = new Date(year, month, 0).getDate();

                const weekdays = ['一','二','三','四','五','六','日'];
                let html = `
                    <div class="omni-cal-header">
                        <button class="omni-cal-nav" data-action="prev">‹</button>
                        <span class="omni-cal-title">${year}年${pad(month+1)}月</span>
                        <button class="omni-cal-nav" data-action="next">›</button>
                    </div>
                    <div class="omni-cal-grid">
                        ${weekdays.map(w => `<div class="omni-cal-weekday">${w}</div>`).join('')}
                `;

                for (let i = startWeekday - 1; i >= 0; i--) {
                    const d = prevMonthDays - i;
                    html += `<div class="omni-cal-day other-month">${d}</div>`;
                }
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${pad(month+1)}-${pad(d)}`;
                    const classes = ['omni-cal-day'];
                    if (dateStr === today) classes.push('today');
                    if (dateStr === selectedVal) classes.push('selected');
                    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${d}</div>`;
                }
                const totalCells = startWeekday + daysInMonth;
                const remaining = (7 - (totalCells % 7)) % 7;
                for (let d = 1; d <= remaining; d++) {
                    html += `<div class="omni-cal-day other-month">${d}</div>`;
                }

                html += `
                    </div>
                    <div class="omni-cal-footer">
                        <button class="omni-cal-today-btn" data-action="today">今天</button>
                        <button class="omni-cal-clear-btn" data-action="clear">清除</button>
                    </div>
                `;
                calendar.innerHTML = html;

                calendar.querySelectorAll('.omni-cal-day[data-date]').forEach(el => {
                    el.addEventListener('click', () => {
                        input.value = el.dataset.date;
                        closeCalendar();
                        if (onChange) onChange(el.dataset.date);
                    });
                });
                calendar.querySelector('[data-action="prev"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    viewDate.setMonth(viewDate.getMonth() - 1);
                    renderCalendar();
                });
                calendar.querySelector('[data-action="next"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    viewDate.setMonth(viewDate.getMonth() + 1);
                    renderCalendar();
                });
                calendar.querySelector('[data-action="today"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const todayStr = fmt(new Date());
                    input.value = todayStr;
                    viewDate = new Date();
                    closeCalendar();
                    if (onChange) onChange(todayStr);
                });
                calendar.querySelector('[data-action="clear"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    input.value = '';
                    closeCalendar();
                    if (onChange) onChange('');
                });
            }

            function positionCalendar() {
                if (!calendar || !calendar.classList.contains('open')) return;
                const rect = input.getBoundingClientRect();
                const calW = calendar.offsetWidth || 260;
                const calH = calendar.offsetHeight || 300;
                let left = rect.left;
                let top = rect.bottom + 4;
                if (left + calW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - calW - 8);
                if (top + calH > window.innerHeight - 8) top = Math.max(8, rect.top - calH - 4);
                calendar.style.left = left + 'px';
                calendar.style.top = top + 'px';
            }

            function openCalendar() {
                document.querySelectorAll('.omni-calendar.open').forEach(c => c.classList.remove('open'));
                if (!calendar) {
                    calendar = document.createElement('div');
                    calendar.className = 'omni-calendar';
                    document.body.appendChild(calendar);
                }
                viewDate = input.value ? parseDate(input.value) : new Date();
                calendar.classList.add('open');
                renderCalendar();
                positionCalendar();
            }

            function closeCalendar() {
                if (calendar) calendar.classList.remove('open');
            }

            input.addEventListener('click', (e) => {
                e.stopPropagation();
                if (calendar && calendar.classList.contains('open')) {
                    closeCalendar();
                } else {
                    openCalendar();
                }
            });

            document.addEventListener('click', (e) => {
                if (calendar && calendar.classList.contains('open')) {
                    if (!calendar.contains(e.target) && e.target !== input) {
                        closeCalendar();
                    }
                }
            });

            // 日历挂到 body 用 fixed 定位：滚动/缩放时重新对齐输入框
            const reposition = () => positionCalendar();
            window.addEventListener('scroll', reposition, true);
            window.addEventListener('resize', reposition);
        }

        createDatePicker('omni-date-start', (val) => {
            if (val) {
                const endInput = document.getElementById('omni-date-end');
                if (endInput && endInput.value && endInput.value < val) {
                    endInput.value = val;
                }
            }
        });
        createDatePicker('omni-date-end', null);

        // 预填源任务ID
        if (State.appInfo.sourceTaskId) {
            const si = widget.querySelector('#omni-source-id');
            if (si && !si.value) si.value = State.appInfo.sourceTaskId;
        }
    }

    function extractAppInfo() {
        const urlParams = new URLSearchParams(location.search);
        State.appInfo.app_id = parseInt(urlParams.get('_app_id')) || 796433;
        State.appInfo.ad_platform = urlParams.get('ad_platform') || 'toutiao';
        const ownerParams = urlParams.getAll('owners[]');
        if (ownerParams.length > 0) State.appInfo.owners = ownerParams;
        State.appInfo.sourceTaskId = null;
        const copyId = urlParams.get('id');
        if (copyId) State.appInfo.sourceTaskId = parseInt(copyId);
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { extractAppInfo(); createPanel(); });
    } else {
        extractAppInfo();
        createPanel();
    }
    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'yx-global-launch';
    var _authPassed = false;
    console.log('%c[授权校验] v11.10.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
    function _showAuthError(msg) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
        d.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.3);"><div style="font-size:48px;margin-bottom:16px;">\u{1F512}</div><h3 style="color:#333;margin:0 0 12px;font-size:18px;">\u811A\u672C\u6388\u6743\u63D0\u793A</h3><p style="color:#666;font-size:14px;line-height:1.6;margin-bottom:16px;">' + msg + '</p><p style="color:#999;font-size:12px;">\u5982\u9700\u6388\u6743\u8BF7\u8054\u7CFB\u811A\u672C\u4F5C\u8005</p></div>';
        document.body.appendChild(d);
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://gitee.com/mlddr/script-toolkit/raw/master/config.json?t=' + Date.now(),
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