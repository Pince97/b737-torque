/**
 * 737NG/MAX AMM ATA20-50-11 Standard Torque Fastener Decoder & Query Engine (v4)
 * Supports all 27 tables (Table 201 - 227), 612 fastener/nut prefixes, and full
 * Boeing Shop (shop.boeing.com) + PSDS + BAC5009 technical specification decoding.
 */

(function(window) {
  'use strict';

  const db = window.TORQUE_DATABASE;

  const SIZE_PREFIX_TO_DASH = {
    '0.0860': '2',
    '0.1120': '04',
    '0.1380': '06',
    '0.1640': '08',
    '0.1900': '3',
    '0.2500': '4',
    '0.3125': '5',
    '0.3750': '6',
    '0.4375': '7',
    '0.5000': '8',
    '0.5625': '9',
    '0.6250': '10',
    '0.7500': '12',
    '0.8750': '14',
    '1.0000': '16',
    '1.1250': '18',
    '1.2500': '20',
    '1.3750': '22',
    '1.5000': '24',
    '1.7500': '28'
  };

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  }

  function toNearest32ndFraction(val) {
    const n32 = Math.round(val * 32);
    if (n32 <= 0) return val.toFixed(3) + ' in';
    const whole = Math.floor(n32 / 32);
    const rem = n32 % 32;
    if (rem === 0) return `${whole} in`;
    const g = gcd(rem, 32);
    const num = rem / g;
    const den = 32 / g;
    return whole > 0 ? `${whole}-${num}/${den} in` : `${num}/${den} in`;
  }

  function resolveDashFromThreadSize(threadSizeStr, fallbackDash) {
    if (!threadSizeStr) return fallbackDash || '3';
    const numPrefixMatch = threadSizeStr.match(/^(\d+\.\d{4})/);
    if (numPrefixMatch && SIZE_PREFIX_TO_DASH[numPrefixMatch[1]]) {
      return SIZE_PREFIX_TO_DASH[numPrefixMatch[1]];
    }
    return fallbackDash || '3';
  }

  const FastenerDecoder = {
    cleanPN: function(raw) {
      if (!raw) return '';
      return raw.trim().toUpperCase().replace(/[\s_]+/g, '');
    },

    /**
     * Fuzzy search matching fastener prefixes for autocomplete/selection list
     */
    searchCandidates: function(rawQuery, limit) {
      limit = limit || 12;
      const q = this.cleanPN(rawQuery);
      if (!q) return [];

      const keys = Object.keys(db.decoder_map);
      const exactOrPrefix = [];
      const contains = [];

      const sortedByLen = keys.slice().sort((a, b) => b.length - a.length);
      let matchedBaseFromFull = null;
      for (const k of sortedByLen) {
        if (q.startsWith(k) && q.length > k.length) {
          matchedBaseFromFull = k;
          break;
        }
      }

      if (matchedBaseFromFull) {
        exactOrPrefix.push({
          pn: q,
          basePN: matchedBaseFromFull,
          isFullInput: true,
          info: db.decoder_map[matchedBaseFromFull]
        });
        exactOrPrefix.push({
          pn: matchedBaseFromFull,
          basePN: matchedBaseFromFull,
          isFullInput: false,
          info: db.decoder_map[matchedBaseFromFull]
        });
        const familyPrefix = matchedBaseFromFull.slice(0, 6);
        for (const k of keys) {
          if (k.startsWith(familyPrefix) && k !== matchedBaseFromFull) {
            contains.push({ pn: k, basePN: k, isFullInput: false, info: db.decoder_map[k] });
          }
        }
      }

      for (const k of keys) {
        if (k.startsWith(q)) {
          exactOrPrefix.push({ pn: k, basePN: k, isFullInput: false, info: db.decoder_map[k] });
        } else if (k.includes(q)) {
          contains.push({ pn: k, basePN: k, isFullInput: false, info: db.decoder_map[k] });
        }
      }

      const combined = exactOrPrefix.concat(contains);
      const seen = new Set();
      const results = [];
      for (const item of combined) {
        if (!seen.has(item.pn)) {
          seen.add(item.pn);
          results.push(item);
          if (results.length >= limit) break;
        }
      }
      return results;
    },

    /**
     * Decode a given fastener or nut part number
     */
    decode: function(rawPN) {
      const pn = this.cleanPN(rawPN);
      if (!pn) return null;

      let matchedBase = null;
      const decoderKeys = Object.keys(db.decoder_map).sort((a, b) => b.length - a.length);

      for (const k of decoderKeys) {
        if (pn.startsWith(k)) {
          matchedBase = k;
          break;
        }
      }

      let isBoeingStandard = pn.startsWith('BAC');
      let remainder = '';
      let baseInfo = null;

      if (matchedBase) {
        baseInfo = Object.assign({}, db.decoder_map[matchedBase]);
        remainder = pn.substring(matchedBase.length);
      } else {
        if (isBoeingStandard && pn.length >= 8) {
          matchedBase = pn.substring(0, 8);
          remainder = pn.substring(8);
          if (db.bac_detailed_specs && db.bac_detailed_specs[matchedBase]) {
            baseInfo = Object.assign({
              material: db.bac_detailed_specs[matchedBase].material_spec || 'Aerospace Alloy',
              class: '160 KSI / 95 KSI',
              type: db.bac_detailed_specs[matchedBase].official_title || 'Boeing Standard Fastener',
              category: 'bolt',
              metal_table: '203',
              comp_table: '215',
              mating_nuts: []
            }, db.bac_detailed_specs[matchedBase]);
          }
        } else {
          matchedBase = pn;
          remainder = '';
        }
      }

      let displayBasePN = matchedBase;
      if (isBoeingStandard && matchedBase.length > 8 && /^(BACB30|BACN10|BACN11|BACS12)/.test(matchedBase)) {
        displayBasePN = matchedBase.substring(0, 8);
      }

      let sizeDash = '';
      let finishCode = '';
      let gripDash = '';
      let oversize = '';
      let paintedHead = false;
      let drilled = false;
      let nominalThreadSize = '';

      // 1. Check if size is embedded in matchedBase
      const embeddedPatterns = [
        { regex: /^NAS(?:62|63|66|67|68|86|87|91)(\d{2})$/, extract: m => parseInt(m[1], 10).toString() },
        { regex: /^MS200(\d{2})$/, extract: m => parseInt(m[1], 10).toString() },
        { regex: /^BACN(?:10JD|11N)(1\d{2})$/, extract: m => (parseInt(m[1], 10) - 100).toString() },
        { regex: /^BACN(?:10JD|11N)(\d{1,2})$/, extract: m => m[1] },
        { regex: /^BACN10JC(0\d|\d{1,2})$/, extract: m => m[1] },
        { regex: /^BACN10YJ(08|3)$/, extract: m => m[1] }
      ];

      for (const pat of embeddedPatterns) {
        const em = matchedBase.match(pat.regex);
        if (em) {
          sizeDash = pat.extract(em);
          break;
        }
      }

      // 2. Parse remainder after matchedBase
      const cleanRemainder = remainder.startsWith('-') ? remainder.substring(1) : remainder;
      if (cleanRemainder) {
        const boeingRegex = /^(0\d|\d+)([A-Z\-]+)?(\d+)?(.*)$/;
        const match = cleanRemainder.match(boeingRegex);
        if (match) {
          if (!sizeDash) {
            sizeDash = match[1] || '';
          } else if (!gripDash) {
            gripDash = match[1] || '';
          }
          finishCode = (match[2] || '').replace(/^-+|-+$/g, '');
          if (!gripDash && match[3]) {
            gripDash = match[3];
          }
          const extra = match[4] || '';
          if (extra.includes('X') || finishCode.endsWith('X')) oversize = '1/64" (0.0156") 加大 (Code X)';
          if (extra.includes('Y') || finishCode.endsWith('Y')) oversize = '1/32" (0.0312") 加大 (Code Y)';
          if (extra.includes('G') || finishCode.includes('G')) paintedHead = true;
          if (extra.includes('D') || finishCode.includes('D')) drilled = true;
        }
      }

      // Special dynamic routing rules per AMM ATA 20-50-11:
      if (baseInfo) {
        if (/^BACS12B(E|F|G|P)$/.test(displayBasePN)) {
          if (finishCode && finishCode.includes('C')) {
            baseInfo.class = '60 - 80 KSI (含 C/CF/CP 代码)';
            baseInfo.type = '60-80 KSI Screw (Table 209 / 223)';
            baseInfo.metal_table = '209';
            baseInfo.comp_table = '223';
          } else {
            baseInfo.class = '95 - 156 KSI (无 C 代码)';
            baseInfo.type = '95-156 KSI Shear Screw (Table 204 / 216)';
            baseInfo.metal_table = '204';
            baseInfo.comp_table = '216';
          }
        }
        if (displayBasePN === 'BACS12ER' && finishCode.includes('A')) {
          baseInfo.metal_table = '216';
          baseInfo.comp_table = '216';
          baseInfo.type = 'Shear Screw with Plastic Seal (Per 2.C.(3)(d) Note -> Table 216)';
        }
        if (displayBasePN === 'BACN11U') {
          if (pn.substring(8).includes('N')) {
            baseInfo.sub_key = 'no_lockwire';
            baseInfo.type = 'Jam Nut without Lockwire Holes (With N Code)';
          } else {
            baseInfo.sub_key = 'lockwire';
            baseInfo.type = 'Jam Nut with Lockwire Holes (No N Code)';
          }
        }
      }

      // Map sizeDash to Nominal Thread Size
      if (sizeDash) {
        if (db.thread_size_dash_map[sizeDash]) {
          nominalThreadSize = db.thread_size_dash_map[sizeDash];
        } else if (db.thread_size_dash_map['0' + sizeDash]) {
          nominalThreadSize = db.thread_size_dash_map['0' + sizeDash];
        } else if (parseInt(sizeDash, 10) > 100 && db.thread_size_dash_map[(parseInt(sizeDash, 10) - 100).toString()]) {
          nominalThreadSize = db.thread_size_dash_map[(parseInt(sizeDash, 10) - 100).toString()];
        }
      }

      // Finish details
      let finishInfo = null;
      if (finishCode && db.finish_codes[finishCode]) {
        finishInfo = db.finish_codes[finishCode];
      } else if (finishCode && finishCode.length > 0) {
        const c1 = finishCode.charAt(0);
        if (db.finish_codes[c1]) {
          finishInfo = db.finish_codes[c1];
        }
      }

      // Grip length in inches
      let gripLengthInches = '';
      if (gripDash && !isNaN(parseInt(gripDash, 10))) {
        const val = parseInt(gripDash, 10);
        const inches = (val * 0.0625).toFixed(4);
        gripLengthInches = `${val}/16" (${inches} in)`;
      }

      const resolvedBaseInfo = baseInfo || {
        material: '未匹配到预设标准，请核对件号或直接查阅全表',
        class: '未知等级',
        type: '未知紧固件类型',
        category: 'bolt',
        metal_table: '203',
        comp_table: '215',
        mating_nuts: [],
        official_title: `AEROSPACE FASTENER (${displayBasePN})`,
        catalog_code: displayBasePN,
        head_type: '参见对应零件规范 (PSDS)',
        drive_type: '参见对应零件规范',
        thread_type: 'UNJF-3A / 3B Right Hand',
        thread_length_type: '标准航空螺纹',
        material_spec: '参见对应规范',
        bac5009_group: 'BAC5009 标准安装',
        equivalent_std: '参见 D-590 交叉索引',
        shop_url: `https://shop.boeing.com/aviation-supply/search?text=${encodeURIComponent(pn)}`
      };

      const mTable = db.tables[resolvedBaseInfo.metal_table];
      const availableSizes = mTable && mTable.rows ? mTable.rows.map(r => r.size) : [];

      return {
        inputPN: pn,
        matchedKey: matchedBase,
        basePN: displayBasePN,
        isKnown: !!baseInfo,
        baseInfo: resolvedBaseInfo,
        sizeDash: sizeDash,
        nominalThreadSize: nominalThreadSize,
        availableSizes: availableSizes,
        finishCode: finishCode,
        finishInfo: finishInfo,
        gripDash: gripDash,
        gripLengthInches: gripLengthInches,
        oversize: oversize,
        paintedHead: paintedHead,
        drilled: drilled
      };
    },

    /**
     * Compute Boeing Shop & PSDS Technical Specification Sheet for a decoded fastener and active thread size
     */
    computeTechnicalSpecs: function(decoded, activeThreadSize) {
      const bi = decoded.baseInfo || {};
      const effectiveSizeStr = activeThreadSize || decoded.nominalThreadSize || '0.1900-32';
      // Always synchronize dashKey with the currently active thread size!
      const dashKey = resolveDashFromThreadSize(effectiveSizeStr, decoded.sizeDash || '3');
      const psdsMap = db.psds_dimensions || {};
      const dim = psdsMap[dashKey] || psdsMap['0' + dashKey] || psdsMap['3'] || {};

      // Clean thread size display without redundant "(0.0860)"
      let friendlyThreadSize = effectiveSizeStr;
      if (dim.dia_label) {
        const prefixName = dim.dia_label.split(' ')[0]; // e.g. "#10" or "1/4"
        const parts = effectiveSizeStr.split(' ');
        const mainCode = parts[0]; // e.g. "0.1900-32" or "0.0860"
        const tpi = mainCode.includes('-') ? mainCode.split('-')[1] : '';
        if (tpi && prefixName.startsWith('#')) {
          friendlyThreadSize = `${prefixName}-${tpi} (${effectiveSizeStr})`;
        } else if (tpi) {
          friendlyThreadSize = `${prefixName}"-${tpi} (${effectiveSizeStr})`;
        } else {
          friendlyThreadSize = `${effectiveSizeStr}`;
        }
      }

      // Head diameter range
      let headDiaStr = '按对应凸头/螺帽对边宽度标准';
      const ht = (bi.head_type || '').toLowerCase();
      if (ht.includes('reduced') || ht.includes('薄型') || ht.includes('缩径')) {
        headDiaStr = dim.red_head_dia ? `头径 ØA: ${dim.red_head_dia}` : '按 PSDS 薄型沉头规范';
      } else if (ht.includes('100 deg') || ht.includes('100°') || ht.includes('countersunk')) {
        headDiaStr = dim.csk_head_dia ? `头径 ØA: ${dim.csk_head_dia}` : '按 PSDS 标准沉头规范';
      }

      // Shank diameter range
      let shankDiaStr = dim.shank_nom ? `${dim.shank_nom} (标准公差)` : '标准公差';
      if (decoded.oversize && decoded.oversize.includes('Code X') && dim.shank_x) {
        shankDiaStr = `${dim.shank_x} (+1/64" 加大 X)`;
      } else if (decoded.oversize && decoded.oversize.includes('Code Y') && dim.shank_y) {
        shankDiaStr = `${dim.shank_y} (+1/32" 加大 Y)`;
      }

      // Thread length calculation
      let tlVal = dim.tl_long || 0.345;
      const tlt = (bi.thread_length_type || '').toLowerCase();
      let tlRangeStr = bi.thread_length_type || 'Standard Thread';
      if (bi.category === 'nut') {
        tlRangeStr = `${bi.thread_length_type || 'UNJF-3B 全螺帽啮合高度'}`;
      } else if (tlt.includes('full thread') || tlt.includes('全螺纹')) {
        tlRangeStr = 'Full Threaded (全螺纹段螺钉)';
      } else {
        if (tlt.includes('st8712h') || tlt.includes('extra-long')) {
          tlVal = dim.tl_xlong || tlVal;
        } else if (tlt.includes('st8712l') || tlt.includes('extra-short')) {
          tlVal = dim.tl_xshort || tlVal;
        } else if (tlt.includes('st8712k') || tlt.includes('short')) {
          tlVal = dim.tl_short || tlVal;
        } else {
          tlVal = dim.tl_long || tlVal;
        }
        const tlMin = Math.max(0.10, tlVal - 0.025).toFixed(2);
        const tlMax = (tlVal + 0.025).toFixed(2);
        tlRangeStr = `${tlMin} ~ ${tlMax} in (标称 TL=${tlVal.toFixed(3)}")`;
      }

      // Grip size & overall length calculation
      let gripRangeStr = '输入含夹持代号件号(如 3K7)自动解算';
      let overallLenStr = 'L = 夹持 Grip + TL (±0.015")';
      if (decoded.gripDash && !isNaN(parseInt(decoded.gripDash, 10))) {
        const gNum = parseInt(decoded.gripDash, 10);
        const gNom = gNum * 0.0625;
        if (tlt.includes('full thread') || tlt.includes('全螺纹')) {
          overallLenStr = `${toNearest32ndFraction(gNom)} (${gNom.toFixed(4)}")`;
          gripRangeStr = '全螺纹螺钉 (无光杆夹持段)';
        } else {
          const gMin = Math.max(0, gNom - 0.010).toFixed(3);
          const gMax = (gNom + 0.010).toFixed(3);
          gripRangeStr = `${gMin} ~ ${gMax} in (${gNum}/16" = ${gNom.toFixed(4)}")`;
          const totalNom = gNom + tlVal;
          const fracStr = toNearest32ndFraction(totalNom);
          overallLenStr = `${fracStr} (${totalNom.toFixed(3)}" ±0.015")`;
        }
      }

      // Drive type with recess size
      let driveStr = bi.drive_type || 'Standard Aerospace Drive';
      if ((driveStr.toLowerCase().includes('cross recess') || driveStr.toLowerCase().includes('phillips')) && dim.recess_size) {
        driveStr += ` [槽号 ${dim.recess_size}]`;
      }

      const liveSearchUrl = `https://shop.boeing.com/aviation-supply/search?text=${encodeURIComponent(decoded.inputPN)}`;
      const verifiedShopUrl = bi.shop_url || liveSearchUrl;

      return {
        officialTitle: bi.official_title || `${decoded.basePN} Aerospace Fastener`,
        catalogCode: bi.catalog_code || decoded.basePN,
        dashNumber: dashKey,
        diameterLabel: dim.dia_label || `Dash -${dashKey}`,
        threadSizeLabel: friendlyThreadSize,
        threadType: bi.thread_type || (bi.category === 'nut' ? 'UNJF-3B Right Hand' : 'UNJF-3A Right Hand'),
        threadLengthType: bi.thread_length_type || 'Standard Thread',
        headType: bi.head_type || bi.type || 'Standard Head',
        headDiaRange: headDiaStr,
        shankDiaRange: shankDiaStr,
        driveType: driveStr,
        threadLengthStr: tlRangeStr,
        gripSizeRange: gripRangeStr,
        overallLengthStr: overallLenStr,
        materialSpec: bi.material_spec || bi.material || 'Aerospace Alloy',
        bac5009Group: bi.bac5009_group || 'BAC5009 Standard Installation',
        equivalentStd: bi.equivalent_std || 'See Boeing D-590 Cross Reference',
        verifiedShopUrl: verifiedShopUrl,
        liveSearchUrl: liveSearchUrl
      };
    },

    /**
     * Look up torque values across any of the 26 installation tables (201 - 226) + Table 227
     */
    lookupTorque: function(decoded, options) {
      options = options || {};
      const structure = options.structure || 'metal';
      const isLubed = options.lubed !== undefined ? options.lubed : false;
      const turnHead = options.turnHead !== undefined ? options.turnHead : true;

      const tableId = structure === 'metal'
        ? (decoded.baseInfo.metal_table || '203')
        : (decoded.baseInfo.comp_table || '215');

      const table = db.tables[tableId];
      if (!table) return null;

      const rows = table.rows || [];
      // Default to 0.1900-32 (#10-32, Dash -3) when no size is specified in the part number
      let defaultRowSize = '0.1900-32';
      if (rows.length > 0 && !rows.some(r => r.size.startsWith('0.1900'))) {
        defaultRowSize = rows[0].size;
      }
      const targetSize = options.threadSize || decoded.nominalThreadSize || defaultRowSize;

      let matchedRow = null;
      const cleanTargetPrefix = targetSize.split(' ')[0].replace(/^\./, '0.');
      for (const r of rows) {
        if (r.size === targetSize || r.size.startsWith(cleanTargetPrefix) || r.size.includes(cleanTargetPrefix)) {
          matchedRow = r;
          break;
        }
      }
      if (!matchedRow && rows.length > 0) {
        matchedRow = rows[0];
      }

      const activeSize = matchedRow ? matchedRow.size : targetSize;

      let matrix = {
        dryTurnNut: '—',
        dryTurnHead: '—',
        lubedTurnNut: '—',
        lubedTurnHead: '—',
        colNutLabel: '转动螺帽且无贴合密封 (Turn the Nut & No Fay Seal)',
        colHeadLabel: '转动螺杆头 及/或 贴合密封 (Turn Fastener Head and/or Fay Seal)',
        rowDryLabel: '干紧固件力矩 (Dry Fasteners)',
        rowLubedLabel: '润滑紧固件力矩 (Lubed Fasteners)'
      };

      let subKey = decoded.baseInfo.sub_key || null;

      if (matchedRow) {
        switch (table.table_type) {
          case 'standard_4col':
            matrix.dryTurnNut = matchedRow.dry_turn_nut || '—';
            matrix.dryTurnHead = matchedRow.dry_turn_head || '—';
            matrix.lubedTurnNut = matchedRow.lubed_turn_nut || '—';
            matrix.lubedTurnHead = matchedRow.lubed_turn_head || '—';
            break;

          case 'dual_material_8col': {
            const matBranch = (subKey === 'titanium' || (decoded.baseInfo.material && decoded.baseInfo.material.toLowerCase().includes('titanium')))
              ? matchedRow.titanium
              : matchedRow.steel;
            if (matBranch) {
              matrix.dryTurnNut = matBranch.dry_turn_nut || '—';
              matrix.dryTurnHead = matBranch.dry_turn_head || '—';
              matrix.lubedTurnNut = matBranch.lubed_turn_nut || '—';
              matrix.lubedTurnHead = matBranch.lubed_turn_head || '—';
            }
            break;
          }

          case 'dual_material_composite_4col': {
            const matBranch = (subKey === 'titanium' || (decoded.baseInfo.material && decoded.baseInfo.material.toLowerCase().includes('titanium')))
              ? matchedRow.titanium
              : matchedRow.steel;
            if (matBranch) {
              matrix.dryTurnNut = matBranch.turn_nut || '—';
              matrix.dryTurnHead = matBranch.turn_head || '—';
              matrix.lubedTurnNut = matBranch.turn_nut || '—';
              matrix.lubedTurnHead = matBranch.turn_head || '—';
            }
            break;
          }

          case 'composite_2col':
            matrix.dryTurnNut = matchedRow.turn_nut || '—';
            matrix.dryTurnHead = matchedRow.turn_head || '—';
            matrix.lubedTurnNut = matchedRow.turn_nut || '—';
            matrix.lubedTurnHead = matchedRow.turn_head || '—';
            break;

          case 'table_205_6col': {
            const branchKey = subKey === 'BACB31V' ? 'BACB31V' : 'BACB31U';
            const branch = matchedRow[branchKey];
            if (branch) {
              matrix.dryTurnNut = branch.dry_turn_nut || '—';
              matrix.dryTurnHead = branch.dry_turn_head || '—';
              matrix.lubedTurnNut = branch.lubed_turn_nut || '—';
              matrix.lubedTurnHead = branch.lubed_turn_head || '—';
            }
            break;
          }

          case 'table_207_6col': {
            const kKey = subKey === '80_KSI' ? '80_KSI' : '125_KSI';
            const branch = matchedRow[kKey];
            if (branch) {
              matrix.dryTurnNut = branch.dry_turn_nut || '—';
              matrix.dryTurnHead = branch.dry_turn_head || '—';
              matrix.lubedTurnNut = branch.lubed_turn_nut || '—';
              matrix.lubedTurnHead = branch.lubed_turn_head || '—';
            }
            break;
          }

          case 'table_220_4col': {
            const kKey = subKey === '80_KSI' ? '80_KSI' : '125_KSI';
            const branch = matchedRow[kKey];
            if (branch) {
              matrix.dryTurnNut = branch.turn_nut || '—';
              matrix.dryTurnHead = branch.turn_head || '—';
              matrix.lubedTurnNut = branch.turn_nut || '—';
              matrix.lubedTurnHead = branch.turn_head || '—';
            }
            break;
          }

          case 'reduced_shear_2col':
            matrix.colNutLabel = '非城堡螺母/螺母板/衬套 (All Non-Castellated Nuts)';
            matrix.colHeadLabel = '城堡螺母力矩范围 (All Castellated Nuts Range)';
            matrix.rowDryLabel = '干态 / 鲸蜡醇润滑 (Dry & Cetyl Alcohol Lubed)';
            matrix.rowLubedLabel = '干态 / 鲸蜡醇润滑 (Turn Head or Nut)';
            matrix.dryTurnNut = matchedRow.non_castellated || '—';
            matrix.dryTurnHead = matchedRow.non_castellated || '—';
            matrix.lubedTurnNut = matchedRow.non_castellated || '—';
            matrix.lubedTurnHead = matchedRow.castellated_range || '—';
            break;

          case 'table_209_4col':
            if (subKey === 'nylon') {
              matrix.dryTurnNut = matchedRow.nylon_nut || '—';
              matrix.dryTurnHead = matchedRow.nylon_head || '—';
              matrix.lubedTurnNut = matchedRow.nylon_nut || '—';
              matrix.lubedTurnHead = matchedRow.nylon_head || '—';
            } else {
              matrix.dryTurnNut = matchedRow.turn_nut || '—';
              matrix.dryTurnHead = matchedRow.turn_head || '—';
              matrix.lubedTurnNut = matchedRow.turn_nut || '—';
              matrix.lubedTurnHead = matchedRow.turn_head || '—';
            }
            break;

          case 'stake_screws_metal':
            matrix.colNutLabel = '60 - 80 KSI Stake Screws';
            matrix.colHeadLabel = '95 - 160 KSI Stake Screws';
            matrix.dryTurnNut = matchedRow.c60_dry || '—';
            matrix.dryTurnHead = matchedRow.c95_dry || '—';
            matrix.lubedTurnNut = matchedRow.c60_lubed || '—';
            matrix.lubedTurnHead = matchedRow.c95_lubed || '—';
            break;

          case 'stake_screws_composite':
            matrix.colNutLabel = '60 - 80 KSI Stake Screws (Dry)';
            matrix.colHeadLabel = '95 - 160 KSI Stake Screws (Dry)';
            matrix.dryTurnNut = matchedRow.c60_dry || '—';
            matrix.dryTurnHead = matchedRow.c95_dry || '—';
            matrix.lubedTurnNut = matchedRow.c60_dry || '—';
            matrix.lubedTurnHead = matchedRow.c95_dry || '—';
            break;

          case 'jam_nuts_metal':
            matrix.colNutLabel = '带保险丝孔 (Lockwire Holes)';
            matrix.colHeadLabel = '无保险丝孔 (No Lockwire Holes)';
            matrix.dryTurnNut = matchedRow.lockwire || '—';
            matrix.dryTurnHead = matchedRow.no_lockwire || '—';
            matrix.lubedTurnNut = matchedRow.lockwire || '—';
            matrix.lubedTurnHead = matchedRow.no_lockwire || '—';
            break;

          case 'jam_nuts_composite':
            if (subKey === 'no_lockwire') {
              matrix.dryTurnNut = matchedRow.no_lock_nut || '—';
              matrix.dryTurnHead = matchedRow.no_lock_head || '—';
              matrix.lubedTurnNut = matchedRow.no_lock_nut || '—';
              matrix.lubedTurnHead = matchedRow.no_lock_head || '—';
            } else {
              matrix.dryTurnNut = matchedRow.lock_nut || '—';
              matrix.dryTurnHead = matchedRow.lock_head || '—';
              matrix.lubedTurnNut = matchedRow.lock_nut || '—';
              matrix.lubedTurnHead = matchedRow.lock_head || '—';
            }
            break;

          case 'coarse_thread_3col':
            matrix.dryTurnNut = matchedRow.turn_nut || '—';
            matrix.dryTurnHead = matchedRow.turn_head || '—';
            matrix.lubedTurnNut = matchedRow.turn_nut || '—';
            matrix.lubedTurnHead = matchedRow.max_cotter ? `最大对齐开口销: ${matchedRow.max_cotter}` : matchedRow.turn_head;
            break;

          case 'plastic_parts_3col':
            matrix.colNutLabel = '灌封嵌件 (Potted Inserts)';
            matrix.colHeadLabel = '标准塑料件 (Standard Plastic Parts)';
            matrix.dryTurnNut = matchedRow.potted_inserts || '—';
            matrix.dryTurnHead = matchedRow.standard_parts || '—';
            matrix.lubedTurnNut = matchedRow.potted_inserts || '—';
            matrix.lubedTurnHead = matchedRow.standard_parts || '—';
            break;
        }
      }

      let primaryTorqueStr = '—';
      if (!isLubed) {
        primaryTorqueStr = turnHead ? matrix.dryTurnHead : matrix.dryTurnNut;
      } else {
        primaryTorqueStr = turnHead ? matrix.lubedTurnHead : matrix.lubedTurnNut;
      }

      let inLbVal = null;
      let nmVal = null;
      let ftLbVal = null;
      if (primaryTorqueStr && primaryTorqueStr !== '—') {
        const isRange = /\d+\s*-\s*\d+\s*in-lb/i.test(primaryTorqueStr);
        if (!isRange) {
          const numMatch = primaryTorqueStr.match(/([\d,]+(?:\.\d+)?)\s*in-lb.*?\(([\d,]+(?:\.\d+)?)\s*N/i);
          if (numMatch) {
            inLbVal = parseFloat(numMatch[1].replace(/,/g, ''));
            nmVal = parseFloat(numMatch[2].replace(/,/g, ''));
            ftLbVal = (inLbVal / 12).toFixed(1);
          }
        }
      }

      let toleranceInfo = null;
      if (inLbVal !== null) {
        toleranceInfo = {
          preset: {
            percent: '±3%',
            inLbRange: `${(inLbVal * 0.97).toFixed(1)} ~ ${(inLbVal * 1.03).toFixed(1)} in-lb`,
            nmRange: `${(nmVal * 0.97).toFixed(2)} ~ ${(nmVal * 1.03).toFixed(2)} N·m`
          },
          nonPreset: {
            percent: '±5%',
            inLbRange: `${(inLbVal * 0.95).toFixed(1)} ~ ${(inLbVal * 1.05).toFixed(1)} in-lb`,
            nmRange: `${(nmVal * 0.95).toFixed(2)} ~ ${(nmVal * 1.05).toFixed(2)} N·m`
          }
        };
      }

      const lockTable = db.tables['227'];
      let lockData = null;
      if (lockTable) {
        const cleanPrefix = activeSize.split(' ')[0].split('-')[0];
        lockData = lockTable.fine_threads.find(f => f.size === activeSize || f.size.startsWith(cleanPrefix)) || null;
      }

      return {
        tableId: tableId,
        tableTitle: table.title,
        tableCode: table.table_code,
        tablePage: table.page || '',
        tableType: table.table_type,
        structure: structure,
        isLubed: isLubed,
        turnHead: turnHead,
        threadSize: activeSize,
        availableSizes: rows.map(r => r.size),
        primaryTorque: primaryTorqueStr,
        inLbVal: inLbVal,
        nmVal: nmVal,
        ftLbVal: ftLbVal,
        toleranceInfo: toleranceInfo,
        matrix: matrix,
        lockData: lockData,
        matingNuts: decoded.baseInfo.mating_nuts || table.nuts || [],
        notes: table.notes || []
      };
    }
  };

  window.FastenerDecoder = FastenerDecoder;
})(window);
