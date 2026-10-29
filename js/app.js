/**
 * Boeing 737NG/MAX AMM 20-50-11 Standard Torque Query System (v4.1)
 * Completely synchronized with window.TORQUE_DATABASE, window.FastenerDecoder, and css/app.css
 */
(function () {
  'use strict';

  const db = window.TORQUE_DATABASE;
  const decoder = window.FastenerDecoder;

  if (!db || !decoder) {
    console.error('TORQUE_DATABASE 或 FastenerDecoder 未能正确加载！');
    return;
  }

  // 全局状态
  const state = {
    rawInput: 'BACB30NN3K7',
    selectedBasePN: 'BACB30NN',
    structure: 'metal',     // 'metal' | 'composite'
    lubed: false,           // false (Dry) | true (Lubed / A-finish)
    turnHead: true,         // false (Turn Nut & No Fay Seal) | true (Turn Fastener Head and/or Fay Seal)
    threadSize: '0.1900-32',
    userOverrodeLube: false,
    userOverrodeThread: false,
    tareTorqueInLb: 0,
    viewMode: 'desktop'     // 'desktop' | 'mobile'
  };

  const els = {};

  function cacheElements() {
    els.partSearchInput = document.getElementById('partSearchInput');
    els.clearSearchBtn = document.getElementById('clearSearchBtn');
    els.candidateCountLabel = document.getElementById('candidateCountLabel');
    els.candidateList = document.getElementById('candidateList');
    els.decodedStatusBadge = document.getElementById('decodedStatusBadge');
    els.fastenerInfoBody = document.getElementById('fastenerInfoBody');
    els.structureConditionGroup = document.getElementById('structureConditionGroup');
    els.lubeConditionGroup = document.getElementById('lubeConditionGroup');
    els.methodConditionGroup = document.getElementById('methodConditionGroup');
    els.metalTableLabel = document.getElementById('metalTableLabel');
    els.compTableLabel = document.getElementById('compTableLabel');
    els.resultTableBadge = document.getElementById('resultTableBadge');
    els.queryResultBody = document.getElementById('queryResultBody');
    els.modeDesktopBtn = document.getElementById('modeDesktopBtn');
    els.modeMobileBtn = document.getElementById('modeMobileBtn');
    els.themeToggleBtn = document.getElementById('themeToggleBtn');
    els.themeIcon = document.getElementById('themeIcon');
    els.defTable227Container = document.getElementById('defTable227Container');
    els.catalogSearchInput = document.getElementById('catalogSearchInput');
    els.catalogTypeFilter = document.getElementById('catalogTypeFilter');
    els.catalogTableBody = document.getElementById('catalogTableBody');
    els.handbookTableSelect = document.getElementById('handbookTableSelect');
    els.handbookTableMeta = document.getElementById('handbookTableMeta');
    els.handbookTableContainer = document.getElementById('handbookTableContainer');
    els.calcTargetT = document.getElementById('calcTargetT');
    els.calcWrenchL = document.getElementById('calcWrenchL');
    els.calcAdapterE = document.getElementById('calcAdapterE');
    els.calcOutputM = document.getElementById('calcOutputM');
  }

  // ==================== 核心搜索与联动刷新 ====================
  function handleQueryUpdate(rawInput, forcedBasePN) {
    state.rawInput = (rawInput || '').trim().toUpperCase();
    const effectiveQuery = state.rawInput || forcedBasePN || 'BACB30NN';

    // 1. 获取候选列表
    let candidates = decoder.searchCandidates(effectiveQuery, 12);
    if (candidates.length === 0) {
      const defaults = ['BACB30NN', 'BACB30NM', 'BACB30MR', 'BACB30LE', 'BACB30MY', 'BACN10YN', 'BACN10YR', 'BACN10JC', 'BACS12FA'];
      candidates = defaults
        .filter(k => db.decoder_map[k])
        .map(k => ({ pn: k, basePN: k, isFullInput: false, info: db.decoder_map[k] }));
    }

    // 2. 解码当前输入
    const targetToDecode = forcedBasePN && !state.rawInput.startsWith(forcedBasePN)
      ? forcedBasePN
      : effectiveQuery;
    const decoded = decoder.decode(targetToDecode) || decoder.decode('BACB30NN3K7');
    state.selectedBasePN = decoded.basePN;

    // 3. 如果用户没有手动覆盖干/湿选项，并且输入件号本身不固定为干态演示，可根据 finishInfo 提示（但保留用户显式选择）
    if (!state.userOverrodeThread && decoded.nominalThreadSize) {
      state.threadSize = decoded.nominalThreadSize;
    }

    // 4. 执行力矩查询
    const res = decoder.lookupTorque(decoded, {
      structure: state.structure,
      lubed: state.lubed,
      turnHead: state.turnHead,
      threadSize: state.threadSize
    });

    if (res && res.threadSize) {
      state.threadSize = res.threadSize;
    }

    renderModule1Candidates(candidates, decoded);
    renderModule2FastenerInfo(decoded, res);
    renderModule3Conditions(decoded, res);
    renderModule4Results(decoded, res);
  }

  // ==================== 模块 1：件号检索与候选列表 ====================
  function renderModule1Candidates(candidates, decoded) {
    els.candidateCountLabel.textContent = `匹配紧固件候选 (${candidates.length} 项)`;

    const hasExactInputMatch = candidates.some(c => c.pn === decoded.inputPN);
    els.candidateList.innerHTML = candidates.map(item => {
      const isSelected = hasExactInputMatch
        ? item.pn === decoded.inputPN
        : (item.pn === decoded.basePN || item.pn === decoded.matchedKey);
      const info = item.info || {};
      const title = info.official_title
        ? info.official_title.split('|')[1] || info.official_title
        : (info.type || '标准紧固件');
      const tableTag = `Table ${info.metal_table || '203'}${info.comp_table ? '/' + info.comp_table : ''}`;

      return `
        <button type="button" class="candidate-item ${isSelected ? 'active' : ''}" data-pick-pn="${item.pn}" data-pick-base="${item.basePN}">
          <div class="cand-pn">${item.pn}</div>
          <div class="cand-desc">${title.trim()} · ${tableTag}</div>
        </button>
      `;
    }).join('');

    els.candidateList.querySelectorAll('.candidate-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const pn = btn.getAttribute('data-pick-pn');
        const base = btn.getAttribute('data-pick-base');
        els.partSearchInput.value = pn;
        state.userOverrodeThread = false;
        handleQueryUpdate(pn, base);
      });
    });
  }

  // ==================== 模块 2：紧固件信息展示（整合去重后的 12 宫格【小卡片模式】） ====================
  function renderModule2FastenerInfo(decoded, res) {
    const activeThreadSize = (res && res.threadSize) || decoded.nominalThreadSize || '0.1900-32';
    const specs = decoder.computeTechnicalSpecs(decoded, activeThreadSize);
    const bi = decoded.baseInfo || {};

    els.decodedStatusBadge.textContent = decoded.sizeDash
      ? `已完整解析件号：${decoded.inputPN} (基础件号 ${decoded.basePN})`
      : `当前选中基础件号：${decoded.basePN} (默认演示尺寸 ${activeThreadSize})`;

    // 表面处理与干/湿提示
    let finishTitle = '按后缀代码区分 (如 K / A / D)';
    let finishSub = 'K=镀镉+鲸蜡醇润滑 · A=铝涂层(湿力矩) · -=裸钛/干态';
    if (decoded.finishCode) {
      finishTitle = `代码 [${decoded.finishCode}] · ${decoded.finishInfo ? decoded.finishInfo.desc : '特殊表面处理'}`;
      finishSub = decoded.finishInfo && decoded.finishInfo.lubed
        ? '含润滑或铝涂层（若未清洗去除，按 2.C.(8) 可对应润滑力矩）'
        : '干态表面（对应 Dry 干安装力矩）';
    }

    // 自锁力矩限值 (Table 227)
    const lockStr = res && res.lockData
      ? `最大自锁: ${res.lockData.max_locking}`
      : '参见 Table 227 自锁力矩表';
    const breakawayStr = res && res.lockData
      ? `最小脱扣(复用下限): ${res.lockData.min_breakaway}`
      : '螺帽复用须检验最小脱扣力矩';

    // 标称螺纹尺寸选择胶囊按钮
    const availableSizes = (res && res.availableSizes) || decoded.availableSizes || [];
    const pillsHtml = availableSizes.map(sz => {
      const isAct = sz === activeThreadSize;
      return `<button type="button" class="size-pill ${isAct ? 'active' : ''}" data-select-size="${sz}">${sz}</button>`;
    }).join('');

    // 配对螺帽推荐标签
    const matingNuts = (res && res.matingNuts) || bi.mating_nuts || [];
    const matingHtml = matingNuts.length > 0
      ? `
        <div class="mating-bar">
          <span>🔗 推荐配用螺帽/紧固件 (点击可快速切换查询)：</span>
          ${matingNuts.map(n => `<button type="button" class="mating-tag" data-jump-nut="${n}">${n}</button>`).join('')}
        </div>
      `
      : '';

    els.fastenerInfoBody.innerHTML = `
      <!-- 顶部官方名称与 Boeing Shop 链接横幅 -->
      <div class="psds-spec-banner">
        <div>
          <div class="psds-title-main">${specs.officialTitle}</div>
          <div class="psds-catalog-sub">
            基础件号: ${decoded.basePN} · 分类代号: ${specs.catalogCode} · 适用表: Table ${bi.metal_table || '203'} (金属) / Table ${bi.comp_table || '215'} (复材)
          </div>
        </div>
        <div class="shop-btn-group">
          <a class="shop-link-btn" href="${specs.verifiedShopUrl}" target="_blank" rel="noopener noreferrer">
            🌐 Boeing Shop 官方规格页 ↗
          </a>
          <a class="shop-link-btn secondary" href="${specs.liveSearchUrl}" target="_blank" rel="noopener noreferrer">
            🔍 检索 ${decoded.inputPN} ↗
          </a>
        </div>
      </div>

      <!-- 去重整合后的 12 宫格小卡片模式 (Small Card Mode) -->
      <div class="unified-card-grid">
        <div class="mini-spec-card primary-card">
          <div class="mini-card-head">
            <span>1. 标称螺纹尺寸 (Thread Size)</span>
            <span class="mini-card-badge">查表索引</span>
          </div>
          <div class="mini-card-main">${specs.threadSizeLabel}</div>
          <div class="mini-card-sub">对应 AMM Table ${res ? res.tableId : '203'} 纵行尺寸</div>
        </div>

        <div class="mini-spec-card primary-card">
          <div class="mini-card-head">
            <span>2. 标称直径 (Nominal Dia)</span>
            <span class="mini-card-badge">Dash -${specs.dashNumber}</span>
          </div>
          <div class="mini-card-main">${specs.diameterLabel}</div>
          <div class="mini-card-sub">光杆外径公差: ${specs.shankDiaRange}</div>
        </div>

        <div class="mini-spec-card primary-card">
          <div class="mini-card-head">
            <span>3. 强度等级 (Fastener Class)</span>
            <span class="mini-card-badge">${bi.category === 'nut' ? '螺帽等级' : '载荷等级'}</span>
          </div>
          <div class="mini-card-main">${bi.class || '标准航空级'}</div>
          <div class="mini-card-sub">${bi.type || ''}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>4. 头部型式 (Head Style)</span>
            <span class="mini-card-badge">外形尺寸</span>
          </div>
          <div class="mini-card-main">${specs.headType}</div>
          <div class="mini-card-sub">${specs.headDiaRange}${decoded.paintedHead ? ' · 带喷漆头(G)' : ''}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>5. 驱动扳拧方式 (Drive Type)</span>
            <span class="mini-card-badge">工具槽型</span>
          </div>
          <div class="mini-card-main">${specs.driveType}</div>
          <div class="mini-card-sub">${decoded.drilled ? '带保险丝孔 (Drilled)' : '标准航空扳拧接口'}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>6. 螺纹制式与旋向 (Thread Type)</span>
            <span class="mini-card-badge">AS8879</span>
          </div>
          <div class="mini-card-main">${specs.threadType}</div>
          <div class="mini-card-sub">${specs.threadLengthType}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>7. 材料与采购规范 (Material &amp; Spec)</span>
            <span class="mini-card-badge">基体合金</span>
          </div>
          <div class="mini-card-main">${bi.material || '航空结构合金'}</div>
          <div class="mini-card-sub">${specs.materialSpec}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>8. 表面处理与润滑 (Finish &amp; Lube)</span>
            <span class="mini-card-badge">干/湿依据</span>
          </div>
          <div class="mini-card-main">${finishTitle}</div>
          <div class="mini-card-sub">${finishSub}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>9. 夹持长度 (Grip Size)</span>
            <span class="mini-card-badge">${decoded.gripDash ? 'Grip -' + decoded.gripDash : '1/16" 递增'}</span>
          </div>
          <div class="mini-card-main">${specs.gripSizeRange}</div>
          <div class="mini-card-sub">无螺纹光杆夹持段公差 (±0.005")</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>10. 螺纹段长与总长 (TL &amp; Length)</span>
            <span class="mini-card-badge">PSDS 尺寸</span>
          </div>
          <div class="mini-card-main">总长 L: ${specs.overallLengthStr}</div>
          <div class="mini-card-sub">螺纹段 TL: ${specs.threadLengthStr}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>11. 自锁/脱扣力矩 (Table 227)</span>
            <span class="mini-card-badge">防松检验</span>
          </div>
          <div class="mini-card-main">${lockStr}</div>
          <div class="mini-card-sub">${breakawayStr}</div>
        </div>

        <div class="mini-spec-card">
          <div class="mini-card-head">
            <span>12. 施工规范与替代 (BAC5009)</span>
            <span class="mini-card-badge">${decoded.oversize ? '加大杆径' : '标准配合'}</span>
          </div>
          <div class="mini-card-main">${decoded.oversize || specs.bac5009Group}</div>
          <div class="mini-card-sub">${specs.equivalentStd}</div>
        </div>
      </div>

      <!-- 标称螺纹尺寸切换栏 -->
      <div class="thread-selector-bar">
        <div class="thread-selector-title">
          <span>📏 标称螺纹尺寸 (Nominal Thread Size) 快速切换：</span>
          <span class="cond-row-sub">已根据件号自动识别为 <b>${activeThreadSize}</b>，点击下方任意尺寸可同步切换上方小卡片与下方力矩结果</span>
        </div>
        <div class="size-pills">${pillsHtml}</div>
      </div>

      ${matingHtml}
    `;

    // 绑定尺寸胶囊点击事件
    els.fastenerInfoBody.querySelectorAll('[data-select-size]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.threadSize = btn.getAttribute('data-select-size');
        state.userOverrodeThread = true;
        handleQueryUpdate(els.partSearchInput.value, state.selectedBasePN);
      });
    });

    // 绑定配对螺帽跳转事件
    els.fastenerInfoBody.querySelectorAll('[data-jump-nut]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nutPN = btn.getAttribute('data-jump-nut').split(' ')[0];
        els.partSearchInput.value = nutPN;
        state.userOverrodeThread = false;
        handleQueryUpdate(nutPN, nutPN);
      });
    });
  }

  // ==================== 模块 3：施工条件高亮状态同步 ====================
  function renderModule3Conditions(decoded, res) {
    const bi = decoded.baseInfo || {};
    if (els.metalTableLabel) {
      els.metalTableLabel.textContent = `适用金属结构表：Table ${bi.metal_table || '203'}`;
    }
    if (els.compTableLabel) {
      els.compTableLabel.textContent = `适用复合材料结构表：Table ${bi.comp_table || '215'}`;
    }

    els.structureConditionGroup.querySelectorAll('[data-structure]').forEach(btn => {
      const isAct = btn.getAttribute('data-structure') === state.structure;
      btn.classList.toggle('active', isAct);
    });

    els.lubeConditionGroup.querySelectorAll('[data-lubed]').forEach(btn => {
      const isAct = (btn.getAttribute('data-lubed') === 'true') === state.lubed;
      btn.classList.toggle('active', isAct);
    });

    els.methodConditionGroup.querySelectorAll('[data-turn-head]').forEach(btn => {
      const isAct = (btn.getAttribute('data-turn-head') === 'true') === state.turnHead;
      btn.classList.toggle('active', isAct);
    });
  }

  // ==================== 模块 4：查询结果 ====================
  function renderModule4Results(decoded, res) {
    if (!res) {
      els.queryResultBody.innerHTML = `<div class="query-path-box">未找到匹配的力矩表数据，请检查紧固件件号。</div>`;
      return;
    }

    els.resultTableBadge.textContent = `Table ${res.tableId} · ${res.tableTitle}`;

    const structText = state.structure === 'metal' ? '安装在金属部件上' : '安装在复合材料/非金属部件上';
    const lubeText = state.lubed ? '润滑/湿安装 (Lubed Fasteners)' : '干安装 (Dry Fasteners)';
    const methodText = state.turnHead ? '转动螺杆头及/或贴合面密封 (Turn Fastener Head and/or Fay Seal)' : '转动螺帽且无贴合面密封 (Turn the Nut & No Fay Seal)';

    const m = res.matrix;
    const isDryNut = !state.lubed && !state.turnHead;
    const isDryHead = !state.lubed && state.turnHead;
    const isLubNut = state.lubed && !state.turnHead;
    const isLubHead = state.lubed && state.turnHead;

    // 扳手公差提示
    const tolHtml = res.toleranceInfo
      ? `
        <div class="tolerance-row">
          <span class="tol-badge">🎯 预置式扳手公差 (<b>${res.toleranceInfo.preset.percent}</b>)：<b>${res.toleranceInfo.preset.inLbRange}</b> (${res.toleranceInfo.preset.nmRange})</span>
          <span class="tol-badge">🧭 指针/数显扳手公差 (<b>${res.toleranceInfo.nonPreset.percent}</b>)：<b>${res.toleranceInfo.nonPreset.inLbRange}</b> (${res.toleranceInfo.nonPreset.nmRange})</span>
        </div>
      `
      : '';

    // 跑合力矩 (Running Torque) 叠加计算器
    const baseInLb = res.inLbVal || 0;
    const totalWithTare = baseInLb + (parseFloat(state.tareTorqueInLb) || 0);
    const totalNmWithTare = (totalWithTare * 0.1129848).toFixed(2);

    const notesHtml = (res.notes && res.notes.length > 0)
      ? `<ul class="notes-list">${res.notes.map(n => `<li>${n}</li>`).join('')}</ul>`
      : '';

    els.queryResultBody.innerHTML = `
      <!-- 1. 查询路径推导面包屑 (严格对应用户示例：ATA20-50检索基础件号 -> 选择力矩表 -> 标称螺纹尺寸 -> 施工条件 -> 最终力矩) -->
      <div class="query-path-box">
        🧭 <b>标准力矩查询路径推导：</b>
        ATA 20-50-11 检索基础件号 <b>${decoded.basePN}</b>（发现金属表 Table ${decoded.baseInfo.metal_table || '203'} / 复材表 Table ${decoded.baseInfo.comp_table || '215'}）
        → 因<b>${structText}</b>，故选择 <b>Table ${res.tableId}</b>
        → <b>${decoded.inputPN}</b> 的标称螺纹尺寸为 <b>${res.threadSize}</b>
        → <b>${lubeText} + ${methodText}</b>
        → 最终标准力矩值：<b>${res.primaryTorque}</b>
      </div>

      <!-- 2. 主力矩大屏显示 -->
      <div class="hero-torque">
        <div class="torque-headline">
          当前选定安装条件下的标准力矩值 (Table ${res.tableId} · 螺纹尺寸 ${res.threadSize})
        </div>
        <div class="torque-val-container">
          <span class="torque-primary">${res.primaryTorque}</span>
          ${res.ftLbVal ? `<span class="torque-ftlb">≈ ${res.ftLbVal} ft-lbs</span>` : ''}
        </div>
        <div class="cond-row-sub">
          当前条件：${structText} · ${lubeText} · ${methodText}
        </div>
        ${tolHtml}
      </div>

      <!-- 3. 不同安装条件下的力矩对比矩阵表（点击任意单元格可直接切换工况，选中单元格强高亮） -->
      <div class="section-subtitle">
        <span>📊 ${decoded.basePN} (螺纹尺寸 ${res.threadSize}) 在不同安装条件下的力矩值对比表：</span>
        <span class="cond-row-sub">点击表内任意工况单元格可直接切换选中状态</span>
      </div>
      <div class="table-scroll">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>润滑状态 \\ 拧紧方式</th>
              <th>${m.colNutLabel}</th>
              <th>${m.colHeadLabel}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>${m.rowDryLabel}</th>
              <td class="clickable-cell ${isDryNut ? 'active-cell' : ''}" data-cell-lubed="false" data-cell-head="false">${m.dryTurnNut}</td>
              <td class="clickable-cell ${isDryHead ? 'active-cell' : ''}" data-cell-lubed="false" data-cell-head="true">${m.dryTurnHead}</td>
            </tr>
            <tr>
              <th>${m.rowLubedLabel}</th>
              <td class="clickable-cell ${isLubNut ? 'active-cell' : ''}" data-cell-lubed="true" data-cell-head="false">${m.lubedTurnNut}</td>
              <td class="clickable-cell ${isLubHead ? 'active-cell' : ''}" data-cell-lubed="true" data-cell-head="true">${m.lubedTurnHead}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 4. 自锁跑合力矩 (Running Torque / Tare Torque) 叠加计算器 -->
      <div class="tare-calculator">
        <div class="cond-row-title">
          <span>⚙️ 自锁螺帽跑合力矩 (Running Torque) 叠加计算器 &amp; Table 227 限值核验</span>
          <span class="cond-row-sub">${res.lockData ? `当前尺寸 (${res.threadSize}) 最大允许自锁力矩: ${res.lockData.max_locking} · 最小脱扣力矩: ${res.lockData.min_breakaway}` : ''}</span>
        </div>
        <div class="tare-inputs">
          <label>实测跑合力矩 Running Torque (in-lb)：
            <input type="number" id="tareTorqueInput" class="tare-input" value="${state.tareTorqueInLb}" min="0" step="0.5" />
          </label>
          <div class="tare-result" id="tareResultDisplay">
            ${baseInLb > 0
              ? `叠加后总紧固力矩 = ${totalWithTare.toFixed(1)} in-lb (${totalNmWithTare} N·m)`
              : '当前为范围力矩，请将实测跑合力矩直接加至表内数值'}
          </div>
        </div>
        ${notesHtml}
      </div>
    `;

    // 绑定矩阵表单元格点击切换
    els.queryResultBody.querySelectorAll('.clickable-cell').forEach(td => {
      td.addEventListener('click', () => {
        state.lubed = td.getAttribute('data-cell-lubed') === 'true';
        state.turnHead = td.getAttribute('data-cell-head') === 'true';
        state.userOverrodeLube = true;
        handleQueryUpdate(els.partSearchInput.value, state.selectedBasePN);
      });
    });

    // 绑定跑合力矩输入实时计算
    const tareInput = document.getElementById('tareTorqueInput');
    const tareDisplay = document.getElementById('tareResultDisplay');
    if (tareInput && tareDisplay) {
      tareInput.addEventListener('input', (e) => {
        state.tareTorqueInLb = parseFloat(e.target.value) || 0;
        if (baseInLb > 0) {
          const sumInLb = baseInLb + state.tareTorqueInLb;
          const sumNm = (sumInLb * 0.1129848).toFixed(2);
          tareDisplay.textContent = `叠加后总紧固力矩 = ${sumInLb.toFixed(1)} in-lb (${sumNm} N·m)`;
        }
      });
    }
  }

  // ==================== 渲染大模块 2 中的 Table 227 对照表 ====================
  function renderDefinitionsTable227() {
    const t227 = db.tables['227'];
    if (!t227 || !els.defTable227Container) return;

    const rows = t227.fine_threads || [];
    els.defTable227Container.innerHTML = `
      <table class="matrix-table">
        <thead>
          <tr>
            <th>标称螺纹尺寸 (Nominal Thread Size)</th>
            <th>最小脱扣力矩 (Min Breakaway Torque - 螺帽复用最低下限)</th>
            <th>最大自锁/旋入力矩 (Max Locking / Run-On Torque - 旋入上限)</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="mono"><b>${r.size}</b></td>
              <td>${r.min_breakaway}</td>
              <td>${r.max_locking}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ==================== 渲染大模块 4：BAC 标准件字典 (136项) ====================
  function renderCatalogView() {
    const specsMap = db.bac_detailed_specs || {};
    const keys = Object.keys(specsMap).sort();
    const q = (els.catalogSearchInput.value || '').trim().toUpperCase();
    const typeFilter = els.catalogTypeFilter.value;

    const filtered = keys.filter(k => {
      if (typeFilter !== 'ALL' && !k.startsWith(typeFilter)) return false;
      if (!q) return true;
      const s = specsMap[k];
      const dm = db.decoder_map[k] || {};
      const hay = `${k} ${s.official_title || ''} ${s.material_spec || ''} ${s.head_type || ''} ${s.drive_type || ''} ${dm.metal_table || ''} ${dm.comp_table || ''}`.toUpperCase();
      return hay.includes(q);
    });

    els.catalogTableBody.innerHTML = filtered.map(k => {
      const s = specsMap[k];
      const dm = db.decoder_map[k] || {};
      const tablesStr = dm.metal_table
        ? `Table ${dm.metal_table}${dm.comp_table ? ' / ' + dm.comp_table : ''}`
        : '参见手册';

      return `
        <tr>
          <td class="mono"><b>${k}</b></td>
          <td style="text-align:left;"><b>${s.official_title || k}</b><br/><small style="color:var(--text-muted);">${s.catalog_code || ''}</small></td>
          <td style="text-align:left;">${s.material_spec || dm.material || ''}</td>
          <td style="text-align:left;">${s.head_type || ''}<br/><small style="color:var(--text-muted);">${s.drive_type || ''}</small></td>
          <td style="text-align:left;">${s.thread_type || ''}<br/><small style="color:var(--text-muted);">${s.bac5009_group || ''}</small></td>
          <td class="mono">${tablesStr}</td>
          <td>
            <button type="button" class="action-btn-sm" data-load-bac="${k}">载入查询 →</button>
          </td>
        </tr>
      `;
    }).join('');

    els.catalogTableBody.querySelectorAll('[data-load-bac]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pn = btn.getAttribute('data-load-bac');
        switchTab('calculator');
        els.partSearchInput.value = pn;
        state.userOverrodeThread = false;
        handleQueryUpdate(pn, pn);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ==================== 渲染大模块 5：手册全表预览 (Table 201 – 227) ====================
  function initHandbookView() {
    const tids = Object.keys(db.tables).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    els.handbookTableSelect.innerHTML = tids.map(id => {
      const t = db.tables[id];
      const rCount = (t.rows || t.fine_threads || []).length;
      return `<option value="${id}">Table ${id} — ${t.title} (${rCount} 行 · ${t.page || ''})</option>`;
    }).join('');

    els.handbookTableSelect.addEventListener('change', () => {
      renderHandbookTable(els.handbookTableSelect.value);
    });

    if (tids.length > 0) {
      renderHandbookTable('203');
      els.handbookTableSelect.value = '203';
    }
  }

  function renderHandbookTable(tid) {
    const t = db.tables[tid];
    if (!t) return;

    const fastenersList = []
      .concat(t.fasteners || [])
      .concat(t.fasteners_steel || [])
      .concat(t.fasteners_titanium || [])
      .concat(t.nuts || []);

    els.handbookTableMeta.innerHTML = `
      <div><b>Table ${t.table_id}: ${t.title}</b> (${t.table_code || ''} · ${t.page || ''})</div>
      <div style="margin-top:4px;font-size:0.8rem;">
        <b>适用紧固件示例：</b>${fastenersList.slice(0, 35).join(', ') || '通用紧固件'}${fastenersList.length > 35 ? ' 等' : ''}
      </div>
    `;

    const tt = t.table_type;
    const rows = t.rows || t.fine_threads || [];

    if (tt === 'standard_4col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th>标称螺纹尺寸 (Size)</th>
              <th>干态 · 拧螺帽 (Dry Turn Nut)</th>
              <th>干态 · 拧螺杆头/密封 (Dry Turn Head)</th>
              <th>润滑 · 拧螺帽 (Lubed Turn Nut)</th>
              <th>润滑 · 拧螺杆头/密封 (Lubed Turn Head)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="mono"><b>${r.size}</b></td>
                <td>${r.dry_turn_nut || '—'}</td>
                <td>${r.dry_turn_head || '—'}</td>
                <td>${r.lubed_turn_nut || '—'}</td>
                <td>${r.lubed_turn_head || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'dual_material_8col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th rowspan="2">螺纹尺寸 (Size)</th>
              <th colspan="4">钢与耐蚀钢紧固件 (Steel / CRES Fasteners)</th>
              <th colspan="4">钛合金紧固件 (Titanium Fasteners)</th>
            </tr>
            <tr>
              <th>干·拧螺帽</th>
              <th>干·拧螺杆头</th>
              <th>湿·拧螺帽</th>
              <th>湿·拧螺杆头</th>
              <th>干·拧螺帽</th>
              <th>干·拧螺杆头</th>
              <th>湿·拧螺帽</th>
              <th>湿·拧螺杆头</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const st = r.steel || {};
              const ti = r.titanium || {};
              return `
                <tr>
                  <td class="mono"><b>${r.size}</b></td>
                  <td>${st.dry_turn_nut || '—'}</td>
                  <td>${st.dry_turn_head || '—'}</td>
                  <td>${st.lubed_turn_nut || '—'}</td>
                  <td>${st.lubed_turn_head || '—'}</td>
                  <td>${ti.dry_turn_nut || '—'}</td>
                  <td>${ti.dry_turn_head || '—'}</td>
                  <td>${ti.lubed_turn_nut || '—'}</td>
                  <td>${ti.lubed_turn_head || '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'dual_material_composite_4col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th rowspan="2">螺纹尺寸 (Size)</th>
              <th colspan="2">钢与耐蚀钢 (Steel / CRES)</th>
              <th colspan="2">钛合金 (Titanium)</th>
            </tr>
            <tr>
              <th>拧螺帽 (Turn Nut)</th>
              <th>拧螺杆头/密封 (Turn Head)</th>
              <th>拧螺帽 (Turn Nut)</th>
              <th>拧螺杆头/密封 (Turn Head)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const st = r.steel || {};
              const ti = r.titanium || {};
              return `
                <tr>
                  <td class="mono"><b>${r.size}</b></td>
                  <td>${st.turn_nut || '—'}</td>
                  <td>${st.turn_head || '—'}</td>
                  <td>${ti.turn_nut || '—'}</td>
                  <td>${ti.turn_head || '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'composite_2col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th>标称螺纹尺寸 (Size)</th>
              <th>转动螺帽 · 无贴合密封 (Turn the Nut &amp; No Fay Seal)</th>
              <th>转动螺杆头 · 及/或贴合密封 (Turn Fastener Head and/or Fay Seal)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="mono"><b>${r.size}</b></td>
                <td>${r.turn_nut || '—'}</td>
                <td>${r.turn_head || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'table_205_6col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th rowspan="2">螺纹尺寸 (Size)</th>
              <th colspan="4">BACB31U (干/湿 · 拧螺帽/螺杆头)</th>
              <th colspan="2">BACB31V (干态)</th>
            </tr>
            <tr>
              <th>干·拧螺帽</th>
              <th>干·拧螺杆头</th>
              <th>湿·拧螺帽</th>
              <th>湿·拧螺杆头</th>
              <th>干·拧螺帽</th>
              <th>干·拧螺杆头</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const u = r.BACB31U || {};
              const v = r.BACB31V || {};
              return `
                <tr>
                  <td class="mono"><b>${r.size}</b></td>
                  <td>${u.dry_turn_nut || '—'}</td>
                  <td>${u.dry_turn_head || '—'}</td>
                  <td>${u.lubed_turn_nut || '—'}</td>
                  <td>${u.lubed_turn_head || '—'}</td>
                  <td>${v.dry_turn_nut || '—'}</td>
                  <td>${v.dry_turn_head || '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'table_207_6col' || tt === 'table_220_4col') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th>螺纹尺寸 (Size)</th>
              <th>80 KSI A286 CRES (拧螺帽 / 拧螺杆头)</th>
              <th>125 KSI A286 CRES (拧螺帽 / 拧螺杆头)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const k80 = r['80_KSI'] || {};
              const k125 = r['125_KSI'] || {};
              return `
                <tr>
                  <td class="mono"><b>${r.size}</b></td>
                  <td>拧螺帽: ${k80.dry_turn_nut || k80.turn_nut || '—'} | 拧头: ${k80.dry_turn_head || k80.turn_head || '—'}</td>
                  <td>拧螺帽: ${k125.dry_turn_nut || k125.turn_nut || '—'} | 拧头: ${k125.dry_turn_head || k125.turn_head || '—'} <small>${k125.lubed_turn_nut ? '(湿: ' + k125.lubed_turn_nut + ' / ' + k125.lubed_turn_head + ')' : ''}</small></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else if (tt === 'locking_torque') {
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              <th>标称螺纹尺寸 (Size)</th>
              <th>最小脱扣力矩 (Min Breakaway Torque)</th>
              <th>最大自锁/旋入力矩 (Max Locking / Run-On Torque)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="mono"><b>${r.size}</b></td>
                <td>${r.min_breakaway || '—'}</td>
                <td>${r.max_locking || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      // 通用自适应表格渲染 (Table 208, 209, 210, 211, 212, 222, 224, 225, 226)
      const cols = rows.length > 0 ? Object.keys(rows[0]) : ['size'];
      els.handbookTableContainer.innerHTML = `
        <table class="matrix-table">
          <thead>
            <tr>
              ${cols.map(c => `<th>${c.toUpperCase()}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                ${cols.map((c, idx) => `<td class="${idx === 0 ? 'mono' : ''}">${idx === 0 ? '<b>' + (r[c] || '—') + '</b>' : (r[c] || '—')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  // ==================== 桌面端 / 手机端视图模式切换 ====================
  function setViewMode(mode) {
    state.viewMode = mode === 'mobile' ? 'mobile' : 'desktop';
    document.documentElement.setAttribute('data-view-mode', state.viewMode);
    if (els.modeDesktopBtn && els.modeMobileBtn) {
      els.modeDesktopBtn.classList.toggle('active', state.viewMode === 'desktop');
      els.modeMobileBtn.classList.toggle('active', state.viewMode === 'mobile');
    }
    try {
      localStorage.setItem('b737_view_mode', state.viewMode);
    } catch (e) {}
  }

  function initViewMode() {
    let saved = null;
    try {
      saved = localStorage.getItem('b737_view_mode');
    } catch (e) {}
    if (saved === 'mobile' || saved === 'desktop') {
      setViewMode(saved);
    } else if (window.innerWidth <= 768) {
      setViewMode('mobile');
    } else {
      setViewMode('desktop');
    }

    if (els.modeDesktopBtn) {
      els.modeDesktopBtn.addEventListener('click', () => setViewMode('desktop'));
    }
    if (els.modeMobileBtn) {
      els.modeMobileBtn.addEventListener('click', () => setViewMode('mobile'));
    }
  }

  // ==================== 顶部五大模块切换与事件绑定 ====================
  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isAct = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-view').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${tabId}`);
    });
  }

  function updateAdapterCalc() {
    if (!els.calcTargetT || !els.calcOutputM) return;
    const T = parseFloat(els.calcTargetT.value) || 0;
    const L = parseFloat(els.calcWrenchL.value) || 10;
    const E = parseFloat(els.calcAdapterE.value) || 0;
    if (L + E <= 0) return;
    const M = (T * L) / (L + E);
    const nm = (M * 0.1129848).toFixed(2);
    els.calcOutputM.textContent = `${M.toFixed(1)} in-lb (${nm} N·m)`;
  }

  function bindEvents() {
    // 顶部五大模块 Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    // 模块 1 搜索框输入
    els.partSearchInput.addEventListener('input', (e) => {
      state.userOverrodeThread = false;
      handleQueryUpdate(e.target.value, null);
    });

    els.clearSearchBtn.addEventListener('click', () => {
      els.partSearchInput.value = '';
      state.userOverrodeThread = false;
      handleQueryUpdate('', 'BACB30NN');
      els.partSearchInput.focus();
    });

    // 模块 3：安装部件材料切换
    els.structureConditionGroup.querySelectorAll('[data-structure]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.structure = btn.getAttribute('data-structure');
        handleQueryUpdate(els.partSearchInput.value, state.selectedBasePN);
      });
    });

    // 模块 3：干/湿状态切换
    els.lubeConditionGroup.querySelectorAll('[data-lubed]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.lubed = btn.getAttribute('data-lubed') === 'true';
        state.userOverrodeLube = true;
        handleQueryUpdate(els.partSearchInput.value, state.selectedBasePN);
      });
    });

    // 模块 3：转动方式切换
    els.methodConditionGroup.querySelectorAll('[data-turn-head]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.turnHead = btn.getAttribute('data-turn-head') === 'true';
        handleQueryUpdate(els.partSearchInput.value, state.selectedBasePN);
      });
    });

    // 主题切换
    els.themeToggleBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      els.themeIcon.textContent = next === 'dark' ? '☀️ 日间' : '🌙 夜间';
    });

    // BAC 标准件字典过滤
    els.catalogSearchInput.addEventListener('input', renderCatalogView);
    els.catalogTypeFilter.addEventListener('change', renderCatalogView);

    // 接杆计算器
    [els.calcTargetT, els.calcWrenchL, els.calcAdapterE].forEach(el => {
      if (el) el.addEventListener('input', updateAdapterCalc);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    initViewMode();
    bindEvents();
    renderDefinitionsTable227();
    renderCatalogView();
    initHandbookView();
    updateAdapterCalc();

    // 默认演示示例：BACB30NN3K7 金属部件 + 干安装 + 拧螺杆头 = 35 in-lb (4.0 N·m)
    els.partSearchInput.value = 'BACB30NN3K7';
    state.structure = 'metal';
    state.lubed = false;
    state.turnHead = true;
    handleQueryUpdate('BACB30NN3K7', 'BACB30NN');
  });
})();
