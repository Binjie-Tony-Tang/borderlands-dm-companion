(() => {
  const languageKey = "borderlands.content-language";
  const byId = id => document.getElementById(id);
  const selectors = [
    ["class-choice", "classId", borderlandsClasses, "Choose class"],
    ["background-choice", "backgroundId", borderlandsBackgrounds, "Choose background"],
    ["species-choice", "speciesId", borderlandsSpecies, "Choose species"],
  ];
  const skillNames = {
    Athletics: "运动", Acrobatics: "体操", "Sleight of Hand": "巧手", Stealth: "隐匿",
    Arcana: "奥秘", History: "历史", Investigation: "调查", Nature: "自然", Religion: "宗教",
    "Animal Handling": "驯兽", Insight: "洞悉", Medicine: "医药", Perception: "察觉", Survival: "生存",
    Deception: "欺瞒", Intimidation: "威吓", Performance: "表演", Persuasion: "说服",
  };
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => entities[character]);
  const signed = number => number == null ? "—" : number < 0 ? `−${Math.abs(number)}` : `+${number}`;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  let language = read(languageKey) === "zh-Hans" ? "zh-Hans" : "en";
  let storage = null;
  let roster = null;
  let draft = null;
  let editingIndex = null;
  let busy = false;
  const chinese = () => language === "zh-Hans";
  const word = (en, zh) => chinese() ? zh : en;
  const nameOf = record => word(record.en, record.zh || record.en);
  const textOf = record => word(record.textEn, record.textZh || record.textEn);
  const bilingualName = record => chinese() && record.zh ? `${record.zh}（${record.en}）` : record.en;
  const characterName = character => character.choice.name || word(`Unnamed ${character.job.en}`, `未命名${character.job.zh}`);
  function displayedStats(character) {
    if (!character.job || !globalThis.combatEngine || !globalThis.borderlandsSession) return null;
    const actor = borderlandsSession.actorFor({ slots: [character.choice], playerCount: roster?.playerCount ?? 4 }, 0);
    return { actor, ...combatEngine.currentStats(actor) };
  }
  function effectSummary(character) {
    const state = character.choice.sheet?.state;
    const conditions = (state?.conditions ?? []).map(effect => word(effect.name || effect.key, effect.zh || effect.name || effect.key));
    if (state?.death?.dead) conditions.unshift(word("Dead", "死亡"));
    else if (state?.death?.stable) conditions.unshift(word("Stable at 0 HP", "0 HP，稳定"));
    if (state?.concentration) conditions.push(word("Concentrating", "专注中"));
    return conditions.join(" · ");
  }

  const historyControls = borderlandsDashboardControls.mount({
    getStore: () => storage,
    isBlocked: () => busy || editingIndex !== null,
    setBusy,
    onChange(updated) {
      roster = updated;
      renderRoster();
    },
    status: showRosterStatus,
    confirmReset: confirmChange,
  });

  function updateSaveControls() {
    byId("import-save").disabled = !storage || busy;
    byId("export-save").hidden = !storage;
    byId("export-save").disabled = busy;
    byId("player-count").disabled = !storage || busy;
    byId("apply-player-count").disabled = !roster || busy || Number(byId("player-count").value) === roster.playerCount;
    byId("slot").inert = busy;
    byId("archive-list").inert = busy;
    historyControls.update();
  }

  function showRosterStatus(message = "", error = false) {
    const element = byId("roster-status");
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function setBusy(next) {
    busy = next;
    const submit = byId("save-character");
    submit.disabled = busy;
    submit.textContent = busy ? "Saving…" : "Save & close";
    byId("cancel").disabled = busy;
    byId("restore-defaults").disabled = busy || !draft?.classId;
    byId("lang-en").disabled = busy;
    byId("lang-zh").disabled = busy;
    document.querySelector(".editor-layout").inert = busy;
    byId("character-form").setAttribute("aria-busy", String(busy));
    updateSaveControls();
  }

  function renderRoster(syncCount = true) {
    const slot = byId("slot");
    if (roster) {
      if (syncCount) byId("player-count").value = String(roster.playerCount);
      byId("roster-count").textContent = `${roster.slots.filter(Boolean).length} of ${roster.playerCount} filled`;
      slot.replaceChildren(...roster.slots.map(renderSlot));
      renderArchive();
    }
    updateSaveControls();
  }

  function renderSlot(choice, index) {
    const entry = document.createElement("article");
    entry.className = "roster-slot";
    const button = document.createElement("button");
    button.type = "button";
    button.className = choice ? "slot-card" : "slot-card empty";
    const label = `<span class="slot-number">Slot ${index + 1}</span>`;
    if (choice) {
      const character = borderlandsCharacter.derive(choice);
      const effective = displayedStats(character);
      const origin = [character.job, character.background, character.species].map(nameOf).join(" · ");
      button.innerHTML = `
        <span class="slot-emblem" aria-hidden="true">${escape(character.job.en[0])}</span>
        <span class="slot-identity">
          ${label}
          <span class="slot-title">${escape(characterName(character))}</span>
          <span class="slot-subtitle">${escape(word(`Level ${character.level}`, `${character.level} 级`))}${character.job.subclass ? ` · ${escape(nameOf(character.job.subclass))}` : ""} · <span lang="${language}">${escape(origin)}</span></span>
          ${effectSummary(character) ? `<span class="slot-subtitle active-effects">${escape(effectSummary(character))}</span>` : ""}
        </span>
        <span class="roster-vitals">
          <span><strong>${character.currentHp}/${character.hp}</strong>HP</span>
          <span><strong>${effective?.ac ?? character.ac}</strong>AC</span>
          <span><strong>${effective?.speed ?? character.speed}</strong>${escape(word("ft", "英尺"))}</span>
        </span>
        <span class="slot-action">Edit <span aria-hidden="true">→</span></span>`;
    } else {
      button.innerHTML = `
        <span class="slot-emblem" aria-hidden="true">+</span>
        <span class="slot-identity">
          ${label}
          <span class="slot-title">Empty slot</span>
          <span class="slot-subtitle">Level 1 · Starter-set character</span>
        </span>
        <span class="slot-action">Create <span aria-hidden="true">→</span></span>`;
    }
    button.addEventListener("click", () => openEditor(index));
    entry.append(button);
    if (choice) {
      const controls = document.createElement("div");
      controls.className = "slot-controls";
      const remove = actionButton("Delete", () => deleteCharacter(index), true);
      remove.setAttribute("aria-label", `Delete ${displayName(choice)} from slot ${index + 1}`);
      const level = choice.level ?? 1;
      const advance = actionButton(level >= 3 ? word("Level 3 · maximum", "3 级 · 已达上限") : word("Level Up", "升级（Level Up）"), () => levelUp(index));
      advance.disabled = level >= 3 || Boolean(roster.combat && roster.combat.phase !== "ended");
      advance.title = roster.combat && roster.combat.phase !== "ended" ? word("End the current combat before leveling up.", "请先结束当前战斗，再升级。") : "";
      controls.append(advance, remove);
      entry.append(controls);
    }
    return entry;
  }

  function actionButton(label, action, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger ? "text-button danger-text" : "text-button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function displayName(choice) {
    return characterName(borderlandsCharacter.derive(choice));
  }

  function renderArchive() {
    byId("archive-count").textContent = roster.archive.length;
    const container = byId("archive-list");
    container.replaceChildren();
    if (!roster.archive.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Deleted characters will appear here.";
      container.append(empty);
      return;
    }
    const full = roster.slots.every(Boolean);
    if (full) {
      const notice = document.createElement("p");
      notice.className = "muted";
      notice.textContent = "Free an empty slot before restoring a character.";
      container.append(notice);
    }
    const list = document.createElement("ul");
    list.className = "archive-entries";
    for (const entry of roster.archive) {
      const character = borderlandsCharacter.derive(entry.character);
      const name = characterName(character);
      const origin = [character.job, character.background, character.species].map(nameOf).join(" · ");
      const deleted = new Date(entry.deletedAt).toLocaleString();
      const row = document.createElement("li");
      row.className = "archive-entry";
      row.innerHTML = `<div class="archive-identity"><strong>${escape(name)}</strong>
        <p class="muted"><span lang="${language}">${escape(origin)}</span> · Deleted ${escape(deleted)}</p></div>`;
      const actions = document.createElement("div");
      actions.className = "archive-actions";
      const restore = actionButton("Restore", () => restoreCharacter(entry.id));
      restore.disabled = full;
      restore.setAttribute("aria-label", `Restore ${name}`);
      const purge = actionButton("Delete permanently", () => purgeCharacter(entry.id), true);
      purge.setAttribute("aria-label", `Delete ${name} permanently`);
      actions.append(restore, purge);
      row.append(actions);
      list.append(row);
    }
    container.append(list);
  }

  function focusSlot(index) {
    byId("slot").querySelectorAll(".slot-card")[index]?.focus();
  }

  function confirmChange(title, message, action) {
    const dialog = byId("roster-confirm");
    byId("confirm-title").textContent = title;
    byId("confirm-message").textContent = message;
    byId("confirm-action").textContent = action;
    dialog.returnValue = "cancel";
    return new Promise(resolve => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }

  function archiveEntry(character) {
    return { id: crypto.randomUUID(), deletedAt: new Date().toISOString(), character };
  }

  async function commitRoster(next, message) {
    setBusy(true);
    try {
      roster = await storage.save(next);
      renderRoster();
      showRosterStatus(message);
      return true;
    } catch (error) {
      showRosterStatus(error.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function levelUp(index) {
    if (busy || editingIndex !== null || !roster?.slots[index] || document.querySelector("dialog[open]")) return;
    if (roster.combat && roster.combat.phase !== "ended") return;
    const original = roster.slots[index];
    const before = borderlandsCharacter.derive(original);
    if (before.level >= 3) return;
    const nextLevel = before.level + 1;
    const dialog = byId("level-up-dialog");
    const select = byId("level-up-subclass");
    const preview = byId("level-up-preview");
    let plan = null;
    let selectedPrepared = null;
    byId("level-up-title").textContent = word(`Level Up ${characterName(before)} to level ${nextLevel}`, `将 ${characterName(before)} 升至 ${nextLevel} 级`);
    byId("level-up-rules").textContent = word("Apply the next supplied Class Board when the DM awards a level. Current HP, equipment, gold, conditions, and manual stat edits are preserved. Additional Power Tokens become available; spent tokens remain spent. This is one Undo-able save.", "由主持人授予等级后，切换到下一张盒装职业板。保留当前生命值、装备、金币、状态和手动属性修改。新增能力标记可用，已消耗的标记保持消耗。此次保存可整体撤销（Undo）。");
    byId("level-up-subclass-wrap").hidden = nextLevel !== 3;
    byId("level-up-subclass-label").textContent = word("Choose subclass", "选择子职业（Subclass）");
    select.replaceChildren(new Option(word("Choose subclass…", "请选择子职业……"), ""),
      ...Object.entries(borderlandsLevels.data.subclasses[original.classId]).map(([id, value]) => new Option(bilingualName(value), id)));
    byId("level-up-cancel").textContent = word("Cancel", "取消");
    byId("level-up-confirm").textContent = word("Apply Level Up", "确认升级");
    const renderPreview = () => {
      plan = nextLevel === 3 && !select.value ? null : borderlandsLevels.advance(original, select.value);
      if (!plan) {
        preview.textContent = word("Select a subclass to preview its board.", "选择子职业后预览职业板的变化。");
        byId("level-up-confirm").disabled = true;
        return;
      }
      if (selectedPrepared) {
        plan.choice.prepared = [...selectedPrepared];
        plan.after = borderlandsCharacter.derive(plan.choice);
      }
      const after = plan.after;
      const metrics = [[word("Maximum HP", "生命值上限"), before.hp, after.hp], [word("Current HP", "当前生命值"), before.currentHp, after.currentHp],
        [word("Armor Class", "护甲等级"), before.ac, after.ac], [word("Speed", "速度"), before.speed, after.speed],
        [word("Arcana", "奥秘"), signed(before.skills.Arcana), signed(after.skills.Arcana)]];
      const powers = after.powers.map(power => {
        const old = before.powers.find(value => value.id === power.id);
        return `<li>${escape(bilingualName(power))}: ${old ? `${old.remaining}/${old.count}` : "—"} → ${power.remaining}/${power.count}</li>`;
      }).join("");
      const newFeatures = after.job.features.filter(feature => !before.job.features.some(old => old.en === feature.en));
      const newSpells = after.defaultSpellIds.filter(id => !before.defaultSpellIds.includes(id));
      preview.innerHTML = `<dl class="level-up-metrics">${metrics.map(([label, old, value]) => `<div><dt>${escape(label)}</dt><dd>${old} → ${value}</dd></div>`).join("")}</dl>
        ${powers ? `<h3>${escape(word("Power Tokens", "能力标记"))}</h3><ul>${powers}</ul>` : ""}
        ${newFeatures.map(feature => `<h3>${escape(bilingualName(feature))}</h3><p>${escape(textOf(feature))}</p>`).join("")}
        ${newSpells.length ? `<p>${escape(word("Added spells: ", "新增法术："))}${newSpells.map(id => escape(bilingualName(borderlandsSpells[id]))).join(" · ")}</p>` : ""}
        ${after.job.prepared ? `<fieldset><legend>${escape(word(`Prepare ${after.job.prepared.count} Wizard spells`, `准备 ${after.job.prepared.count} 个法师法术`))}</legend><p>${after.choice.prepared.length}/${after.job.prepared.count}</p><div class="prepared-options">${after.job.prepared.choices.map(id => `<label><input type="checkbox" data-level-spell="${id}"${after.choice.prepared.includes(id) ? " checked" : ""}${after.choice.prepared.length === after.job.prepared.count && !after.choice.prepared.includes(id) ? " disabled" : ""}>${escape(bilingualName(borderlandsSpells[id]))}</label>`).join("")}</div></fieldset>` : ""}
        <p><a href="${escape(after.job.source)}" target="_blank" rel="noopener">${escape(word(`Class Board source · PDF page ${after.job.sourcePage}`, `职业板来源 · PDF 第 ${after.job.sourcePage} 页`))} ↗</a></p>`;
      byId("level-up-confirm").disabled = !after.complete;
    };
    const onSubclass = () => { selectedPrepared = null; renderPreview(); };
    const onPrepared = event => {
      const id = event.target.dataset.levelSpell;
      if (!id || !plan) return;
      selectedPrepared = event.target.checked ? [...plan.choice.prepared, id] : plan.choice.prepared.filter(value => value !== id);
      renderPreview();
    };
    try {
      renderPreview();
      select.addEventListener("change", onSubclass);
      preview.addEventListener("change", onPrepared);
      dialog.returnValue = "cancel";
      const confirmed = await new Promise(resolve => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
        dialog.showModal();
      });
      if (!confirmed || !plan?.after.complete) return;
      if (plan.choice.sheet?.spellIds && selectedPrepared) {
        const defaults = borderlandsLevels.advance(original, select.value).choice.prepared;
        const removed = defaults.filter(id => !selectedPrepared.includes(id)
          && ![plan.after.background, plan.after.species].some(origin => origin?.spells.includes(id)));
        plan.choice.sheet.spellIds = [...new Set([...plan.choice.sheet.spellIds.filter(id => !removed.includes(id)), ...selectedPrepared])];
      }
      const slots = roster.slots.slice();
      slots[index] = borderlandsCharacter.normalize(plan.choice);
      await commitRoster({ ...roster, slots }, word(`${characterName(before)} is now level ${nextLevel}. Use Undo to reverse it.`, `${characterName(before)} 已升至 ${nextLevel} 级。可用撤销（Undo）还原。`));
    } catch (error) {
      showRosterStatus(error.message, true);
    } finally {
      select.removeEventListener("change", onSubclass);
      preview.removeEventListener("change", onPrepared);
    }
  }

  async function deleteCharacter(index) {
    if (busy || !roster.slots[index]) return;
    const character = roster.slots[index];
    const slots = roster.slots.slice();
    slots[index] = null;
    const next = { ...roster, slots, archive: [archiveEntry(character), ...roster.archive] };
    detachKeepSlots(next, [index]);
    if (await commitRoster(next, `${displayName(character)} moved to the Rubbish Bin.`)) focusSlot(index);
  }

  function detachKeepSlots(next, indices) {
    if (!indices.length) return;
    const detached = new Set(indices);
    if (next.adventure) {
      const adventure = next.adventure;
      next.adventure = { ...adventure, uses: Object.fromEntries(Object.entries(adventure.uses).filter(([key]) => {
        const healing = /:heal:(\d+)$/.exec(key);
        return !healing || !detached.has(Number(healing[1]));
      })) };
    }
    if (!next.keep) return;
    const keep = next.keep;
    const scoped = /^(?:library-research|rumor|requisition-tabard|bank-deposit|bank-loan|disrupting-the-charge|catapult-installation):(\d+)(?::|$)/;
    const belongsToRemoved = key => {
      const match = scoped.exec(key);
      return match !== null && detached.has(Number(match[1]));
    };
    const log = [...keep.log];
    for (const index of indices) {
      const held = keep.uses[`bank-deposit:${index}`] ?? 0;
      const loan = keep.uses[`bank-loan:${index}`] ?? 0;
      if (held || loan) {
        log.push(`Bank record for archived slot ${index + 1}: ${held} GP deposited, ${loan} GP principal owed.`);
      }
    }
    next.keep = { ...keep, log,
      effects: keep.effects.filter(effect => !detached.has(effect.slot)),
      uses: Object.fromEntries(Object.entries(keep.uses).filter(([key]) => !belongsToRemoved(key))),
      flags: Object.fromEntries(Object.entries(keep.flags).filter(([key]) => !belongsToRemoved(key))),
      quests: Object.fromEntries(Object.entries(keep.quests).filter(([key]) => !belongsToRemoved(key))),
    };
  }

  async function restoreCharacter(id) {
    if (busy) return;
    const index = roster.slots.indexOf(null);
    const entry = roster.archive.find(item => item.id === id);
    if (index < 0 || !entry) return;
    const slots = roster.slots.slice();
    slots[index] = entry.character;
    const next = { ...roster, slots, archive: roster.archive.filter(item => item.id !== id) };
    if (await commitRoster(next, `${displayName(entry.character)} restored to slot ${index + 1}.`)) focusSlot(index);
  }

  async function purgeCharacter(id) {
    if (busy) return;
    const entry = roster.archive.find(item => item.id === id);
    if (!entry) return;
    const name = displayName(entry.character);
    const confirmed = await confirmChange(
      "Delete permanently?",
      `Remove ${name} from the Rubbish Bin. Use Undo if you need to recover this character during this session.`,
      "Delete permanently",
    );
    if (!confirmed) return;
    const next = { ...roster, archive: roster.archive.filter(item => item.id !== id) };
    if (await commitRoster(next, `${name} was permanently deleted.`)) {
      byId("rubbish-bin").querySelector("summary").focus({ preventScroll: true });
    }
  }

  function renderSelections() {
    for (const [id, field, deck, placeholder] of selectors) {
      const select = byId(id);
      const empty = new Option(placeholder, "");
      empty.disabled = true;
      select.replaceChildren(empty, ...Object.entries(deck).map(([key, card]) => new Option(bilingualName(card), key)));
      select.value = draft[field];
    }
  }

  function renderPrepared(character, focusId) {
    const preparation = character.job?.prepared;
    byId("prepared-section").hidden = !preparation;
    if (!preparation) return;
    const current = draft.prepared;
    byId("prepared-count").textContent = `${current.length} of ${preparation.count} selected. Uncheck a spell to swap it.`;
    const labels = preparation.choices.map(id => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = id;
      checkbox.checked = current.includes(id);
      checkbox.disabled = current.length === preparation.count && !checkbox.checked;
      checkbox.addEventListener("change", () => {
        draft.prepared = checkbox.checked ? [...draft.prepared, id] : draft.prepared.filter(spell => spell !== id);
        if (draft.sheet?.spellIds) {
          const active = new Set(draft.sheet.spellIds);
          if (checkbox.checked) active.add(id);
          else if (![character.background, character.species].some(origin => origin?.spells.includes(id))) active.delete(id);
          draft.sheet = { ...draft.sheet, spellIds: [...active] };
        }
        clearError();
        updateCharacter(id);
      });
      const caption = document.createElement("span");
      caption.lang = language;
      caption.textContent = bilingualName(borderlandsSpells[id]);
      label.append(checkbox, caption);
      return label;
    });
    byId("prepared-options").replaceChildren(...labels);
    if (focusId) labels.find(label => label.firstChild.value === focusId)?.firstChild.focus();
  }

  function stat(label, value, unit = "") {
    return `<div class="vital"><span>${label}</span><strong>${value}${unit && value !== "—" ? ` <small>${unit}</small>` : ""}</strong></div>`;
  }

  function row(label, value, note = "") {
    return `<div><dt>${escape(label)}</dt><dd>${escape(value)}${note ? `<span class="quick-note">${escape(note)}</span>` : ""}</dd></div>`;
  }

  function renderSummary(character) {
    const { job, species, hp, currentHp, tempHp, ac, speed, initiative, optionalInitiative, powers } = character;
    const effective = displayedStats(character);
    const currentInitiative = effective?.initiative ?? initiative;
    const initiativeValue = optionalInitiative && currentInitiative != null
      ? `${signed(currentInitiative)} / ${signed(currentInitiative + optionalInitiative)}`
      : signed(currentInitiative);
    const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map(ability =>
      `<div><dt>${ability}</dt><dd>${signed(effective?.abilities[ability] ?? character.abilities[ability])}</dd></div>`
    ).join("");
    const attackRows = character.attacks.map(attack => row(nameOf(attack), signed(effective
      ? combatEngine.effectiveAttackBonus(effective.actor, attack) : attack.bonus))).join("");
    const powerRows = powers.map(power => row(nameOf(power), `${power.remaining} / ${power.count}`, nameOf(power.origin))).join("");
    byId("summary").innerHTML = `
      <div class="panel-heading"><h2>Character stats</h2></div>
      <div class="vitals">
        ${stat("HP", hp == null ? "—" : `${currentHp} / ${hp}`)}
        ${stat("Armor Class", effective?.ac ?? ac ?? "—")}
        ${stat("Initiative", initiativeValue)}
        ${stat("Speed", effective?.speed ?? speed ?? "—", "ft")}
      </div>
      ${effectSummary(character) ? `<p class="muted active-effects">${escape(effectSummary(character))}</p><p class="muted">${escape(word(`Base AC ${ac}; base Speed ${speed} ft. Current values above include recorded effects.`, `基础 AC ${ac}；基础速度 ${speed} 英尺。上方当前数值已包含记录的效果。`))} <a href="../session_page/">${escape(word("Manage effects", "管理效果"))} ↗</a></p>` : ""}
      ${optionalInitiative && initiative != null ? `<p class="muted initiative-note">${word("Criminal can add +2 when rolling Initiative.", "罪犯可以在掷先攻时选择加 2。")}</p>` : ""}
      <dl class="ability-list" aria-label="Ability modifiers">${abilities}</dl>
      <dl class="quick-list">
        ${row("Gold", job ? `${character.gold} GP` : "—")}
        ${tempHp ? row("Temporary HP", tempHp) : ""}
        ${row("Size", species ? word(species.size, species.size === "Small" ? "小型" : "中型") : "—")}
        ${attackRows}
        ${character.spellDC == null ? "" : row("Spell save DC", effective ? combatEngine.effectiveSaveDC(effective.actor, { save: { dc: character.spellDC }, saveAbility: character.castingAbility }) : character.spellDC)}
      </dl>
      <p class="quick-heading">Power Tokens</p>
      ${powerRows ? `<dl class="quick-list" lang="${language}">${powerRows}</dl>` : `<p class="muted">${job ? "None" : "—"}</p>`}`;
  }

  function sourceLink(path) {
    return path ? `<a class="source-link" href="${escape(path)}" target="_blank" rel="noopener">Source card ↗</a>` : "";
  }

  function referenceList(cards, caption = () => "") {
    return `<ul class="reference">${cards.map(card => {
      const metadata = caption(card);
      return `<li><strong>${escape(bilingualName(card))}</strong>
        ${metadata ? `<p class="reference-meta">${escape(metadata)}</p>` : ""}
        <p>${escape(textOf(card))}</p>${sourceLink(card.source)}</li>`;
    }).join("")}</ul>`;
  }

  function cardFeatures(card) {
    return card ? referenceList(card.features) + sourceLink(card.source) : "";
  }

  function statTable(entries, description, translate = label => label) {
    return entries.length ? `<table class="skill-table"><caption>${description}</caption><tbody>
      ${entries.map(([label, value]) => `<tr><th scope="row">${escape(translate(label))}</th><td>${signed(value)}</td></tr>`).join("")}
    </tbody></table>` : "";
  }

  function referencePanels(character) {
    const { job, background, species, armor, equipment, spells, skills } = character;
    const effective = displayedStats(character);
    const skillLabel = label => chinese() ? `${skillNames[label] ?? label}（${label}）` : label;
    const slotLabel = { armor: word("Equipped armor", "已装备护甲"), weapon: word("Main hand", "主手"), offhand: word("Off hand", "副手") };
    const armorNote = armor?.stealthDisadvantage
      ? `<p class="muted">${word("Your armor imposes Disadvantage on Stealth checks.", "穿戴此护甲时，隐匿检定具有劣势。")}</p>` : "";
    return [
      ["stats", "Edit stats & resources", ""],
      ["equipment", "Equipment", equipment.length ? referenceList(equipment, item => {
        const slot = item.worn ? word("Worn", "已穿戴") : slotLabel[item.slot] ?? word("Carried", "随身携带");
        const quantity = item.qty > 1 ? ` · ×${item.qty}` : "";
        if (!item.dice || item.damageBonus == null) return slot + quantity;
        const bonus = item.damageBonus === 0 ? "" : ` ${signed(item.damageBonus)}`;
        const damage = `${item.dice}${bonus} ${word(item.typeEn, item.typeZh)}`;
        const attack = item.attackBonus == null ? "" : ` · ${word("Attack", "攻击")} ${signed(item.attackBonus)}`;
        return `${slot}${quantity}${attack} · ${word("Standard hit", "普通命中")} ${damage}`;
      }) : ""],
      ["spells", "Spells", spells.length ? referenceList(spells, spell => {
        const level = spell.level === 0 ? word("Cantrip", "戏法") : word(`Level ${spell.level}`, `${spell.level} 环`);
        const origins = spell.origins.length ? spell.origins.map(nameOf) : [word("Learned during play", "冒险中习得")];
        return [level, word(spell.timingEn, spell.timingZh), ...origins].filter(Boolean).join(" · ");
      }) : ""],
      ["class", "Class features", cardFeatures(job)],
      ["background", "Background", cardFeatures(background)],
      ["species", "Species traits", cardFeatures(species)],
      ["skills", "Skills & saving throws",
        armorNote + statTable(Object.entries(effective?.skills ?? skills), word("Current skill checks", "当前技能检定"), skillLabel) +
        statTable(Object.entries(effective?.saves ?? character.saves), word("Current saving throws", "当前豁免检定")) + sourceLink(job?.source)],
    ];
  }

  function referenceContent(key, content) {
    return content || (key === "stats" ? "" : `<p class="muted">${word("None listed.", "暂无。")}</p>`);
  }

  function renderDetails(character) {
    const details = byId("details");
    const expanded = new Set([...details.querySelectorAll("details[open]")].map(section => section.dataset.section));
    const controls = borderlandsSheetUI.sections(character, language);
    details.innerHTML = referencePanels(character).map(([key, title, content]) => `
      <details data-section="${key}" ${expanded.has(key) ? "open" : ""}>
        <summary>${title}</summary>
        <div class="detail-body">${controls[key] ?? ""}
          <div data-reference="${key}" lang="${language}">${referenceContent(key, content)}</div>
        </div>
      </details>`).join("");
  }

  function refreshDerived() {
    const character = borderlandsCharacter.derive(draft);
    renderSummary(character);
    for (const [key, , content] of referencePanels(character)) {
      byId("details").querySelector(`[data-reference="${key}"]`).innerHTML = referenceContent(key, content);
    }
    borderlandsSheetUI.refresh?.(byId("details"), character);
  }

  function updateCharacter(focusId) {
    const character = borderlandsCharacter.derive(draft);
    byId("character-level-label").textContent = word(`Level ${character.level}`, `${character.level} 级`)
      + (character.job?.subclass ? ` · ${nameOf(character.job.subclass)}` : "");
    renderPrepared(character, focusId);
    renderSummary(character);
    renderDetails(character);
    byId("restore-defaults").disabled = busy || !draft.classId;
  }

  function clearError() {
    byId("form-status").hidden = true;
  }

  function showError(message, focus = false) {
    const element = byId("form-status");
    element.textContent = message;
    element.hidden = false;
    if (focus) element.focus();
  }

  function openEditor(index) {
    if (busy || !storage) return;
    editingIndex = index;
    const choice = roster.slots[index];
    draft = borderlandsCharacter.normalize(choice ?? {});
    byId("editor-title").textContent = choice ? "Edit character" : "Create character";
    byId("editor-slot").textContent = `Slot ${index + 1}`;
    byId("character-name").value = draft.name;
    byId("details").replaceChildren();
    showRosterStatus();
    clearError();
    byId("editor-notice").hidden = true;
    renderSelections();
    updateCharacter();
    byId("roster").hidden = true;
    byId("editor").hidden = false;
    historyControls.update();
    window.scrollTo(0, 0);
    byId("editor-title").focus();
  }

  function closeEditor(message = "") {
    const index = editingIndex;
    editingIndex = null;
    draft = null;
    renderRoster();
    showRosterStatus(message);
    byId("editor").hidden = true;
    byId("roster").hidden = false;
    window.scrollTo(0, 0);
    focusSlot(index);
  }

  function setLanguage(next) {
    language = next;
    try {
      localStorage.setItem(languageKey, language);
    } catch {
      // The current view still switches language if storage is unavailable.
    }
    byId("lang-en").setAttribute("aria-pressed", String(!chinese()));
    byId("lang-zh").setAttribute("aria-pressed", String(chinese()));
    if (draft) {
      renderSelections();
      updateCharacter();
    } else {
      renderRoster(false);
    }
  }

  for (const [id, field] of selectors) {
    byId(id).addEventListener("change", event => {
      const choice = { ...draft, [field]: event.target.value };
      if (field === "classId") {
        delete choice.prepared;
        delete choice.level;
        delete choice.subclassId;
      }
      draft = borderlandsCharacter.normalize(choice);
      clearError();
      updateCharacter();
    });
  }
  byId("character-name").addEventListener("input", event => { draft.name = event.target.value; });
  byId("cancel").addEventListener("click", () => closeEditor());
  byId("restore-defaults").addEventListener("click", async () => {
    if (busy || !draft?.classId) return;
    if (!await confirmChange(
      "Restore character defaults?",
      "Reset equipment, spells, base stats, HP and Power Tokens to this level's defaults. Clear recorded conditions, Concentration and death tracking. Save & close to keep the reset.",
      "Restore defaults",
    )) return;
    const restored = { ...draft };
    delete restored.sheet;
    delete restored.prepared;
    draft = borderlandsCharacter.normalize(restored);
    clearError();
    updateCharacter();
    const notice = byId("editor-notice");
    notice.textContent = "Starting values restored. Save & close to keep them.";
    notice.hidden = false;
  });
  borderlandsSheetUI.bind(byId("details"), {
    getCharacter: () => borderlandsCharacter.derive(draft),
    update(sheet, redraw) {
      draft = { ...draft, sheet };
      clearError();
      byId("editor-notice").hidden = true;
      if (redraw) updateCharacter();
      else refreshDerived();
    },
  });
  byId("lang-en").addEventListener("click", () => setLanguage("en"));
  byId("lang-zh").addEventListener("click", () => setLanguage("zh-Hans"));
  byId("character-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!draft || !storage || busy) return;
    const character = borderlandsCharacter.derive(draft);
    if (!character.complete) {
      showError(character.job?.prepared ? `Choose ${character.job.prepared.count} prepared spells.` : "Choose a class, background and species.");
      return;
    }
    clearError();
    setBusy(true);
    try {
      const slots = roster.slots.slice();
      slots[editingIndex] = character.choice;
      roster = await storage.save({ ...roster, slots });
    } catch (error) {
      setBusy(false);
      showError(error.message, true);
      return;
    }
    setBusy(false);
    closeEditor("Character saved.");
  });

  byId("player-count").addEventListener("change", updateSaveControls);
  byId("player-count-form").addEventListener("submit", async event => {
    event.preventDefault();
    const select = byId("player-count");
    const playerCount = Number(select.value);
    if (!roster || busy || !Number.isInteger(playerCount) || playerCount < 4 || playerCount > 8 || playerCount === roster.playerCount) return;
    const removed = roster.slots.slice(playerCount).filter(Boolean);
    if (removed.length) {
      const names = removed.map(displayName).join(", ");
      const confirmed = await confirmChange(
        `Reduce party to ${playerCount} players?`,
        `Move these characters from the slots being removed to the Rubbish Bin: ${names}.`,
        "Reduce and archive",
      );
      if (!confirmed) {
        select.value = String(roster.playerCount);
        updateSaveControls();
        select.focus();
        return;
      }
    }
    const slots = Array.from({ length: playerCount }, (_, index) => roster.slots[index] ?? null);
    const archive = [...removed.map(archiveEntry), ...roster.archive];
    const note = removed.length ? ` ${removed.length} moved to the Rubbish Bin.` : "";
    const next = { ...roster, playerCount, slots, archive };
    detachKeepSlots(next, removed.length ? Array.from({ length: roster.playerCount - playerCount }, (_, index) => playerCount + index) : []);
    if (!await commitRoster(next, `Player count set to ${playerCount}.${note}`)) {
      select.value = String(roster.playerCount);
      updateSaveControls();
    }
    select.focus();
  });

  byId("export-save").addEventListener("click", () => {
    if (!roster || busy) return;
    const data = JSON.stringify(roster);
    const url = URL.createObjectURL(new Blob([data + "\n"], { type: "application/json" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = "borderlands-roster.json";
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showRosterStatus("Party and adventure save exported.");
  });

  const fileInput = byId("import-file");
  byId("import-save").addEventListener("click", () => {
    if (storage && !busy) fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file || !storage || busy) return;
    showRosterStatus("Reading save…");
    let payload;
    setBusy(true);
    try {
      if (file.size > borderlandsStorage.maxBytes) throw new Error("This save file is too large.");
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new Error("This file couldn’t be read as a JSON save.");
      }
    } catch (error) {
      showRosterStatus(error.message, true);
      return;
    } finally {
      setBusy(false);
    }
    try {
      const imported = borderlandsStorage.decode(payload);
      if (payload.version === 1) {
        const choice = imported.slots[0];
        if (!choice) throw new Error("The file doesn’t contain a character.");
        const index = roster.slots.indexOf(null);
        if (index < 0) throw new Error("Free a slot before importing this character.");
        const slots = roster.slots.slice();
        slots[index] = choice;
        if (await commitRoster({ ...roster, slots }, `Character imported into slot ${index + 1}.`)) focusSlot(index);
        return;
      }
      const existing = roster.slots.some(Boolean) || roster.archive.length || roster.playerCount !== 4
        || roster.keep || roster.adventure || roster.combat;
      if (existing && !await confirmChange(
        "Replace the current roster?",
        "The import replaces the roster and Rubbish Bin. If the file includes map progress or combat, it also replaces that part of the save.",
        "Import roster",
      )) {
        showRosterStatus();
        return;
      }
      if (await commitRoster(imported, "Save imported.")) focusSlot(0);
    } catch (error) {
      showRosterStatus(error.message, true);
    }
  });

  async function initialize() {
    showRosterStatus("Checking saved character…");
    try {
      storage = await borderlandsStorage.load();
      roster = storage.roster;
      renderRoster();
      showRosterStatus(storage.notice);
    } catch (error) {
      showRosterStatus(error.message, true);
    }
  }

  setLanguage(language);
  initialize();
})();
