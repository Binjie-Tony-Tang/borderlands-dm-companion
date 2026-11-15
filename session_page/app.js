(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const S = borderlandsSession, E = combatEngine, C = combatActions;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clone = value => structuredClone(value);
  const languageKey = "borderlands.content-language";
  let language = "en";
  try { language = localStorage.getItem(languageKey) === "zh-Hans" ? "zh-Hans" : "en"; } catch {}
  const word = (en, zh) => language === "zh-Hans" ? zh : en;
  const name = record => language === "zh-Hans" ? record?.zh || record?.name || record?.en : record?.name || record?.en;
  const text = record => language === "zh-Hans" ? record.descriptionZh || record.description : record.description;
  const modeOptions = () => ({ auto: word("Automatic", "自动计算"), normal: word("Normal", "正常"), advantage: word("Advantage", "优势"), disadvantage: word("Disadvantage", "劣势") });
  const conditions = { blinded: ["Blinded", "目盲"], charmed: ["Charmed", "魅惑"], deafened: ["Deafened", "耳聋"], frightened: ["Frightened", "恐慌"], grappled: ["Grappled", "擒抱"], incapacitated: ["Incapacitated", "失能"], invisible: ["Invisible", "隐形"], paralyzed: ["Paralyzed", "麻痹"], petrified: ["Petrified", "石化"], poisoned: ["Poisoned", "中毒"], prone: ["Prone", "倒地"], restrained: ["Restrained", "束缚"], stunned: ["Stunned", "震慑"], unconscious: ["Unconscious", "昏迷"] };
  const button = (cmd, label, value = "", primary = false) => `<button type="button" class="${primary ? "primary" : "secondary"}" data-cmd="${cmd}" data-value="${escape(value)}">${escape(label)}</button>`;
  const field = (key, label, min, max, value = "", required = false) => `<label>${escape(label)}<input name="${escape(key)}" type="number" step="1" min="${min}" max="${max}" value="${escape(value)}"${required ? " required" : ""}></label>`;
  const select = (key, label, options, current = "") => `<label>${escape(label)}<select name="${escape(key)}">${Object.entries(options).map(([value, caption]) => `<option value="${escape(value)}"${String(current) === value ? " selected" : ""}>${escape(caption)}</option>`).join("")}</select></label>`;
  const diceFields = (key, die, label) => Array.from({ length: die.count }, (_, index) => field(key, `${label} ${index + 1} · d${die.sides}`, 1, die.sides, "", true)).join("");
  const number = (data, key) => data.get(key) === null || data.get(key) === "" ? undefined : Number(data.get(key));
  const rolls = (data, key, extra = `${key}2`) => [number(data, key), number(data, extra)].filter(value => value !== undefined);
  let store, roster, selected, draft, busy = false, catalog = {};
  const activeFight = () => roster?.combat && roster.combat.phase !== "ended";
  const partyBattle = () => S.partyBattle(roster);
  const people = battle => battle.actors.filter(actor => actor.side === "party");
  const character = actor => actor && !actor.npc && roster.slots[actor.slot] ? borderlandsCharacter.derive(roster.slots[actor.slot]) : null;
  function notify(message = "", error = false) {
    $("status").textContent = message; $("status").classList.toggle("error", error);
    if (error && $("workflow").open) {
      let note = $("workflow-body").querySelector("[data-workflow-error]");
      if (!note) { note = document.createElement("p"); note.dataset.workflowError = ""; note.className = "status error"; note.setAttribute("role", "alert"); $("workflow-body").prepend(note); }
      note.textContent = message;
    }
  }
  function setBusy(value) {
    busy = value;
    $("session-content").inert = value || Boolean(activeFight());
    history.update();
    rest.update();
  }
  const history = borderlandsDashboardControls.mount({ getStore: () => store, isBlocked: () => busy || Boolean(draft), setBusy,
    onChange(updated) { roster = S.ensure(updated); render(); }, status: notify });
  async function commit(next, message) {
    setBusy(true);
    try { roster = S.ensure(await store.save(next)); render(); notify(message); return true; }
    catch (error) { notify(error.message, true); return false; }
    finally { setBusy(false); }
  }
  const rest = borderlandsPartyRestUI.mount({ getRoster: () => roster, getLanguage: () => language,
    isBlocked: () => busy || Boolean(activeFight() || draft), commit, notify });
  function stats(actor) {
    const current = E.currentStats(actor);
    return `${actor.hp}/${actor.maxHp} HP · AC ${current.ac} · ${word("Speed", "速度")} ${current.speed ?? "—"} ft${actor.death?.dead ? ` · ${word("Dead", "死亡")}` : actor.death?.stable ? ` · ${word("Stable", "稳定")}` : ""}`;
  }
  function render() {
    if (!roster) return;
    const battle = partyBattle(), actors = people(battle);
    if (!actors.some(actor => actor.id === selected)) selected = actors[0]?.id;
    $("heading").textContent = word("Party actions", "队伍行动");
    $("intro").textContent = word("Cast spells, use abilities and record physical rolls between fights. Track time at the table and remove expired effects here.", "在战斗之间施法、使用能力并记录实体骰结果。请在桌面记录时间，并在此移除已到期的效果。");
    $("active-fight").hidden = !activeFight();
    $("active-fight").innerHTML = word('Finish or cancel the current fight on <a href="../combat_page/">Combat</a> before using Party actions.', '请先在<a href="../combat_page/">战斗页面</a>结束或取消当前战斗，再使用队伍行动。');
    $("lang-en").setAttribute("aria-pressed", String(language === "en"));
    $("lang-zh").setAttribute("aria-pressed", String(language === "zh-Hans"));
    $("party-panel").innerHTML = `<h2>${escape(word("Party and companions", "队伍与同伴"))}</h2><div class="session-stack">${actors.map(actor => `<article class="session-person" aria-current="${actor.id === selected}">${button("select", name(actor), actor.id)}<p>${escape(stats(actor))}</p>${actor.conditions.map(effect => `<span class="session-note">${escape(name(effect))} · </span>`).join("")}</article>`).join("") || `<p>${escape(word("Create a character on Characters first.", "请先在角色页建立角色。"))}</p>`}</div>`;
    renderActions(battle.actors.find(actor => actor.id === selected), battle);
    renderPending(battle);
    renderCompanions();
    setBusy(busy);
  }
  function actionList(actor, battle) {
    return C.forActor(actor, character(actor), battle).filter(action => !action.id.startsWith("opportunity-") && !action.reaction && !action.deathBurst);
  }
  function renderActions(actor, battle) {
    if (!actor) { $("action-panel").innerHTML = ""; return; }
    const current = E.currentStats(actor), sheet = character(actor);
    const statRows = entries => `<dl class="session-stats">${Object.entries(entries).map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
    const actions = actionList(actor, battle);
    $("action-panel").innerHTML = `<h2>${escape(name(actor))}</h2><p>${escape(stats(actor))}</p>${statRows(current.abilities)}
      <details><summary>${escape(word("Saving throws, skills and equipment", "豁免、技能与装备"))}</summary>${statRows(current.saves)}${statRows(current.skills)}${sheet ? `<ul>${sheet.equipment.map(item => `<li>${escape(name(item))} × ${item.qty}${item.slots.length ? ` · ${escape(word("equipped", "已装备"))}` : ""}</li>`).join("")}</ul>` : `<a href="${escape(catalog[actor.monster]?.source || "../library_page/")}" target="_blank" rel="noopener">${escape(word("Printed card", "原始卡牌"))} ↗</a>`}</details>
      ${sheet?.powers.length ? `<p class="session-note">${escape(sheet.powers.map(power => `${name(power)} ${power.remaining}/${power.count}`).join(" · "))}</p>` : ""}
      <div class="session-toolbar">${button("adjust", word("HP, conditions and effects", "生命值、状态与效果"), actor.id)}${actor.hp === 0 && !actor.npc && !actor.death?.dead && !actor.death?.stable ? button("death-save", word("Next turn · death save", "下一回合 · 死亡豁免"), actor.id) : ""}${actor.concentration ? button("end-concentration", word("End Concentration", "结束专注"), actor.id) : ""}</div>
      ${actor.conditions.map(effect => `<div class="session-condition"><span>${escape(name(effect))}</span><div>${effect.tick?.dice ? button("effect-damage", word("Resolve ongoing damage", "结算持续伤害"), `${actor.id}|${effect.id}`) : ""}${effect.repeatSave ? button("effect-save", word("Repeat save", "再次豁免"), `${actor.id}|${effect.id}`) : ""}${button("remove-effect", word("Remove", "移除"), `${actor.id}|${effect.id}`)}</div></div>`).join("")}
      <h3>${escape(word("Spells and abilities", "法术与能力"))}</h3><p class="session-note">${escape(word("Resolve ranges, visibility and narrative results at the physical table. Each applied result can be undone.", "距离、视线和叙事结果由实体桌面判定。每次已结算结果均可撤销。"))}</p><div class="session-actions">${actions.map(action => `<button class="secondary" type="button" data-cmd="action" data-value="${escape(action.id)}"><strong>${escape(name(action))}</strong><small>${escape(action.cost?.power ? `${action.remaining ?? 0} ${word("tokens remaining", "枚标记可用")}` : action.timing)}</small></button>`).join("")}</div>`;
  }
  function renderCompanions() {
    $("companion-panel").innerHTML = `<h2>${escape(word("Friendly and hired NPC companions", "友善与雇佣 NPC 同伴"))}</h2><p>${escape(word("Use the printed card chosen by the DM. Friendly companions join future fights with the party; hiring costs and limits follow the adventure or your table agreement.", "使用主持人选定的原始卡牌。同伴会随队伍加入之后的战斗；雇佣费用与限制按冒险文本或桌上约定处理。"))}</p>
      <form data-form="companion"><div class="session-fields"><label>${escape(word("Name", "名字"))}<input name="name" maxlength="80" required></label>${select("monster", word("Printed stat card", "原始属性卡"), Object.fromEntries(Object.entries(catalog).map(([id, card]) => [id, name(card)])))}${select("role", word("Relationship", "关系"), { friendly: word("Friendly", "友善"), hired: word("Hired", "雇佣") })}${select("duration", word("Duration", "持续时间"), { ongoing: word("Until dismissed", "直到遣散"), one: word("One fight", "一场战斗") })}</div><div class="session-fields">${select("payer", word("Payer (if hired)", "付款角色（若雇佣）"), { "": word("No payment now", "本次不付款"), ...Object.fromEntries(roster.slots.flatMap((choice, slot) => choice ? [[slot, choice.name || choice.classId]] : [])) })}${field("fee", word("Agreed fee · GP", "约定费用 · 金币"), 0, 999999, 0)}<button class="primary" type="submit">${escape(word("Add companion", "添加同伴"))}</button></div></form>
      <div class="session-stack">${roster.session.companions.map(companion => `<article class="session-person"><strong>${escape(name(companion))}</strong><p>${escape(`${companion.hp}/${companion.maxHp} HP · ${companion.role === "hired" ? word("Hired", "雇佣") : word("Friendly", "友善")} · ${companion.active ? word("Travelling with party", "随队中") : word("Dismissed", "已遣散")}${companion.serviceEnded ? ` · ${word("service completed", "服务已完成")}` : companion.remainingFights === 1 ? ` · ${word("one fight remaining", "剩余一场战斗")}` : ""}`)}</p>${companionNotes(companion)}${companion.serviceEnded ? "" : button(companion.active ? "dismiss" : "rejoin", companion.active ? word("Dismiss", "遣散") : word("Rejoin", "重新加入"), companion.id)}</article>`).join("")}</div>`;
  }
  function companionNotes(companion) {
    const area = scope => ({ wilderness: word("Wilderness", "荒野"), caves: word("Caves of Chaos", "混沌洞穴") }[scope]
      || (/^cave-[a-k]$/.test(scope) ? word(`Cave ${scope.slice(-1).toUpperCase()}`, `洞穴 ${scope.slice(-1).toUpperCase()}`) : scope));
    const notes = [word(companion.serviceNote || "", companion.serviceNoteZh || companion.serviceNote || ""),
      companion.scope ? word(`Service area: ${area(companion.scope)}`, `服务范围：${area(companion.scope)}`) : "",
      companion.excludedMaps?.length ? word(`Does not enter: ${companion.excludedMaps.map(area).join(", ")}`, `不会进入：${companion.excludedMaps.map(area).join("、")}`) : ""].filter(Boolean);
    return notes.map(note => `<p class="session-note">${escape(note)}</p>`).join("")
      + (/^(?:\/|\.\.\/)database\//.test(companion.source || "") ? `<p><a href="${escape(companion.source)}" target="_blank" rel="noopener">${escape(word("Adventure source", "冒险原文"))} ↗</a></p>` : "");
  }
  function renderPending(battle) {
    const prompts = E.prompts(battle).filter(prompt => prompt.kind !== "death-burst");
    $("pending-panel").hidden = !prompts.length;
    $("pending-panel").innerHTML = `<h2>${escape(word("Pending rolls", "待结算掷骰"))}</h2>${prompts.map((prompt, index) => `<p>${escape(`${name(battle.actors.find(actor => actor.id === prompt.actorId))} · ${prompt.label || prompt.kind}${prompt.dc ? ` DC ${prompt.dc}` : ""}`)} ${button("prompt", word("Resolve", "结算"), String(index))}</p>`).join("")}`;
  }
  function showDialog(title, html) {
    $("workflow-title").textContent = title;
    $("workflow-body").innerHTML = html;
    if (!$("workflow").open) $("workflow").showModal();
    history.update();
  }
  function closeDialog() { draft = null; $("workflow").close(); history.update(); }
  const cancel = () => button("cancel", word("Cancel", "取消"));
  function startAction(actionId) {
    const battle = partyBattle(), actor = battle.actors.find(entry => entry.id === selected);
    const source = actionList(actor, battle).find(action => action.id === actionId);
    if (!source) throw new Error("Choose an available action.");
    const action = { ...clone(source), timing: "free" };
    battle.active = actor.id;
    draft = { kind: "action", action, actorId: actor.id, battle, targets: action.target === "self" ? [actor.id] : [], input: {}, stage: "setup" };
    if (source.slots) {
      draft.root = clone(source); draft.slotIndex = 0; draft.workingRoster = clone(roster); draft.results = [];
      return beginSlot();
    }
    renderActionSetup();
  }
  function beginSlot(choiceIndex) {
    const slot = draft.root.slots[draft.slotIndex];
    if (Array.isArray(slot) && choiceIndex === undefined) return showDialog(name(draft.root), `<p>${escape(word(`Choose attack ${draft.slotIndex + 1} of ${draft.root.slots.length}`, `选择第 ${draft.slotIndex + 1}／${draft.root.slots.length} 次攻击`))}</p><div class="session-toolbar">${slot.map((action, index) => button("slot-action", name(action), String(index))).join("")}${cancel()}</div>`);
    draft.action = { ...clone(Array.isArray(slot) ? slot[choiceIndex] : slot), timing: "free" };
    draft.action.description ||= draft.root.description;
    draft.action.descriptionZh ||= draft.root.descriptionZh;
    draft.battle = S.partyBattle(draft.workingRoster);
    draft.battle.active = draft.actorId;
    draft.targets = draft.action.target === "self" ? [draft.actorId] : [];
    draft.input = {}; draft.stage = "setup";
    return renderActionSetup();
  }
  function renderActionSetup() {
    const { action, actorId, battle } = draft;
    const actor = battle.actors.find(entry => entry.id === actorId), candidates = people(battle);
    const targetFields = action.target === "pick" ? `<fieldset class="session-targets"><legend>${escape(word("Targets", "目标"))}</legend>${candidates.map(target => `<label><input name="target" type="checkbox" value="${escape(target.id)}"${draft.targets.includes(target.id) ? " checked" : ""}>${escape(name(target))} · ${escape(stats(target))}</label>`).join("")}</fieldset>` : "";
    const optionFields = Object.entries(action.options || {}).map(([key, values]) => select(`option-${key}`, key, Object.fromEntries(values.map(value => [value, value])), draft.input[key] ?? values[0])).join("");
    const targetRolls = candidates.map(target => `<fieldset><legend>${escape(name(target))}</legend><div class="session-fields">${select(`mode-${target.id}`, word("Roll mode", "掷骰方式"), modeOptions())}${field(`modifier-${target.id}`, word("Situational modifier", "情境调整值"), -99, 99)}${action.type === "save" ? field(`save-${target.id}`, `${action.save.ability} · d20`, 1, 20) + field(`save2-${target.id}`, word("Second d20 if needed", "需要时录入第二颗 d20"), 1, 20) : ""}${target.conditions.some(effect => effect.key === "bless") && action.type === "save" ? field(`bless-${target.id}`, "Bless · d4", 1, 4) : ""}${action.darts ? field(`darts-${target.id}`, word("Allocated darts", "分配的飞弹数"), 0, action.darts, 0) : ""}</div>${target.conditions.some(effect => effect.key === "sanctuary") ? `<p>${escape(word("If targeting Sanctuary: enter the acting creature's Wisdom save.", "若以受庇护术保护者为目标，请录入行动者的感知豁免。"))}</p><div class="session-fields">${field(`ward-${target.id}`, "Sanctuary WIS · d20", 1, 20)}${field(`ward2-${target.id}`, "Second d20", 1, 20)}${select(`wardMode-${target.id}`, "Mode", modeOptions())}</div>` : ""}</fieldset>`).join("");
    const attacks = action.type === "attack" ? `<div class="session-fields">${field("attack", word("Attack · d20", "攻击 · d20"), 1, 20, "", true)}${field("attack2", word("Second d20 if needed", "需要时录入第二颗 d20"), 1, 20)}${actor.conditions.some(effect => effect.key === "bless") ? field("bless-attack", "Bless · d4", 1, 4) : ""}</div>` : "";
    const checks = action.type === "check" ? `<p>${escape(action.check.skill)} · DC ${action.check.dc}</p><div class="session-fields">${field("check", "Check · d20", 1, 20, "", true)}${field("check2", "Second d20", 1, 20)}${select("checkMode", "Mode", modeOptions())}${field("guidance", "Guidance · d4", 1, 4)}</div>` : "";
    const wind = action.secondWindCheck ? `<div class="session-fields">${field("previousCheckTotal", word("Failed check total", "失败的检定总值"), -999, 999, "", true)}${field("checkDC", "DC", 0, 999, "", true)}${field("windRoll", "Second Wind · d10", 1, 10, "", true)}</div>` : "";
    const manual = action.type === "manual" ? `<label>${escape(word("Result or DM ruling", "结果或主持人裁定"))}<textarea name="note" maxlength="500"></textarea></label>` : "";
    showDialog(name(action), `${draft.root ? `<p>${escape(word(`Attack ${draft.slotIndex + 1} of ${draft.root.slots.length}. The full sequence saves together after the last attack.`, `第 ${draft.slotIndex + 1}／${draft.root.slots.length} 次攻击。最后一次攻击结算后，将整体保存。`))}</p>` : ""}<p>${escape(text(action) || "")}</p>${action.targetCap ? `<p class="session-note">${escape(word(`Printed limit: ${action.targetCap} target(s).`, `印刷规则上限：${action.targetCap} 个目标。`))}</p>` : ""}<form data-form="action-setup">${targetFields}<div class="session-fields">${optionFields}</div>${attacks}${checks}${wind}${["attack", "save"].includes(action.type) || action.darts ? targetRolls : ""}${manual}${action.kitCheck ? field("kitRoll", word("Healer's Kit check · d10", "医疗包消耗检定 · d10"), 1, 10, "", true) : ""}<div class="session-toolbar"><button class="primary" type="submit">${escape(word("Preview result", "预览结果"))}</button>${cancel()}</div></form>`);
  }
  function readAction(data) {
    const { action, battle } = draft;
    draft.targets = action.target === "pick" ? data.getAll("target") : action.target === "self" ? [draft.actorId] : [];
    const input = { note: data.get("note") || "", modes: {}, modifiers: {}, saves: {}, allocations: {}, sanctuary: {}, wardModes: {}, bless: { saves: {} } };
    input.attack = rolls(data, "attack");
    input.checkRolls = rolls(data, "check");
    if (data.get("checkMode") && data.get("checkMode") !== "auto") input.checkMode = data.get("checkMode");
    for (const key of ["guidance", "kitRoll", "previousCheckTotal", "checkDC", "windRoll"]) if (number(data, key) !== undefined) input[key] = number(data, key);
    for (const key of Object.keys(action.options || {})) input[key] = data.get(`option-${key}`);
    for (const actor of people(battle)) {
      if (data.get(`mode-${actor.id}`) && data.get(`mode-${actor.id}`) !== "auto") input.modes[actor.id] = data.get(`mode-${actor.id}`);
      if (number(data, `modifier-${actor.id}`) !== undefined) input.modifiers[actor.id] = number(data, `modifier-${actor.id}`);
      input.saves[actor.id] = rolls(data, `save-${actor.id}`, `save2-${actor.id}`);
      if (number(data, `darts-${actor.id}`) !== undefined) input.allocations[actor.id] = number(data, `darts-${actor.id}`);
      if (number(data, `bless-${actor.id}`) !== undefined) input.bless.saves[actor.id] = number(data, `bless-${actor.id}`);
      input.sanctuary[actor.id] = rolls(data, `ward-${actor.id}`, `ward2-${actor.id}`);
      if (data.get(`wardMode-${actor.id}`) && data.get(`wardMode-${actor.id}`) !== "auto") input.wardModes[actor.id] = data.get(`wardMode-${actor.id}`);
    }
    if (number(data, "bless-attack") !== undefined) input.bless.attack = number(data, "bless-attack");
    draft.input = input;
    draft.preview = E.preview(battle, draft.actorId, action, draft.targets, input);
  }
  function renderActionResult() {
    const { action, preview } = draft;
    const results = `<p>${escape(preview.summary)}</p>${preview.warnings.map(value => `<p class="session-note">${escape(value)}</p>`).join("")}`;
    if (preview.complete) {
      draft.stage = "preview";
      showDialog(name(action), results + `<p>${escape(text(action) || "")}</p><div class="session-toolbar">${button("apply-action", word("Apply and save", "结算并保存"), "", true)}${button("edit-action", word("Edit rolls", "修改掷骰"))}${cancel()}</div>`);
      return;
    }
    const dice = preview.dice || [];
    if (preview.needsDamage && !draft.input.damage) {
      draft.stage = "damage";
      showDialog(name(action), results + `<form data-form="action-damage"><p>${escape(word("Enter final physical dice after any permitted rerolls. Flat modifiers are added automatically.", "请录入按规则重掷后的最终实体骰点数。固定调整值会自动加上。"))}</p>${dice.map((die, index) => `<fieldset><legend>${escape(die.type || "Dice")} · ${die.count}d${die.sides} ${die.flat >= 0 ? "+" : ""}${die.flat || 0}</legend><div class="session-fields">${diceFields(`damage-${index}`, die, word("Die", "骰子"))}${die.criticalRequired ? diceFields(`critical-${index}`, die, word("Critical die", "重击骰")) : ""}</div></fieldset>`).join("")}${preview.damageTypeRoll ? field("damageTypeRoll", word("Damage type die", "伤害类型骰"), 1, preview.damageTypeRoll.sides, "", true) : ""}<div class="session-toolbar"><button class="primary" type="submit">${escape(word("Preview result", "预览结果"))}</button>${button("edit-action", word("Edit targets / rolls", "修改目标／掷骰"))}${cancel()}</div></form>`);
    } else showDialog(name(action), results + `<p class="error">${escape(word("Choose targets, options and all required dice before applying.", "请先选择目标、选项，并录入全部所需骰子。"))}</p><div class="session-toolbar">${button("edit-action", word("Edit targets / rolls", "修改目标／掷骰"))}${cancel()}</div>`);
  }
  function openAdjustment(actorId) {
    const battle = partyBattle(), actor = battle.actors.find(entry => entry.id === actorId);
    draft = { kind: "adjust", battle, actorId };
    showDialog(`${name(actor)} · ${word("Record effects", "记录效果")}`, `<form data-form="adjust"><p>${escape(word("Use healing or damage for a new event. Current HP is an explicit DM correction.", "新发生的事件请用治疗或伤害。当前生命值用于主持人直接修正。"))}</p><div class="session-fields">${field("hp", word("Current HP", "当前生命值"), 0, actor.maxHp, actor.hp)}${field("tempHp", word("Temporary HP", "临时生命值"), 0, 9999, actor.tempHp || 0)}${field("damage", word("Damage", "伤害"), 0, 9999)}${field("heal", word("Healing", "治疗"), 0, 9999)}${field("exhaustionLevels", word("Exhaustion level", "力竭等级"), 0, 6, E.currentStats(actor).exhaustion)}${select("life", word("Life state", "生死状态"), { "": word("Keep current", "保持当前"), dying: word("Dying · 0 HP", "濒死 · 0 HP"), stable: word("Stable · 0 HP", "稳定 · 0 HP"), dead: word("Dead", "死亡"), conscious: word("Alive · positive HP", "存活 · 正生命值") })}</div><fieldset><legend>${escape(word("Add a lasting condition or stat effect", "添加持续状态或属性效果"))}</legend>${select("condition", word("Printed condition", "规则状态"), { "": word("None / custom effect", "无／自定义效果"), ...Object.fromEntries(Object.entries(conditions).map(([key, [en, zh]]) => [key, word(en, `${zh}（${en}）`)])) })}<label>${escape(word("Custom effect name (optional)", "自定义效果名称（可选）"))}<input name="effectName" maxlength="100"></label><div class="session-fields">${field("ac", "AC +/−", -999, 999)}${field("speed", word("Speed +/− ft", "速度 +/− 英尺"), -999, 999)}${field("attackBonus", word("Attack +/−", "攻击 +/−"), -999, 999)}${field("saveBonus", word("Saving throws +/−", "豁免 +/−"), -999, 999)}${field("abilityBonus", word("Ability checks +/−", "属性检定 +/−"), -999, 999)}</div></fieldset><div class="session-toolbar"><button class="primary" type="submit">${escape(word("Save adjustment", "保存调整"))}</button>${cancel()}</div></form>`);
  }
  function openPrompt(prompt, battle = partyBattle()) {
    const actor = battle.actors.find(entry => entry.id === prompt.actorId);
    draft = { kind: "prompt", prompt, battle, actorId: actor.id };
    const damage = prompt.kind === "effect-damage";
    const mode = prompt.mode || "normal";
    showDialog(`${name(actor)} · ${prompt.label || prompt.kind}`, `<form data-form="prompt"><p>${escape(`${prompt.ability || ""}${prompt.dc ? ` DC ${prompt.dc}` : ""}`)}</p>${damage ? (prompt.dice || []).map((die, index) => `<fieldset><legend>${escape(die.type || "Damage")} · ${die.count}d${die.sides}</legend><div class="session-fields">${diceFields(`effect-${index}`, die, word("Die", "骰子"))}</div></fieldset>`).join("") : `<div class="session-fields">${field("die", "d20", 1, 20, "", true)}${field("extra", word("Second d20 if needed", "需要时录入第二颗 d20"), 1, 20)}${select("mode", word("Mode", "方式"), { normal: word("Normal", "正常"), advantage: word("Advantage", "优势"), disadvantage: word("Disadvantage", "劣势") }, mode)}${actor.conditions.some(effect => effect.key === "bless") ? field("bless", "Bless · d4", 1, 4) : ""}</div>`}<div class="session-toolbar"><button class="primary" type="submit">${escape(word("Resolve and save", "结算并保存"))}</button>${cancel()}</div></form>`);
  }
  async function runClick(cmd, value) {
    if (cmd === "cancel") return closeDialog();
    if (busy || !roster || activeFight()) return;
    if (cmd === "select") { selected = value; return render(); }
    if (cmd === "action") return startAction(value);
    if (cmd === "slot-action") return beginSlot(Number(value));
    if (cmd === "edit-action") { draft.input = {}; return renderActionSetup(); }
    if (cmd === "adjust") return openAdjustment(value);
    if (cmd === "death-save") {
      const battle = partyBattle(), actor = battle.actors.find(entry => entry.id === value);
      battle.active = actor.id; actor.turns = (actor.turns || 0) + 1;
      return openPrompt(E.prompts(battle).find(prompt => prompt.kind === "death" && prompt.actorId === actor.id), battle);
    }
    if (cmd === "end-concentration" || cmd === "remove-effect") {
      const [actorId, effectId] = value.split("|");
      const next = E.correct(partyBattle(), actorId, cmd === "end-concentration" ? { endConcentration: true } : { removeCondition: effectId });
      return commit(S.reconcile(S.capture(roster, next)), word("Effect updated. Use Undo to reverse it.", "效果已更新，可用撤销还原。"));
    }
    if (cmd === "effect-damage" || cmd === "effect-save") {
      const [actorId, effectId] = value.split("|"), battle = partyBattle();
      const actor = battle.actors.find(entry => entry.id === actorId), effect = actor.conditions.find(entry => entry.id === effectId);
      const save = effect.repeatSave;
      const prompt = { id: `manual-${cmd}-${actorId}-${Date.now()}`, kind: cmd, actorId, sourceId: effect.sourceId,
        effectId, label: effect.name, ...(cmd === "effect-damage" ? { dice: effect.tick.dice } : { ability: save.ability, dc: save.dc, mode: save.mode || "normal" }) };
      battle.pending.push(prompt);
      return openPrompt(prompt, battle);
    }
    if (cmd === "prompt") { const battle = partyBattle(); return openPrompt(E.prompts(battle)[Number(value)], battle); }
    if (cmd === "dismiss" || cmd === "rejoin") {
      const next = clone(roster), companion = next.session.companions.find(entry => entry.id === value);
      if (!companion) return;
      if (cmd === "rejoin" && companion.death?.dead) throw new Error(word("A dead companion cannot rejoin without revival.", "死亡的同伴须先复活才能重新加入。"));
      if (cmd === "rejoin" && companion.serviceEnded) throw new Error(word("This one-fight service has ended. Recruit or hire the companion again from the adventure location, or add a new companion with the agreed fee.", "本次助战服务已结束。请在冒险地点重新招募或雇佣，或按约定费用添加新同伴。"));
      companion.active = cmd === "rejoin";
      return commit(next, word("Companion updated.", "同伴已更新。"));
    }
    if (cmd === "apply-action") {
      const result = S.resolve(draft.workingRoster || roster, { action: draft.action, actorId: draft.actorId, targetIds: draft.targets, input: draft.input, title: name(draft.action) });
      if (!result.preview.complete) throw new Error(result.preview.warnings[0] || "Complete all required dice.");
      const summary = result.preview.summary;
      if (draft.root && draft.slotIndex + 1 < draft.root.slots.length) {
        draft.results.push(summary); draft.workingRoster = result.roster; draft.slotIndex++;
        return beginSlot();
      }
      const summaries = [...(draft.results || []), summary].join(" | ");
      closeDialog();
      return commit(result.roster, `${word("Saved", "已保存")} · ${summaries}`);
    }
  }
  async function runForm(form) {
    if (busy || !roster || activeFight()) return;
    const data = new FormData(form), kind = form.dataset.form;
    if (kind === "companion") {
      const monster = data.get("monster"), card = catalog[monster];
      if (!card) throw new Error("Choose a printed stat card.");
      let next = clone(roster);
      const fee = number(data, "fee") || 0, payer = data.get("payer");
      if (fee > 0) {
        if (payer === "" || data.get("role") !== "hired") throw new Error(word("Choose a hired companion and paying character for this fee.", "有费用时请选择雇佣同伴与付款角色。"));
        const choice = next.slots[Number(payer)], sheet = borderlandsCharacter.derive(choice);
        if (sheet.gold < fee) throw new Error(word("The paying character does not have enough gold.", "付款角色没有足够金币。"));
        choice.sheet ??= {}; choice.sheet.stats = { ...choice.sheet.stats, gold: sheet.gold - fee };
      }
      const companionName = String(data.get("name")).trim();
      next = S.addCompanion(next, { monster, name: companionName, zh: companionName, role: data.get("role"),
        hp: card.hp, maxHp: card.hp, baseMaxHp: card.hp, ac: card.ac, initiative: card.initiative,
        abilities: clone(card.abilities || {}), saves: clone(card.saves || {}), skills: clone(card.skills || {}), defenses: clone(card.defenses || {}),
        source: card.source, printedDetails: card.printedDetails || "",
        movement: clone(card.speed || {}), ...(Number.isFinite(card.speed?.walk) ? { speed: card.speed.walk } : {}),
        kind: card.kind, size: card.kind?.split(" ")[0], printed: true, profile: "context",
        remainingFights: data.get("duration") === "one" ? 1 : null });
      return commit(next, word("Companion added with printed stats. Use Undo to reverse this and any hiring payment.", "已按原始属性添加同伴。可用撤销还原此次添加及雇佣付款。"));
    }
    if (kind === "action-setup") { readAction(data); return renderActionResult(); }
    if (kind === "action-damage") {
      draft.input.damage = draft.preview.dice.map((_, index) => data.getAll(`damage-${index}`).map(Number));
      draft.input.critical = draft.preview.dice.map((_, index) => data.getAll(`critical-${index}`).map(Number));
      if (number(data, "damageTypeRoll") !== undefined) draft.input.damageTypeRoll = number(data, "damageTypeRoll");
      draft.preview = E.preview(draft.battle, draft.actorId, draft.action, draft.targets, draft.input);
      return renderActionResult();
    }
    if (kind === "adjust") {
      const change = {};
      for (const key of ["hp", "tempHp", "damage", "heal", "exhaustionLevels"]) if (number(data, key) !== undefined) change[key] = number(data, key);
      if (change.damage !== undefined && change.heal !== undefined) throw new Error(word("Apply damage and healing separately.", "请分别结算伤害与治疗。"));
      const life = data.get("life");
      if (["dead", "stable", "dying"].includes(life)) change.hp = 0;
      if (life) { change.dead = life === "dead"; if (life !== "dead") change.stable = life === "stable"; }
      if (life === "conscious" && !change.hp) throw new Error(word("Enter positive current HP for a conscious creature.", "清醒生物须录入正的当前生命值。"));
      const effectName = String(data.get("effectName")).trim();
      const condition = data.get("condition"), standard = conditions[condition];
      const effectFields = ["ac", "speed", "attackBonus", "saveBonus", "abilityBonus"];
      if (!effectName && !standard && effectFields.some(key => number(data, key) !== undefined)) throw new Error(word("Choose a condition or enter a name for this effect.", "请选择状态或输入效果名称。"));
      if (effectName || standard) {
        change.addCondition = { name: effectName || standard[0], ...(standard ? { key: condition, zh: standard[1] } : { key: `custom-${crypto.randomUUID()}` }) };
        for (const key of effectFields) if (number(data, key) !== undefined) change.addCondition[key] = number(data, key);
      }
      const next = E.correct(draft.battle, draft.actorId, change);
      closeDialog();
      return commit(S.reconcile(S.capture(roster, next)), word("Party adjustment saved.", "队伍调整已保存。"));
    }
    if (kind === "prompt") {
      const { prompt, battle } = draft;
      let next;
      if (prompt.kind === "death") { battle.active = prompt.actorId; next = E.deathSave(battle, prompt.actorId, rolls(data, "die", "extra"), data.get("mode"), number(data, "bless")); }
      else if (prompt.kind === "concentration") next = E.concentrationSave(battle, prompt.actorId, rolls(data, "die", "extra"), data.get("mode"), number(data, "bless"));
      else next = E.resolvePrompt(battle, prompt.id, prompt.kind === "effect-damage" ? prompt.dice.map((_, index) => data.getAll(`effect-${index}`).map(Number)) : rolls(data, "die", "extra"), { mode: data.get("mode") || undefined, bless: number(data, "bless") });
      closeDialog();
      return commit(S.reconcile(S.capture(roster, next)), word("Roll resolved and saved.", "掷骰已结算并保存。"));
    }
  }
  document.addEventListener("click", event => { const target = event.target.closest("[data-cmd]"); if (target) runClick(target.dataset.cmd, target.dataset.value).catch(error => notify(error.message, true)); });
  document.addEventListener("submit", event => { if (!event.target.matches("[data-form]")) return; event.preventDefault(); runForm(event.target).catch(error => notify(error.message, true)); });
  $("workflow").addEventListener("cancel", () => { draft = null; history.update(); });
  for (const [id, value] of [["lang-en", "en"], ["lang-zh", "zh-Hans"]]) $(id).addEventListener("click", () => {
    language = value; try { localStorage.setItem(languageKey, language); } catch {} render();
  });
  Promise.all([borderlandsStorage.load(), fetch("/api/adventure/creatures", { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("Restart the Borderlands launcher to load printed NPC stat cards.");
    return response.json();
  })]).then(([loaded, cards]) => {
    const names = { ...globalThis.combatOrdinaryNames, ...globalThis.combatFixedNames }, defenses = { ...globalThis.combatOrdinaryDefenses, ...globalThis.combatFixedDefenses };
    catalog = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, { ...card, zh: C.enemies[id]?.zh || names[id] || card.name, defenses: defenses[id] || {} }]));
    store = loaded; roster = S.ensure(store.roster); render(); notify(loaded.notice || "");
  }).catch(error => notify(error.message, true));
})();
