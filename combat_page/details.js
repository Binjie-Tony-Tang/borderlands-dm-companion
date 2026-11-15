(() => {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const signed = number => number < 0 ? `−${-number}` : `+${number}`;
  const skills = {
    Athletics: ["STR", "运动"], Acrobatics: ["DEX", "体操"], "Sleight of Hand": ["DEX", "巧手"], Stealth: ["DEX", "隐匿"],
    Arcana: ["INT", "奥秘"], History: ["INT", "历史"], Investigation: ["INT", "调查"], Nature: ["INT", "自然"], Religion: ["INT", "宗教"],
    "Animal Handling": ["WIS", "驯兽"], Insight: ["WIS", "洞悉"], Medicine: ["WIS", "医药"], Perception: ["WIS", "察觉"], Survival: ["WIS", "求生"],
    Deception: ["CHA", "欺瞒"], Intimidation: ["CHA", "威吓"], Performance: ["CHA", "表演"], Persuasion: ["CHA", "游说"],
  };
  const abilityNames = { STR: "力量", DEX: "敏捷", CON: "体质", INT: "智力", WIS: "感知", CHA: "魅力" };
  const movementNames = { walk: "步行", climb: "攀爬", fly: "飞行", swim: "游泳", burrow: "掘穴" };

  function render({ actor, character, card, stats, battle, actions = [], traits = [], language = "en", bound = true }) {
    const zh = language === "zh-Hans";
    const word = (en, cn) => zh ? cn : en;
    const nameOf = entry => zh && (entry.zh || entry.nameZh) ? `${entry.zh || entry.nameZh} (${entry.en || entry.name})` : entry.en || entry.name;
    const description = entry => zh ? entry.textZh || entry.descriptionZh || entry.textEn || entry.description : entry.textEn || entry.description;
    const actorName = entry => zh && entry.zh ? entry.zh : entry.name;
    const baseNote = (base, current, modifier = false) => Number.isFinite(base) && base !== current
      ? `<small class="combat-base-value">${word("base", "基础")} ${modifier ? signed(base) : base}</small>` : "";
    const value = (label, current, base, modifier = false, unit = "") => `<div><dt>${escape(label)}</dt><dd class="${base !== current && Number.isFinite(base) ? "combat-stat-changed" : ""}">${Number.isFinite(current) ? modifier ? signed(current) : current : "—"}${unit ? ` ${escape(unit)}` : ""}${baseNote(base, current, modifier)}</dd></div>`;
    const section = (key, title, body, open = false) => `<details class="combat-detail-section" data-detail-section="${key}"${open ? " open" : ""}><summary>${escape(title)}</summary>${body}</details>`;
    const list = values => values.length ? `<ul>${values.map(row => `<li>${row}</li>`).join("")}</ul>` : `<p class="combat-empty">${word("None recorded.", "未记录。")}</p>`;
    const rulesNotes = (stats.notes || []).map(note => escape(typeof note === "string" ? note : zh ? note.zh || note.en : note.en));
    const expiry = effect => {
      if (effect.expires?.phase === "round-start") return word(`Start of round ${effect.expires.round}`, `第 ${effect.expires.round} 轮开始时`);
      if (!effect.expires) return word("No automatic turn expiry; follow the card or remove manually.", "没有自动回合到期；按卡面处理或手动移除。");
      const owner = battle.actors.find(entry => entry.id === effect.expires.actorId);
      const remaining = effect.expires.turn - (owner?.turns ?? 0);
      const whose = owner ? actorName(owner) : word("recorded creature", "已记录生物");
      const phase = effect.expires.phase === "start" ? word("start", "开始") : word("end", "结束");
      if (remaining === 0) return word(`At the ${phase} of ${whose}'s current turn`, `${whose}当前回合${phase}时`);
      return remaining === 1 ? word(`At the ${phase} of ${whose}'s next turn`, `${whose}下个回合${phase}时`)
        : word(`At the ${phase} of ${whose}'s turn after ${Math.max(0, remaining)} turns`, `${whose}经过 ${Math.max(0, remaining)} 个回合后的回合${phase}时`);
    };
    const effectRows = (stats.effects || actor.conditions || []).map(effect => {
      const owner = battle.actors.find(entry => entry.id === effect.sourceId);
      const changes = [["ac", "AC"], ["speed", word("Speed (ft.)", "速度（英尺）")], ["attackBonus", word("Attack rolls", "攻击检定")],
        ["saveBonus", word("Saving throws", "豁免")], ["abilityBonus", word("Ability checks", "属性检定")]]
        .filter(([key]) => Number.isFinite(effect[key]) && effect[key] !== 0).map(([key, label]) => `${label} ${signed(effect[key])}`);
      for (const [label, values] of [[word("Abilities", "属性"), effect.abilities], [word("Saves", "豁免"), effect.saves]]) {
        for (const [key, number] of Object.entries(values || {})) changes.push(`${label} ${key} ${signed(number)}`);
      }
      return `<article class="combat-detail-effect"><h4>${escape(zh ? effect.zh || effect.name : effect.name)}</h4>
        ${changes.length ? `<p>${escape(changes.join(" · "))}</p>` : ""}
        ${owner ? `<p>${word("Source", "来源")}: ${escape(actorName(owner))}</p>` : ""}<p>${escape(expiry(effect))}</p>
        ${effect.concentration ? `<p>${word("Requires the source's Concentration.", "需要来源维持专注（Concentration）。")}</p>` : ""}
        ${effect.repeatSave ? `<p>${word("Repeat saving throw", "重复豁免")}: ${escape(effect.repeatSave.ability)} DC ${escape(effect.repeatSave.dc)} · ${effect.repeatSave.phase === "end" ? word("at the end of this creature's turn", "在此生物回合结束时") : word("at the start of this creature's turn", "在此生物回合开始时")}</p>` : ""}</article>`;
    });
    const movement = Object.entries(stats.movement || {}).filter(([, number]) => Number.isFinite(number)).map(([mode, number]) =>
      value(zh ? `${movementNames[mode] || mode} (${mode})` : mode[0].toUpperCase() + mode.slice(1), number, stats.baseMovement?.[mode], false, word("ft.", "英尺"))).join("");
    const saves = Object.entries(stats.saves || {}).map(([key, number]) => value(zh ? `${abilityNames[key] || key} (${key})` : key, number, actor.saves?.[key], true)).join("");
    const abilities = Object.entries(stats.abilities || {}).map(([key, number]) => value(zh ? `${abilityNames[key] || key} (${key})` : key, number, actor.abilities?.[key], true)).join("");
    const state = actor.death?.dead ? word("Dead", "死亡") : actor.death?.stable ? word("Stable at 0 HP", "0 HP，稳定") : actor.hp === 0 && actor.side === "party" ? word("Dying", "濒死") : "";
    let output = `<p class="combat-detail-identity">${escape(character ? `Level 1 · ${nameOf(character.job)} · ${nameOf(character.background)} · ${nameOf(character.species)}` : actor.kind || card?.kind || "")}${card?.challengeRating != null ? ` · CR ${escape(card.challengeRating)}` : ""}</p>
      ${!bound ? `<p class="error">${word("The saved character sheet changed outside this fight. Combat values remain the fight snapshot; replace the participant to resync.", "角色表在战斗外已改变；战斗数值仍是本次战斗的快照。重新加入角色以同步。")}</p>` : ""}
      <div class="combat-detail-vitals"><dl>${value(word("Current HP", "当前生命值（HP）"), actor.hp)}${value(word("Maximum HP", "生命值上限"), actor.maxHp)}${value(word("Temporary HP", "临时生命值"), actor.tempHp ?? 0)}${value(word("Armor Class", "护甲等级（AC）"), stats.ac, stats.baseAc)}${value(word("Initiative modifier", "先攻调整值"), stats.initiative ?? actor.initiative, actor.initiative, true)}</dl>${state ? `<p class="combat-effect">${escape(state)}</p>` : ""}</div>
      ${section("movement", word("Movement and current effects", "移动与当前效果"), `<dl class="combat-detail-stats">${movement || `<div><dt>${word("Speed", "速度")}</dt><dd>—</dd></div>`}</dl>${actor.movement?.hover || card?.speed?.hover ? `<p>${word("Can hover while flying.", "飞行时可悬浮（Hover）。")}</p>` : ""}${rulesNotes.length ? list(rulesNotes) : ""}<div class="combat-detail-effects">${effectRows.join("") || `<p class="combat-empty">${word("No active effects.", "没有生效中的效果。")}</p>`}</div>`, true)}
      ${section("abilities", word("Ability modifiers and saving throws", "属性调整值与豁免"), `<h4>${word("Ability modifiers", "属性调整值")}</h4><dl class="combat-detail-stats">${abilities}</dl><h4>${word("Saving throw bonuses", "豁免加值")}</h4><dl class="combat-detail-stats">${saves}</dl>${stats.saveModifier ? `<p>${word("Includes current saving-throw modifier", "包含当前豁免调整")}: ${signed(stats.saveModifier)}</p>` : ""}`, true)}
      ${section("defenses", word("Defenses and immunities", "抗性、易伤与免疫"), list(Object.entries(actor.defenses || {}).map(([key, items]) => `${escape(key)}: ${escape(Array.isArray(items) ? items.join(", ") : typeof items === "object" ? JSON.stringify(items) : items)}`)))}
      `;
    if (character) {
      const skillRows = Object.entries(character.skills).map(([name, base]) => {
        const ability = skills[name]?.[0];
        const current = base + (Number.isFinite(stats.abilities?.[ability]) ? stats.abilities[ability] - (actor.abilities?.[ability] ?? stats.abilities[ability]) : 0) + (stats.abilityCheckModifier ?? 0);
        return value(zh ? `${skills[name]?.[1] || name} (${name})` : name, current, base, true);
      }).join("");
      const equipment = character.equipment.map(item => {
        const slots = item.slots.map(slot => ({ armor: word("Armor", "护甲"), weapon: word("Main hand", "主手"), offhand: word("Off hand", "副手") })[slot] || slot);
        if (item.worn) slots.push(word("Worn", "已穿戴"));
        const carried = slots.length ? slots.join(" · ") : word("Carried", "携带");
        return `<article class="combat-detail-item"><h4>${escape(nameOf(item))} × ${item.qty}</h4><p class="combat-statline">${escape(carried)}</p><p>${escape(description(item) || "")}</p></article>`;
      }).join("");
      const spells = character.spells.map(spell => `<article class="combat-detail-item"><h4>${escape(nameOf(spell))}</h4><p class="combat-statline">${spell.level === 0 ? word("Cantrip", "戏法") : word(`Level ${spell.level}`, `${spell.level} 环`)}</p><p>${escape(description(spell) || "")}</p></article>`).join("");
      const features = [character.job, character.background, character.species].filter(Boolean).map(card => `<h4>${escape(nameOf(card))}</h4>${(card.features || []).map(feature => `<p><strong>${escape(nameOf(feature))}</strong> · ${escape(description(feature))}</p>`).join("")}`).join("");
      const powers = character.powers.map(power => `<li>${escape(nameOf(power))}: <strong>${power.remaining}/${power.count}</strong></li>`).join("");
      output += section("skills", word("Skills", "技能"), `<dl class="combat-detail-stats combat-detail-skills">${skillRows}</dl>`)
        + section("equipment", word("Equipment, worn items and carried inventory", "装备、穿戴物与背包"), equipment, true)
        + section("resources", word("Resources and spellcasting", "资源与施法"), `<dl class="combat-detail-stats">${value(word("Gold (GP)", "金币（GP）"), character.gold)}${Number.isFinite(character.spellDC) ? value(word("Spell save DC (base)", "法术豁免 DC（基础）"), character.spellDC) : ""}</dl><ul>${powers}</ul>`)
        + section("spells", word("Known and prepared spells", "已知与已准备法术"), spells)
        + section("features", word("Class, background and species features", "职业、背景与种族特性"), features);
    }
    const actionRows = actions.flatMap(action => action.slots ? action.slots.flat() : [action]);
    const uniqueActions = [...new Map(actionRows.map(action => [action.id, action])).values()];
    const actionText = uniqueActions.map(action => {
      const bonus = Number.isFinite(action.bonus) ? combatEngine.effectiveAttackBonus?.(actor, action) ?? action.bonus + (stats.attackModifier ?? 0) : null;
      const dc = action.save ? combatEngine.effectiveSaveDC?.(actor, action) ?? action.save.dc : null;
      const numbers = [Number.isFinite(bonus) ? word(`Attack ${signed(bonus)}`, `攻击 ${signed(bonus)}`) : "", Number.isFinite(dc) ? `${action.save.ability} DC ${dc}` : "", action.timing].filter(Boolean).join(" · ");
      return `<article class="combat-detail-item"><h4>${escape(nameOf(action))}</h4>${numbers ? `<p class="combat-statline">${escape(numbers)}</p>` : ""}<p>${escape(description(action) || "")}</p></article>`;
    }).join("");
    output += section("actions", word("Attack and action reference", "攻击与动作参考"), actionText);
    if (traits.length) output += section("traits", word("Monster traits", "怪物特性"), traits.map(trait => `<article class="combat-detail-item"><h4>${escape(nameOf(trait))}</h4><p>${escape(description(trait))}</p></article>`).join(""));
    if (card?.printedDetails) output += section("printed", word("Complete reviewed card text (English)", "已核对卡面全文（英文）"), `<p class="combat-printed-text">${escape(card.printedDetails)}</p>`);
    if (card?.source) output += `<p><a href="${escape(card.source)}" target="_blank" rel="noopener">${word("Open original monster record", "打开原怪物记录")} ↗</a></p>`;
    return output;
  }

  globalThis.combatDetails = { render };
})();
