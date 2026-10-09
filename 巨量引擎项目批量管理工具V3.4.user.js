// ==UserScript==
// @name         巨量引擎项目批量管理工具V3.4
// @namespace    oceanengine-project-manager
// @version      11.11.0
// @description  API驱动批量搜索/删除零消耗项目/统计剧目，直接调用接口极速操作，防误删
// @author       Trae
// @match        https://business.oceanengine.com/ebp/account-manage/ad/bidding/universe/project*
// @match        https://business.oceanengine.com/ebp/account-manage/ad/bidding/universe/project
// @match        https://business.oceanengine.com/ebp/account-manage/ad/bidding/superior/project*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      gitee.com
// @connect      raw.giteeusercontent.com
// @connect      *
// @updateURL   https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E%E9%A1%B9%E7%9B%AE%E6%89%B9%E9%87%8F%E7%AE%A1%E7%90%86%E5%B7%A5%E5%85%B7V3.4.user.js
// @downloadURL https://gitee.com/mlddr/script-toolkit-v2/raw/master/%E5%B7%A8%E9%87%8F%E5%BC%95%E6%93%8E%E9%A1%B9%E7%9B%AE%E6%89%B9%E9%87%8F%E7%AE%A1%E7%90%86%E5%B7%A5%E5%85%B7V3.4.user.js
// ==/UserScript==

(function () {

    function main() {
    'use strict';

    // ============================
    // 配置
    // ============================
    const CONFIG = {
        debug: true,
        apiDelay: 100,              // API调用间隔(ms)
        deleteBatchSize: 500,       // 每批删除数量 (提升到500)
        maxPages: 800,              // 最大翻页数 (800页 × 500条 = 40万)
        pageSize: 1000,             // 每页项目数 (1000条/页，减少请求次数)
        tableLoadTimeout: 15000,
        costCheckDays: 90,          // 消耗检查天数 (检查近90天的消耗)
        deleteRetryMax: 3,          // 删除后验证重试次数 (发现遗留则重试)
        deleteVerifyDelay: 2000,   // 删除后等待服务器处理的时间(ms)
        deleteVerifyPages: 10,      // 验证时检查的页数 (前10页约5000条)
        batchConcurrency: 8,        // 并行获取页面的并发数
    };

    // ============================
    // API 端点 (从实际抓包获取)
    // ============================
    const API = {
        getProjectList: '/api/ebp/promotion/ad/get_project_list',
        batchDelete: '/api/ebp/promotion/common/batch_delete_project',
    };

    // ============================
    // 状态
    // ============================
    const state = {
        isProcessing: false,
        shouldStop: false,
        allProjects: [],           // 所有项目数据(API返回)
        zeroCostProjects: [],      // 零消耗项目
        costProjects: [],          // 有消耗项目
        uniqueDramas: new Set(),   // 不重复剧目 (product_name)
        dramaCountMap: {},         // 剧目 → 项目数
        dramaAccountsMap: {},      // 剧目 → Set<抖音号> (每个剧目对应的抖音号集合)
        uniqueAccounts: new Set(), // 不重复抖音号 (roi3_aweme_name)
        accountCountMap: {},       // 抖音号 → 项目数
        deleteLog: [],
        ebpid: '',
        currentKeyword: '',
    };

    // ============================
    // 工具函数
    // ============================
    function log(msg, level = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const prefix = { info: '[INFO]', warn: '[WARN]', error: '[ERROR]', success: '[OK]' }[level] || '[INFO]';
        const fullMsg = `[${time}] ${prefix} ${msg}`;
        console.log(`%c[项目管理工具] ${fullMsg}`, `color: ${level === 'error' ? '#ff4d4f' : level === 'warn' ? '#faad14' : level === 'success' ? '#52c41a' : '#1890ff'}`);
        addLogToPanel(fullMsg, level);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getEbpid() {
        const match = window.location.href.match(/[?&]ebpid=(\d+)/);
        return match ? match[1] : '';
    }

    // 获取消耗检查的时间范围 (近N天)
    function getTimeRange() {
        const now = new Date();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const start = new Date(end.getTime() - CONFIG.costCheckDays * 24 * 60 * 60 * 1000);
        return {
            startTime: Math.floor(start.getTime() / 1000).toString(),
            endTime: Math.floor(end.getTime() / 1000).toString(),
        };
    }

    // ============================
    // 安全头提取 (CSRF Token等)
    // ============================
    function getCsrfToken() {
        // 从cookie中提取CSRF token
        const cookies = document.cookie.split(';');
        const csrfKeys = ['csrf_token', '_csrf', 'XSRF-TOKEN', 'tecsrf', 'csrf', 'x-csrf-token'];
        for (const cookie of cookies) {
            const [key, ...valParts] = cookie.trim().split('=');
            if (csrfKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                const val = valParts.join('=');
                if (val) return { key: key.trim(), value: val.trim() };
            }
        }
        // 从meta标签提取
        const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"], meta[name="XSRF-TOKEN"]');
        if (meta) return { key: 'X-CSRF-Token', value: meta.content };
        return null;
    }

    // 从页面拦截到的请求头中获取必要头
    function getCapturedHeaders() {
        try {
            const stored = sessionStorage.getItem('oe_pm_captured_headers');
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return null;
    }

    // 拦截页面自身的fetch调用，捕获请求头
    function installRequestInterceptor() {
        if (unsafeWindow.__oePmInterceptorInstalled) return;
        unsafeWindow.__oePmInterceptorInstalled = true;

        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            // 只拦截删除API和项目列表API
            const url = typeof input === 'string' ? input : input?.url || '';
            if (url.includes('batch_delete_project') || url.includes('get_project_list')) {
                if (init && init.headers) {
                    // 将Headers对象转换为普通对象
                    const headersObj = {};
                    if (init.headers instanceof Headers) {
                        init.headers.forEach((v, k) => { headersObj[k] = v; });
                    } else if (typeof init.headers === 'object') {
                        Object.assign(headersObj, init.headers);
                    }
                    if (Object.keys(headersObj).length > 0) {
                        sessionStorage.setItem('oe_pm_captured_headers', JSON.stringify(headersObj));
                        console.log('[项目管理工具] 捕获到请求头:', headersObj);
                    }
                }
            }
            return origFetch.apply(this, arguments);
        };

        // 也拦截XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function (method, url) {
            this.__oeUrl = url;
            this.__oeHeaders = {};
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
            this.__oeHeaders[key] = value;
            return origSetHeader.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (this.__oeUrl && (this.__oeUrl.includes('batch_delete_project') || this.__oeUrl.includes('get_project_list'))) {
                if (Object.keys(this.__oeHeaders).length > 0) {
                    sessionStorage.setItem('oe_pm_captured_headers', JSON.stringify(this.__oeHeaders));
                    console.log('[项目管理工具] XHR捕获到请求头:', this.__oeHeaders);
                }
            }
            return origSend.apply(this, arguments);
        };

        log('请求拦截器已安装，请在页面上手动删除一个项目以捕获请求头', 'info');
    }

    // ============================
    // API 调用 (返回 {ok, status, data})
    // ============================
    async function apiCall(url, body) {
        const fullUrl = url + '?ebpid=' + state.ebpid;

        // 构建请求头 - 合并默认头、CSRF token、页面拦截到的头
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
        };

        // 添加CSRF token
        const csrf = getCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf.value;
            headers['x-csrf-token'] = csrf.value;
        }

        // 合并页面拦截到的头 (优先级最高)
        const captured = getCapturedHeaders();
        if (captured) {
            Object.assign(headers, captured);
        }

        try {
            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                credentials: 'include',
            });

            const text = await response.text();
            let parsed = null;

            // 处理空响应 (204 No Content 等情况)
            if (text && text.trim()) {
                try {
                    parsed = JSON.parse(text);
                } catch (e) {
                    log(`API响应JSON解析失败, HTTP ${response.status}: ${text.substring(0, 200)}`, 'warn');
                }
            }

            return {
                ok: response.ok,
                status: response.status,
                data: parsed,
                responseText: text,
            };
        } catch (e) {
            log(`API请求失败: ${e.message}`, 'error');
            return { ok: false, status: 0, data: null, responseText: '' };
        }
    }

    // 获取项目列表 (API方式)
    // keyword: 有值时走API搜索(全字段)，无值时获取全部数据(去掉status filter)
    // 返回 { success, list, total }
    async function fetchProjectList(keyword, page = 1, limit = CONFIG.pageSize) {
        const timeRange = getTimeRange();

        const body = {
            startTime: timeRange.startTime,
            endTime: timeRange.endTime,
            cascadeMetrics: [
                'project_name', 'project_id',
                'roi3_aweme_name', 'roi3_aweme_id',
                'product_name', 'product_id',
                'oc_project_status_first', 'oc_project_status_first_name',
                'oc_project_status_second', 'oc_project_status_second_name',
            ],
            fields: [
                'all_stat_total_cost_trend',
                'all_roi_0day_trend',
                'all_billing_gmv_0day_trend',
                'all_billing_micro_game_0d_amount_trend',
                'all_billing_gmv_3days_trend',
                'all_roi_3days_trend',
            ],
            orderField: 'create_time',
            orderType: 1,
            offset: page,
            limit: limit,
            accountType: 0,
            filter: {
                uniProject: {},
            },
            platformVersion: '2',
            isRoi3: true,
            isCpl2: false,
        };

        // 有搜索关键词时：添加 search filter (不指定searchType，让API搜索全字段)
        if (keyword && keyword.trim()) {
            body.filter.search = {
                keyword: keyword.trim(),
            };
        }
        // 无搜索关键词时：不加 search filter，获取全部数据

        const resp = await apiCall(API.getProjectList, body);

        if (!resp.ok) {
            return { success: false, list: [], total: 0, error: `HTTP ${resp.status}` };
        }

        const json = resp.data;
        if (!json) {
            return { success: false, list: [], total: 0, error: '空响应' };
        }

        // 健壮地提取项目列表 - 尝试多种可能的数据结构
        const list = json.data?.list || json.data?.rows || json.data?.data || json.list || json.rows || [];

        // 提取总数 - 用于判断是否还有更多页
        const total = json.data?.total || json.data?.count || json.total || json.count || 0;

        return { success: true, list, total, raw: json };
    }

    // 批量删除项目 (API方式)
    // 删除API返回 HTTP 200 + JSON {code:0, data:{list:[], hasFailed:false}}
    async function batchDeleteProjects(projects) {
        if (!projects || projects.length === 0) {
            log('没有需要删除的项目', 'warn');
            return false;
        }

        const accountDetail = projects.map(p => ({
            advertiserId: String(p.advertiser_id),
            groupId: String(p.group_id),
            id: String(p.project_id),
            name: p.project_name,
        }));

        // 关键: 必须包含 accountType: 0，否则服务器会静默忽略删除请求
        const body = {
            accountDetail,
            accountType: 0,
        };

        // 第一批删除时输出详细请求信息
        if (CONFIG.debug) {
            log(`删除请求: ${accountDetail.length} 个项目, 首个: ${accountDetail[0]?.name?.substring(0, 30)}`);
            log(`请求体字段: ${Object.keys(body).join(', ')}`);
            log(`首个项目 advertiserId=${accountDetail[0]?.advertiserId}, groupId=${accountDetail[0]?.groupId}, id=${accountDetail[0]?.id}`);
        }

        const resp = await apiCall(API.batchDelete, body);

        // 日志输出完整响应
        log(`删除API返回 HTTP ${resp.status} | 响应体: ${resp.responseText ? resp.responseText.substring(0, 200) : '(空)'}`);

        // 删除API成功判断: HTTP 200 且 JSON code === 0 且 hasFailed === false
        if (resp.ok && resp.status === 200 && resp.data) {
            const code = resp.data.code;
            const hasFailed = resp.data.data?.hasFailed;
            const failList = resp.data.data?.list || [];

            if (code === 0 && !hasFailed) {
                log(`删除成功: ${accountDetail.length} 个项目已删除 (code=0, hasFailed=false)`, 'success');
                return true;
            }

            // 部分失败
            if (hasFailed) {
                log(`部分删除失败: hasFailed=true, 失败列表长度=${failList.length}`, 'warn');
                if (failList.length > 0) {
                    log(`失败项目示例: ${JSON.stringify(failList[0]).substring(0, 150)}`, 'warn');
                }
                // 即使部分失败，也返回true让流程继续（失败的会在下次获取时重新出现）
                return true;
            }

            // code 非0
            log(`删除失败: code=${code}, msg=${resp.data.msg || resp.data.message || '(无)'}`, 'error');
            return false;
        }

        // 兼容 204 空响应 (某些情况下可能返回)
        if (resp.ok && resp.status === 204) {
            log(`删除成功: HTTP 204 (空响应)`, 'success');
            return true;
        }

        // 失败 - 尝试从响应体提取错误信息
        let errMsg = `HTTP ${resp.status}`;
        if (resp.data) {
            errMsg = `code=${resp.data.code}, msg=${resp.data.msg || resp.data.message || '(无)'}`;
        } else if (resp.responseText) {
            errMsg = resp.responseText.substring(0, 200);
        }
        log(`删除失败: ${errMsg}`, 'error');
        return false;
    }

    // ============================
    // 核心 - 关键词搜索 (双模式: API搜索 + 客户端多字段过滤回退)
    // 模式1: API搜索(searchType:8) — 关键词匹配项目名称时走此路径(快)
    // 模式2: 全量获取+客户端过滤 — API搜索返回0时自动回退，多字段匹配(慢但全)
    // ============================
    async function fetchAllProjects(keyword) {
        if (state.isProcessing) {
            log('已有操作进行中', 'warn');
            return;
        }

        state.isProcessing = true;
        state.shouldStop = false;
        state.allProjects = [];
        state.zeroCostProjects = [];
        state.costProjects = [];
        state.uniqueDramas = new Set();
        state.dramaCountMap = {};
        state.dramaAccountsMap = {};
        state.uniqueAccounts = new Set();
        state.accountCountMap = {};
        state.currentKeyword = keyword || '';

        try {
            log('===== 开始搜索项目 =====', 'success');
            if (keyword) log(`搜索关键词: "${keyword}"`);
            updateStatusBar('正在搜索...', 'info');

            // 数据处理函数
            function processItems(items) {
                for (const item of items) {
                    const costRaw = item.metrics?.all_stat_total_cost_trend
                        || item.all_stat_total_cost_trend || item.cost || '0';
                    const cost = parseFloat(costRaw) || 0;
                    const dramaName = item.product_name || '';
                    const accountName = item.roi3_aweme_name || '';

                    const project = {
                        project_id: item.project_id,
                        project_name: item.project_name,
                        advertiser_id: item.advertiser_id,
                        group_id: item.group_id,
                        drama_name: dramaName,
                        account_name: accountName,
                        product_name: dramaName,
                        roi3_aweme_name: accountName,
                        cost: cost,
                        costRaw: costRaw,
                        status: item.oc_project_status_first_name || '',
                        create_time: item.create_time || '',
                        shouldDelete: cost === 0,
                        isProtected: cost > 0,
                    };

                    state.allProjects.push(project);
                    if (cost > 0) state.costProjects.push(project);
                    else state.zeroCostProjects.push(project);

                    if (dramaName) {
                        state.uniqueDramas.add(dramaName);
                        state.dramaCountMap[dramaName] = (state.dramaCountMap[dramaName] || 0) + 1;
                        if (!state.dramaAccountsMap[dramaName]) state.dramaAccountsMap[dramaName] = new Set();
                        if (accountName) state.dramaAccountsMap[dramaName].add(accountName);
                    }
                    if (accountName) {
                        state.uniqueAccounts.add(accountName);
                        state.accountCountMap[accountName] = (state.accountCountMap[accountName] || 0) + 1;
                    }
                }
                return items.length;
            }

            // 客户端多字段匹配函数 (回退模式使用)
            function matchKeyword(item, kw) {
                const kwLower = kw.toLowerCase();
                const fields = [
                    item.project_name,
                    item.product_name,
                    item.roi3_aweme_name,
                    item.advertiser_id,
                    item.project_id,
                ];
                return fields.some(f => f && String(f).toLowerCase().includes(kwLower));
            }

            // 持续并行获取函数 (两种模式共用)
            async function fetchAllPages(searchKw, filterFn) {
                const firstResult = await fetchProjectList(searchKw, 1, CONFIG.pageSize);
                if (!firstResult.success || !firstResult.list || firstResult.list.length === 0) {
                    return { firstList: null, firstResult };
                }

                const firstList = filterFn
                    ? firstResult.list.filter(item => filterFn(item))
                    : firstResult.list;

                if (firstResult.total) {
                    log(`API报告总数: ${firstResult.total} 个项目`);
                }

                let totalProjects = processItems(firstList);
                let pagesFetched = 1;
                log(`第 1 页: ${firstResult.list.length} 条${filterFn ? `, 过滤后: ${firstList.length}` : ''} | 累计: ${totalProjects}`);
                updateStatusBar(`正在获取（第1页, ${totalProjects}个）...`, 'info');
                updateStatistics(1);

                if (firstResult.list.length < CONFIG.pageSize) {
                    log('仅一页数据，获取完成', 'success');
                } else {
                    const concurrency = CONFIG.batchConcurrency;
                    let page = 2;

                    while (!state.shouldStop && page <= CONFIG.maxPages) {
                        const batch = [];
                        for (let i = 0; i < concurrency && page <= CONFIG.maxPages; i++) {
                            batch.push(page++);
                        }

                        const results = await Promise.all(batch.map(p => fetchProjectList(searchKw, p, CONFIG.pageSize)));

                        let reachedLastPage = false;
                        for (const result of results) {
                            pagesFetched++;
                            if (result.success && result.list && result.list.length > 0) {
                                const pageItems = filterFn
                                    ? result.list.filter(item => filterFn(item))
                                    : result.list;
                                totalProjects += processItems(pageItems);
                                if (result.list.length < CONFIG.pageSize) {
                                    reachedLastPage = true;
                                }
                            } else {
                                reachedLastPage = true;
                            }
                        }
                        log(`已获取 ${pagesFetched} 页 | 累计: ${totalProjects} 个项目`);
                        updateStatusBar(`正在获取（${pagesFetched}页, ${totalProjects}个）...`, 'info');
                        updateStatistics(pagesFetched);

                        if (reachedLastPage) break;
                    }
                }

                return { firstList, firstResult };
            }

            // Step 1: 先尝试API搜索 (searchType:8, 搜索项目名称)
            if (keyword) {
                log(`模式1: 尝试API搜索 "${keyword}" ...`);
                const apiResult = await fetchProjectList(keyword, 1, CONFIG.pageSize);

                if (apiResult.success && apiResult.list && apiResult.list.length > 0) {
                    // API搜索有结果 → 快速路径: 直接用API搜索获取全部
                    log(`API搜索匹配到 ${apiResult.list.length} 条，使用API搜索模式`, 'success');

                    // 重新调用fetchAllPages处理第一页和后续页
                    // 但第一页已经获取了，所以直接处理
                    if (apiResult.total) {
                        log(`API报告总数: ${apiResult.total} 个项目`);
                    }

                    let totalProjects = processItems(apiResult.list);
                    let pagesFetched = 1;
                    log(`第 1 页: ${apiResult.list.length} 个 | 累计: ${totalProjects}`);
                    updateStatusBar(`正在获取（第1页, ${totalProjects}个）...`, 'info');
                    updateStatistics(1);

                    if (apiResult.list.length < CONFIG.pageSize) {
                        log('仅一页数据，获取完成', 'success');
                    } else {
                        const concurrency = CONFIG.batchConcurrency;
                        let page = 2;

                        while (!state.shouldStop && page <= CONFIG.maxPages) {
                            const batch = [];
                            for (let i = 0; i < concurrency && page <= CONFIG.maxPages; i++) {
                                batch.push(page++);
                            }

                            const results = await Promise.all(batch.map(p => fetchProjectList(keyword, p, CONFIG.pageSize)));

                            let reachedLastPage = false;
                            for (const result of results) {
                                pagesFetched++;
                                if (result.success && result.list && result.list.length > 0) {
                                    totalProjects += processItems(result.list);
                                    if (result.list.length < CONFIG.pageSize) {
                                        reachedLastPage = true;
                                    }
                                } else {
                                    reachedLastPage = true;
                                }
                            }
                            log(`已获取 ${pagesFetched} 页 | 累计: ${totalProjects} 个项目`);
                            updateStatusBar(`正在获取（${pagesFetched}页, ${totalProjects}个）...`, 'info');
                            updateStatistics(pagesFetched);

                            if (reachedLastPage) break;
                        }
                    }
                } else {
                    // API搜索返回0 → 回退: 全量获取+客户端多字段过滤
                    log(`API搜索无结果，切换为全量获取+客户端过滤模式`, 'warn');
                    log(`将获取全部数据后按多字段(项目名/剧目/抖音号等)过滤 "${keyword}"`);

                    const result = await fetchAllPages(null, item => matchKeyword(item, keyword));
                    if (!result.firstList || result.firstList.length === 0) {
                        log('全量过滤后无匹配项目', 'warn');
                        updateStatusBar('搜索完成: 0个项目', 'warn');
                        return;
                    }
                }
            } else {
                // 无关键词 → 获取全部数据
                const result = await fetchAllPages(null, null);
                if (!result.firstList || result.firstList.length === 0) {
                    log('无数据', 'warn');
                    updateStatusBar('搜索完成: 0个项目', 'warn');
                    return;
                }
            }

            log(`===== 搜索完成 =====`, 'success');
            log(`共获取 ${state.allProjects.length} 个项目`);
            log(`有消耗: ${state.costProjects.length} | 零消耗: ${state.zeroCostProjects.length}`);
            log(`不重复剧目: ${state.uniqueDramas.size} 部 | 不重复抖音号: ${state.uniqueAccounts.size} 个`);

            updateStatusBar(`搜索完成: ${state.allProjects.length}个项目, ${state.uniqueDramas.size}部剧目`, 'success');
            updateStatistics();

        } catch (e) {
            log(`获取项目出错: ${e.message}`, 'error');
            console.error(e);
        } finally {
            state.isProcessing = false;
            updateButtonStates();
        }
    }

    // ============================
    // 核心 - API批量删除零消耗项目 (含验证重试)
    // ============================
    async function apiBatchDeleteZeroCost() {
        if (state.isProcessing) {
            log('已有操作进行中', 'warn');
            return;
        }

        // 如果还没有项目数据，先获取
        if (state.allProjects.length === 0) {
            log('请先获取项目列表', 'warn');
            return;
        }

        if (state.zeroCostProjects.length === 0) {
            log('没有零消耗项目需要删除', 'success');
            return;
        }

        state.isProcessing = true;
        state.shouldStop = false;

        // 保存已删除的项目ID集合 (用于验证时排除)
        const deletedIds = new Set();
        // 待删除队列 (初始为全部零消耗项目)
        let pendingDelete = [...state.zeroCostProjects];

        try {
            log('===== 开始API批量删除零消耗项目 =====', 'success');
            log(`待删除: ${pendingDelete.length} 个 | 受保护: ${state.costProjects.length} 个`);
            updateStatusBar(`正在删除（0/${pendingDelete.length}）...`, 'info');

            // 显示待删除项目列表
            log(`即将删除以下项目 (前20个):`, 'warn');
            for (const p of pendingDelete.slice(0, 20)) {
                log(`  - ${p.project_name} | 剧目: ${p.drama_name} | 抖音号: ${p.account_name} | 成本: ${p.costRaw}`);
            }
            if (pendingDelete.length > 20) {
                log(`  ... 还有 ${pendingDelete.length - 20} 个`);
            }

            // 用户确认
            const confirmed = await showConfirmDialog(
                `确认删除 ${pendingDelete.length} 个零消耗项目？`,
                `有消耗的 ${state.costProjects.length} 个项目将被保护，不会被删除。此操作通过API直接执行，速度极快。`
            );
            if (!confirmed) {
                log('用户取消了操作', 'warn');
                updateStatusBar('已取消删除', 'warn');
                return;
            }

            let totalRound = 0;

            // === 多轮删除+验证 ===
            while (pendingDelete.length > 0 && totalRound < CONFIG.deleteRetryMax && !state.shouldStop) {
                totalRound++;
                const isRetry = totalRound > 1;

                log(`\n===== 第 ${totalRound} 轮${isRetry ? ' (重试)' : ''}: 删除 ${pendingDelete.length} 个项目 =====`, isRetry ? 'warn' : 'success');

                // 分批删除当前待删除队列
                let roundDeleted = 0;
                let batchNum = 0;
                const batchSize = CONFIG.deleteBatchSize;

                while (!state.shouldStop && roundDeleted < pendingDelete.length) {
                    batchNum++;
                    const batch = pendingDelete.slice(roundDeleted, roundDeleted + batchSize);

                    log(`--- 第 ${totalRound} 轮 第 ${batchNum} 批: 删除 ${batch.length} 个 ---`);

                    const success = await batchDeleteProjects(batch);
                    if (success) {
                        roundDeleted += batch.length;
                        // 记录已删除的ID
                        for (const p of batch) {
                            deletedIds.add(String(p.project_id));
                        }
                        const totalDeleted = deletedIds.size;
                        log(`本轮累计删除 ${roundDeleted} / ${pendingDelete.length}`, 'success');
                        updateStatusBar(`正在删除（${totalDeleted}/${state.zeroCostProjects.length}）...`, 'info');
                    } else {
                        log(`第 ${batchNum} 批删除失败，跳过剩余批次`, 'error');
                        break;
                    }

                    await sleep(CONFIG.apiDelay);
                }

                log(`第 ${totalRound} 轮完成: 删除了 ${roundDeleted} 个项目`);

                // 如果还有更多轮次，验证是否有遗留
                if (totalRound < CONFIG.deleteRetryMax && !state.shouldStop) {
                    log(`等待 ${CONFIG.deleteVerifyDelay / 1000} 秒，让服务器处理删除...`);
                    updateStatusBar('正在验证删除结果...', 'info');
                    await sleep(CONFIG.deleteVerifyDelay);

                    log(`开始验证: 重新获取项目列表检查遗留...`);
                    const remaining = await verifyDeletedProjects(deletedIds);

                    if (remaining.length === 0) {
                        log(`验证通过: 没有遗留项目，删除完全成功!`, 'success');
                        break;
                    } else {
                        log(`发现 ${remaining.length} 个遗留项目，准备第 ${totalRound + 1} 轮重试`, 'warn');
                        // 显示遗留项目示例
                        for (const p of remaining.slice(0, 5)) {
                            log(`  遗留: ${p.project_name} (id=${p.project_id})`);
                        }
                        if (remaining.length > 5) {
                            log(`  ... 还有 ${remaining.length - 5} 个`);
                        }
                        // 更新待删除队列为遗留项目
                        pendingDelete = remaining;
                    }
                } else if (pendingDelete.length > 0 && totalRound >= CONFIG.deleteRetryMax) {
                    log(`已达到最大重试次数 (${CONFIG.deleteRetryMax})，剩余 ${pendingDelete.length} 个未删除`, 'warn');
                }
            }

            log(`\n===== 删除完成 =====`, 'success');
            log(`共删除 ${deletedIds.size} 个零消耗项目，分 ${totalRound} 轮完成`);
            if (pendingDelete.length > 0) {
                log(`仍有 ${pendingDelete.length} 个未删除 (可能需要手动处理)`, 'warn');
                updateStatusBar(`删除完成: ${deletedIds.size}个已删, ${pendingDelete.length}个未删`, 'warn');
            } else {
                updateStatusBar(`删除完成: 共删除${deletedIds.size}个项目`, 'success');
            }

            // 更新状态
            state.zeroCostProjects = pendingDelete; // 剩余未删除的
            state.allProjects = state.costProjects.concat(state.zeroCostProjects);
            updateStatistics();

            // 提示刷新
            log(`建议刷新页面查看最新状态`, 'info');

        } catch (e) {
            log(`批量删除出错: ${e.message}`, 'error');
            console.error(e);
        } finally {
            state.isProcessing = false;
            updateButtonStates();
        }
    }

    // ============================
    // 验证删除结果 - 重新获取项目列表，检查零消耗项目是否仍存在
    // ============================
    async function verifyDeletedProjects(deletedIds) {
        const remaining = [];
        let page = 1;
        let checked = 0;

        while (!state.shouldStop && page <= CONFIG.deleteVerifyPages) {
            const result = await fetchProjectList(state.currentKeyword, page, CONFIG.pageSize);
            if (!result.success || !result.list || result.list.length === 0) {
                break;
            }

            for (const item of result.list) {
                const pid = String(item.project_id);
                // 提取消耗
                const costRaw = item.metrics?.all_stat_total_cost_trend
                    || item.all_stat_total_cost_trend
                    || item.cost
                    || '0';
                const cost = parseFloat(costRaw) || 0;

                // 只关心零消耗且在已删除列表中的项目 (说明删除未生效)
                if (cost === 0 && deletedIds.has(pid)) {
                    const project = {
                        project_id: item.project_id,
                        project_name: item.project_name,
                        advertiser_id: item.advertiser_id,
                        group_id: item.group_id,
                        drama_name: item.product_name || '',
                        account_name: item.roi3_aweme_name || '',
                        product_name: item.product_name || '',
                        roi3_aweme_name: item.roi3_aweme_name || '',
                        cost: cost,
                        costRaw: costRaw,
                        status: item.oc_project_status_first_name || '',
                        create_time: item.create_time || '',
                        shouldDelete: true,
                        isProtected: false,
                    };
                    remaining.push(project);
                }
                checked++;
            }

            log(`验证第 ${page} 页: ${result.list.length} 条, 累计检查 ${checked} 条, 遗留 ${remaining.length} 个`);

            if (result.list.length < CONFIG.pageSize) break;
            page++;
            await sleep(CONFIG.apiDelay);
        }

        return remaining;
    }

    // ============================
    // 核心 - 通过API搜索项目
    // ============================
    async function searchByKeywordAPI(keyword) {
        if (!keyword || !keyword.trim()) {
            log('请输入搜索关键词', 'warn');
            return;
        }
        await fetchAllProjects(keyword.trim());
    }

    // ============================
    // 状态栏更新
    // ============================
    function updateStatusBar(text, type = 'info') {
        const el = document.getElementById('oePmStatus');
        if (!el) return;
        el.textContent = text;
        el.className = `oe-pm-status ${type}`;
    }

    // ============================
    // 查看汇总弹窗
    // ============================
    function showProjectSummary() {
        if (state.allProjects.length === 0) {
            updateStatusBar('请先搜索项目', 'warn');
            return;
        }

        // 剧目统计（按项目数排序，取前30）
        const dramaList = Object.entries(state.dramaCountMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30);

        // 抖音号统计（按项目数排序，取前20）
        const accountList = Object.entries(state.accountCountMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        const overlay = document.createElement('div');
        overlay.id = 'oe-pm-summary-overlay';
        overlay.style.cssText = `
            position:fixed;top:0;left:0;right:0;bottom:0;
            background:rgba(46,61,47,0.4);z-index:100001;
            display:flex;align-items:center;justify-content:center;
            animation:oePmFadeIn 0.2s ease;
        `;

        overlay.innerHTML = `
            <div style="background:#f1f8f4;border-radius:16px;width:520px;max-width:92%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(126,198,153,0.3);overflow:hidden;animation:oePmScaleIn 0.3s ease;">
                <div style="background:linear-gradient(135deg,#7ec699 0%,#5bb87a 100%);color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <div style="font-size:15px;font-weight:600;">项目汇总</div>
                    <button id="oePmSummaryClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:0.8;">&times;</button>
                </div>
                <div style="padding:16px 20px;overflow-y:auto;flex:1;">
                    <!-- 概览 -->
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#5bb187;">${state.allProjects.length}</div>
                            <div style="font-size:11px;color:#8a9b8c;">总项目</div>
                        </div>
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#66bb6a;">${state.costProjects.length}</div>
                            <div style="font-size:11px;color:#8a9b8c;">有消耗</div>
                        </div>
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#e57373;">${state.zeroCostProjects.length}</div>
                            <div style="font-size:11px;color:#8a9b8c;">零消耗</div>
                        </div>
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#7ec699;">${state.uniqueDramas.size}</div>
                            <div style="font-size:11px;color:#8a9b8c;">不重复剧目</div>
                        </div>
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#ffa726;">${state.uniqueAccounts.size}</div>
                            <div style="font-size:11px;color:#8a9b8c;">不重复抖音号</div>
                        </div>
                        <div style="text-align:center;background:#e8f5e9;border-radius:10px;padding:10px 6px;">
                            <div style="font-size:22px;font-weight:700;color:#999;">${(state.zeroCostProjects.length / Math.max(state.allProjects.length, 1) * 100).toFixed(1)}%</div>
                            <div style="font-size:11px;color:#8a9b8c;">零消耗占比</div>
                        </div>
                    </div>

                    <!-- 剧目列表 -->
                    <div style="font-size:13px;font-weight:600;color:#2e3d2f;margin-bottom:8px;">剧目排行 (前${dramaList.length}部, 共${state.uniqueDramas.size}部)</div>
                    <div style="background:#fff;border:1px solid #d4ebe0;border-radius:10px;padding:8px 12px;max-height:200px;overflow-y:auto;margin-bottom:16px;">
                        ${dramaList.length === 0 ? '<div style="color:#999;text-align:center;padding:10px;">暂无剧目数据</div>' :
                            dramaList.map(([name, count]) => {
                                const accts = state.dramaAccountsMap[name] ? Array.from(state.dramaAccountsMap[name]).filter(a => a) : [];
                                return `
                                <div style="padding:6px 0;border-bottom:1px solid #f0f7f2;">
                                    <div style="display:flex;justify-content:space-between;align-items:center;">
                                        <span style="font-size:12px;color:#4a5c4b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                                        <span style="font-size:12px;font-weight:600;color:#5bb187;margin-left:8px;flex-shrink:0;">${count}个项目 | ${accts.length}个抖音号</span>
                                    </div>
                                    ${accts.length > 0 ? `<div style="font-size:11px;color:#8a9b8c;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${accts.join('、')}</div>` : ''}
                                </div>
                                `;
                            }).join('')
                        }
                    </div>

                    <!-- 抖音号列表 -->
                    <div style="font-size:13px;font-weight:600;color:#2e3d2f;margin-bottom:8px;">抖音号排行 (前${accountList.length}个, 共${state.uniqueAccounts.size}个)</div>
                    <div style="background:#fff;border:1px solid #d4ebe0;border-radius:10px;padding:8px 12px;max-height:150px;overflow-y:auto;">
                        ${accountList.length === 0 ? '<div style="color:#999;text-align:center;padding:10px;">暂无抖音号数据</div>' :
                            accountList.map(([name, count]) => `
                                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f0f7f2;">
                                    <span style="font-size:12px;color:#4a5c4b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || '(空)'}</span>
                                    <span style="font-size:12px;font-weight:600;color:#ffa726;margin-left:8px;flex-shrink:0;">${count}个</span>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
                <div style="padding:12px 20px;border-top:1px solid #d4ebe0;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">
                    <button id="oePmSummaryExport" style="padding:8px 18px;border:1px solid #c8e6c9;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;color:#6b7b6c;">导出Excel</button>
                    <button id="oePmSummaryClose2" style="padding:8px 18px;border:none;background:linear-gradient(135deg,#7ec699 0%,#5bb187 100%);border-radius:8px;cursor:pointer;font-size:13px;color:#fff;font-weight:600;">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#oePmSummaryClose').onclick = close;
        overlay.querySelector('#oePmSummaryClose2').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        // 导出Excel (使用SheetJS)
        overlay.querySelector('#oePmSummaryExport').onclick = () => {
            if (typeof XLSX === 'undefined') {
                updateStatusBar('XLSX库未加载，请刷新页面重试', 'error');
                return;
            }

            const wb = XLSX.utils.book_new();
            const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '');

            // === Sheet 1: 剧目汇总（含抖音号） ===
            const dramaSheetData = [['剧目名称', '项目数', '抖音号数量', '抖音号列表']];
            const allDramas = Object.entries(state.dramaCountMap)
                .sort((a, b) => b[1] - a[1]);
            for (const [name, count] of allDramas) {
                const accounts = state.dramaAccountsMap[name] 
                    ? Array.from(state.dramaAccountsMap[name]).filter(a => a) 
                    : [];
                dramaSheetData.push([
                    name,
                    count,
                    accounts.length,
                    accounts.join('、')
                ]);
            }
            const dramaSheet = XLSX.utils.aoa_to_sheet(dramaSheetData);
            dramaSheet['!cols'] = [{ wch: 40 }, { wch: 8 }, { wch: 10 }, { wch: 80 }];
            XLSX.utils.book_append_sheet(wb, dramaSheet, '剧目汇总');

            // === Sheet 2: 抖音号汇总 ===
            const accountSheetData = [['抖音号', '项目数']];
            const allAccounts = Object.entries(state.accountCountMap)
                .sort((a, b) => b[1] - a[1]);
            for (const [name, count] of allAccounts) {
                accountSheetData.push([name || '(空)', count]);
            }
            const accountSheet = XLSX.utils.aoa_to_sheet(accountSheetData);
            accountSheet['!cols'] = [{ wch: 40 }, { wch: 8 }];
            XLSX.utils.book_append_sheet(wb, accountSheet, '抖音号汇总');

            // === Sheet 3: 项目明细 ===
            const projectSheetData = [['项目名称', '剧目', '抖音号', '消耗', '状态', '项目ID']];
            for (const p of state.allProjects) {
                projectSheetData.push([
                    p.project_name || '',
                    p.drama_name || '',
                    p.account_name || '',
                    p.cost || 0,
                    p.status || '',
                    String(p.project_id || '')
                ]);
            }
            const projectSheet = XLSX.utils.aoa_to_sheet(projectSheetData);
            projectSheet['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 20 }];
            XLSX.utils.book_append_sheet(wb, projectSheet, '项目明细');

            // === Sheet 4: 概览 ===
            const overviewData = [
                ['项目汇总报告', ''],
                ['生成时间', new Date().toLocaleString('zh-CN')],
                ['搜索关键词', state.currentKeyword || '(全部)'],
                ['', ''],
                ['总项目数', state.allProjects.length],
                ['有消耗项目', state.costProjects.length],
                ['零消耗项目', state.zeroCostProjects.length],
                ['不重复剧目', state.uniqueDramas.size],
                ['不重复抖音号', state.uniqueAccounts.size],
                ['零消耗占比', (state.zeroCostProjects.length / Math.max(state.allProjects.length, 1) * 100).toFixed(1) + '%'],
            ];
            const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
            overviewSheet['!cols'] = [{ wch: 20 }, { wch: 30 }];
            XLSX.utils.book_append_sheet(wb, overviewSheet, '概览');

            XLSX.writeFile(wb, `项目汇总_${dateStr}.xlsx`);
        };
    }

    // ============================
    // 批量搜索剧目对话框
    // ============================
    function showBatchDramaDialog() {
        const overlay = document.createElement('div');
        overlay.id = 'oe-pm-batch-overlay';
        overlay.style.cssText = `
            position:fixed;top:0;left:0;right:0;bottom:0;
            background:rgba(46,61,47,0.4);z-index:100001;
            display:flex;align-items:center;justify-content:center;
            animation:oePmFadeIn 0.2s ease;
        `;

        overlay.innerHTML = `
            <div style="background:#f1f8f4;border-radius:16px;padding:0;width:460px;max-width:90%;box-shadow:0 12px 48px rgba(126,198,153,0.3);overflow:hidden;animation:oePmScaleIn 0.3s ease;">
                <div style="background:linear-gradient(135deg,#7ec699 0%,#5bb87a 100%);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:15px;font-weight:600;">批量搜索剧目</div>
                        <div style="font-size:12px;opacity:0.9;margin-top:2px;">每行一个剧目名，一次性获取全部数据后批量过滤</div>
                    </div>
                    <button id="oePmBatchClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;opacity:0.8;">&times;</button>
                </div>
                <div style="padding:16px 20px;">
                    <textarea id="oePmBatchInput" placeholder="请粘贴或输入剧目名称，每行一个...&#10;例如:&#10;婚礼当天我成了亲戚的付款人&#10;我妈的煎饼摊&#10;荒滩变良田第一季"
                        style="width:100%;height:180px;padding:12px;border:2px solid #c8e6c9;border-radius:10px;font-size:13px;line-height:1.8;resize:vertical;outline:none;background:#fff;color:#2e3d2f;font-family:inherit;"></textarea>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
                        <span id="oePmBatchCount" style="font-size:12px;color:#6b7b6c;">0 个剧目</span>
                        <div style="display:flex;gap:8px;">
                            <button id="oePmBatchClear" style="padding:7px 16px;border:1px solid #c8e6c9;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;color:#6b7b6c;">清空</button>
                            <button id="oePmBatchSearch" style="padding:7px 20px;border:none;background:linear-gradient(135deg,#7ec699 0%,#5bb187 100%);border-radius:8px;cursor:pointer;font-size:13px;color:#fff;font-weight:600;">开始搜索</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        const textarea = overlay.querySelector('#oePmBatchInput');
        const countEl = overlay.querySelector('#oePmBatchCount');

        const updateCount = () => {
            const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
            countEl.textContent = `${lines.length} 个剧目`;
        };
        textarea.addEventListener('input', updateCount);

        const close = () => overlay.remove();
        overlay.querySelector('#oePmBatchClose').onclick = close;
        overlay.querySelector('#oePmBatchClear').onclick = () => { textarea.value = ''; updateCount(); textarea.focus(); };
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        overlay.querySelector('#oePmBatchSearch').onclick = async () => {
            const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length === 0) {
                textarea.focus();
                return;
            }
            close();
            await batchSearchDramas(lines);
        };

        textarea.focus();
    }

    // ============================
    // 批量搜索剧目 - 先用搜索框关键词缩小范围，再按product_name过滤
    // 不依赖API的total字段，持续获取直到一页返回不满pageSize条
    // ============================
    async function batchSearchDramas(dramaNames) {
        if (state.isProcessing) {
            log('已有操作进行中', 'warn');
            return;
        }

        state.isProcessing = true;
        state.shouldStop = false;
        state.allProjects = [];
        state.zeroCostProjects = [];
        state.costProjects = [];
        state.uniqueDramas = new Set();
        state.dramaCountMap = {};
        state.dramaAccountsMap = {};
        state.uniqueAccounts = new Set();
        state.accountCountMap = {};

        // 读取搜索框关键词，用于缩小API搜索范围
        const searchInput = document.getElementById('oePmSearchInput');
        const searchKeyword = searchInput && searchInput.value.trim() ? searchInput.value.trim() : null;

        try {
            log(`===== 批量搜索 ${dramaNames.length} 个剧目 =====`, 'success');
            if (searchKeyword) {
                log(`步骤1: 使用搜索框关键词 "${searchKeyword}" 缩小范围，再按剧目信息过滤`);
            } else {
                log(`步骤1: 获取全部项目数据（搜索框为空），再按剧目信息过滤`);
            }
            updateStatusBar('正在获取项目数据...', 'info');

            // Step 1: 获取第一页 (有搜索框关键词则用它，否则获取全部)
            const firstResult = await fetchProjectList(searchKeyword, 1, CONFIG.pageSize);
            if (!firstResult.success) {
                log(`获取第一页失败: ${firstResult.error || '未知错误'}`, 'error');
                return;
            }

            const list = firstResult.list;
            if (!list || list.length === 0) {
                log('第 1 页无数据，请确认页面有项目', 'warn');
                updateStatusBar('搜索完成: 0个项目', 'warn');
                return;
            }

            if (firstResult.total) {
                log(`API报告总数: ${firstResult.total} 个项目`);
            }

            const allRawItems = [...list];
            let pagesFetched = 1;
            log(`第 1 页: ${list.length} 个 | 累计: ${allRawItems.length}`);
            updateStatusBar(`正在获取（第1页, ${allRawItems.length}个）...`, 'info');

            // 如果第一页不满pageSize条，说明只有一页
            if (list.length < CONFIG.pageSize) {
                log('仅一页数据，获取完成', 'success');
            } else {
                // Step 2: 持续并行获取，直到某页返回不满pageSize条
                const concurrency = CONFIG.batchConcurrency;
                let page = 2;

                while (!state.shouldStop && page <= CONFIG.maxPages) {
                    const batch = [];
                    for (let i = 0; i < concurrency && page <= CONFIG.maxPages; i++) {
                        batch.push(page++);
                    }

                    const results = await Promise.all(batch.map(p => fetchProjectList(searchKeyword, p, CONFIG.pageSize)));

                    let reachedLastPage = false;
                    for (const result of results) {
                        pagesFetched++;
                        if (result.success && result.list && result.list.length > 0) {
                            allRawItems.push(...result.list);
                            if (result.list.length < CONFIG.pageSize) {
                                reachedLastPage = true;
                            }
                        } else {
                            reachedLastPage = true;
                        }
                    }
                    log(`已获取 ${pagesFetched} 页 | 累计: ${allRawItems.length} 个项目`);
                    updateStatusBar(`正在获取（${pagesFetched}页, ${allRawItems.length}个）...`, 'info');
                    updateStatistics(pagesFetched);

                    if (reachedLastPage) break;
                }
            }

            log(`数据获取完成: ${allRawItems.length} 个项目`);
            log(`步骤2: 客户端按剧目信息(product_name)批量过滤`);

            // Step 3: 客户端按多个剧目名称过滤 (一次性遍历)
            const kwList = dramaNames.map(n => n.trim().toLowerCase()).filter(n => n);
            const dramaFoundMap = {};
            kwList.forEach(kw => { dramaFoundMap[kw] = 0; });

            const filteredItems = allRawItems.filter(item => {
                const dramaName = (item.product_name || '').toLowerCase();
                if (!dramaName) return false;
                for (const kw of kwList) {
                    if (dramaName.includes(kw)) {
                        dramaFoundMap[kw]++;
                        return true;
                    }
                }
                return false;
            });

            // 日志: 每个剧目找到多少
            let totalFound = 0;
            for (let i = 0; i < dramaNames.length; i++) {
                const kw = dramaNames[i].trim().toLowerCase();
                const count = dramaFoundMap[kw] || 0;
                totalFound += count;
                log(`剧目 [${i + 1}/${dramaNames.length}]: ${dramaNames[i]} → 找到 ${count} 个项目`);
            }

            log(`批量过滤完成: ${allRawItems.length} → ${filteredItems.length} 个项目`);

            // Step 4: 处理过滤后的数据
            for (const item of filteredItems) {
                const costRaw = item.metrics?.all_stat_total_cost_trend
                    || item.all_stat_total_cost_trend || item.cost || '0';
                const cost = parseFloat(costRaw) || 0;
                const dName = item.product_name || '';
                const aName = item.roi3_aweme_name || '';

                const project = {
                    project_id: item.project_id,
                    project_name: item.project_name,
                    advertiser_id: item.advertiser_id,
                    group_id: item.group_id,
                    drama_name: dName,
                    account_name: aName,
                    product_name: dName,
                    roi3_aweme_name: aName,
                    cost: cost,
                    costRaw: costRaw,
                    status: item.oc_project_status_first_name || '',
                    create_time: item.create_time || '',
                    shouldDelete: cost === 0,
                    isProtected: cost > 0,
                };

                state.allProjects.push(project);
                if (cost > 0) state.costProjects.push(project);
                else state.zeroCostProjects.push(project);

                if (dName) {
                    state.uniqueDramas.add(dName);
                    state.dramaCountMap[dName] = (state.dramaCountMap[dName] || 0) + 1;
                    if (!state.dramaAccountsMap[dName]) state.dramaAccountsMap[dName] = new Set();
                    if (aName) state.dramaAccountsMap[dName].add(aName);
                }
                if (aName) {
                    state.uniqueAccounts.add(aName);
                    state.accountCountMap[aName] = (state.accountCountMap[aName] || 0) + 1;
                }
            }

            log(`===== 批量搜索完成 =====`, 'success');
            log(`共搜索 ${dramaNames.length} 个剧目, 找到 ${totalFound} 个项目`);
            log(`有消耗: ${state.costProjects.length} | 零消耗: ${state.zeroCostProjects.length}`);
            log(`不重复剧目: ${state.uniqueDramas.size} 部 | 不重复抖音号: ${state.uniqueAccounts.size} 个`);

            updateStatusBar(`搜索完成: ${totalFound}个项目, ${state.uniqueDramas.size}部剧目`, 'success');
            updateStatistics();

        } catch (e) {
            log(`批量搜索出错: ${e.message}`, 'error');
            console.error(e);
            updateStatusBar(`搜索出错: ${e.message}`, 'error');
        } finally {
            state.isProcessing = false;
            updateButtonStates();
        }
    }

    // ============================
    // 安全 - 确认对话框
    // ============================
    function showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.id = 'oe-pm-confirm-overlay';
            overlay.style.cssText = `
                position:fixed;top:0;left:0;right:0;bottom:0;
                background:rgba(46,61,47,0.4);z-index:100002;
                display:flex;align-items:center;justify-content:center;
                animation:oePmFadeIn 0.2s ease;
            `;

            overlay.innerHTML = `
                <div style="background:#f1f8f4;border-radius:14px;padding:24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(126,198,153,0.25);animation:oePmScaleIn 0.3s ease;">
                    <div style="font-size:16px;font-weight:600;color:#2e3d2f;margin-bottom:8px;">${title}</div>
                    <div style="font-size:13px;color:#6b7b6c;line-height:1.6;margin-bottom:20px;">${message}</div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="oePmConfirmCancel" style="padding:8px 18px;border:1px solid #c8e6c9;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;color:#6b7b6c;">取消</button>
                        <button id="oePmConfirmOk" style="padding:8px 18px;border:none;background:linear-gradient(135deg,#e57373 0%,#ef5350 100%);border-radius:8px;cursor:pointer;font-size:13px;color:#fff;font-weight:600;">确认删除</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            const cleanup = (result) => { overlay.remove(); resolve(result); };
            overlay.querySelector('#oePmConfirmOk').onclick = () => cleanup(true);
            overlay.querySelector('#oePmConfirmCancel').onclick = () => cleanup(false);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
        });
    }

    // ============================
    // UI - 创建浮动小球 + 面板
    // ============================
    function createUI() {
        if (document.getElementById('oe-pm-ball')) return;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes oePmFadeIn { from{opacity:0} to{opacity:1} }
            @keyframes oePmScaleIn { from{transform:scale(0.9);opacity:0} to{transform:scale(1);opacity:1} }
            @keyframes oePmSlideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
            @keyframes oePmPulse { 0%,100%{transform:scale(1);box-shadow:0 4px 16px rgba(126,198,153,0.4)} 50%{transform:scale(1.05);box-shadow:0 6px 24px rgba(126,198,153,0.6)} }
            @keyframes oePmSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }

            /* === 浮动小球 === */
            #oe-pm-ball {
                position:fixed;top:100px;right:30px;z-index:100000;
                width:52px;height:52px;border-radius:50%;
                background:linear-gradient(135deg,#7ec699 0%,#5bb187 100%);
                cursor:pointer;user-select:none;
                display:flex;align-items:center;justify-content:center;
                box-shadow:0 4px 16px rgba(126,198,153,0.4);
                transition:transform 0.2s,box-shadow 0.2s;
                animation:oePmPulse 3s ease-in-out infinite;
            }
            #oe-pm-ball:hover { transform:scale(1.1); }
            #oe-pm-ball:active { transform:scale(0.95); }
            #oe-pm-ball svg { width:26px;height:26px; }
            #oe-pm-ball .oe-pm-ball-badge {
                position:absolute;top:-2px;right:-2px;
                min-width:18px;height:18px;border-radius:9px;
                background:#e57373;color:#fff;font-size:10px;
                display:flex;align-items:center;justify-content:center;
                font-weight:700;padding:0 4px;border:2px solid #f1f8f4;
                display:none;
            }
            #oe-pm-ball .oe-pm-ball-badge.show { display:flex; }
            #oe-pm-ball.processing svg { animation:oePmSpin 1.5s linear infinite; }

            /* === 面板 === */
            #oe-pm-panel {
                position:fixed;top:80px;right:30px;z-index:100000;
                width:340px;background:#f1f8f4;border-radius:16px;
                box-shadow:0 8px 32px rgba(126,198,153,0.2);
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
                font-size:13px;overflow:hidden;display:none;
                animation:oePmSlideUp 0.3s ease;
                border:1px solid #d4ebe0;
            }
            #oe-pm-panel * { box-sizing:border-box; }
            #oe-pm-panel.show { display:block; }

            .oe-pm-header {
                background:linear-gradient(135deg,#7ec699 0%,#5bb187 100%);
                color:#fff;padding:12px 16px;display:flex;
                justify-content:space-between;align-items:center;
                cursor:move;user-select:none;
            }
            .oe-pm-title { font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px; }
            .oe-pm-controls { display:flex;gap:6px; }
            .oe-pm-btn-icon {
                background:rgba(255,255,255,0.25);border:none;color:#fff;
                width:26px;height:26px;border-radius:8px;cursor:pointer;
                font-size:16px;display:flex;align-items:center;justify-content:center;
                transition:background 0.2s;
            }
            .oe-pm-btn-icon:hover { background:rgba(255,255,255,0.4); }

            .oe-pm-body { padding:14px 16px; max-height:520px; overflow-y:auto; }
            .oe-pm-body::-webkit-scrollbar { width:5px; }
            .oe-pm-body::-webkit-scrollbar-thumb { background:#c8e6c9;border-radius:3px; }
            .oe-pm-body::-webkit-scrollbar-track { background:transparent; }

            .oe-pm-search-row { display:flex;gap:6px;align-items:center; }
            .oe-pm-input-wrap { flex:1;position:relative; }
            .oe-pm-input {
                width:100%;padding:8px 30px 8px 12px;border:1.5px solid #c8e6c9;
                border-radius:10px;font-size:13px;outline:none;
                background:#fff;color:#2e3d2f;
                transition:border-color 0.2s,box-shadow 0.2s;
            }
            .oe-pm-input:focus { border-color:#7ec699;box-shadow:0 0 0 3px rgba(126,198,153,0.15); }
            .oe-pm-input::placeholder { color:#a5c4a8; }
            .oe-pm-input-clear {
                position:absolute;right:8px;top:50%;transform:translateY(-50%);
                width:18px;height:18px;border-radius:50%;
                background:#c8e6c9;border:none;cursor:pointer;
                display:none;align-items:center;justify-content:center;
                font-size:12px;color:#5bb187;line-height:1;
                transition:background 0.2s,transform 0.2s;
            }
            .oe-pm-input-clear:hover { background:#a5d6a7;transform:translateY(-50%) scale(1.1); }
            .oe-pm-input-clear.show { display:flex; }

            .oe-pm-btn {
                padding:8px 14px;border:1.5px solid #c8e6c9;background:#fff;
                border-radius:10px;cursor:pointer;font-size:13px;
                color:#4a5c4b;transition:all 0.2s;white-space:nowrap;
                font-weight:500;
            }
            .oe-pm-btn:hover { border-color:#7ec699;color:#5bb187;background:#edf7f0; }
            .oe-pm-btn:active { transform:scale(0.96); }
            .oe-pm-btn:disabled { opacity:0.5;cursor:not-allowed; }

            .oe-pm-btn-primary {
                background:linear-gradient(135deg,#7ec699 0%,#5bb187 100%);
                color:#fff;border-color:transparent;
            }
            .oe-pm-btn-primary:hover { background:linear-gradient(135deg,#8ed8a9 0%,#6bc397 100%);color:#fff; }

            .oe-pm-btn-danger {
                background:linear-gradient(135deg,#e57373 0%,#ef5350 100%);
                color:#fff;border-color:transparent;
            }
            .oe-pm-btn-danger:hover { background:linear-gradient(135deg,#ef8585 0%,#f56565 100%);color:#fff; }

            .oe-pm-btn-stop {
                background:#fff;border:1.5px solid #e57373;color:#e57373;
                display:none;
            }
            .oe-pm-btn-stop.active { display:inline-block;animation:oePmPulse 1.5s infinite; }
            .oe-pm-btn-stop:hover { background:#fef0f0; }

            /* 统计 */
            .oe-pm-stats {
                display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;
                background:#e8f5e9;border-radius:10px;padding:10px 8px;
            }
            .oe-pm-stat-item { text-align:center; }
            .oe-pm-stat-value { font-size:18px;font-weight:700;color:#5bb187;line-height:1.2; }
            .oe-pm-stat-value.danger { color:#e57373; }
            .oe-pm-stat-value.success { color:#66bb6a; }
            .oe-pm-stat-value.warning { color:#ffa726; }
            .oe-pm-stat-label { font-size:10px;color:#8a9b8c;margin-top:2px; }

            /* 底部状态栏 */
            .oe-pm-status {
                padding:8px 16px;background:#e8f5e9;
                font-size:12px;color:#4a5c4b;
                border-top:1px solid #d4ebe0;
                display:flex;align-items:center;gap:6px;
                min-height:34px;
            }
            .oe-pm-status.info { color:#5bb187; }
            .oe-pm-status.success { color:#43a047; }
            .oe-pm-status.warn { color:#fb8c00; }
            .oe-pm-status.error { color:#e53935; }
            .oe-pm-status::before {
                content:'';width:8px;height:8px;border-radius:50%;
                background:currentColor;flex-shrink:0;
            }
            .oe-pm-status.info::before { animation:oePmPulse 1.5s infinite; }
        `;
        document.head.appendChild(style);

        // === 浮动小球 ===
        const ball = document.createElement('div');
        ball.id = 'oe-pm-ball';
        ball.title = '点击打开项目管理工具';
        ball.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <span class="oe-pm-ball-badge" id="oePmBallBadge"></span>
        `;
        document.body.appendChild(ball);

        // === 面板 ===
        const panel = document.createElement('div');
        panel.id = 'oe-pm-panel';
        panel.innerHTML = `
            <div class="oe-pm-header" id="oePmHeader">
                <div class="oe-pm-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                    <span>项目批量管理</span>
                </div>
                <div class="oe-pm-controls">
                    <button class="oe-pm-btn-icon" id="oePmMin" title="收起为小球">&minus;</button>
                </div>
            </div>
            <div class="oe-pm-body">
                <!-- 搜索 -->
                <div class="oe-pm-search-row" style="margin-bottom:10px;">
                    <div class="oe-pm-input-wrap">
                        <input class="oe-pm-input" id="oePmSearchInput" placeholder="输入关键词搜索项目..." />
                        <button class="oe-pm-input-clear" id="oePmSearchClear" title="清空">&times;</button>
                    </div>
                    <button class="oe-pm-btn" id="oePmBatchDramaBtn" title="批量搜索剧目">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">
                            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                        </svg>
                    </button>
                    <button class="oe-pm-btn oe-pm-btn-primary" id="oePmSearchBtn">搜索</button>
                </div>

                <!-- 统计 -->
                <div class="oe-pm-stats" style="margin-bottom:10px;">
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value" id="oePmStatTotal">0</div>
                        <div class="oe-pm-stat-label">总项目</div>
                    </div>
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value success" id="oePmStatCost">0</div>
                        <div class="oe-pm-stat-label">有消耗</div>
                    </div>
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value danger" id="oePmStatZero">0</div>
                        <div class="oe-pm-stat-label">零消耗</div>
                    </div>
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value" id="oePmStatDrama" style="color:#7ec699;">0</div>
                        <div class="oe-pm-stat-label">剧目</div>
                    </div>
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value warning" id="oePmStatAccount">0</div>
                        <div class="oe-pm-stat-label">抖音号</div>
                    </div>
                    <div class="oe-pm-stat-item">
                        <div class="oe-pm-stat-value" id="oePmStatPage" style="color:#999;font-size:14px;">0</div>
                        <div class="oe-pm-stat-label">已获取页</div>
                    </div>
                </div>

                <!-- 操作 -->
                <div style="display:flex;gap:8px;">
                    <button class="oe-pm-btn" id="oePmSummaryBtn" style="flex:1;font-weight:600;">
                        查看汇总
                    </button>
                    <button class="oe-pm-btn oe-pm-btn-danger" id="oePmBatchDeleteBtn" style="flex:1;font-weight:600;">
                        删除零消耗 (${state.zeroCostProjects.length})
                    </button>
                    <button class="oe-pm-btn oe-pm-btn-stop" id="oePmStopBtn">停止</button>
                </div>
            </div>
            <!-- 底部状态栏 -->
            <div class="oe-pm-status info" id="oePmStatus">就绪</div>
        `;

        document.body.appendChild(panel);
        bindPanelEvents();
        makeDraggable(ball, ball);
        makeDraggable(panel, panel.querySelector('#oePmHeader'));

        // 点击小球展开
        ball.onclick = () => {
            panel.classList.add('show');
            ball.style.display = 'none';
        };
    }

    function bindPanelEvents() {
        // 收起为小球
        document.getElementById('oePmMin').onclick = () => {
            const panel = document.getElementById('oe-pm-panel');
            const ball = document.getElementById('oe-pm-ball');
            panel.classList.remove('show');
            ball.style.display = 'flex';
        };

        // 搜索
        const searchInput = document.getElementById('oePmSearchInput');
        const searchClear = document.getElementById('oePmSearchClear');

        document.getElementById('oePmSearchBtn').onclick = async () => {
            const keyword = searchInput.value.trim();
            if (!keyword) {
                updateStatusBar('请输入搜索关键词', 'warn');
                return;
            }
            await searchByKeywordAPI(keyword);
        };

        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('oePmSearchBtn').click();
        };

        // 搜索框清空按钮：输入时显示，清空时隐藏
        searchInput.addEventListener('input', () => {
            if (searchInput.value) searchClear.classList.add('show');
            else searchClear.classList.remove('show');
        });
        searchClear.onclick = () => {
            searchInput.value = '';
            searchClear.classList.remove('show');
            searchInput.focus();
        };

        // 批量搜索剧目
        document.getElementById('oePmBatchDramaBtn').onclick = () => {
            showBatchDramaDialog();
        };

        // 查看汇总
        document.getElementById('oePmSummaryBtn').onclick = () => {
            showProjectSummary();
        };

        // 删除零消耗
        document.getElementById('oePmBatchDeleteBtn').onclick = () => {
            apiBatchDeleteZeroCost();
        };

        // 停止
        document.getElementById('oePmStopBtn').onclick = () => {
            state.shouldStop = true;
            updateStatusBar('正在停止...', 'warn');
        };
    }

    function makeDraggable(element, handle) {
        let isDragging = false, startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            element.style.transition = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newLeft = startLeft + (e.clientX - startX);
            let newTop = startTop + (e.clientY - startY);
            newLeft = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, newTop));
            element.style.left = newLeft + 'px';
            element.style.top = newTop + 'px';
            element.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            element.style.transition = '';
        });
    }

    function addLogToPanel(msg, level = 'info') {
        // 日志面板已移除，仅输出到控制台
    }

    function updateStatistics(currentPage) {
        const setStat = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setStat('oePmStatTotal', state.allProjects.length);
        setStat('oePmStatCost', state.costProjects.length);
        setStat('oePmStatZero', state.zeroCostProjects.length);
        setStat('oePmStatDrama', state.uniqueDramas.size);
        setStat('oePmStatAccount', state.uniqueAccounts.size);
        if (currentPage !== undefined) setStat('oePmStatPage', currentPage);

        const delBtn = document.getElementById('oePmBatchDeleteBtn');
        if (delBtn) {
            delBtn.textContent = `删除零消耗 (${state.zeroCostProjects.length})`;
        }

        // 更新小球徽标
        const badge = document.getElementById('oePmBallBadge');
        if (badge) {
            if (state.zeroCostProjects.length > 0) {
                badge.textContent = state.zeroCostProjects.length;
                badge.classList.add('show');
            } else {
                badge.classList.remove('show');
            }
        }
    }

    function updateButtonStates() {
        const stopBtn = document.getElementById('oePmStopBtn');
        const ball = document.getElementById('oe-pm-ball');
        if (stopBtn) {
            if (state.isProcessing) stopBtn.classList.add('active');
            else stopBtn.classList.remove('active');
        }
        if (ball) {
            if (state.isProcessing) ball.classList.add('processing');
            else ball.classList.remove('processing');
        }
    }

    // ============================
    // 初始化
    // ============================
    async function init() {
        console.log('%c[项目管理工具 v11.10.4] 正在初始化...', 'color: #7ec699; font-size: 14px;');

        state.ebpid = getEbpid();
        if (!state.ebpid) {
            console.warn('[项目管理工具] 未找到ebpid参数');
        }

        await sleep(1500);

        createUI();

        // 安装请求拦截器 (备用)
        installRequestInterceptor();

        log('工具已启动 v11.10.4', 'success');

        if (state.ebpid) {
            log(`检测到ebpid: ${state.ebpid}`);
            log(`消耗检查范围: 近${CONFIG.costCheckDays}天 | 每页${CONFIG.pageSize}条`);
            updateStatusBar('就绪 - 点击小球展开面板', 'info');
        } else {
            log('未检测到ebpid，请确认在项目列表页面', 'warn');
            updateStatusBar('未检测到ebpid', 'warn');
        }

        // 监听 URL 变化
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                const newEbpid = getEbpid();
                if (newEbpid !== state.ebpid) {
                    state.ebpid = newEbpid;
                    log(`检测到页面切换，ebpid更新: ${state.ebpid}`, 'info');
                    state.allProjects = [];
                    state.zeroCostProjects = [];
                    state.costProjects = [];
                    state.uniqueDramas = new Set();
                    state.dramaCountMap = {};
                    state.dramaAccountsMap = {};
                    state.uniqueAccounts = new Set();
                    state.accountCountMap = {};
                    updateStatistics();
                    updateStatusBar('页面已切换，就绪', 'info');
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }
    }

    // ==================== 远程授权校验 ====================
    var SCRIPT_ID = 'jl-project-manage';
    var _authPassed = false;
    console.log('%c[授权校验] v11.11.0 开始检查脚本: ' + SCRIPT_ID, 'color:#1976d2;font-weight:bold');
    function _showAuthError(msg) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
        d.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.3);"><div style="font-size:48px;margin-bottom:16px;">\u{1F512}</div><h3 style="color:#333;margin:0 0 12px;font-size:18px;">\u811A\u672C\u6388\u6743\u63D0\u793A</h3><p style="color:#666;font-size:14px;line-height:1.6;margin-bottom:16px;">' + msg + '</p><p style="color:#999;font-size:12px;">\u5982\u9700\u6388\u6743\u8BF7\u8054\u7CFB\u811A\u672C\u4F5C\u8005</p></div>';
        document.body.appendChild(d);
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://raw.giteeusercontent.com/mlddr/script-toolkit-v2/raw/master/config.json?t=' + Date.now(),
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