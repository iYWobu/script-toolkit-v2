// ==UserScript==
// @name         营销云·短剧API多子任务搭建助手
// @name:zh-CN   营销云·短剧API多子任务搭建助手
// @namespace    https://github.com/iYWobu/script-toolkit-v2
// @version      11.15.0
// @description  纯API调用，支持多子任务(1-10)批量搭建，开启DPA从商品库随机选商品，修复日历遮挡Bug，精简日志，支持Excel导入剧目信息。加回publish_status:2过滤器（API才返回playlet_id），product_id不用dramaId fallback，调试日志显示ID映射。
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
// @connect      gitee.com
// @connect      raw.giteeusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      *
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E7%9F%AD%E5%89%A7API%E5%A4%9A%E5%AD%90%E4%BB%BB%E5%8A%A1%E6%90%AD%E5%BB%BA%E5%8A%A9%E6%89%8B.user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E8%90%A5%E9%94%80%E4%BA%91-%E7%9F%AD%E5%89%A7API%E5%A4%9A%E5%AD%90%E4%BB%BB%E5%8A%A1%E6%90%AD%E5%BB%BA%E5%8A%A9%E6%89%8B.user.js
// ==/UserScript==

(function() {

    function main() {
    'use strict';

    // ==================== 全局配置 ====================
    const CONFIG = {
        version: '11.14.0',
        defaultRoiMin: '1.08',
        defaultRoiMax: '1.1',
        defaultStartEpisode: '3',
        defaultSubtaskCount: 1,
        accountsPerGroup: 15,
        dramasPerGroup: 8,
        delayBetweenTasks: 800,
        maxRetries: 3,
        retryDelay: 3000,
        materialCheckDelay: 2000,
        materialRetryMax: 6,
        rateLimitBackoff: [2000, 4000, 6000, 8000, 10000, 12000],
        UI_VALUES_KEY: 'dba_v8_ui_values',
    };

    // 起始解锁集数 → purchase_panel_template_id 映射表
    const EPISODE_PANEL_MAP = {
        '1': '21010', '2': '21009', '3': '21011', '4': '21001', '5': '21002',
        '6': '21003', '7': '21012', '8': '21004', '9': '21005', '10': '21006',
    };

    function episodeToPanelId(episode) {
        const key = String(episode).trim();
        if (EPISODE_PANEL_MAP[key]) return EPISODE_PANEL_MAP[key];
        if (/^\d{5}$/.test(key)) return key;
        return EPISODE_PANEL_MAP['3'];
    }

    // ==================== 状态 ====================
    const State = {
        isRunning: false,
        isPaused: false,
        currentIndex: 0,
        currentGroup: 0,
        successCount: 0,
        skipCount: 0,
        failCount: 0,
        data: {
            accounts: [],
            dramas: [],
            roiMin: CONFIG.defaultRoiMin,
            roiMax: CONFIG.defaultRoiMax,
            startEpisode: CONFIG.defaultStartEpisode,
            subtaskCount: CONFIG.defaultSubtaskCount,
            execStartDate: formatDate(new Date()),
            execEndDate: formatDate(new Date()),
            productPlatformId: '',
            accountsPerGroup: CONFIG.accountsPerGroup,
            dramasPerGroup: CONFIG.dramasPerGroup,
        },
        logs: [],
        templateTaskInfo: null,
        sourceTaskId: null,
        appInfo: {},
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
        updateLogUI();
    }

    function getAccountsPerGroup() { return State.data.accountsPerGroup || CONFIG.accountsPerGroup; }
    function getDramasPerGroup() { return State.data.dramasPerGroup || CONFIG.dramasPerGroup; }
    function getSubtaskCount() { return Math.min(10, Math.max(1, State.data.subtaskCount || 1)); }
    function randomDelay() { return Math.floor(Math.random() * 500 + 300); }

    function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

    // ==================== API 核心封装 ====================

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="x-secsdk-csrf-token"]');
        if (meta) return meta.content;
        const match = document.cookie.match(/x-secsdk-csrf-token=([^;]+)/);
        if (match) return match[1];
        return null;
    }

    async function apiRequest(url, method, body = null, retries = CONFIG.maxRetries, rateLimitRetries = 0) {
        let rateLimitAttempts = 0;
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

                    // v11.10.0: 429限流检测 — code:777/status_code:777 用指数退避重试
                    const isRateLimited = (json.code === 777 || json.status_code === 777 || resp.status === 429);
                    if (isRateLimited && rateLimitAttempts < rateLimitRetries) {
                        rateLimitAttempts++;
                        const delayIdx = Math.min(rateLimitAttempts - 1, CONFIG.rateLimitBackoff.length - 1);
                        const delay = CONFIG.rateLimitBackoff[delayIdx];
                        log(`⚠️ 限流(429)，${delay/1000}秒后重试 (${rateLimitAttempts}/${rateLimitRetries})...`, 'warn');
                        await sleep(delay);
                        attempt--;
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

    // ==================== 剧目信息查询（关键修复） ====================

    // bookInfo 缓存，避免重复查询
    const bookInfoCache = new Map();

    /**
     * 查询剧目真实信息：通过 pack_list API 获取 product_id(real_book_id) 和 playlet_id(book_id)
     * v11.12.0: 移除所有用户上传ID的fallback，必须使用API返回的playlet_id和product_id
     * 缺失任一字段则返回null跳过，因为book_id和real_book_id是不同的值
     *
     * @param {string} dramaId - 用户输入的剧名ID（用于pack_list查询）
     * @param {string} dramaName - 剧名（用于日志）
     * @returns {Object|null} { productId, playletId, bookName } 或 null
     */
    async function fetchBookInfo(dramaId, dramaName) {
        const cacheKey = String(dramaId);
        if (bookInfoCache.has(cacheKey)) {
            return bookInfoCache.get(cacheKey);
        }

        const maxRetries = 3;
        const retryDelays = [1000, 2000, 3000]; // 递增等待

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (!State.isRunning) throw new Error('__STOP__');

            try {
                const resp = await apiRequest('/advertising/api/v1/product_manage/pack_list', 'POST', {
                    app_id: State.appInfo.app_id || 796433,
                    product_genre: 203,
                    product_ids: [String(dramaId)],
                    pagination: { page_size: 30, page_num: 1 },
                    business_type: 1,
                    all_fields: true,
                    // v11.14.0: 加回publish_status:2过滤器，API只有带此过滤器才返回playlet_id
                    // 没有此过滤器API不返回playlet_id，导致fallback到product_id（等于用户上传ID）
                    filters: { logic_op: 1, children: [{ logic_op: 1, condition: { operator: 1, field: 'publish_status', int64_value: 2 } }] },
                }, 2, CONFIG.materialRetryMax);

                const products = resp.data?.products || [];
                if (products.length > 0) {
                    const product = products[0];
                    const fields = product.fields || {};

                    // v11.14.0: productId 必须来自API，不能用用户上传的dramaId做fallback
                    // playlet_id 来自API（带publish_status:2过滤器才会返回）
                    const productId = product.product_id ? String(product.product_id).replace(/\s+/g, '') : null;
                    if (!productId) {
                        log(`❌ ${dramaName} API未返回product_id，跳过（不能用用户上传的ID搭建）`, 'error');
                        return null;
                    }
                    const playletId = String(fields.playlet_id?.string_value || productId).replace(/\s+/g, '');
                    const bookName = fields.book_name?.string_value || product.product_name || '';

                    const info = { productId, playletId, bookName };
                    bookInfoCache.set(cacheKey, info);
                    log(`📖 ${dramaName} 上传ID=${dramaId} → API返回 product_id=${productId} playlet_id=${playletId}${playletId === productId ? '（无playlet_id,用product_id）' : ''}`, 'info');
                    return info;
                }

                // pack_list 返回空 — 可能查询太快，递增等待后重试
                if (attempt < maxRetries) {
                    log(`📖 ${dramaName} 暂未返回数据，等待重试(${attempt + 1}/${maxRetries})...`, 'warn');
                    await sleep(retryDelays[attempt]);
                }
            } catch (err) {
                if (err.message === '__STOP__') throw err;
                if (attempt < maxRetries) {
                    log(`📖 ${dramaName} 查询异常，重试中(${attempt + 1}/${maxRetries})...`, 'warn');
                    await sleep(retryDelays[attempt]);
                } else {
                    log(`❌ ${dramaName} 查询失败: ${err.message}`, 'error');
                    return null; // 不缓存，下次运行可重新查询
                }
            }
        }

        // 所有重试均返回空 — 不使用 fallback（原始ID做 book_id 是错误的）
        log(`❌ ${dramaName}（ID:${dramaId}）多次查询均无结果，已跳过`, 'error');
        return null;
    }

    /**
     * [已弃用] 查询 DPA 产品信息
     * v8.4.0: DPA product_ids 直接使用剧目ID（用户输入），不再需要此函数
     * 保留此函数以备后续需要通过商品库名称匹配时使用
     *
     * @param {string} dramaName - 剧名（用于搜索匹配）
     * @param {Object} templateDpa - 模板的 account_dpa 配置
     * @returns {Object|null} { product_platform_id, product_ids } 或 null
     */
    async function fetchDpaProduct(dramaName, templateDpa) {
        if (!templateDpa?.product_platform_id) return null;

        try {
            // 使用模板的 product_platform_id 查询产品列表
            const resp = await apiRequest('/advertising/api/v1/auto_create/dpa/list_product_platform', 'POST', {
                page: 1,
                page_size: 50,
                product_platform_id: templateDpa.product_platform_id,
                app_id: State.appInfo.app_id || 796433,
                ad_platform: 1,
            }, 1);

            // 在产品列表中搜索匹配的剧目
            const products = resp.data?.products || resp.data?.list || [];
            const cleanSearchName = dramaName.replace(/[\s\-_—·.,，。！？!?]/g, '');

            for (const p of products) {
                const pName = (p.product_name || p.name || '').replace(/[\s\-_—·.,，。！？!?]/g, '');
                if (pName && (pName.includes(cleanSearchName) || cleanSearchName.includes(pName))) {
                    const productId = String(p.product_id || p.id);
                    log(`📦 DPA匹配: ${dramaName} → product_id=${productId}`, 'info');
                    return {
                        product_platform_id: templateDpa.product_platform_id,
                        product_ids: [productId],
                    };
                }
            }

            // 未找到匹配，尝试使用全部产品（如果列表只有1个）
            if (products.length === 1) {
                const productId = String(products[0].product_id || products[0].id);
                log(`📦 DPA单产品fallback: product_id=${productId}`, 'info');
                return {
                    product_platform_id: templateDpa.product_platform_id,
                    product_ids: [productId],
                };
            }

            log(`⚠️ DPA未找到"${dramaName}"，保留模板配置`, 'warn');
            return null;
        } catch (err) {
            log(`⚠️ DPA查询失败: ${err.message}，保留模板配置`, 'warn');
            return null;
        }
    }

    /**
     * [v8.6.0] 从商品库中获取商品列表并随机选一个
     * 抓包发现：平台成功提交任务时 enable_dpa=true，account_dpa.product_ids 是商品库中的商品ID
     * product_ids 不是剧目ID，而是商品库中实际商品的 product_id
     * API: /advertising/api/v1/auto_create/dpa/list_product
     *
     * @param {string} productPlatformId - 商品库ID
     * @returns {string|null} 随机选中的 product_id
     */
    async function fetchProductList(productPlatformId) {
        if (!productPlatformId) return null;
        // v8.6.4: 去除商品库ID中所有空格
        const cleanPlatformId = String(productPlatformId).replace(/\s+/g, '');

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

            // 随机选一个商品
            const randomIdx = Math.floor(Math.random() * products.length);
            const selected = products[randomIdx];
            // v8.6.4: 去除ID中所有空格，防止空格导致商品搜索失败
            const productId = String(selected.product_id || selected.id).replace(/\s+/g, '');
            const productName = selected.name || '未知';

            log(`📦 DPA商品: 随机选中「${productName}」→ product_id=${productId}（共${products.length}个商品）`, 'info');
            return productId;
        } catch (err) {
            log(`⚠️ 获取商品列表失败: ${err.message}`, 'warn');
            return null;
        }
    }

    // 检查单个剧目的素材
    async function checkMaterialForDrama(drama, template, bookInfo) {
        const subtask = template.create_stage?.combine_strategy?.subtasks?.[0];
        if (!subtask) return true;

        // 使用 bookInfo 中的正确 book_id 和 real_book_id（v8.1.0 修复）
        const productInfo = deepClone(subtask.product_info);
        if (productInfo.book_info) {
            if (bookInfo) {
                productInfo.book_info.book_id = bookInfo.playletId;
                productInfo.book_info.book_name = drama.name;
                productInfo.book_info.real_book_id = bookInfo.productId;
            } else {
                // v11.11.0: 不能用 drama.id 做 fallback，会导致用错误ID搭建
                return false;
            }
        }

        const body = {
            app_id: template.base_info.app_id,
            promotion_purpose: template.base_info.promotion_purpose,
            promotion_content: template.base_info.promotion_content,
            product_list: [productInfo],
            customer_id: template.base_info.customer_id,
            ad_platform: template.base_info.ad_platform,
            material_strategy: subtask.material_strategy || {},
        };

        try {
            // v11.10.0: 增加限流重试(6次指数退避)，防止429导致全部跳过
            const resp = await apiRequest('/advertising/api/v1/auto_create/material/preview', 'POST', body, CONFIG.maxRetries, CONFIG.materialRetryMax);

            // 限流后仍返回错误 → 不跳过，假设有素材继续
            if (resp.code === 777 || resp.status_code === 777) {
                log(`⚠️ ${drama.name} 素材查询被限流，跳过检查默认继续`, 'warn');
                return true;
            }

            const layerNum = resp.data?.layer_distinct_num ?? 0;
            // v8.7.0: 精简日志 — 仅在无素材时记录跳过，有素材时静默
            return layerNum > 0;
        } catch (err) {
            log(`素材查询异常: ${err.message}，默认继续`, 'warn');
            return true;
        }
    }

    // 提交任务
    async function submitTask(taskInfo) {
        const resp = await apiRequest('/advertising/api/v1/auto_create/task/upsert', 'POST', {
            create_task_info: taskInfo,
        });
        return resp.data?.task_id || null;
    }

    // ==================== 子任务调整核心逻辑 ====================

    /**
     * 调整子任务数量并修改每个子任务的剧目信息
     * @param {Object} template - 源任务模板
     * @param {Array} dramas - 本批次的剧目数组（长度=目标子任务数）
     * @param {Array} groupAccounts - 本组账户
     * @param {Map} bookInfoMap - drama.id → { productId, playletId, bookName } 的映射
     * @returns {Object} 修改后的 taskInfo
     */
    function adjustSubtasks(template, dramas, groupAccounts, bookInfoMap, productPlatformId, selectedProductId) {
        const task = deepClone(template);
        const sourceSubtasks = task.create_stage?.combine_strategy?.subtasks || [];
        const targetCount = dramas.length;

        // 1. 修改基础信息
        const firstDrama = dramas[0];
        const cleanName = firstDrama.name.replace(/-副本$/, '').replace(/-第.*$/, '');
        task.base_info.name = cleanName;

        // 日期（v8.3.0：支持起止日期范围）
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
        const panelId = episodeToPanelId(State.data.startEpisode);
        const accountList = groupAccounts.map(a => ({ account_id: String(a.id) }));
        const accountListInfo = groupAccounts.map(a => ({
            account_id: String(a.id),
            account_name: a.name || '',
            media_customer_id: a.media_customer_id || '',
        }));

        const newSubtasks = [];
        for (let i = 0; i < targetCount; i++) {
            const drama = dramas[i];
            const dCleanName = drama.name.replace(/-副本$/, '').replace(/-第.*$/, '');

            // 选择克隆源：优先用对应位置的子任务，超出则循环使用
            const sourceIdx = i < sourceSubtasks.length ? i : (i % Math.max(1, sourceSubtasks.length));
            const st = deepClone(sourceSubtasks[sourceIdx]);

            // 删除旧子任务标识
            delete st.subtask_id;
            delete st.opt_status;

            // 修改子任务名称
            st.subtask_name = dCleanName;
            st.subtask_status = 'enable';

            // ★★★ 核心修复：正确设置 book_id 和 real_book_id ★★★
            // v8.6.1: 使用 pack_list API 返回的 playlet_id 和 product_id
            // book_id = playlet_id（平台展示ID），real_book_id = product_id（剧目真实ID）
            // book_name 优先使用 API 返回的名称，这样平台能正确显示剧名
            const bookInfo = bookInfoMap?.get(String(drama.id));
            if (st.product_info?.book_info) {
                if (bookInfo) {
                    st.product_info.book_info.book_id = bookInfo.playletId;
                    st.product_info.book_info.book_name = bookInfo.bookName || dCleanName;
                    st.product_info.book_info.real_book_id = bookInfo.productId;
                } else {
                    // v11.11.0: bookInfo为null时不能用原始ID搭建，跳过此子任务
                    log(`❌ ${dCleanName} 缺少剧目信息，跳过此子任务（不能用原始ID搭建）`, 'error');
                    continue;
                }
            }

            // ★★★ DPA 配置 ★★★
            // v8.6.0 核心修复：开启DPA，从商品库随机选一个商品
            // 抓包发现：平台成功提交时 enable_dpa=true，account_dpa 包含随机选的商品
            // product_ids 是商品库中实际商品的 product_id（不是剧目ID）
            if (st.account_info) {
                if (productPlatformId && selectedProductId) {
                    st.account_info.enable_dpa = true;
                    st.account_info.account_dpa = {
                        product_platform_id: String(productPlatformId).replace(/\s+/g, ''),
                        product_rec_type: 3,
                        product_ids: [String(selectedProductId).replace(/\s+/g, '')],
                    };
                } else {
                    // Fallback：保留模板原始DPA配置
                    log(`⚠️ 子任务${i + 1}未设置DPA商品，保留模板配置`, 'warn');
                }
            }

            // ROI
            if (st.bid_info?.roi_goal_range) {
                st.bid_info.roi_goal_range.lower = parseFloat(State.data.roiMin);
                st.bid_info.roi_goal_range.upper = parseFloat(State.data.roiMax);
            }

            // 起始集数
            if (st.content_promotion?.promotion_strategy) {
                st.content_promotion.promotion_strategy.purchase_panel_template_id = panelId;
            }

            // 账户列表
            if (st.account_info) {
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
        if (dramas.length === 0) { log('没有剧名数据', 'error'); stopAutomation(); return; }
        if (accounts.length === 0) { log('没有账户数据', 'error'); stopAutomation(); return; }

        const apg = getAccountsPerGroup();
        const dpg = getDramasPerGroup();
        const stc = getSubtaskCount();
        const totalGroups = Math.max(1, Math.ceil(accounts.length / apg));
        log(`🚀 开始搭建！共${dramas.length}部剧，${accounts.length}个账户，${totalGroups}组，每任务${stc}个子任务`, 'success');

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

        // ★★★ Step 2.5: 预查询剧目信息 + 获取DPA商品 ★★★
        // v8.6.0：DPA开启，需要从商品库随机选一个商品
        // 抓包发现：平台成功提交时 enable_dpa=true，product_ids 是商品库中的商品ID
        const bookInfoMap = new Map();

        // 获取商品库ID（用户输入或模板默认），去除所有空格
        const templateDpa = State.templateTaskInfo?.create_stage?.combine_strategy?.subtasks?.[0]?.account_info?.account_dpa;
        const templateProductPlatformId = (templateDpa?.product_platform_id || '').replace(/\s+/g, '');
        const userProductPlatformId = State.data.productPlatformId.replace(/\s+/g, '');
        const productPlatformId = userProductPlatformId || templateProductPlatformId;

        if (productPlatformId) {
            log(`🏪 商品库ID: ${productPlatformId}（${userProductPlatformId ? '用户指定' : '模板默认'}）`, 'info');
        } else {
            log(`⚠️ 未找到商品库ID，DPA将保留模板配置`, 'warn');
        }

        // 从商品库随机选一个商品
        let selectedProductId = null;
        if (productPlatformId) {
            selectedProductId = await fetchProductList(productPlatformId);
            if (!selectedProductId) {
                log(`⚠️ 未能从商品库获取商品，将保留模板DPA配置`, 'warn');
            }
        }

        // v8.7.0: 移除预查询阶段，改为边查边建（查询+素材检查+搭建 同步进行）
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

                // 逐个：查询剧目信息 + 检查素材
                const validDramas = [];
                for (let i = 0; i < batchDramas.length; i++) {
                    if (!State.isRunning) return;
                    const drama = batchDramas[i];
                    State.currentIndex = d + i;
                    updateProgressUI();

                    // v8.7.0: 边查边建 — 先查剧目信息（带重试），再查素材
                    // v11.11.0: bookInfo为null时跳过剧目，不能用用户上传的ID直接搭建（ID不一致会出大问题）
                    let bookInfo = bookInfoMap.get(String(drama.id));
                    if (!bookInfo && drama.id) {
                        bookInfo = await fetchBookInfo(drama.id, drama.name);
                        if (bookInfo) {
                            bookInfoMap.set(String(drama.id), bookInfo);
                        }
                    }
                    if (!bookInfo) {
                        State.skipCount++;
                        log(`⏭️ ${drama.name} 剧目信息查询失败，跳过（不能用原始ID搭建）`, 'warn');
                        updateProgressUI();
                        continue;
                    }
                    // v11.10.0: 素材检查前加延迟，防止API限流(429)
                    await sleep(CONFIG.materialCheckDelay);
                    const hasMaterial = await checkMaterialForDrama(drama, State.templateTaskInfo, bookInfo);
                    if (hasMaterial) {
                        validDramas.push(drama);
                    } else {
                        State.skipCount++;
                        log(`⏭️ ${drama.name} 素材为空`, 'warn');
                        updateProgressUI();
                    }
                }

                if (validDramas.length === 0) {
                    log('本批次全部无素材，跳过', 'warn');
                    await sleep(CONFIG.delayBetweenTasks);
                    continue;
                }

                // 构建任务（子任务数 = validDramas.length）
                const taskInfo = adjustSubtasks(State.templateTaskInfo, validDramas, groupAccounts, bookInfoMap, productPlatformId, selectedProductId);

                try {
                    const newTaskId = await submitTask(taskInfo);
                    if (newTaskId) {
                        State.successCount++;
                        const names = validDramas.map(x => x.name).join('、');
                        log(`✅ ${names} 搭建成功 (${validDramas.length}个子任务, ID: ${newTaskId})`, 'success');
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
        }

        log(`🎉 全部完成！成功:${State.successCount} 跳过:${State.skipCount} 失败:${State.failCount}`, 'success');
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

    // ==================== 输入解析 ====================
    function parseAccounts(text) {
        return text.trim().split(/[\n,，\s]+/).filter(s => s.trim()).map(s => ({ id: s.trim().replace(/\s+/g, ''), name: '', media_customer_id: '' }));
    }

    function parseDramas(text) {
        const lines = text.trim().split('\n').filter(l => l.trim());
        const dramas = [];
        for (const line of lines) {
            const parts = line.split(/\t|\|/).map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                // v8.6.3: 去除ID中所有空格（包括中间的空格），防止粘贴时带入多余空格导致API搜索失败
                dramas.push({ name: parts[0], id: parts[1].replace(/\s+/g, '') });
            } else if (parts.length === 1) {
                const m = parts[0].match(/^(.+?)\s*[（(]\s*(\d+)\s*[)）]\s*$/);
                if (m) dramas.push({ name: m[1].trim(), id: m[2] });
                else dramas.push({ name: parts[0], id: '' });
            }
        }
        return dramas;
    }

    // ==================== v8.7.0: Excel 文件导入 ====================
    let _xlsxLoading = null;
    function ensureXLSX() {
        // v11.9.0: 优先使用@require加载的XLSX（Tampermonkey沙箱兼容）
        if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
        if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX);
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.XLSX) return Promise.resolve(unsafeWindow.XLSX);
        if (_xlsxLoading) return _xlsxLoading;
        _xlsxLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = () => {
                const lib = (typeof unsafeWindow !== 'undefined' && unsafeWindow.XLSX) || window.XLSX || XLSX;
                if (lib) resolve(lib);
                else reject(new Error('Excel库加载后未找到XLSX对象'));
            };
            s.onerror = () => { _xlsxLoading = null; reject(new Error('Excel解析库加载失败，请检查网络连接')); };
            document.head.appendChild(s);
        });
        return _xlsxLoading;
    }

    async function parseExcelFile(file) {
        const XLSX = await ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('Excel文件中没有工作表');
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        const lines = [];
        let headerSkipped = false;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;
            const name = String(row[0] || '').trim();
            const id = String(row[1] || '').trim().replace(/\s+/g, '');

            // 首行表头检测：包含"剧名"/"名称"/"name" 且 包含"id"/"编号"
            if (i === 0 && !headerSkipped) {
                if (/剧名|名称|name|标题/i.test(name) && /id|编号/i.test(id)) {
                    headerSkipped = true;
                    continue;
                }
            }

            if (name && id) {
                lines.push(`${name}\t${id}`);
            } else if (name && !id) {
                lines.push(name);
            }
        }
        return { text: lines.join('\n'), count: lines.length };
    }

    async function downloadTemplate() {
        const XLSX = await ensureXLSX();
        const ws = XLSX.utils.aoa_to_sheet([
            ['剧名', '剧名ID'],
            ['（示例，请删除此行后填写）闪婚老公藏不住', '752156678627090915'],
        ]);
        ws['!cols'] = [{ wch: 32 }, { wch: 25 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '剧目信息');
        // v11.9.0: 使用手动Blob下载替代XLSX.writeFile，兼容Tampermonkey沙箱
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '剧目信息模板.xlsx';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }

    function readFormData() {
        const $ = id => document.getElementById(id);
        const v = id => $(id)?.value;
        if ($('dba-account-input')) State.data.accounts = parseAccounts(v('dba-account-input'));
        if ($('dba-drama-input')) State.data.dramas = parseDramas(v('dba-drama-input'));
        if (v('dba-roi-min')) State.data.roiMin = v('dba-roi-min');
        if (v('dba-roi-max')) State.data.roiMax = v('dba-roi-max');
        if (v('dba-episode')) State.data.startEpisode = v('dba-episode');
        if (v('dba-subtask-count')) State.data.subtaskCount = parseInt(v('dba-subtask-count')) || 1;
        if (v('dba-date-start')) State.data.execStartDate = v('dba-date-start');
        if (v('dba-date-end')) State.data.execEndDate = v('dba-date-end');
        if (v('dba-product-platform-id') !== undefined) State.data.productPlatformId = v('dba-product-platform-id').trim();
        if (v('dba-apg')) State.data.accountsPerGroup = parseInt(v('dba-apg')) || CONFIG.accountsPerGroup;
        if (v('dba-dpg')) State.data.dramasPerGroup = parseInt(v('dba-dpg')) || CONFIG.dramasPerGroup;
        if (v('dba-source-id')?.trim()) State.appInfo.sourceTaskId = parseInt(v('dba-source-id').trim());
        saveUIValues();
    }

    function saveUIValues() {
        try {
            localStorage.setItem(CONFIG.UI_VALUES_KEY, JSON.stringify({
                roiMin: State.data.roiMin, roiMax: State.data.roiMax,
                startEpisode: State.data.startEpisode, subtaskCount: State.data.subtaskCount,
                execStartDate: State.data.execStartDate, execEndDate: State.data.execEndDate,
                productPlatformId: State.data.productPlatformId,
                accountsPerGroup: State.data.accountsPerGroup, dramasPerGroup: State.data.dramasPerGroup,
            }));
        } catch(e) {}
    }

    function loadUIValues() {
        try {
            const v = JSON.parse(localStorage.getItem(CONFIG.UI_VALUES_KEY) || '{}');
            if (v.roiMin) State.data.roiMin = v.roiMin;
            if (v.roiMax) State.data.roiMax = v.roiMax;
            if (v.startEpisode) State.data.startEpisode = v.startEpisode;
            if (v.subtaskCount) State.data.subtaskCount = v.subtaskCount;
            if (v.execStartDate) State.data.execStartDate = v.execStartDate;
            else if (v.execDate) State.data.execStartDate = v.execDate; // 兼容旧版
            if (v.execEndDate) State.data.execEndDate = v.execEndDate;
            else State.data.execEndDate = State.data.execStartDate; // 默认截止=起始
            if (v.productPlatformId !== undefined) State.data.productPlatformId = v.productPlatformId;
            if (v.accountsPerGroup) State.data.accountsPerGroup = v.accountsPerGroup;
            if (v.dramasPerGroup) State.data.dramasPerGroup = v.dramasPerGroup;
        } catch(e) {}
    }

    // ==================== 控制 ====================
    function startAutomation() {
        extractAppInfo();
        readFormData();
        if (State.data.dramas.length === 0) { alert('请先输入剧名和剧名ID'); return; }
        if (State.data.accounts.length === 0) { alert('请先输入账户ID'); return; }

        State.isRunning = true;
        State.isPaused = false;
        State.currentIndex = 0;
        State.currentGroup = 0;
        State.successCount = 0;
        State.skipCount = 0;
        State.failCount = 0;
        State.logs = [];
        State.templateTaskInfo = null;
        State.sourceTaskId = null;

        updateButtonState('running');
        const p = document.getElementById('dba-panel');
        if (p) p.classList.add('dba-running');
        const fab = document.getElementById('dba-fab');
        if (fab) fab.classList.add('has-log');
        runBatchBuild().catch(err => {
            if (err.message === '__STOP__') {
                log('已停止', 'warn');
            } else {
                log(`❌ 运行异常: ${err.message}`, 'error');
            }
            stopAutomation();
        });
    }

    function stopAutomation() {
        State.isRunning = false;
        State.isPaused = false;
        updateButtonState('stopped');
        const p = document.getElementById('dba-panel');
        if (p) p.classList.remove('dba-running');
        const fab = document.getElementById('dba-fab');
        if (fab) fab.classList.remove('has-log');
    }

    function togglePause() {
        State.isPaused = !State.isPaused;
        const btn = document.getElementById('dba-pause-btn');
        if (btn) btn.textContent = State.isPaused ? '▶ 继续' : '⏸ 暂停';
    }

    // ==================== UI ====================
    function updateStepUI() {
        const el = document.getElementById('dba-step-status');
        if (!el) return;
        const colors = { error: '#E57373', success: '#4FC3F7', warn: '#FFB74D', info: '#78909C' };
        const last = State.logs[State.logs.length - 1];
        if (last) { el.textContent = last.msg; el.style.color = colors[last.type] || '#78909C'; }
    }

    function updateProgressUI() {
        const el = document.getElementById('dba-progress');
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

    function updateLogUI() {
        const el = document.getElementById('dba-log');
        if (!el) return;
        const recent = State.logs.slice(-15).reverse();
        const colors = { error: '#E57373', success: '#4FC3F7', warn: '#FFB74D', info: '#90A4AE' };
        el.innerHTML = recent.map(l => `<div style="color:${colors[l.type] || '#90A4AE'};margin-bottom:3px;">[${l.time}] ${l.msg}</div>`).join('');
    }

    function updateButtonState(state) {
        const $ = id => document.getElementById(id);
        if (state === 'running') {
            $('dba-start-btn').disabled = true;
            $('dba-stop-btn').disabled = false;
            $('dba-pause-btn').disabled = false;
        } else {
            $('dba-start-btn').disabled = false;
            $('dba-stop-btn').disabled = true;
            $('dba-pause-btn').disabled = true;
            $('dba-pause-btn').textContent = '⏸ 暂停';
        }
    }

    function createPanel() {
        if (document.getElementById('dba-widget')) return;
        if (!document.body) { setTimeout(createPanel, 500); return; }

        loadUIValues();

        const widget = document.createElement('div');
        widget.id = 'dba-widget';
        widget.innerHTML = `
        <style>
            /* ===== 外层容器 ===== */
            #dba-widget {
                position: fixed;
                z-index: 99999;
                font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
                right: 24px;
                bottom: 24px;
            }

            /* ===== 小圆球 FAB ===== */
            #dba-fab {
                width: 52px; height: 52px;
                border-radius: 50%;
                background: linear-gradient(135deg, #B3D9FF 0%, #6BA3D8 100%);
                box-shadow: 0 4px 20px rgba(107, 163, 216, 0.4), 0 2px 8px rgba(0,0,0,0.06);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
                transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                position: relative; user-select: none;
                border: 2px solid rgba(255,255,255,0.6);
            }
            #dba-fab:hover {
                transform: scale(1.12) rotate(8deg);
                box-shadow: 0 6px 28px rgba(107, 163, 216, 0.5);
            }
            #dba-fab:active { transform: scale(0.95); }
            #dba-fab .fab-icon { font-size: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15)); }
            #dba-fab .fab-dot {
                position: absolute; top: 6px; right: 6px;
                width: 10px; height: 10px;
                background: #FF6B6B; border-radius: 50%;
                border: 2px solid #fff; display: none;
            }
            #dba-fab.has-log .fab-dot { display: block; animation: fabBlink 1.5s ease-in-out infinite; }
            @keyframes fabBlink { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

            /* ===== 主面板 ===== */
            #dba-panel {
                position: absolute;
                bottom: 64px; right: 0;
                width: 400px; max-height: 80vh;
                background: rgba(240, 248, 255, 0.96);
                border-radius: 24px;
                box-shadow: 0 12px 48px rgba(59, 80, 102, 0.12), 0 4px 16px rgba(0,0,0,0.04);
                border: 1px solid rgba(176, 212, 241, 0.35);
                backdrop-filter: blur(24px) saturate(1.3);
                font-size: 13px; color: #3B5066;
                display: none; flex-direction: column; overflow: hidden;
                transform-origin: bottom right;
                animation: panelPopIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            #dba-panel.open { display: flex; }
            @keyframes panelPopIn {
                from { opacity: 0; transform: scale(0.85) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            /* ===== 标题栏 ===== */
            #dba-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px;
                background: linear-gradient(135deg, #B3D9FF 0%, #6BA3D8 100%);
                color: #fff;
                border-radius: 24px 24px 0 0;
                font-weight: 700; font-size: 14px;
                flex-shrink: 0; cursor: grab; user-select: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                letter-spacing: 0.3px;
            }
            #dba-header:active { cursor: grabbing; }
            #dba-header .header-title { display: flex; align-items: center; gap: 8px; }
            #dba-close-btn {
                width: 28px; height: 28px; border-radius: 50%;
                background: rgba(255,255,255,0.25); border: none;
                color: #fff; font-size: 16px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            #dba-close-btn:hover { background: rgba(255,255,255,0.4); transform: rotate(90deg); }

            /* ===== 内容区 ===== */
            #dba-body {
                overflow-y: auto; padding: 16px; flex: 1;
                scrollbar-width: thin; scrollbar-color: #B0D4F1 transparent;
            }
            #dba-body::-webkit-scrollbar { width: 4px; }
            #dba-body::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #B3D9FF, #6BA3D8); border-radius: 10px; }
            #dba-body::-webkit-scrollbar-track { background: transparent; }

            /* ===== 区块 ===== */
            .dba-section {
                margin-bottom: 14px;
                background: rgba(230, 243, 255, 0.6);
                border-radius: 16px; padding: 12px;
                border: 1px solid rgba(176, 212, 241, 0.2);
            }
            .dba-label {
                font-size: 11px; color: #4A90D9; margin-bottom: 6px;
                font-weight: 700; display: flex; align-items: center; gap: 4px;
                letter-spacing: 0.5px;
            }
            .dba-input {
                width: 100%; padding: 9px 12px;
                border: 1.5px solid rgba(176, 212, 241, 0.4);
                border-radius: 12px; font-size: 12px; color: #3B5066;
                background: rgba(255,255,255,0.85);
                transition: all 0.25s ease; box-sizing: border-box; outline: none;
            }
            .dba-input::placeholder { color: #9AB5CC; }
            .dba-input:focus { border-color: #6BA3D8; box-shadow: 0 0 0 3px rgba(107, 163, 216, 0.12); background: #fff; }
            textarea.dba-input { resize: vertical; min-height: 56px; font-family: 'SF Mono', monospace; line-height: 1.5; }
            .dba-row { display: flex; gap: 8px; }
            .dba-row > * { flex: 1; }

            /* ===== 进度 ===== */
            .dba-progress-box {
                text-align: center; padding: 14px 10px;
                background: linear-gradient(135deg, rgba(179,217,255,0.25), rgba(107,163,216,0.12));
                border-radius: 16px; margin-bottom: 12px;
                border: 1px solid rgba(176, 212, 241, 0.25);
            }
            .dba-progress-box .count-main { font-size: 22px; font-weight: 800; color: #4A90D9; }
            .dba-progress-box .count-sub { margin-left: 10px; font-size: 13px; font-weight: 600; }
            .count-success { color: #4FC3F7; }
            .count-skip { color: #FFB74D; }
            .count-fail { color: #E57373; }

            /* ===== 状态 & 日志 ===== */
            #dba-step-status {
                font-size: 11px; color: #78909C; text-align: center;
                padding: 8px; margin-bottom: 10px;
                background: rgba(230, 243, 255, 0.7); border-radius: 10px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                font-weight: 500; border: 1px dashed rgba(176, 212, 241, 0.3);
            }
            #dba-log {
                max-height: 160px; overflow-y: auto; padding: 10px;
                background: rgba(255, 255, 255, 0.7); border-radius: 12px;
                font-size: 11px; line-height: 1.7; font-family: 'SF Mono', monospace;
                scrollbar-width: thin; scrollbar-color: #B0D4F1 transparent;
                border: 1px solid rgba(176, 212, 241, 0.15);
            }
            #dba-log::-webkit-scrollbar { width: 3px; }
            #dba-log::-webkit-scrollbar-thumb { background: #B0D4F1; border-radius: 10px; }

            /* ===== 按钮 ===== */
            .dba-btn-row { display: flex; gap: 8px; margin-top: 12px; }
            .dba-btn {
                flex: 1; padding: 11px; border: none; border-radius: 14px;
                font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.25s ease; letter-spacing: 0.5px;
            }
            .dba-btn:disabled { opacity: 0.45; cursor: not-allowed; filter: grayscale(0.3); }
            .dba-btn-start {
                background: linear-gradient(135deg, #B3D9FF, #6BA3D8);
                color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                box-shadow: 0 3px 12px rgba(107, 163, 216, 0.25);
            }
            .dba-btn-start:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(107, 163, 216, 0.4); }
            .dba-btn-stop { background: linear-gradient(135deg, #FFCDD2, #EF9A9A); color: #C62828; }
            .dba-btn-stop:not(:disabled):hover { background: linear-gradient(135deg, #EF9A9A, #E57373); color: #fff; }
            .dba-btn-pause { background: linear-gradient(135deg, #E1F5FE, #B3E5FC); color: #0277BD; }
            .dba-btn-pause:not(:disabled):hover { background: linear-gradient(135deg, #B3E5FC, #81D4FA); }

            /* ===== 徽标 ===== */
            .dba-badge {
                display: inline-block; padding: 3px 10px; border-radius: 20px;
                background: rgba(255,255,255,0.3); color: #fff;
                font-size: 10px; font-weight: 800;
                backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2);
            }

            /* ===== 运行中动画 ===== */
            #dba-panel.dba-running .dba-btn-start { animation: btnPulse 1.8s ease-in-out infinite; }
            @keyframes btnPulse {
                0%,100% { opacity: 1; box-shadow: 0 3px 12px rgba(107, 163, 216, 0.25); }
                50% { opacity: 0.85; box-shadow: 0 4px 20px rgba(107, 163, 216, 0.45); }
            }

            /* ===== 子任务数量高亮 ===== */
            .dba-subtask-hint {
                font-size: 10px; color: #9AB5CC; margin-top: 4px; text-align: center;
            }

            /* ===== 输入提示文字 ===== */
            .dba-hint {
                font-size: 10px; color: #9AB5CC; margin-top: 3px; line-height: 1.4;
            }
            .dba-field-group { margin-bottom: 8px; }
            .dba-field-group:last-child { margin-bottom: 0; }
            .dba-field-label {
                font-size: 10px; color: #4A90D9; font-weight: 600; margin-bottom: 3px;
                display: flex; align-items: center; gap: 3px;
            }

            /* ===== 清除按钮 ===== */
            .dba-clear-btn {
                position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
                width: 20px; height: 20px; border-radius: 50%;
                background: rgba(255,107,107,0.12); border: none;
                color: #E57373; font-size: 11px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s; opacity: 0;
            }
            .dba-clear-btn:hover { background: rgba(255,107,107,0.25); transform: translateY(-50%) scale(1.15); }
            .dba-input-wrap { position: relative; }
            .dba-input-wrap:hover .dba-clear-btn { opacity: 1; }
            .dba-input-wrap .dba-clear-btn.always-show { opacity: 0.6; }

            /* ===== 自定义日期选择器 ===== */
            .dba-date-input {
                width: 100%; padding: 9px 12px 9px 34px;
                border: 1.5px solid rgba(176, 212, 241, 0.4);
                border-radius: 12px; font-size: 12px; color: #3B5066;
                background: rgba(255,255,255,0.85);
                transition: all 0.25s ease; box-sizing: border-box; outline: none;
                cursor: pointer; user-select: none;
            }
            .dba-date-input:focus { border-color: #6BA3D8; box-shadow: 0 0 0 3px rgba(107, 163, 216, 0.12); background: #fff; }
            .dba-date-input:hover { border-color: rgba(107, 163, 216, 0.6); }
            .dba-date-wrap { position: relative; }
            .dba-date-icon {
                position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
                font-size: 14px; pointer-events: none; opacity: 0.6;
            }

            /* 日历弹窗 — v8.7.0: portal 到 body + fixed 定位，避免被面板 overflow 裁剪 */
            .dba-calendar {
                position: fixed; z-index: 100001;
                background: #fff; border-radius: 16px;
                box-shadow: 0 12px 40px rgba(59, 80, 102, 0.18), 0 4px 12px rgba(0,0,0,0.06);
                border: 1px solid rgba(176, 212, 241, 0.3);
                padding: 14px; width: 260px;
                display: none;
                animation: calPopIn 0.2s ease;
            }
            @keyframes calPopIn {
                from { opacity: 0; transform: scale(0.92) translateY(-6px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .dba-calendar.open { display: block; }
            .dba-cal-header {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 10px;
            }
            .dba-cal-title { font-size: 13px; font-weight: 700; color: #3B5066; }
            .dba-cal-nav {
                width: 26px; height: 26px; border-radius: 8px; border: none;
                background: rgba(230,243,255,0.8); color: #4A90D9;
                cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .dba-cal-nav:hover { background: #B3D9FF; color: #fff; }
            .dba-cal-grid {
                display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
            }
            .dba-cal-weekday {
                text-align: center; font-size: 10px; color: #9AB5CC; font-weight: 600; padding: 4px 0;
            }
            .dba-cal-day {
                text-align: center; font-size: 11px; padding: 6px 0; border-radius: 8px;
                cursor: pointer; transition: all 0.15s; color: #3B5066;
            }
            .dba-cal-day:hover { background: rgba(179,217,255,0.3); }
            .dba-cal-day.other-month { color: #C8D6E0; }
            .dba-cal-day.today { font-weight: 700; color: #4A90D9; }
            .dba-cal-day.selected {
                background: linear-gradient(135deg, #B3D9FF, #6BA3D8); color: #fff;
                font-weight: 700; box-shadow: 0 2px 8px rgba(107, 163, 216, 0.3);
            }
            .dba-cal-day.in-range { background: rgba(179,217,255,0.2); }
            .dba-cal-footer {
                display: flex; justify-content: space-between; align-items: center;
                margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(176,212,241,0.2);
            }
            .dba-cal-today-btn {
                font-size: 11px; color: #4A90D9; border: none; background: none;
                cursor: pointer; font-weight: 600;
            }
            .dba-cal-today-btn:hover { text-decoration: underline; }
            .dba-cal-clear-btn {
                font-size: 11px; color: #E57373; border: none; background: none;
                cursor: pointer; font-weight: 600;
            }
            .dba-cal-clear-btn:hover { text-decoration: underline; }

            /* v8.7.0: 日历改为 portal 到 body，不再依赖 date-wrap 定位 */
            .dba-date-wrap { position: relative; }

            /* ===== v8.7.0: Excel 导入按钮 ===== */
            .dba-excel-btn {
                font-size: 10px; padding: 4px 10px; border-radius: 10px;
                background: linear-gradient(135deg, #B3D9FF, #6BA3D8); color: #fff;
                border: none; cursor: pointer; font-weight: 700; transition: all 0.2s;
                white-space: nowrap; letter-spacing: 0.3px;
            }
            .dba-excel-btn:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(107,163,216,0.35); }
            .dba-excel-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
            .dba-field-label-row {
                display: flex; justify-content: space-between; align-items: center;
                font-size: 10px; color: #4A90D9; font-weight: 600; margin-bottom: 3px;
            }

            /* ===== v8.7.0: Excel 导入弹窗 ===== */
            .dba-modal-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(30, 50, 70, 0.45);
                backdrop-filter: blur(4px);
                z-index: 100002;
                display: none; align-items: center; justify-content: center;
            }
            .dba-modal-overlay.open { display: flex; animation: modalFadeIn 0.2s ease; }
            @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
            .dba-modal {
                width: 360px; background: rgba(248, 251, 255, 0.98);
                border-radius: 20px; box-shadow: 0 16px 56px rgba(30,50,70,0.2);
                border: 1px solid rgba(176, 212, 241, 0.3);
                overflow: hidden; animation: modalPopIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            @keyframes modalPopIn {
                from { opacity: 0; transform: scale(0.9) translateY(10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .dba-modal-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px;
                background: linear-gradient(135deg, #B3D9FF 0%, #6BA3D8 100%);
                color: #fff; font-weight: 700; font-size: 14px;
            }
            .dba-modal-close {
                width: 26px; height: 26px; border-radius: 50%;
                background: rgba(255,255,255,0.25); border: none; color: #fff;
                font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .dba-modal-close:hover { background: rgba(255,255,255,0.4); transform: rotate(90deg); }
            .dba-modal-body { padding: 18px; }
            .dba-modal-section { margin-bottom: 16px; }
            .dba-modal-section:last-child { margin-bottom: 0; }
            .dba-modal-section-label {
                font-size: 11px; color: #4A90D9; font-weight: 700; margin-bottom: 8px;
                letter-spacing: 0.5px;
            }
            .dba-modal-row { display: flex; align-items: center; gap: 10px; }
            .dba-modal-btn-primary {
                padding: 9px 16px; border-radius: 12px; border: none;
                background: linear-gradient(135deg, #B3D9FF, #6BA3D8); color: #fff;
                font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
                white-space: nowrap;
            }
            .dba-modal-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(107,163,216,0.35); }
            .dba-modal-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
            .dba-modal-btn-secondary {
                padding: 9px 16px; border-radius: 12px;
                border: 1.5px solid rgba(107,163,216,0.4); background: rgba(255,255,255,0.9);
                color: #4A90D9; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
                white-space: nowrap;
            }
            .dba-modal-btn-secondary:hover { background: rgba(230,243,255,0.8); border-color: #6BA3D8; }
            .dba-modal-hint { font-size: 10px; color: #9AB5CC; }
            .dba-file-info {
                margin-top: 8px; padding: 8px 12px; border-radius: 10px;
                background: rgba(179,217,255,0.15); font-size: 11px; color: #4A90D9;
                border: 1px solid rgba(176,212,241,0.2); line-height: 1.5;
            }
            .dba-modal-footer {
                display: flex; justify-content: flex-end; gap: 10px;
                padding: 14px 18px; border-top: 1px solid rgba(176,212,241,0.15);
            }
            .dba-modal-btn-cancel {
                padding: 8px 20px; border-radius: 12px;
                border: 1.5px solid rgba(176,212,241,0.4); background: transparent;
                color: #78909C; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
            }
            .dba-modal-btn-cancel:hover { background: rgba(230,243,255,0.5); }
            .dba-modal-btn-confirm {
                padding: 8px 20px; border-radius: 12px; border: none;
                background: linear-gradient(135deg, #B3D9FF, #6BA3D8); color: #fff;
                font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
            }
            .dba-modal-btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
            .dba-modal-btn-confirm:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(107,163,216,0.35); }
        </style>

        <!-- 小圆球 -->
        <div id="dba-fab">
            <span class="fab-icon">🐳</span>
            <span class="fab-dot"></span>
        </div>

        <!-- 主面板 -->
        <div id="dba-panel">
            <div id="dba-header">
                <span class="header-title">
                    <span>🐳</span>
                    <span>短剧多子任务搭建 <span class="dba-badge">v${CONFIG.version}</span></span>
                </span>
                <button id="dba-close-btn">✕</button>
            </div>
            <div id="dba-body">
                <div class="dba-section">
                    <div class="dba-label">📋 参数配置</div>
                    <div class="dba-field-group">
                        <div class="dba-field-label">🔗 复制源任务ID</div>
                        <div class="dba-input-wrap">
                            <input class="dba-input" id="dba-source-id" placeholder="自动填入，也可手动输入" value="">
                            <button class="dba-clear-btn" data-target="dba-source-id" title="清除">✕</button>
                        </div>
                        <div class="dba-hint">从复制页面自动获取，无需手动填写</div>
                    </div>
                    <div class="dba-field-group">
                        <div class="dba-row" style="gap:6px;">
                            <div style="flex:1;">
                                <div class="dba-field-label">💰 ROI 下限</div>
                                <input class="dba-input" id="dba-roi-min" placeholder="如 1.08" value="${State.data.roiMin}">
                            </div>
                            <div style="flex:1;">
                                <div class="dba-field-label">💰 ROI 上限</div>
                                <input class="dba-input" id="dba-roi-max" placeholder="如 1.1" value="${State.data.roiMax}">
                            </div>
                            <div style="flex:1;">
                                <div class="dba-field-label">🎬 起始集数</div>
                                <input class="dba-input" id="dba-episode" placeholder="1-10" value="${State.data.startEpisode}">
                            </div>
                        </div>
                        <div class="dba-hint">ROI 系数范围 & 起始解锁集数（1-10）</div>
                    </div>
                    <div class="dba-field-group">
                        <div class="dba-row" style="gap:6px;">
                            <div style="flex:1;">
                                <div class="dba-field-label">📅 投放起始日期</div>
                                <div class="dba-date-wrap">
                                    <span class="dba-date-icon">📅</span>
                                    <input class="dba-date-input" id="dba-date-start" readonly value="${State.data.execStartDate}" placeholder="选择日期">
                                </div>
                            </div>
                            <div style="flex:1;">
                                <div class="dba-field-label">📅 投放截止日期</div>
                                <div class="dba-date-wrap">
                                    <span class="dba-date-icon">📅</span>
                                    <input class="dba-date-input" id="dba-date-end" readonly value="${State.data.execEndDate}" placeholder="选择日期">
                                </div>
                            </div>
                        </div>
                        <div class="dba-hint">任务投放的起止日期范围</div>
                    </div>
                    <div class="dba-field-group">
                        <div class="dba-row" style="gap:6px;">
                            <div style="flex:1;">
                                <div class="dba-field-label">📦 子任务数</div>
                                <input class="dba-input" id="dba-subtask-count" type="number" min="1" max="10" value="${State.data.subtaskCount}">
                            </div>
                            <div style="flex:1;">
                                <div class="dba-field-label">🏪 商品库ID</div>
                                <div class="dba-input-wrap">
                                    <input class="dba-input" id="dba-product-platform-id" placeholder="留空用模板默认" value="${State.data.productPlatformId}">
                                    <button class="dba-clear-btn" data-target="dba-product-platform-id" title="清除">✕</button>
                                </div>
                            </div>
                        </div>
                        <div class="dba-hint">子任务数=每任务含几部剧(1-10)｜商品库ID留空则使用模板的库</div>
                    </div>
                </div>

                <div class="dba-section">
                    <div class="dba-label">👥 分组配置</div>
                    <div class="dba-row" style="gap:6px;">
                        <div style="flex:1;">
                            <div class="dba-field-label">每组账户数</div>
                            <input class="dba-input" id="dba-apg" type="number" value="${State.data.accountsPerGroup}">
                        </div>
                        <div style="flex:1;">
                            <div class="dba-field-label">每组剧数</div>
                            <input class="dba-input" id="dba-dpg" type="number" value="${State.data.dramasPerGroup}">
                        </div>
                    </div>
                    <div class="dba-hint">账户按每组数量分批，每组处理指定剧数</div>
                </div>

                <div class="dba-section">
                    <div class="dba-field-label">📝 账户ID（每行一个）</div>
                    <div class="dba-input-wrap">
                        <textarea class="dba-input" id="dba-account-input" placeholder="粘贴账户ID，每行一个" style="min-height:64px;"></textarea>
                        <button class="dba-clear-btn always-show" data-target="dba-account-input" title="清空" style="top:14px;transform:none;">✕</button>
                    </div>
                </div>

                <div class="dba-section">
                    <div class="dba-field-label-row">
                        <span>🎬 剧名与剧名ID（Tab分隔，可从Excel粘贴）</span>
                        <button class="dba-excel-btn" id="dba-excel-import">📁 导入Excel</button>
                    </div>
                    <div class="dba-input-wrap">
                        <textarea class="dba-input" id="dba-drama-input" placeholder="格式：剧名[TAB]剧名ID&#10;示例：闪婚老公藏不住\t752156678627090915&#10;也可点击右上角「导入Excel」上传文件" style="min-height:90px;"></textarea>
                        <button class="dba-clear-btn always-show" data-target="dba-drama-input" title="清空" style="top:14px;transform:none;">✕</button>
                    </div>
                    <div class="dba-hint">Excel格式：A列=剧名，B列=剧名ID（首行可为表头，自动跳过）</div>
                </div>

                <div class="dba-progress-box" id="dba-progress">
                    <span class="count-main">0/0</span>
                    <span class="count-sub count-success">✅0</span>
                    <span class="count-sub count-skip">⏭️0</span>
                    <span class="count-sub count-fail">❌0</span>
                </div>

                <div id="dba-step-status">就绪</div>
                <div id="dba-log"></div>

                <div class="dba-btn-row">
                    <button class="dba-btn dba-btn-start" id="dba-start-btn">🚀 开始</button>
                    <button class="dba-btn dba-btn-pause" id="dba-pause-btn" disabled>⏸ 暂停</button>
                    <button class="dba-btn dba-btn-stop" id="dba-stop-btn" disabled>⏹ 停止</button>
                </div>
            </div>
        </div>

        <!-- v8.7.0: Excel 导入弹窗 -->
        <div class="dba-modal-overlay" id="dba-excel-modal">
            <div class="dba-modal">
                <div class="dba-modal-header">
                    <span>📄 导入剧目信息</span>
                    <button class="dba-modal-close" id="dba-modal-close">✕</button>
                </div>
                <div class="dba-modal-body">
                    <div class="dba-modal-section">
                        <div class="dba-modal-section-label">① 获取模板文件</div>
                        <div class="dba-modal-row">
                            <button class="dba-modal-btn-primary" id="dba-download-template">⬇️ 点击下载模板</button>
                            <span class="dba-modal-hint">下载后填写剧目信息</span>
                        </div>
                    </div>
                    <div class="dba-modal-section">
                        <div class="dba-modal-section-label">② 导入文件</div>
                        <div class="dba-modal-row">
                            <button class="dba-modal-btn-secondary" id="dba-upload-btn">⬆️ 上传文件</button>
                            <span class="dba-modal-hint">仅支持 .xlsx 文件格式</span>
                        </div>
                        <input type="file" id="dba-excel-file" accept=".xlsx" style="display:none;">
                        <div id="dba-file-info" class="dba-file-info" style="display:none;"></div>
                    </div>
                </div>
                <div class="dba-modal-footer">
                    <button class="dba-modal-btn-cancel" id="dba-modal-cancel">取消</button>
                    <button class="dba-modal-btn-confirm" id="dba-modal-confirm" disabled>确定</button>
                </div>
            </div>
        </div>
        `;

        document.body.appendChild(widget);

        const fab = widget.querySelector('#dba-fab');
        const panel = widget.querySelector('#dba-panel');
        const header = widget.querySelector('#dba-header');
        const closeBtn = widget.querySelector('#dba-close-btn');

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
            if (target === 'header' && e.target.closest('#dba-close-btn')) return;
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
        widget.querySelector('#dba-start-btn').addEventListener('click', startAutomation);
        widget.querySelector('#dba-stop-btn').addEventListener('click', stopAutomation);
        widget.querySelector('#dba-pause-btn').addEventListener('click', togglePause);

        // 清除按钮
        widget.querySelectorAll('.dba-clear-btn').forEach(btn => {
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

        // ===== v8.7.0: Excel 导入弹窗 =====
        const excelBtn = widget.querySelector('#dba-excel-import');
        const excelModal = widget.querySelector('#dba-excel-modal');
        const modalClose = widget.querySelector('#dba-modal-close');
        const modalCancel = widget.querySelector('#dba-modal-cancel');
        const modalConfirm = widget.querySelector('#dba-modal-confirm');
        const downloadBtn = widget.querySelector('#dba-download-template');
        const uploadBtn = widget.querySelector('#dba-upload-btn');
        const excelFile = widget.querySelector('#dba-excel-file');
        const fileInfo = widget.querySelector('#dba-file-info');

        let pendingImport = null; // 暂存解析结果

        function openExcelModal() {
            pendingImport = null;
            if (fileInfo) { fileInfo.style.display = 'none'; fileInfo.textContent = ''; }
            if (modalConfirm) modalConfirm.disabled = true;
            if (excelFile) excelFile.value = '';
            if (excelModal) excelModal.classList.add('open');
        }
        function closeExcelModal() {
            if (excelModal) excelModal.classList.remove('open');
            pendingImport = null;
        }

        if (excelBtn) {
            excelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openExcelModal();
            });
        }
        if (modalClose) modalClose.addEventListener('click', closeExcelModal);
        if (modalCancel) modalCancel.addEventListener('click', closeExcelModal);
        // 点击遮罩关闭
        if (excelModal) {
            excelModal.addEventListener('click', (e) => {
                if (e.target === excelModal) closeExcelModal();
            });
        }

        // 下载模板
        if (downloadBtn) {
            downloadBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const orig = downloadBtn.textContent;
                downloadBtn.disabled = true;
                downloadBtn.textContent = '⏳ 生成中...';
                try {
                    await downloadTemplate();
                } catch (err) {
                    alert('模板下载失败：' + err.message);
                } finally {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = orig;
                }
            });
        }

        // 上传文件
        if (uploadBtn && excelFile) {
            uploadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                excelFile.value = '';
                excelFile.click();
            });
            excelFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                // 校验格式
                if (!/\.xlsx$/i.test(file.name)) {
                    alert('仅支持 .xlsx 文件格式');
                    excelFile.value = '';
                    return;
                }
                const orig = uploadBtn.textContent;
                uploadBtn.disabled = true;
                uploadBtn.textContent = '⏳ 解析中...';
                try {
                    const result = await parseExcelFile(file);
                    if (result.count === 0) {
                        alert('未从文件中解析到有效数据\n请确保 A列=剧名，B列=剧名ID');
                        pendingImport = null;
                        if (fileInfo) fileInfo.style.display = 'none';
                        if (modalConfirm) modalConfirm.disabled = true;
                    } else {
                        pendingImport = result;
                        if (fileInfo) {
                            fileInfo.style.display = 'block';
                            fileInfo.innerHTML = `📄 ${file.name}<br>✅ 解析到 <b>${result.count}</b> 条剧目数据`;
                        }
                        if (modalConfirm) modalConfirm.disabled = false;
                    }
                } catch (err) {
                    alert('文件解析失败：' + err.message);
                    pendingImport = null;
                    if (fileInfo) fileInfo.style.display = 'none';
                    if (modalConfirm) modalConfirm.disabled = true;
                } finally {
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = orig;
                }
            });
        }

        // 确定导入
        if (modalConfirm) {
            modalConfirm.addEventListener('click', () => {
                if (!pendingImport) return;
                const dramaInput = document.getElementById('dba-drama-input');
                if (dramaInput) {
                    const existing = (dramaInput.value || '').trim();
                    dramaInput.value = existing ? existing + '\n' + pendingImport.text : pendingImport.text;
                    log(`📁 Excel导入成功：${pendingImport.count} 条剧目`, 'success');
                }
                closeExcelModal();
            });
        }

        // ===== 自定义日期选择器 =====
        function createDatePicker(inputId, onChange) {
            const input = document.getElementById(inputId);
            if (!input) return;

            const wrap = input.closest('.dba-date-wrap');
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
                const startWeekday = (firstDay.getDay() + 6) % 7; // 周一=0
                const daysInMonth = lastDay.getDate();
                const prevMonthDays = new Date(year, month, 0).getDate();

                const weekdays = ['一','二','三','四','五','六','日'];
                let html = `
                    <div class="dba-cal-header">
                        <button class="dba-cal-nav" data-action="prev">‹</button>
                        <span class="dba-cal-title">${year}年${pad(month+1)}月</span>
                        <button class="dba-cal-nav" data-action="next">›</button>
                    </div>
                    <div class="dba-cal-grid">
                        ${weekdays.map(w => `<div class="dba-cal-weekday">${w}</div>`).join('')}
                `;

                // 上月填充
                for (let i = startWeekday - 1; i >= 0; i--) {
                    const d = prevMonthDays - i;
                    html += `<div class="dba-cal-day other-month">${d}</div>`;
                }
                // 本月
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateStr = `${year}-${pad(month+1)}-${pad(d)}`;
                    const classes = ['dba-cal-day'];
                    if (dateStr === today) classes.push('today');
                    if (dateStr === selectedVal) classes.push('selected');
                    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${d}</div>`;
                }
                // 下月填充
                const totalCells = startWeekday + daysInMonth;
                const remaining = (7 - (totalCells % 7)) % 7;
                for (let d = 1; d <= remaining; d++) {
                    html += `<div class="dba-cal-day other-month">${d}</div>`;
                }

                html += `
                    </div>
                    <div class="dba-cal-footer">
                        <button class="dba-cal-today-btn" data-action="today">今天</button>
                        <button class="dba-cal-clear-btn" data-action="clear">清除</button>
                    </div>
                `;
                calendar.innerHTML = html;

                // 绑定日历事件
                calendar.querySelectorAll('.dba-cal-day[data-date]').forEach(el => {
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

            function openCalendar() {
                // 关闭其他日历
                document.querySelectorAll('.dba-calendar.open').forEach(c => c.classList.remove('open'));

                if (!calendar) {
                    calendar = document.createElement('div');
                    calendar.className = 'dba-calendar';
                    document.body.appendChild(calendar); // v8.7.0: portal 到 body，避免被面板 overflow 裁剪
                }
                viewDate = input.value ? parseDate(input.value) : new Date();

                // v8.7.0: 根据输入框位置计算 fixed 坐标，支持向下/向上翻转
                const rect = input.getBoundingClientRect();
                const calW = 260, calH = 320;
                let top = rect.bottom + 4;
                let left = rect.left;
                if (top + calH > window.innerHeight) {
                    top = Math.max(4, rect.top - calH - 4); // 空间不足时翻转到上方
                }
                if (left + calW > window.innerWidth - 8) {
                    left = window.innerWidth - calW - 8;
                }
                if (left < 8) left = 8;
                calendar.style.top = top + 'px';
                calendar.style.left = left + 'px';

                calendar.classList.add('open');
                renderCalendar();
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

            // 点击外部关闭
            document.addEventListener('click', (e) => {
                if (calendar && calendar.classList.contains('open')) {
                    if (!calendar.contains(e.target) && e.target !== input) {
                        closeCalendar();
                    }
                }
            });

            // v8.7.0: 滚动或窗口缩放时关闭日历（fixed 定位不再跟随输入框移动）
            document.addEventListener('scroll', () => {
                if (calendar && calendar.classList.contains('open')) closeCalendar();
            }, true);
            window.addEventListener('resize', () => {
                if (calendar && calendar.classList.contains('open')) closeCalendar();
            });
        }

        // 创建两个日期选择器
        createDatePicker('dba-date-start', (val) => {
            // 起始日期变更时，如果截止日期早于起始日期，自动更新截止日期
            if (val) {
                const endInput = document.getElementById('dba-date-end');
                if (endInput && endInput.value && endInput.value < val) {
                    endInput.value = val;
                }
            }
        });
        createDatePicker('dba-date-end', null);

        // 预填源任务ID
        if (State.appInfo.sourceTaskId) {
            const si = widget.querySelector('#dba-source-id');
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
    var SCRIPT_ID = 'yx-dj-builder';
    var _authPassed = false;
    console.log('%c[授权校验] v11.15.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
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