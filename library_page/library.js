(() => {
  "use strict";

  const languageKey = "borderlands.content-language";
  const byId = (id) => document.getElementById(id);
  const search = byId("library-search");
  const query = byId("library-query");
  const categories = byId("library-categories");
  const results = byId("library-results");
  const reader = byId("library-reader");
  const copy = {
    en: {
      title: "Library", description: "Browse the local campaign records and source pages.",
      searchLibrary: "Search library", placeholder: "Try ‘Giant Spider’ or ‘Bonus Action’", search: "Search",
      categories: "Categories", all: "All records", records: (count) => `${count} ${count === 1 ? "record" : "records"}`,
      loading: "Loading records…", noResults: "No matching records.", browseError: "The local Library could not load.",
      choose: "Choose a record", open: "Open a record to read its details and sources.",
      loadingRecord: "Loading record…", recordError: "This Library record could not load.",
      references: "Sources and related records", dmOnly: "DM only", official: "Official box", local: "Local design",
      dashboard: "Dashboard summary", starter: "Starter-set summary", rules: "Starter-set rules summary",
      reviewed: "Reviewed", partiallyReviewed: "Partially reviewed", ocr: "Unverified OCR", visual: "Map inventory",
      sourceRoute: "Source reference", approved: "Approved house rule", cardTranscription: "Official card transcription",
      noContent: "No additional details recorded.",
      translated: "Chinese reference text; English rules and numbers remain authoritative.",
      summary: "Chinese guide (summary). Expand the English original for the complete source text.",
      sourceGuide: "Chinese source guide. The English OCR has not been translated in full; its original verification status still applies.",
      notTranslated: "Chinese translation not available yet.", original: "English original",
    },
    "zh-Hans": {
      title: "资料库", description: "浏览本地冒险资料和原始资料页。",
      searchLibrary: "搜索资料库", placeholder: "试试“巨型蜘蛛”或“附赠动作”", search: "搜索",
      categories: "分类", all: "全部条目", records: (count) => `${count} 条资料`,
      loading: "正在加载资料…", noResults: "没有找到符合条件的资料。", browseError: "无法加载本地资料库。",
      choose: "选择一条资料", open: "打开条目即可查看详细内容和来源。",
      loadingRecord: "正在加载条目…", recordError: "无法加载该条资料。",
      references: "来源及相关条目", dmOnly: "仅供 DM 查看", official: "官方盒装资料", local: "本地设计",
      dashboard: "仪表板摘要", starter: "入门套装摘要", rules: "入门套装规则摘要",
      reviewed: "已核对", partiallyReviewed: "已部分核对", ocr: "未经核对的 OCR", visual: "地图目录",
      sourceRoute: "来源索引", approved: "已采用的自订规则", cardTranscription: "官方卡牌转录",
      noContent: "没有更多详细内容。",
      translated: "中文参考说明；英文规则与数值为准。",
      summary: "中文导读（摘要）。完整内容可展开下方英文原文。",
      sourceGuide: "中文来源导读。英文 OCR 尚无全文翻译；仍保留原来的核对等级。",
      notTranslated: "尚无中文翻译。", original: "英文原文（English original）",
    },
  };
  let language = localStorage.getItem(languageKey) === "zh-Hans" ? "zh-Hans" : "en";
  let locationState;
  let browseData;
  let categoryList = [];
  let record;
  let listError = false;
  let recordError = false;
  let listRequest;
  let recordRequest;

  function element(tag, value, className) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function readLocation() {
    const params = new URLSearchParams(window.location.search);
    return {
      q: params.get("q")?.trim().slice(0, 160) || "",
      category: params.get("category") || "",
      record: params.get("record") || params.get("id") || "",
    };
  }

  function libraryUrl(next) {
    const params = new URLSearchParams();
    for (const key of ["category", "q", "record"]) {
      if (next[key]) params.set(key, next[key]);
    }
    return `/library_page/${params.size ? `?${params}` : ""}`;
  }

  function select(next, focusReader = false) {
    const url = libraryUrl(next);
    if (url !== window.location.pathname + window.location.search) history.pushState(null, "", url);
    updateLocation(focusReader);
  }

  async function fetchJson(path, params, signal) {
    const response = await fetch(`${path}?${new URLSearchParams(params)}`, { signal });
    if (!response.ok) throw new Error(`Library request failed (${response.status}).`);
    return response.json();
  }

  async function loadBrowse(state) {
    listRequest?.abort();
    const controller = new AbortController();
    listRequest = controller;
    browseData = undefined;
    listError = false;
    renderBrowse();
    results.scrollTop = 0;
    try {
      const data = await fetchJson("/api/library", { q: state.q, category: state.category }, controller.signal);
      if (controller.signal.aborted) return;
      browseData = data;
      categoryList = data.categories;
    } catch {
      if (controller.signal.aborted) return;
      listError = true;
    }
    renderBrowse();
  }

  async function loadRecord(id) {
    recordRequest?.abort();
    record = undefined;
    recordError = false;
    renderRecord();
    reader.scrollTop = 0;
    if (!id) return;
    const controller = new AbortController();
    recordRequest = controller;
    try {
      const data = await fetchJson("/api/library/record", { id }, controller.signal);
      if (controller.signal.aborted) return;
      record = data;
    } catch {
      if (controller.signal.aborted) return;
      recordError = true;
    }
    renderRecord();
  }

  function updateLocation(focusReader = false) {
    const previous = locationState;
    locationState = readLocation();
    query.value = locationState.q;
    if (previous?.q !== locationState.q || previous?.category !== locationState.category) {
      void loadBrowse(locationState);
    } else {
      for (const link of results.querySelectorAll(".library-item")) {
        if (link.dataset.record === locationState.record) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
    if (previous?.record !== locationState.record) void loadRecord(locationState.record);
    if (focusReader) {
      reader.focus({ preventScroll: true });
      reader.scrollIntoView({ block: "nearest" });
    }
  }

  function renderBrowse() {
    const t = copy[language];
    const active = locationState.category;
    const allCount = categoryList.length ? categoryList.reduce((total, group) => total + (group.count || 0), 0) : undefined;
    const categoryButtons = [{ id: "", label: t.all, zh: t.all, count: allCount }, ...categoryList];
    if (categoryList.length) {
      const focusCategory = document.activeElement?.dataset.category;
      categories.replaceChildren(...categoryButtons.map((group) => {
        const label = language === "zh-Hans" ? group.zh || group.label : group.label;
        const button = element("button", undefined, "library-category");
        button.type = "button";
        button.dataset.category = group.id;
        button.setAttribute("aria-pressed", String(active === group.id));
        button.append(element("span", label));
        if (Number.isFinite(group.count)) button.append(element("span", group.count, "library-category-count"));
        return button;
      }));
      for (const button of categories.querySelectorAll("button")) {
        if (button.dataset.category === focusCategory) button.focus({ preventScroll: true });
      }
    }
    const current = categoryList.find((group) => group.id === active);
    byId("library-results-heading").textContent = current
      ? (language === "zh-Hans" ? current.zh || current.label : current.label)
      : t.all;
    const items = browseData?.items || [];
    byId("library-status").textContent = listError ? t.browseError
      : !browseData ? t.loading : items.length ? t.records(items.length) : t.noResults;
    results.replaceChildren(...items.map((item) => {
      const row = element("li");
      const link = element("a", undefined, "library-item");
      link.href = libraryUrl({ ...locationState, record: item.id });
      link.dataset.record = item.id;
      if (item.id === locationState.record) link.setAttribute("aria-current", "true");
      const translated = item.zh && item.zh !== item.title;
      link.append(element("strong", language === "zh-Hans" && translated ? `${item.zh} (${item.title})` : item.title));
      const excerpt = language === "zh-Hans" ? item.excerptZh || t.notTranslated : item.excerpt;
      if (excerpt) link.append(element("small", excerpt, "library-excerpt"));
      row.append(link);
      return row;
    }));
  }

  function safeLink(destination) {
    if (!destination) return null;
    try {
      const url = new URL(destination, window.location.origin);
      const dashboardPages = ["/library_page/", "/keep_page/", "/adventure_page/"];
      if (url.origin === window.location.origin &&
          (dashboardPages.includes(url.pathname) || url.pathname.startsWith("/database/maps/"))) {
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  function appendInline(parent, value) {
    const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(?<!\*)\*([^*]+)\*(?!\*)/g;
    let offset = 0;
    for (const match of value.matchAll(pattern)) {
      parent.append(value.slice(offset, match.index));
      const [, label, destination, strong, code, emphasis] = match;
      if (label !== undefined) {
        const url = destination.startsWith("/") ? safeLink(destination) : null;
        if (url) {
          const link = element("a", label);
          link.href = url.href;
          parent.append(link);
        } else parent.append(label);
      } else if (strong !== undefined) parent.append(element("strong", strong));
      else if (code !== undefined) parent.append(element("code", code));
      else parent.append(element("em", emphasis));
      offset = match.index + match[0].length;
    }
    parent.append(value.slice(offset));
  }

  const factLabels = {
    ability_modifiers: "属性调整值", saving_throw_bonuses: "豁免加值", saving_throws: "豁免加值",
    challenge_rating: "挑战等级（CR）", size_and_type: "体型与类型", armor_class: "护甲等级（AC）", ac: "护甲等级（AC）",
    hit_points: "生命值（HP）", hit_point_maximum: "生命值上限", initiative_bonus: "先攻加值", initiative: "先攻加值",
    speed: "速度", walk: "步行", climb: "攀爬", fly: "飞行", swim: "游泳", burrow: "掘穴",
    speed_feet: "速度（英尺）", printed_unarmored_ac: "印刷未着甲 AC", starting_gold_gp: "起始金币（GP）",
    short_rest_hp: "短休恢复 HP", melee_attack: "近战攻击加值", ranged_attack: "远程攻击加值",
    spell_attack: "法术攻击加值", spell_save_dc: "法术豁免 DC", damage_formula: "伤害公式", damage_type: "伤害类型",
    ability_values_are_modifiers: "属性数值为调整值", attack_die: "攻击骰", damage_rolled_separately: "伤害另掷",
    printed_attack_numbers_are_bonuses: "卡面攻击数值为加值", applies_to: "适用对象", level: "等级／环阶",
    casting_time: "施放时间", duration_as_printed: "印刷持续时间", range_feet: "距离（英尺）", target: "目标",
    saving_throw_ability: "豁免属性", higher_level: "高环效果", effect: "效果", properties: "属性", mastery: "精通",
    category: "类别", ac_bonus: "AC 加值", ac_formula: "AC 公式", dexterity_modifier_cap: "敏捷调整值上限",
    magic_bonus_already_included: "已包含魔法加值", acid_breath_area: "强酸吐息范围", claw: "爪击", scimitar_damage: "弯刀伤害",
    role: "身份", species: "种族", traits: "特性", rumor_truth_values: "传闻真假", ceiling_feet: "天花板高度（英尺）",
    lighting_day: "白天光照", lighting_night: "夜间光照", monster_record_id: "怪物记录", snare: "套索陷阱",
    secret_door: "暗门", ogre_hire_gp: "雇用食人魔费用（GP）", dragon_tribute_gp_per_character: "红龙每人贡金（GP）",
    treasure_gp: "宝藏金币（GP）", treasure: "宝藏", drops: "掉落", reward: "报酬", quest_giver: "任务给予者",
    vex_trigger: "扰袭触发", vex_effect: "扰袭效果", equipment: "起始装备", powers: "能力标记",
  };
  const factTerms = {
    Acid: "强酸（Acid）", Bludgeoning: "钝击（Bludgeoning）", Cold: "冷冻（Cold）", Fire: "火焰（Fire）",
    Force: "力场（Force）", Lightning: "闪电（Lightning）", Necrotic: "黯蚀（Necrotic）", Piercing: "穿刺（Piercing）",
    Poison: "毒素（Poison）", Psychic: "心灵（Psychic）", Radiant: "光耀（Radiant）", Slashing: "挥砍（Slashing）", Thunder: "雷鸣（Thunder）",
    Tiny: "微型", Small: "小型", Medium: "中型", Large: "大型", Huge: "巨型", Gargantuan: "超巨型",
    Humanoid: "类人生物", Human: "人类", Dragon: "龙", Undead: "亡灵", Beast: "野兽", Monstrosity: "怪物",
    Construct: "构装生物", Aberration: "异怪", Fey: "妖精", Fiend: "邪魔", Elemental: "元素", Giant: "巨人", Ooze: "泥怪",
  };
  const factLabel = (key, locale = language) => locale === "zh-Hans" ? factLabels[key] || key : key.replaceAll("_", " ");

  function describeValue(value, locale = language) {
    if (Array.isArray(value)) return value.map(entry => describeValue(entry, locale)).join(", ");
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, entry]) => `${factLabel(key, locale)} ${describeValue(entry, locale)}`).join(", ");
    }
    if (locale === "zh-Hans" && typeof value === "boolean") return value ? "是" : "否";
    if (locale === "zh-Hans" && typeof value === "string") {
      if (factTerms[value]) return factTerms[value];
      if (/^(?:Tiny|Small|Medium|Large|Huge|Gargantuan) /.test(value)) {
        return value.replace(/\b[A-Za-z]+\b/g, term => factTerms[term] || term);
      }
    }
    return value ?? "—";
  }

  function codeBlock(lines, type, locale) {
    const raw = lines.join("\n");
    if (type === "json") {
      try {
        const values = JSON.parse(raw);
        if (values && typeof values === "object" && !Array.isArray(values)) {
          const facts = element("dl");
          for (const [key, value] of Object.entries(values)) {
            const row = element("div");
            row.append(element("dt", factLabel(key, locale)), element("dd", describeValue(value, locale)));
            facts.append(row);
          }
          return facts;
        }
      } catch {
        // Keep incomplete source transcriptions readable in their original form.
      }
    }
    return element("pre", raw);
  }

  function markdown(value, title, locale = language) {
    const content = element("div", undefined, "library-content");
    const lines = value.split(/\r?\n/);
    const listItem = /^(?:([-*+])|(\d+)\.)\s+(.+)$/;
    const heading = /^(#{1,6})\s+(.+)$/;
    const startsBlock = /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|---+$)/;
    for (let index = 0; index < lines.length;) {
      const line = lines[index++].trim();
      if (!line) continue;
      const header = line.match(heading);
      const item = line.match(listItem);
      if (header) {
        if (header[1] === "#" && header[2] === title && !content.childElementCount) continue;
        const node = element(header[1].length <= 2 ? "h3" : "h4");
        appendInline(node, header[2]);
        content.append(node);
      } else if (line.startsWith("```")) {
        const block = [];
        while (index < lines.length && !lines[index].trim().startsWith("```")) block.push(lines[index++]);
        if (index < lines.length) index += 1;
        content.append(codeBlock(block, line.slice(3).trim(), locale));
      } else if (item) {
        const ordered = Boolean(item[2]);
        const list = element(ordered ? "ol" : "ul");
        if (ordered) list.start = Number(item[2]);
        let current = item;
        while (current && Boolean(current[2]) === ordered) {
          const row = element("li");
          appendInline(row, current[3]);
          list.append(row);
          current = lines[index]?.trim().match(listItem);
          if (current && Boolean(current[2]) === ordered) index += 1;
        }
        content.append(list);
      } else if (line.startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index] || "")) {
        const table = element("table");
        const tableRows = [line];
        index += 1;
        while (lines[index]?.trim().startsWith("|")) tableRows.push(lines[index++].trim());
        tableRows.forEach((row, rowIndex) => {
          const section = rowIndex === 0 ? table.createTHead() : table.tBodies[0] || table.createTBody();
          const tr = section.insertRow();
          for (const value of row.replace(/^\||\|$/g, "").split("|")) {
            const cell = element(rowIndex === 0 ? "th" : "td");
            if (rowIndex === 0) cell.scope = "col";
            appendInline(cell, value.trim());
            tr.append(cell);
          }
        });
        const frame = element("div", undefined, "table-scroll");
        frame.append(table);
        content.append(frame);
      } else if (/^---+$/.test(line)) {
        content.append(element("hr"));
      } else {
        const quoted = line.startsWith(">");
        const node = element(quoted ? "blockquote" : "p");
        const paragraph = [quoted ? line.replace(/^>\s?/, "") : line];
        while (lines[index]?.trim() && (quoted ? lines[index].trim().startsWith(">") : !startsBlock.test(lines[index].trim()))) {
          paragraph.push(quoted ? lines[index++].trim().replace(/^>\s?/, "") : lines[index++].trim());
        }
        appendInline(node, paragraph.join(" "));
        content.append(node);
      }
    }
    return content;
  }

  function renderRecord() {
    const t = copy[language];
    if (!record) {
      const title = locationState.record ? (recordError ? t.recordError : t.loadingRecord) : t.choose;
      const heading = element("h2", title);
      heading.id = "library-record-heading";
      reader.replaceChildren(heading);
      if (!locationState.record) reader.append(element("p", t.open));
      return;
    }

    const title = language === "zh-Hans" && record.zh && record.zh !== record.title
      ? `${record.zh} (${record.title})` : record.title;
    const heading = element("h2", title);
    heading.id = "library-record-heading";
    const meta = element("div", undefined, "library-record-meta");
    const quality = record.quality || "";
    const authorityLabel = {
      official_box_scan: t.official,
      local_design: t.local,
      starter_set_summary: quality === "starter_rules_summary" ? t.rules : t.starter,
      user_transcription_of_official_card: t.cardTranscription,
    }[record.authority];
    const qualityLabel = {
      partially_reviewed: t.partiallyReviewed,
      ocr_unverified: t.ocr,
      visual_inventory: t.visual,
      source_route: t.sourceRoute,
      dashboard_summary: t.dashboard,
      approved_house_rule: t.approved,
    }[quality] || (quality.startsWith("reviewed") ? t.reviewed : "");
    if (authorityLabel) meta.append(element("span", authorityLabel));
    if (qualityLabel) meta.append(element("span", qualityLabel, ["ocr_unverified", "partially_reviewed"].includes(quality) ? "quality" : ""));
    if (record.visibility === "dm_only") meta.append(element("span", t.dmOnly));
    if (record.source) meta.append(element("span", record.source));
    reader.replaceChildren(heading, meta);
    if (language === "zh-Hans") {
      const note = record.translation === "summary" ? t.summary : record.translation === "source-guide" ? t.sourceGuide
        : record.bodyZh ? t.translated : t.notTranslated;
      reader.append(element("p", note, "library-translation-note"));
      const body = record.bodyZh || record.body;
      reader.append(body ? markdown(body, record.zh || record.title) : element("p", t.noContent));
      if (record.bodyZh && record.body) {
        const original = element("details", undefined, "library-original");
        original.lang = "en";
        original.append(element("summary", t.original), markdown(record.body, record.title, "en"));
        reader.append(original);
      }
    } else reader.append(record.body ? markdown(record.body, record.title) : element("p", t.noContent));

    const links = [];
    for (const reference of record.references || []) {
      const url = safeLink(reference.url);
      if (!url) continue;
      const item = element("li");
      const referenceLabels = {"Open dashboard map": "打开交互地图", "Original map scan": "原始地图扫描", "Redrawn map": "重绘地图",
        "Find on the Keep map": "在要塞地图查看", "Open this location": "打开此地点", "Open on the adventure map": "在冒险地图查看", "Open the Keep's Watch event": "打开要塞卫队事件"};
      const referenceTitle = language === "zh-Hans" ? reference.zh || referenceLabels[reference.title] || reference.title : reference.title;
      const link = element("a", referenceTitle);
      link.href = url.href;
      item.append(link);
      links.push(item);
    }
    if (links.length) {
      const sources = element("section", undefined, "library-references");
      const list = element("ul");
      list.append(...links);
      sources.append(element("h3", t.references), list);
      reader.append(sources);
    }
  }

  function renderLanguage() {
    const t = copy[language];
    document.documentElement.lang = language;
    document.title = `${t.title} · Borderlands`;
    byId("lang-en").setAttribute("aria-pressed", String(language === "en"));
    byId("lang-zh").setAttribute("aria-pressed", String(language === "zh-Hans"));
    byId("library-title").textContent = t.title;
    byId("library-description").textContent = t.description;
    byId("library-category-heading").textContent = t.categories;
    byId("library-search-label").textContent = t.searchLibrary;
    byId("library-submit").textContent = t.search;
    query.placeholder = t.placeholder;
    if (locationState) {
      renderBrowse();
      renderRecord();
    }
  }

  for (const [id, value] of [["lang-en", "en"], ["lang-zh", "zh-Hans"]]) {
    byId(id).addEventListener("click", () => {
      language = value;
      localStorage.setItem(languageKey, language);
      renderLanguage();
      window.dispatchEvent(new CustomEvent("borderlands:language", { detail: language }));
    });
  }
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    select({ ...locationState, q: query.value.trim(), record: "" });
  });
  query.addEventListener("search", () => {
    if (!query.value && locationState.q) select({ ...locationState, q: "", record: "" });
  });
  categories.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button || button.dataset.category === locationState.category) return;
    select({ ...locationState, category: button.dataset.category, q: query.value.trim(), record: "" });
  });
  for (const section of [results, reader]) {
    section.addEventListener("click", (event) => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a");
      if (!link || link.pathname !== "/library_page/") return;
      const id = new URL(link.href).searchParams.get("record");
      if (!id) return;
      event.preventDefault();
      select({ ...locationState, record: id }, true);
    });
  }
  window.addEventListener("popstate", () => updateLocation());

  renderLanguage();
  updateLocation();
})();
