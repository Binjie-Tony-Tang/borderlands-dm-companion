(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const E = combatEngine;
  const C = combatActions;
  const ambushLink = "../adventure_page/?map=trail&point=bandit-ambush";
  const fromAmbush = new URLSearchParams(location.search).get("encounter") === "ambush";
  const incoming = combatHandoff.read();
  const languageKey = "borderlands.content-language";
  const modes = { normal: "Normal", advantage: "Advantage", disadvantage: "Disadvantage" };
  let language = localStorage.getItem(languageKey) === "zh-Hans" ? "zh-Hans" : "en";
  let store, roster, battle, selected, draft, correction, turnPrompt;
  let busy = false;
  let offerEncounter = Boolean(fromAmbush || incoming);
  let catalog = C.enemies;
  let pendingAdds = null;
  let detailActor = null;
  const drafting = () => draft && draft.stage !== "inspect";
  const incapacitating = new Set(["unconscious", "incapacitated", "paralyzed", "petrified", "stunned"]);

  const zh = () => language === "zh-Hans";
  const id = prefix => `${prefix}-${crypto.randomUUID()}`;
  const signed = number => number < 0 ? `−${-number}` : `+${number}`;
  const actorName = actor => zh() && actor.zh ? actor.zh : actor.name;
  const moveName = action => zh() && action.zh ? action.zh : action.name;
  const moveText = action => zh() && action.descriptionZh ? action.descriptionZh : action.description;
  const translated = value => Array.isArray(value) ? value[zh() ? 1 : 0] || value[0] : value;
  const working = () => draft?.working ?? battle;
  const sparring = () => battle?.rule === "friendly-sparring";
  const find = actorId => working()?.actors.find(actor => actor.id === actorId);
  const bind = choice => JSON.stringify(choice);
  const character = actor => actor.side === "party" && !actor.npc && roster.slots[actor.slot]
    ? borderlandsCharacter.derive(roster.slots[actor.slot]) : null;
  const bound = actor => actor.side !== "party" || actor.npc || actor.object || Boolean(roster.slots[actor.slot] && bind(roster.slots[actor.slot]) === actor.binding);
  const actions = actor => actor.object || !bound(actor) ? [] : C.forActor(actor, character(actor), working());
  const button = (cmd, label, value = "", primary = false, disabled = false) => `<button type="button"
    class="${primary ? "primary" : "secondary"}" data-cmd="${cmd}" data-value="${escape(value)}"${disabled || busy ? " disabled" : ""}>${escape(label)}</button>`;
  const field = (name, label, min, max, value = "", required = true) => `<label>${escape(label)}
    <input name="${escape(name)}" type="number" step="1" min="${min}" max="${max}" value="${escape(value)}"${required ? " required" : ""}></label>`;
  const select = (name, label, options, chosen = "") => `<label>${escape(label)} <select name="${escape(name)}">
    ${Object.entries(options).map(([key, value]) => `<option value="${escape(key)}"${String(chosen) === key ? " selected" : ""}>${escape(value)}</option>`).join("")}
    </select></label>`;
  const submit = (label, disabled = false) => `<button type="submit" class="primary"${disabled || busy ? " disabled" : ""}>${escape(label)}</button>`;
  const diceFields = (prefix, count, sides, label) => Array.from({ length: count }, (_, index) =>
    field(prefix, count === 1 ? `${label} · d${sides}` : `${label} · d${sides} #${index + 1}`, 1, sides)).join("");
  const form = (kind, fields, label, cancel = false) => `<form data-form="${kind}">
    <div class="combat-fields">${fields}</div><div class="combat-toolbar">${submit(label)}${cancel ? button("cancel", "Cancel") : ""}</div></form>`;

  function notify(message = "", error = false) {
    $("combat-status").textContent = message;
    $("combat-status").classList.toggle("error", error);
  }

  function clearEncounterEntry() {
    offerEncounter = false;
    if (incoming || fromAmbush) history.replaceState(null, "", location.pathname);
  }

  const historyControls = borderlandsDashboardControls.mount({
    getStore: () => store,
    isBlocked: () => busy || Boolean(drafting() || correction || turnPrompt || pendingAdds),
    setBusy(value) {
      busy = value;
      if (!value) render();
    },
    onChange(updated) {
      roster = updated;
      battle = roster.combat;
      draft = null;
      selected = battle?.active ?? battle?.actors[0]?.id;
      render();
    },
    status: notify,
  });

  function pc(slot) {
    return borderlandsSession.actorFor(roster, slot);
  }

  function enemy(monster, scalePlayers, hp, number, group = {}) {
    const card = catalog[monster];
    if (!card) throw new Error("This creature has no reviewed monster card.");
    const suffix = number > 1 || group.count > 1 || monster === "bandit" ? ` ${number}` : "";
    const profile = group.printed ? "context" : group.fixed ? "fixed" : card.profile;
    const names = Array.isArray(group.name) ? group.name : [group.name ?? card.name, group.name ?? card.zh ?? card.name];
    return {
      id: id("enemy"), side: "enemy", monster, profile, scalePlayers,
      name: names[0] + suffix, zh: (names[1] ?? names[0]) + suffix,
      hp, maxHp: hp, tempHp: 0, ac: group.ac ?? card.ac, initiative: card.initiative,
      saves: card.saves, skills: card.skills || {}, abilities: card.abilities ?? {}, defenses: card.defenses ?? {},
      ...(Number.isFinite(card.speed?.walk) ? { speed: card.speed.walk } : {}), movement: structuredClone(card.speed ?? {}),
      size: card.kind?.split(" ")[0], kind: card.kind,
      ...(group.printed ? { printed: true } : {}),
      ...(group.reserve ? { reserve: true, inactive: true, note: group.note } : {}),
      conditions: [], recharge: {}, roll: null,
    };
  }

  function newBattle(source) {
    const scalePlayers = roster.playerCount;
    const actors = roster.slots.flatMap((choice, slot) => choice ? [pc(slot)] : []);
    const map = source === "encounter" && incoming.back ? new URL(incoming.back, location.href).searchParams.get("map") : null;
    actors.push(...roster.session.companions.filter(entry => borderlandsSession.companionEligible(entry, map)).map(entry => borderlandsSession.companionActor(entry, scalePlayers)));
    borderlandsSession.rebaseEffects(actors, roster.session.elapsedSeconds);
    const groups = source === "encounter" ? incoming.groups : source === "ambush"
      ? C.ambush(scalePlayers).map(group => ({ ...group, id: group.monster })) : [];
    const counts = {};
    for (const group of groups) {
      for (let number = 1; number <= group.count; number++) {
        counts[group.id] = (counts[group.id] ?? 0) + 1;
        actors.push(enemy(group.id, scalePlayers, group.hp, counts[group.id], group));
      }
    }
    const title = source === "encounter" ? incoming.title : source === "ambush"
      ? ["Pral’s Bandit Ambush", "普拉尔的强盗伏击"] : ["Manual combat", "手动战斗"];
    return {
      phase: "setup", source: incoming?.rule === "ambush" && source === "encounter" ? "ambush" : source,
      title: Array.isArray(title) ? title[0] : title, titleZh: Array.isArray(title) ? title[1] : title,
      ...(source === "encounter" ? { back: incoming.back } : {}),
      ...(source === "encounter" && incoming.rule === "friendly-sparring" ? { rule: incoming.rule } : {}),
      scalePlayers, actors, order: [], active: null, round: 0, log: [], initiativeMode: "group",
      pending: structuredClone(roster.session.pending || []).filter(prompt => actors.some(actor => actor.id === prompt.actorId)),
    };
  }

  async function commit(next, message, costs = []) {
    if (busy || !store) return false;
    const slots = [...roster.slots];
    for (const actor of next.actors) {
      if (actor.side !== "party" || actor.npc || actor.object) continue;
      const before = battle?.actors.find(entry => entry.id === actor.id);
      if (!before) continue;
      if (!bound(before)) {
        if (actor.inactive) continue;
        throw new Error(`${actorName(actor)}’s character sheet changed outside combat. Remove and replace their combat entry before saving this fight.`);
      }
      const actorCosts = costs.filter(cost => cost.id === actor.id);
      const changed = ["hp", "tempHp", "baseMaxHp", "ac", "initiative", "gold", "speed"].filter(key => actor[key] !== before[key]);
      if (!changed.length && !actorCosts.length) continue;
      if (!bound(before)) throw new Error(`${actorName(actor)}’s character sheet changed outside combat. Replace their combat entry before applying changes to it.`);
      const current = borderlandsCharacter.derive(slots[actor.slot]);
      const sheet = { ...current.choice.sheet, stats: { ...current.choice.sheet?.stats } };
      const statFields = { hp: "currentHp", tempHp: "tempHp", baseMaxHp: "maxHp", ac: "ac", initiative: "initiative", gold: "gold", speed: "speed" };
      for (const key of changed) if (key !== "baseMaxHp" || current.choice.sheet?.stats?.maxHp !== undefined || actor.baseMaxHp !== current.baseHp) sheet.stats[statFields[key]] = actor[key];
      if (actorCosts.some(cost => cost.item)) sheet.inventory = { ...current.inventory };
      if (actorCosts.some(cost => cost.power)) sheet.power = { ...current.choice.sheet?.power };
      for (const cost of actorCosts) {
        if (cost.item) {
          const quantity = sheet.inventory[cost.item] ?? 0;
          if (!quantity) throw new Error(`${actorName(actor)} has no ${borderlandsItems[cost.item]?.en ?? cost.item} remaining.`);
          if (quantity === 1) delete sheet.inventory[cost.item];
          else sheet.inventory[cost.item] = quantity - 1;
        }
        if (cost.power) {
          const power = current.powers.find(entry => entry.id === cost.power);
          const remaining = sheet.power[cost.power] ?? power?.remaining ?? 0;
          if (!remaining) throw new Error(`${actorName(actor)} has no ${power?.en ?? "Power Token"} remaining.`);
          sheet.power[cost.power] = remaining - 1;
        }
      }
      const updated = borderlandsStorage.decode({
        ...borderlandsStorage.empty(), slots: [{ ...current.choice, sheet }, null, null, null],
      }).slots[0];
      slots[actor.slot] = updated;
      actor.binding = bind(updated);
    }
    busy = true;
    historyControls.update();
    try {
      let updated = { ...roster, slots };
      for (const actor of next.actors) if (actor.npc && actor.companionId && !updated.session.companions.some(entry => entry.id === actor.companionId)) {
        updated = borderlandsSession.addCompanion(updated, { ...actor, id: actor.companionId });
      }
      const rounds = Math.max(0, next.round - (battle?.round || 0));
      if (rounds && battle?.phase === "fight") updated.session.elapsedSeconds += rounds * 6;
      updated = borderlandsSession.capture(updated, next);
      if (next.phase === "ended" && battle?.phase !== "ended" && !sparring()) {
        for (const companion of updated.session.companions) if (companion.remainingFights === 1 && next.actors.some(actor => actor.companionId === companion.id && !actor.inactive)) {
          companion.active = false;
          companion.serviceEnded = true;
        }
      }
      roster = await store.save({ ...updated, combat: next });
      battle = roster.combat;
      notify(message);
      return true;
    } finally {
      busy = false;
      historyControls.update();
    }
  }

  function log(next, action, summary, rolls) {
    next.log.push({ round: next.round, action, summary, ...(rolls ? { rolls } : {}) });
    return next;
  }

  function setView(reset = false) {
    if (reset) {
      draft = correction = turnPrompt = pendingAdds = null;
      selected = battle?.active ?? battle?.actors.find(actor => !actor.inactive)?.id;
    }
    render();
  }

  function hydrateActors(current) {
    for (const actor of current?.actors ?? []) {
      if (actor.side === "party" && !actor.npc && !actor.object) {
        const saved = character(actor);
        if (saved) {
          actor.baseMaxHp ??= saved.baseHp;
          actor.classFeatures = structuredClone(saved.classFeatures || {});
          actor.subclassId = saved.subclassId || "";
          actor.species = saved.choice.speciesId;
          actor.armorEquipped = Boolean(saved.equipped.armor);
          actor.castingAbility = saved.job.spellAbility || ({ cleric: "WIS", wizard: "INT" }[saved.choice.classId]);
          actor.spellAttackBonus = saved.attacks.find(entry => entry.en === "Spell attack")?.bonus;
        }
      }
      if (["fight", "ended"].includes(current.phase) && actor.roll && actor.roll.resolvedModifier === undefined) {
        // Older fights rolled against the saved base modifier. Keep that
        // already-resolved initiative when current effects change afterward.
        actor.roll.resolvedModifier = actor.initiative;
      }
      if (actor.speed !== undefined && actor.movement) continue;
      let sheet;
      if (actor.side === "party") {
        try { sheet = borderlandsCharacter.derive(JSON.parse(actor.binding)); }
        catch { sheet = character(actor); }
      }
      const movement = actor.side === "party" ? (Number.isFinite(sheet?.speed) ? { walk: sheet.speed } : {}) : catalog[actor.monster]?.speed ?? {};
      actor.movement ??= structuredClone(movement);
      if (actor.speed === undefined && Number.isFinite(movement.walk)) actor.speed = movement.walk;
    }
  }

  const currentStats = actor => E.currentStats(actor);
  const speedLine = actor => {
    const stats = currentStats(actor);
    const movement = Object.entries(stats.movement ?? {}).filter(([, number]) => Number.isFinite(number));
    const labels = { walk: "步行", climb: "攀爬", fly: "飞行", swim: "游泳", burrow: "掘穴" };
    return movement.length ? movement.map(([mode, number]) => `${zh() ? labels[mode] ?? mode : mode} ${number} ft${stats.baseMovement?.[mode] !== number ? ` (${zh() ? "基础" : "base"} ${stats.baseMovement?.[mode] ?? "—"})` : ""}`).join(" · ") : "";
  };
  const statline = actor => `${actor.hp}/${actor.maxHp} HP${actor.tempHp ? ` + ${actor.tempHp} temp` : ""} · AC ${currentStats(actor).ac}${speedLine(actor) ? ` · ${escape(speedLine(actor))}` : ""}`;

  function renderDetails() {
    const dialog = $("combat-details-dialog");
    if (!dialog.open) return;
    const actor = find(detailActor);
    if (!actor) { dialog.close(); return; }
    const content = $("combat-details-content");
    const scroll = content.scrollTop;
    const previousSections = new Map([...content.querySelectorAll("[data-detail-section]")].map(node => [node.dataset.detailSection, node.open]));
    let sheet = character(actor);
    if (!bound(actor)) {
      try { sheet = borderlandsCharacter.derive(JSON.parse(actor.binding)); } catch { /* Current saved sheet remains available as a fallback. */ }
    }
    $("combat-details-title").textContent = `${actorName(actor)} · ${zh() ? "详细资料" : "Combat details"}`;
    $("combat-details-expand").textContent = dialog.classList.contains("is-expanded") ? zh() ? "缩小窗口" : "Restore window" : zh() ? "展开窗口" : "Expand window";
    $("combat-details-close").textContent = zh() ? "关闭" : "Close";
    content.innerHTML = combatDetails.render({ actor, character: sheet, card: catalog[actor.monster], stats: currentStats(actor), battle: working(),
      actions: actions(actor), traits: globalThis.combatFixedTraits?.[actor.monster] ?? globalThis.combatOrdinaryTraits?.[actor.monster] ?? [], language, bound: bound(actor) });
    for (const node of content.querySelectorAll("[data-detail-section]")) if (previousSections.has(node.dataset.detailSection)) node.open = previousSections.get(node.dataset.detailSection);
    content.scrollTop = scroll;
  }

  function openDetails(actorId) {
    const dialog = $("combat-details-dialog");
    if (detailActor !== actorId) $("combat-details-content").replaceChildren();
    detailActor = actorId;
    if (!dialog.open) dialog.showModal();
    renderDetails();
  }
  const activeActors = () => working().actors.filter(actor => !actor.inactive);
  const participants = () => activeActors().filter(actor => !actor.object);
  const availableSlots = () => roster.slots.flatMap((choice, slot) => choice &&
    !battle.actors.some(actor => actor.side === "party" && actor.slot === slot && !actor.inactive)
    ? [[slot, choice.name || borderlandsCharacter.derive(choice).job.en]] : []);
  const enemyChoices = () => Object.fromEntries(Object.entries(catalog).map(([slug, entry]) => [slug, zh() ? entry.zh ?? entry.name : entry.name])
    .sort((left, right) => left[1].localeCompare(right[1], language)));

  function addOptions() {
    const saved = availableSlots();
    return `<div class="combat-toolbar">
      <form class="combat-toolbar" data-form="enemy">${select("monster", "Add enemy", enemyChoices(), "giant-spider")}
        ${field("count", "Count", 1, 32, 1)}
        <label><input name="scale" type="checkbox" checked> Scale for party</label>${submit("Add enemy")}</form>
      ${saved.length ? `<form class="combat-toolbar" data-form="character">${select("slot", "Add saved character", Object.fromEntries(saved))}${submit("Add character")}</form>` : ""}
      <form class="combat-toolbar" data-form="companion">${select("monster", zh() ? "友方／雇佣同伴" : "Friendly / hired companion", enemyChoices(), "guard")}
        <label>${zh() ? "姓名" : "Name"}<input name="name" maxlength="60"></label>
        ${select("duration", zh() ? "服务期限" : "Service", { persistent: zh() ? "留在队伍" : "Until dismissed", one: zh() ? "一场战斗" : "One fight" })}
        ${submit(zh() ? "添加同伴" : "Add companion")}</form>
      </div>`;
  }

  function reserves() {
    const actors = battle.actors.filter(actor => actor.reserve && actor.inactive);
    if (!actors.length) return "";
    return `<details><summary>Reinforcements and optional creatures (${actors.length})</summary><div class="combat-stack">
      ${actors.map(actor => `<div class="combat-card combat-toolbar"><span><strong>${escape(actorName(actor))}</strong>
        <span class="combat-statline">${statline(actor)}${actor.note ? ` · ${escape(translated(actor.note))}` : ""}</span></span>
        ${button("details", zh() ? "详细资料" : "Details", actor.id)}${button("activate", "Add", actor.id)}</div>`).join("")}</div></details>`;
  }

  function renderSetup() {
    const root = $("combat-setup");
    if (battle?.phase !== "setup" && battle) { root.hidden = true; return; }
    root.hidden = false;
    if (!battle) {
      root.innerHTML = `<h2>Set up combat</h2><p>All saved characters join by default.</p><div class="combat-toolbar">
        ${button("new", "New manual combat", "manual", true)}</div>`;
      return;
    }
    const groups = [["party", "Characters"], ["enemy", "Enemies"]];
    root.innerHTML = `<h2>Set up combat</h2><p class="combat-empty">Prepared for ${battle.scalePlayers} players. Adjust the participants before rolling initiative.</p>
      <div class="combat-setup-grid">${groups.map(([side, label]) => `<div><h3>${label}</h3><div class="combat-stack">
        ${participants().filter(actor => actor.side === side).map(actor => `<div class="combat-card combat-toolbar">
          <span><strong>${escape(actorName(actor))}</strong><span class="combat-statline">${statline(actor)} · Initiative ${signed(currentStats(actor).initiative ?? actor.initiative)}</span></span>
          ${button("details", zh() ? "详细资料" : "Details", actor.id)}${button("remove", "Remove", actor.id)}</div>`).join("") || '<p class="combat-empty">None added.</p>'}
      </div></div>`).join("")}</div>
      ${addOptions()}${reserves()}<div class="combat-toolbar">
      ${button("initiative", "Roll initiative", "", true, !participants().some(actor => actor.side === "party") || !participants().some(actor => actor.side === "enemy"))}</div>`;
  }

  function initiativeInputs(actor, index) {
    const roll = actor.roll;
    return `<tr>
      <th scope="row">${escape(actorName(actor))} ${button("details", zh() ? "详细资料" : "Details", actor.id)}${roll?.source === "automatic" ? '<small class="combat-statline">Automatic</small>' : ""}</th>
      <td>${select(`mode-${actor.id}`, "Roll mode", modes, roll?.mode ?? E.initiativeMode(actor))}</td>
      <td>${field(`die-${actor.id}`, "d20", 1, 20, roll?.dice[0] ?? "", false)}</td>
      <td>${field(`second-${actor.id}`, "Second d20", 1, 20, roll?.dice[1] ?? "", false)}</td>
      <td>${signed(currentStats(actor).initiative ?? actor.initiative)}</td>
      <td>${field(`override-${actor.id}`, "Total override", -99, 150, roll?.override ?? "", false)}</td>
      <td data-init-total="${escape(actor.id)}">${E.initiativeTotal(actor) ?? "—"}</td>
      <td>${field(`rank-${actor.id}`, "Tie order", 1, 96, roll?.rank ?? index + 1, false)}</td>
    </tr>`;
  }

  function renderInitiative() {
    const root = $("combat-initiative");
    root.hidden = battle?.phase !== "initiative";
    if (root.hidden) return;
    const swapActors = participants().filter(actor => actor.side === "party" && actor.hp > 0
      && !actor.conditions.some(effect => ["incapacitated", "unconscious", "stunned", "paralyzed", "petrified"].includes(effect.key)));
    const criminals = swapActors.filter(actor => character(actor)?.choice.backgroundId === "criminal");
    const swap = criminals.length && swapActors.length > 1 ? `<details><summary>Criminal initiative swap</summary>
      <div class="combat-toolbar">
      ${select("swapFrom", "Criminal", Object.fromEntries(criminals.map(actor => [actor.id, actorName(actor)])))}
      ${select("swapTo", "Willing ally", Object.fromEntries(swapActors.map(actor => [actor.id, actorName(actor)])),
        swapActors.find(actor => actor.id !== criminals[0].id)?.id)}
      <button class="secondary" name="intent" value="swap">Swap initiative totals</button></div></details>` : "";
    root.innerHTML = `<h2>Initiative</h2>
      <p>Enter the physical d20s for your characters. Change any result or modifier by entering a total override. Lower tie order acts first.</p>
      <form data-form="initiative">
        <div class="combat-toolbar">${select("initiativeMode", "Enemy initiative", { group: "Group identical enemies", individual: "Roll each enemy" }, battle.initiativeMode)}
          <button class="secondary" name="intent" value="roll">Reroll enemy dice</button>${button("setup", "Edit participants")}</div>
        <div class="combat-table-scroll"><table class="combat-table">
          <thead><tr><th>Combatant</th><th>Mode</th><th>Roll</th><th>Extra die</th><th>Modifier</th><th>Override</th><th>Total</th><th>Ties</th></tr></thead>
          <tbody>${participants().map(initiativeInputs).join("")}</tbody>
        </table></div>
        ${swap}<div class="combat-toolbar"><button class="secondary" name="intent" value="save">Save rolls</button>
          <button class="primary" name="intent" value="start">Start round 1</button></div>
      </form>`;
  }

  function renderParticipants() {
    const ordered = battle.order.map(find).filter(Boolean);
    const extras = battle.actors.filter(actor => !battle.order.includes(actor.id) && !actor.reserve);
    const rows = [...ordered, ...extras].map(actor => {
      const total = E.initiativeTotal(actor);
      const summary = actor.inactive ? "Out of combat" : actor.object ? `Object · ${statline(actor)}` : statline(actor);
      const statuses = [...actor.conditions.map(effect => effect.name), ...(actor.death?.dead ? ["Dead"]
        : actor.death?.stable ? ["Stable"] : actor.hp === 0 && actor.side === "party" ? ["Dying"] : [])];
      return `<button type="button" class="combat-combatant" data-cmd="select" data-value="${actor.id}"
        data-side="${actor.side}" data-active="${battle.active === actor.id}" aria-pressed="${selected === actor.id}">
        <strong>${total == null || actor.object ? "" : `${total} · `}${escape(actorName(actor))}</strong>
        <span class="combat-statline">${summary}${statuses.length ? ` · ${escape(statuses.join(", "))}` : ""}</span></button>`;
    });
    $("combat-participants").innerHTML = `<h2>Round ${battle.round}</h2>
      <p class="combat-statline">${battle.phase === "ended" ? escape(battle.outcome ?? "Combat ended") : `Turn: ${escape(find(battle.active) ? actorName(find(battle.active)) : "None")}`}</p>
      ${battle.phase === "fight" ? `<div class="combat-toolbar">${button("advance", "End turn", "", true, !battle.active)}</div>` : ""}
      <div class="combat-stack">${rows.join("")}</div>
      ${battle.phase === "fight" ? `<details><summary>Add combatants</summary>${addOptions()}</details>${reserves()}` : ""}`;
  }

  function reason(actor, action) {
    if (actor.inactive) return "Out of combat";
    if (actor.hp <= 0 || actor.death?.dead || actor.conditions.some(effect => incapacitating.has(effect.key))) return "Unable to act";
    if (action.recharge && actor.recharge[action.rechargeKey ?? action.id] === false) return "Needs recharge";
    if (action.timing !== "reaction" && actor.id !== battle.active) return "Wait for their turn";
    const blocked = E.availability(battle, actor, action);
    if (blocked) return blocked;
    if (action.reaction) return "Choose in the attack preview";
    const sheet = character(actor);
    if (action.cost?.power && !sheet?.powers.some(power => power.id === action.cost.power && power.remaining > 0)) return "No Power Tokens left";
    if (action.cost?.item && !sheet?.inventory[action.cost.item]) return "Item unavailable";
    return "";
  }

  function renderActions() {
    const actor = find(selected) ?? find(battle.active);
    const root = $("combat-actions");
    if (!actor) { root.innerHTML = "<h2>Actions</h2><p>Select a combatant.</p>"; return; }
    const choices = actions(actor);
    const traits = (globalThis.combatFixedTraits?.[actor.monster] ?? globalThis.combatOrdinaryTraits?.[actor.monster] ?? []);
    const card = catalog[actor.monster];
    const stats = currentStats(actor);
    root.innerHTML = `<h2>${escape(actorName(actor))}</h2><p>${statline(actor)}</p>
      ${actor.side === "party" ? `<p class="combat-statline">${escape(Object.entries(stats.abilities ?? {}).map(([key, n]) => `${key} ${signed(n)}`).join(" · "))}</p>` : ""}
      <div class="combat-toolbar">${button("details", zh() ? "详细属性、装备与效果" : "Full stats, equipment & effects", actor.id)}</div>
      ${!bound(actor) ? '<p class="error">Character sheet changed outside combat. Remove and re-add this character to sync.</p>' : ""}
      ${battle.phase === "fight" ? `<div class="combat-toolbar">
        ${button("correct", "Adjust stats / effects", actor.id, false, !bound(actor))}
        ${button(actor.inactive ? "restore" : "remove", actor.inactive ? "Rejoin" : "Remove from fight", actor.id, false, actor.object || actor.inactive && !bound(actor))}
        </div>` : ""}
      ${actor.conditions.length ? `<p>${actor.conditions.map(effect => `<span class="combat-effect">${escape(zh() ? effect.zh ?? effect.name : effect.name)}</span>`).join(" ")}</p>` : ""}
      ${card?.source ? `<details><summary>Monster card and traits</summary>
        ${traits.map(trait => `<p><strong>${escape(moveName(trait))}</strong> · ${escape(moveText(trait))}</p>`).join("")}
        <a href="${escape(card.source)}" target="_blank" rel="noopener">Full card ↗</a></details>` : ""}
      ${battle.phase === "fight" && !actor.object ? `<p class="combat-statline">Action ${actor.spent?.action ? "spent" : "ready"} · Bonus action ${actor.spent?.bonus ? "spent" : "ready"} · Reaction ${actor.spent?.reaction ? "spent" : "ready"}</p>` : ""}
      ${character(actor)?.powers.length ? `<p class="combat-statline">${escape(character(actor).powers.map(power => `${zh() ? power.zh ?? power.en : power.en}: ${power.remaining}/${power.count}`).join(" · "))}</p>` : ""}
      ${battle.phase === "fight" ? actor.conditions.filter(effect => effect.escape).map(effect =>
        button("escape", `Escape ${effect.name}`, effect.id, false, actor.id !== battle.active || actor.spent?.action)).join("") : ""}
      ${battle.phase === "fight" && choices.length ? `<h3>Actions</h3><div class="combat-actions-grid">
        ${choices.map(action => {
          const blocked = reason(actor, action);
          return `<button class="combat-action" type="button" data-cmd="action" data-value="${escape(action.id)}"
            aria-pressed="${draft?.root.id === action.id}"${busy ? " disabled" : ""}>
            <strong>${escape(moveName(action))}</strong><small>${escape(blocked || action.timing)}</small></button>`;
        }).join("")}</div>` : ""}`;
  }

  function stageTarget() {
    const { action, actorId } = draft;
    const options = activeActors().map(actor => `<label class="combat-card"><input type="checkbox" name="target"
      value="${actor.id}"${draft.targets.includes(actor.id) ? " checked" : ""}> ${escape(actorName(actor))} · ${statline(actor)}</label>`).join("");
    const choices = Object.entries(action.options ?? {}).map(([key, values]) => select(`option-${key}`, key, Object.fromEntries(values.map(value => [value, value])), draft.input[key] ?? values[0])).join("");
    const allocation = action.darts ? `<p>Allocate all ${action.darts} darts. Roll one shared d4; each dart deals that result + 1 Force damage.</p>${activeActors().map(actor => field(`darts-${actor.id}`, `${actorName(actor)} · darts`, 0, action.darts, draft.input.allocations?.[actor.id] ?? 0)).join("")}` : "";
    if (action.target === "pick") return form("targets", `<fieldset class="combat-targets"><legend>Targets</legend>${options}</fieldset>${choices}${allocation}`, "Continue", true);
    if (choices && !draft.optionsChosen) return form("spell-options", choices, "Continue", true);
    draft.targets = action.target === "self" ? [actorId] : [];
    draft.stage = "roll";
    return stageRoll();
  }

  function stageRoll() {
    const { action, actorId, targets } = draft;
    if (action.secondWindCheck) return form("second-wind-check", `${field("previousCheckTotal", "Failed ability-check total", -999, 999)}${field("checkDC", "Check DC", 0, 999)}${field("windRoll", "Second Wind · d10", 1, 10)}`, "Preview check result", true);
    if (action.type === "manual") {
      return form("manual", `<label>Rolls and ruling <input name="note" maxlength="200" placeholder="For example, d20 14 + 3 = 17"></label>`, "Preview action", true);
    }
    if (action.type === "check") {
      const actor = find(actorId), check = E.checkTotal(actor, action.check.skill, []);
      return form("check", `<p>${escape(action.check.skill)} · DC ${action.check.dc}</p>${diceFields("check", 1, 20, "Check")}
        ${select("checkMode", "Mode", modes, check.mode)}${field("check2", "Second d20 if needed", 1, 20, "", false)}
        ${check.guidance ? field("guidance", "Guidance · d4", 1, 4) : ""}`, "Preview action", true);
    }
    const wards = targets.filter(id => find(id).conditions.some(effect => effect.key === "sanctuary") && !action.area
      && (action.type === "attack" || action.spell && (action.dice?.some(die => die.type !== "Healing") || action.darts)));
    const wardFields = wards.map(id => `<fieldset><legend>${escape(actorName(find(id)))} · Sanctuary</legend><p>Attacker's Wisdom save before choosing this protected target. Failure blocks this target; choose another target or lose this attack/spell.</p>
      ${field(`ward-${id}`, "WIS save · d20", 1, 20)}${field(`ward2-${id}`, "Second d20 if needed", 1, 20, "", false)}
      ${select(`wardMode-${id}`, "WIS save mode", modes, E.saveMode(working(), id, actorId, { ability: "WIS", magic: true }))}
      ${find(actorId).conditions.some(effect => effect.key === "bless") ? field(`wardBless-${id}`, "Bless · d4", 1, 4) : ""}</fieldset>`).join("");
    if (action.type !== "attack" && action.type !== "save" && wardFields && !draft.wardsChosen) return form("wards", wardFields, "Check Sanctuary", true);
    if (action.type !== "attack" && action.type !== "save") {
      draft.stage = "damage";
      return stageDamage();
    }
    const settings = targets.map(targetId => {
      const target = find(targetId);
      const mode = action.type === "attack" ? E.attackMode(working(), actorId, targetId, { ...draft.input, action })
        : E.saveMode(working(), actorId, targetId, { ...draft.input, ability: action.save.ability, action });
      const blessed = target.conditions.some(effect => effect.key === "bless");
      const autoFail = action.type === "save" && E.preview(working(), actorId, action, [targetId], { hitsOnly: true }).targets[0]?.autoFail;
      return `<fieldset><legend>${escape(actorName(target))}</legend><div class="combat-fields">
        ${select(`mode-${targetId}`, "Roll mode", { auto: `Automatic (${modes[mode]})`, ...modes }, "auto")}
        ${select(`cover-${targetId}`, "Cover", { 0: "None", 2: "Half (+2)", 5: "Three-quarters (+5)" }, 0)}
        ${field(`modifier-${targetId}`, "Situational roll modifier", -50, 50, "", false)}
        ${action.dice?.some(die => die.when === "charged") || action.effects?.some(effect => effect.when === "charged")
          ? `<label><input type="checkbox" name="charged-${targetId}"> Charge requirement met</label>` : ""}
        ${["kobold-warrior", "hobgoblin-warrior"].includes(find(actorId).monster) && action.type === "attack"
          ? `<label><input type="checkbox" name="pack-${targetId}"> Pack Tactics applies</label>` : ""}
        ${["wight-lifedrinker", "kobold-warrior", "kuo-toa-marauder"].includes(find(actorId).monster) && action.type === "attack"
          ? `<label><input type="checkbox" name="sunlight-${targetId}"> In sunlight</label>` : ""}
        ${action.type === "attack" && target.conditions.some(effect => ["unconscious", "paralyzed", "prone"].includes(effect.key))
          ? select(`distance-${targetId}`, "Distance for condition", { unknown: "Use table ruling", close: "Within 5 feet", far: "Beyond 5 feet" }) : ""}
        ${action.type === "attack" ? field(`ac-${targetId}`, "AC override", 0, 999, "", false)
          : autoFail ? "<p>Automatically fails this save.</p>"
            : `<div class="combat-rolls">${field(`save-${targetId}`, `${action.save.ability} save · d20`, 1, 20)}
              ${field(`save2-${targetId}`, "Second d20 if needed", 1, 20, "", false)}
              ${blessed ? field(`bless-${targetId}`, "Bless · d4", 1, 4) : ""}</div>`}</div></fieldset>`;
    }).join("");
    const shared = action.type === "attack" ? `<div class="combat-rolls">
      ${field("attack", "Attack · d20", 1, 20)}${field("attack2", "Second d20 if needed", 1, 20, "", false)}
      ${find(actorId).conditions.some(effect => effect.key === "bless") ? field("bless-attack", "Bless · d4", 1, 4) : ""}
      </div><p class="combat-statline">Attack modifier ${signed(E.effectiveAttackBonus(find(actorId), action))}${action.attackAbility ? ` (${escape(action.attackAbility)})` : ""}</p>` : `<p>Saving throw DC ${E.effectiveSaveDC(find(actorId), action)}</p>`;
    return form("roll", wardFields + shared + settings, "Check results", true);
  }

  function outcomeRows(preview) {
    return `<ul class="combat-result">${preview.targets.map(target => {
      const calculation = target.die == null ? target.total : `${target.die} ${signed(target.bonus ?? 0)} = ${target.total}`;
      const check = target.check ? `${target.check.total ?? "—"} vs DC ${target.check.dc} · ${target.check.success ? "Succeeded" : "Failed"}` : target.hit != null ? `${calculation} vs AC ${target.ac} · ${target.critical ? "Critical hit" : target.hit ? "Hit" : "Miss"}`
        : target.saved != null ? target.autoFail ? "Automatic failure"
          : `${calculation} vs DC ${target.dc} · ${target.saved ? "Saved" : "Failed"}` : "";
      const result = [
        target.damage != null ? `${target.damage} damage` : "",
        target.heal != null ? `${target.heal} healing` : "",
        ...(target.effects ?? []), ...(target.ward ? [`Sanctuary: ${target.ward.total ?? "pending"} vs DC ${target.ward.dc}${target.wardBlocked ? " — target blocked" : ""}`] : []), target.reaction ? moveName(target.reaction) : "",
      ].filter(Boolean);
      const math = target.components?.map(component => `${component.type ?? "Damage"}: ${component.raw}${component.raw !== component.amount ? ` → ${component.amount}` : ""}`).join(" · ");
      return `<li><strong>${escape(actorName(find(target.id)))}</strong> ${escape([check, ...result].filter(Boolean).join(" · "))}
        ${math ? `<small class="combat-statline">${escape(math)}</small>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  function reactionList() {
    const { action, input, preview } = draft;
    const options = preview.targets.flatMap(row => {
      if (row.wardBlocked || input.reactions?.[row.id]) return [];
      const target = find(row.id);
      const selfReactions = actions(target).filter(move => move.reaction?.trigger === "hit" && (row.hit || action.darts) && (!action.darts || move.reaction.magicMissile) && !E.availability(working(), target, move)
        && (!move.reaction.melee || action.melee)
        && (!move.cost?.power || character(target)?.powers.some(power => power.id === move.cost.power && power.remaining > 0)))
        .map(move => button("reaction", `${actorName(target)} · ${moveName(move)}`, `${row.id}:${move.id}`));
      const flares = action.type === "attack" ? activeActors().flatMap(reactor => actions(reactor).filter(move => move.reaction?.trigger === "attack" && !E.availability(working(), reactor, move))
        .map(move => button("reaction", `${actorName(reactor)} · ${moveName(move)} → ${actorName(target)}`, `${row.id}|${reactor.id}|${move.id}`))) : [];
      return [...selfReactions, ...flares];
    });
    return options.length ? `<div class="combat-toolbar">${options.join("")}</div>` : "";
  }

  function stageDamage() {
    const { actorId, action, targets, input } = draft;
    const preview = draft.preview = E.preview(working(), actorId, action, targets, input);
    const results = preview.targets.length ? outcomeRows(preview) : "";
    const reactions = reactionList();
    const dice = preview.dice ?? action.dice ?? [];
    if (action.kitCheck && input.kitRoll == null) return results + form("kit", field("kitRoll", "Kit check · d10 (1 expends the kit)", 1, 10), "Preview action", true);
    if (preview.complete) return results + reactions + (preview.warnings ?? []).map(warning => `<p class="combat-empty">${escape(warning)}</p>`).join("")
      + `<div class="combat-toolbar">${button("apply", applyLabel(), "", true)}
        ${["attack", "save"].includes(action.type) ? button("back", "Edit roll") : ""}${button("cancel", "Cancel")}</div>`;
    if (preview.warnings.length && !preview.needsDamage) return results
      + preview.warnings.map(warning => `<p class="error">${escape(warning)}</p>`).join("")
      + `<div class="combat-toolbar">${button("cancel", "Cancel")}</div>`;
    const rollFields = dice.map((die, index) => {
      const label = die.type || (action.type === "heal" ? "Healing" : "Damage");
      const expression = die.count ? `${die.count}d${die.sides}${die.flat ? signed(die.flat) : ""}` : String(die.flat ?? 0);
      return `<fieldset><legend>${escape(label)} · ${expression}${die.ability ? ` (${escape(die.ability)})` : ""}</legend>
        <div class="combat-rolls">${diceFields(`damage-${index}`, die.count, die.sides, label)}
        ${die.criticalRequired ?? preview.needsCritical ? diceFields(`critical-${index}`, die.count, die.sides, "Extra critical dice") : ""}</div></fieldset>`;
    }).join("");
    const damageType = preview.damageTypeRoll || (preview.needsDamage && action.damageTypeRoll);
    return results + reactions + (action.type === "heal" ? `<p class="combat-statline">Enter final physical healing dice after any permitted Healing Rerolls.</p>` : "") + form("damage", (damageType ? field("damageType", "Damage type die", 1, damageType.sides) : "") + rollFields + (action.melee ?
      sparring() ? '<p class="combat-statline">A finishing melee hit knocks the target out at 1 HP.</p>'
        : '<label><input type="checkbox" name="knockout"> Knock out instead of killing</label>' : ""), "Preview action", true)
      + (["attack", "save"].includes(action.type) ? button("back", "Edit roll") : "");
  }

  function renderDraft() {
    const { action, stage, root, slotIndex } = draft;
    if (stage === "inspect") return `<h2>${escape(moveName(action))}</h2><p>${escape(actionStats(action))}</p><p>${escape(moveText(action) ?? "")}</p>
      <p class="combat-empty">${escape(draft.blocked)}</p>`;
    if (stage === "slot") return `<h2>${escape(moveName(root))}</h2>
      <p>Attack ${slotIndex + 1} of ${root.slots.length}</p><p>${escape(moveText(root) ?? "")}</p>
      <div class="combat-stack">${slotChoices().map((move, index) => button("slot", moveName(move), index, true)).join("")}
      ${button("cancel", "Cancel multiattack")}</div>`;
    const intro = `<h2>${escape(moveName(action))}</h2><p class="combat-statline">${escape(actionStats(action))}</p>
      ${action.targetCap ? `<p class="combat-statline">Card guidance: up to ${action.targetCap} target${action.targetCap === 1 ? "" : "s"}.</p>` : ""}
      ${root.slots ? `<p>Attack ${slotIndex + 1} of ${root.slots.length}</p>` : ""}
      ${moveText(action) ? `<p>${escape(moveText(action))}</p>` : ""}`;
    if (stage === "targets") return intro + stageTarget();
    if (stage === "roll") return intro + stageRoll();
    if (stage === "damage") return intro + stageDamage();
    const fortitude = (draft.preview.fortitude ?? []).filter(check => check.success == null);
    if (fortitude.length && draft.root.slots && draft.slotIndex < draft.root.slots.length - 1) {
      return intro + outcomeRows(draft.preview) + form("fortitude", fortitude.map(check =>
        `<fieldset><legend>${escape(actorName(find(check.actorId)))} · Undead Fortitude DC ${check.dc}</legend>
          ${field(`fortitude-${check.actorId}`, "CON save · d20", 1, 20)}
          ${check.mode !== "normal" ? field(`fortitude2-${check.actorId}`, "Second d20", 1, 20) : ""}
          ${find(check.actorId).conditions.some(effect => effect.key === "bless")
            ? field(`fortitudeBless-${check.actorId}`, "Bless · d4", 1, 4) : ""}</fieldset>`).join(""), "Check Fortitude", true);
    }
    return intro + outcomeRows(draft.preview)
      + (draft.preview.warnings ?? []).map(warning => `<p class="combat-empty">${escape(warning)}</p>`).join("")
      + `<p>${escape(draft.preview.summary)}</p><div class="combat-toolbar">
      ${button("apply", applyLabel(), "", true)}
      ${button("back", "Edit roll")}${button("cancel", "Cancel")}</div>`;
  }

  function actionStats(action) {
    const actor = find(draft?.actorId ?? selected);
    const dice = (action.dice ?? []).map(die =>
      `${die.count ? `${die.count}d${die.sides}${die.flat ? signed(die.flat) : ""}` : die.flat ?? 0} ${die.type ?? ""}${die.when ? " (conditional)" : ""}`.trim());
    return [action.type === "attack" ? `${signed(actor ? E.effectiveAttackBonus(actor, action) : action.bonus ?? 0)} to hit` : "",
      action.save ? `DC ${actor ? E.effectiveSaveDC(actor, action) : action.save.dc} ${action.save.ability} save` : "", ...dice,
      action.recharge ? `Recharge ${action.recharge.join("–")}` : ""].filter(Boolean).join(" · ");
  }

  function renderCorrection() {
    const actor = find(correction);
    const remove = actor.conditions.length ? select("removeCondition", "Remove effect",
      Object.fromEntries([["", "Keep effects"], ...actor.conditions.map(effect => [effect.id, effect.name])])) : "";
    return `<h2>Adjust ${escape(actorName(actor))}</h2>` + form("correction", `<div class="combat-rolls">
      ${field("hp", "Current HP", 0, 9999, actor.hp)}
      ${field("maxHp", "Maximum HP", 1, 9999, actor.maxHp)}
      ${field("tempHp", "Temporary HP", 0, 9999, actor.tempHp)}
      ${field("ac", "Base AC", 0, 999, actor.ac)}
      ${Number.isFinite(actor.speed) ? field("speed", "Base walking Speed (ft)", 0, 999, actor.speed) : ""}
      ${actor.object ? "" : field("total", "Initiative total", -99, 150, E.initiativeTotal(actor) ?? "", false)}
      ${field("damage", "Apply damage", 0, 9999, "", false)}
      ${actor.object ? "" : field("heal", "Apply healing", 0, 9999, "", false)}
      ${actor.object ? "" : field("exhaustionLevels", "Set total Exhaustion level (0–6)", 0, 6, "", false)}
      </div>${actor.object ? "" : `<p class="combat-empty">${zh() ? "力竭等级留空则保留原值，0 移除力竭；达到 6 级会死亡，降低等级不会使死者复活。" : "Leave Exhaustion blank to keep it; 0 clears it. Level 6 causes death. Lowering it does not revive a dead creature."}</p>`}${remove}
      <label>Add condition or buff <input name="condition" maxlength="80"></label>
      <fieldset><legend>${zh() ? "新效果的临时数值变化" : "Temporary changes from the new effect"}</legend><div class="combat-rolls">
      ${field("effectAC", "AC change", -50, 50, "", false)}
      ${field("effectSpeed", "Speed change (ft)", -999, 999, "", false)}
      ${field("effectAttack", "Attack-roll change", -50, 50, "", false)}
      ${field("effectSave", "Saving-throw change", -50, 50, "", false)}
      ${field("effectAbility", "Ability-check change", -50, 50, "", false)}</div>
      ${select("effectExpiry", "Effect ends", { none: "When removed manually", "round-start": "At start of a numbered round", "start-target": "At start of this creature's turn", "end-target": "At end of this creature's turn", "start-actor": "At start of the source creature's turn", "end-actor": "At end of the source creature's turn" })}
      ${select("effectSource", "Source creature", Object.fromEntries(battle.actors.map(entry => [entry.id, actorName(entry)])), battle.active ?? actor.id)}
      ${field("effectRounds", "Rounds / source or target turns until expiry", 1, 1000, 1)}
      <p class="combat-empty">${zh() ? "填写新效果名称才会加入临时变化。1 轮表示下轮开始；回合时点则按所选生物的下个开始／结束计算。基础数值编辑是永久修改；临时变化到期会自动移除。" : "Enter an effect name to add temporary changes. 1 round expires at the next numbered round; turn timings follow the chosen creature's next start/end. Base-stat edits are permanent; temporary effects expire automatically."}</p></fieldset>
      ${select("life", "Life status", { "": "Keep current", stable: "Stable at 0 HP", dying: "Dying at 0 HP", dead: "Dead", conscious: "Conscious (HP above 0)" })}
      ${actor.concentration ? '<label><input type="checkbox" name="endConcentration"> End concentration</label>' : ""}
      <label>Note <input name="note" maxlength="160"></label>`, "Apply adjustment", true);
  }

  function rechargeMoves(actor) {
    const choices = actions(actor).flatMap(action => action.slots ? action.slots.flat() : [action]);
    return [...new Map(choices.filter(action => action.recharge).map(action => [action.rechargeKey ?? action.id, action])).values()];
  }

  function promptEntries() {
    const entries = E.prompts(working()).map(prompt => ({ ...prompt, key: prompt.id ?? `${prompt.kind}:${prompt.actorId}` }));
    const active = find(working().active);
    if (active) {
      for (const action of rechargeMoves(active)) {
        if (E.rechargeDue(active, action)) entries.push({ kind: "recharge", actorId: active.id, action,
          key: `recharge:${active.id}:${action.id}` });
      }
    }
    return entries;
  }

  const promptLabel = prompt => prompt.label ?? (prompt.kind === "death" ? "Death save"
    : prompt.kind === "concentration" ? "Concentration" : `Recharge ${moveName(prompt.action)}`);

  function renderPrompts() {
    const entries = promptEntries();
    const prompt = entries.find(entry => entry.key === turnPrompt);
    if (prompt) {
      const label = promptLabel(prompt);
      const heading = `<h2>${escape(label)}</h2><p>${escape(actorName(find(prompt.actorId)))}${prompt.dc ? ` · DC ${prompt.dc} ${prompt.ability ?? ""}` : ""}</p>`;
      if (prompt.kind === "death-burst") return heading + `<div class="combat-toolbar">
        ${button("death-burst", "Choose affected creatures", prompt.actorId, true)}
        ${button("dismiss-prompt", "No creatures affected", prompt.id)}</div>`;
      const saveOptions = ["death", "concentration", "effect-save", "fortitude"].includes(prompt.kind)
        ? select("mode", "Mode", modes, prompt.mode ?? "normal") + field("extra", "Second d20 if needed", 1, 20, "", false)
          + (find(prompt.actorId).conditions.some(effect => effect.key === "bless") ? field("bless", "Bless · d4", 1, 4, "", false) : "") : "";
      const dice = prompt.kind === "effect-damage" ? prompt.dice.map((die, index) =>
        diceFields(`effect-${index}`, die.count, die.sides, die.type ?? "Damage")).join("")
        : diceFields("die", 1, prompt.kind === "recharge" ? 6 : 20, label);
      return heading + form("prompt", dice + saveOptions, "Record roll", true);
    }
    return entries.length ? `<h2>Pending rolls</h2><div class="combat-stack">${entries.map(entry => button("prompt",
      `${actorName(find(entry.actorId))} · ${promptLabel(entry)}`, entry.key)).join("")}</div>` : "";
  }

  function renderWorkflow() {
    const root = $("combat-workflow");
    if (battle.phase === "ended") { root.innerHTML = `<h2>Combat ended</h2><p>${escape(battle.outcome)}</p>`; return; }
    if (pendingAdds) {
      const roll = pendingAdds.roll;
      root.innerHTML = `<h2>Initiative · ${escape(actorName(pendingAdds))}</h2>`
        + form("join", field("die", "Initiative · d20", 1, 20, roll?.dice[0] ?? "", false)
          + field("extra", "Second d20", 1, 20, roll?.dice[1] ?? "", false)
          + field("total", "Total override", -99, 150, roll?.override ?? "", false)
          + select("mode", "Roll mode", modes, roll?.mode ?? "normal"), "Join combat", true);
      return;
    }
    if (correction) { root.innerHTML = renderCorrection(); return; }
    if (draft?.stage === "escape") {
      const effect = draft.escape;
      root.innerHTML = `<h2>Escape ${escape(effect.name)}</h2><p>DC ${effect.escape.dc} · ${escape(effect.escape.ability ?? "Strength")} check</p>`
        + form("escape", diceFields("die", 1, 20, "Escape") + select("mode", "Mode", modes, effect.escape.mode ?? "normal")
          + field("extra", "Second d20 if needed", 1, 20, "", false)
          + field("modifier", "Modifier override", -50, 50, "", false), "Record escape", true);
      return;
    }
    if (draft) { root.innerHTML = renderDraft(); return; }
    root.innerHTML = renderPrompts() || "<h2>Resolve action</h2><p>Choose a combatant and an action.</p>";
  }

  function rollDetails(rolls) {
    if (Array.isArray(rolls)) {
      return rolls.map(roll => `${roll.name ?? "Combatant"}: ${roll.dice?.join(", ") || "—"}`
        + ` ${signed(roll.modifier ?? 0)} → ${roll.total}${roll.override != null ? " (override)" : ""}`).join("\n");
    }
    const labels = { attack: "Attack d20s", damage: "Damage / healing", critical: "Extra critical dice",
      saves: "Saving throws", bless: "Bless", modifiers: "Situational modifiers", dice: "Dice", mode: "Mode",
      source: "Source", total: "Total", die: "Die" };
    function display(value) {
      if (Array.isArray(value)) return value.map(entry => Array.isArray(entry) ? `[${entry.join(", ")}]` : display(entry)).join(", ");
      if (value && typeof value === "object") return Object.entries(value).map(([key, entry]) =>
        `${find(key)?.name ?? labels[key] ?? key}: ${display(entry)}`).join(" · ");
      return String(value);
    }
    return Object.entries(rolls).filter(([, value]) => value != null && (typeof value !== "object" || Object.keys(value).length))
      .map(([key, value]) => `${labels[key] ?? key}: ${display(value)}`).join("\n");
  }

  function renderLog() {
    const entries = battle?.log ?? [];
    $("combat-log").innerHTML = entries.length ? `<ol class="combat-log-list">${[...entries].reverse().map(entry =>
      `<li><strong>${entry.round ? `Round ${entry.round} · ` : ""}${escape(entry.action ?? "Combat")}</strong>
      <p>${escape(entry.summary)}</p>
      ${entry.rolls && rollDetails(entry.rolls) ? `<details><summary>Dice and modifiers</summary><pre>${escape(rollDetails(entry.rolls))}</pre></details>` : ""}</li>`).join("")}</ol>`
      : '<p class="combat-empty">Dice and resolved actions appear here.</p>';
  }

  function render() {
    hydrateActors(battle);
    if (draft?.working && draft.working !== battle) hydrateActors(draft.working);
    $("lang-en").setAttribute("aria-pressed", !zh());
    $("lang-zh").setAttribute("aria-pressed", zh());
    $("combat-heading").textContent = battle ? zh() ? battle.titleZh ?? (battle.source === "ambush" ? "普拉尔的强盗伏击" : battle.title) : battle.title : "Combat";
    const back = combatHandoff.backURL(battle?.back) ?? (battle?.source === "ambush" ? ambushLink : null);
    const storyBack = back && new URL(back, location.href).searchParams.get("map") === "intro";
    $("combat-source").innerHTML = back ? `<a href="${escape(back)}"${storyBack ? ' target="borderlands-story"' : ""}>← ${storyBack ? "Story Mode" : "Back to encounter"}</a>` : "";
    const results = { Victory: "Victory", Retreat: "Retreat", Surrender: "Surrender", "Other outcome": "Other outcome" };
    if (battle?.source === "ambush") results["Bandit ambush defeat"] = "Bandit ambush defeat";
    $("combat-end").innerHTML = `${offerEncounter && battle ? button("new", `Set up ${translated(incoming?.title ?? "Bandit Ambush")}`, incoming ? "encounter" : "ambush", true) : ""}
      ${sparring() && battle.phase !== "ended" ? button("stop-sparring", zh() ? "停止比试" : "Stop sparring", "", true)
        : battle?.phase === "fight" ? `<form class="combat-toolbar" data-form="end">
        ${select("result", "Outcome", results)}
        ${submit("End combat")}</form>` : battle ? button("new", "New manual combat", "manual") : ""}
      ${battle ? button("cancel-combat", zh() ? "取消战斗" : "Cancel combat") : ""}`;
    renderSetup();
    renderInitiative();
    const showFight = battle?.phase === "fight" || battle?.phase === "ended";
    $("combat-fight").hidden = !showFight;
    if (showFight) {
      renderParticipants();
      renderActions();
      renderWorkflow();
    }
    renderLog();
    renderDetails();
    historyControls.update();
  }

  function slotChoices() {
    const entry = draft.root.slots[draft.slotIndex];
    return (Array.isArray(entry) ? entry : [entry]).filter(action =>
      (!action.oncePerMultiattack || !draft.used.includes(action.id))
      && (!action.slotGroup || draft.used.filter(key => key === action.slotGroup).length < (action.maxPerMultiattack ?? 1))
      && !E.availability(working(), find(draft.actorId), { ...action, timing: draft.slotIndex ? "free" : draft.root.timing }));
  }

  function chooseSlot(action) {
    draft.action = { ...action, timing: draft.slotIndex === 0 ? draft.root.timing : "free" };
    draft.targets = [];
    draft.input = {};
    draft.stage = "targets";
  }

  function openSlot() {
    draft.stage = "slot";
    const choices = slotChoices();
    if (choices.length === 1) chooseSlot(choices[0]);
  }

  function applyLabel() {
    return draft.root.slots && draft.slotIndex < draft.root.slots.length - 1 ? "Next attack"
      : draft.root.slots ? "Apply multiattack" : "Apply action";
  }

  function startAction(actor, root, blocked) {
    draft = { actorId: actor.id, root, action: root, slotIndex: 0, targets: [], input: {}, blocked,
      stage: blocked ? "inspect" : "targets", working: battle, costs: [], used: [] };
    if (root.slots && !blocked) openSlot();
    renderActions();
    renderWorkflow();
    historyControls.update();
  }

  function formNumber(data, key) {
    const value = data.get(key);
    return value == null || value === "" ? undefined : Number(value);
  }

  function readInitiative(formElement) {
    const data = new FormData(formElement);
    const next = structuredClone(battle);
    next.initiativeMode = data.get("initiativeMode");
    const changedMode = battle.initiativeMode !== next.initiativeMode;
    for (const actor of next.actors.filter(entry => !entry.inactive)) {
      const first = formNumber(data, `die-${actor.id}`);
      const second = formNumber(data, `second-${actor.id}`);
      const override = formNumber(data, `override-${actor.id}`);
      const mode = data.get(`mode-${actor.id}`);
      const rank = formNumber(data, `rank-${actor.id}`);
      const previous = actor.roll;
      if (changedMode && previous?.source === "automatic" && first === previous.dice[0] && second === previous.dice[1]
        && override == null && mode === previous.mode) {
        actor.roll = null;
      } else if (first != null || override != null) {
        const dice = [first, second].filter(value => value != null);
        const source = previous?.source === "automatic" && first === previous.dice[0] && second === previous.dice[1]
          && override == null && mode === previous.mode ? "automatic" : "manual";
        actor.roll = { dice, mode, override, rank, source };
      } else {
        actor.roll = null;
      }
    }
    if (next.initiativeMode === "group") {
      const groups = new Map();
      for (const actor of next.actors.filter(entry => entry.side === "enemy" && !entry.inactive && entry.roll)) {
        const key = E.initiativeGroup(next, actor);
        const rows = groups.get(key) ?? [];
        rows.push(actor);
        groups.set(key, rows);
      }
      for (const group of groups.values()) {
        const current = group.find(actor => {
          const before = find(actor.id)?.roll;
          return !before || actor.roll.override !== before.override || actor.roll.mode !== before.mode ||
            actor.roll.dice.join() !== before.dice.join();
        }) ?? group[0];
        for (const actor of group) actor.roll = { ...current.roll, rank: actor.roll.rank };
      }
    }
    return next;
  }

  function sortOrder(next) {
    next.order.sort((a, b) => {
      const left = next.actors.find(actor => actor.id === a);
      const right = next.actors.find(actor => actor.id === b);
      return (E.initiativeTotal(right) ?? -100) - (E.initiativeTotal(left) ?? -100)
        || (left.roll?.rank ?? 99) - (right.roll?.rank ?? 99);
    });
  }

  async function addActor(actor, roll) {
    if (battle.actors.length >= 96 && !battle.actors.some(entry => entry.id === actor.id && entry.inactive)) throw new Error("This combat has reached its participant limit.");
    const next = structuredClone(battle);
    if (next.actors.some(entry => entry.id === actor.id && !entry.inactive)) throw new Error("This companion or character is already in the fight.");
    next.actors = next.actors.filter(entry => entry.id !== actor.id);
    next.order = next.order.filter(entry => entry !== actor.id);
    next.actors.push(actor);
    if (battle.phase === "fight") {
      actor.roll = roll;
      next.order.push(actor.id);
      sortOrder(next);
      if (!next.active) next.active = actor.id;
    }
    if (await commit(log(next, "Add combatant", `${actor.name} joins combat.`, roll), `${actor.name} added.`)) {
      pendingAdds = null;
      selected = actor.id;
      render();
    }
  }

  function preparedGroup(monster, count, scaled) {
    const card = catalog[monster];
    const players = battle.scalePlayers;
    const total = scaled && card.profile === "weaker" ? Math.floor(count * players / 4) : count;
    const hp = !scaled || card.profile === "context" ? card.hp : Math.ceil(card.hp * count * players / (4 * total));
    const number = battle.actors.filter(actor => actor.monster === monster).length;
    return Array.from({ length: total }, (_, index) => enemy(monster, players, hp, number + index + 1, { count: total, printed: !scaled }));
  }

  async function addEnemies(actors, activate = false) {
    if (!activate && battle.actors.length + actors.length > 96) throw new Error("This combat has reached its participant limit.");
    const next = structuredClone(battle);
    for (const actor of actors) {
      if (activate) Object.assign(next.actors.find(entry => entry.id === actor.id), { inactive: false, reserve: false });
      else next.actors.push(actor);
      if (battle.phase === "fight") next.order.push(actor.id);
    }
    const ready = battle.phase === "fight" ? E.fillEnemyInitiative(next) : next;
    if (battle.phase === "fight") {
      sortOrder(ready);
      ready.active ??= ready.order[0];
    }
    const summary = actors.map(actor => actor.name).join(", ") + (actors.length === 1 ? " joins combat." : " join combat.");
    if (await commit(log(ready, "Add combatant", summary), summary)) render();
  }

  async function applyDraft() {
    const { battle: next, outcome } = E.apply(working(), draft.actorId, draft.action, draft.targets, draft.input);
    const root = draft.root;
    if (root.slots && draft.slotIndex + 1 < root.slots.length) {
      draft.working = next;
      draft.costs.push(...(outcome.costs ?? []));
      draft.used.push(draft.action.slotGroup ?? draft.action.id);
      draft.slotIndex++;
      openSlot();
      renderWorkflow();
      return;
    }
    if (await commit(next, outcome.summary ?? "Action recorded.", [...draft.costs, ...(outcome.costs ?? [])])) {
      draft = null;
      render();
    }
  }

  async function runClick(command, value) {
    if (!store || busy) return;
    if (command === "details-close") { $("combat-details-dialog").close(); return; }
    if (command === "details-expand") {
      const expanded = $("combat-details-dialog").classList.toggle("is-expanded");
      $("combat-details-expand").setAttribute("aria-pressed", String(expanded));
      renderDetails();
      return;
    }
    if (command === "details") { openDetails(value); return; }
    if (command === "new") {
      if (battle && battle.phase !== "ended" && !confirm("Replace the current combat setup or fight? You can undo this change.")) return;
      if (await commit(newBattle(value), "Combat setup ready.")) { clearEncounterEntry(); setView(true); }
      return;
    }
    if (!battle) return;
    if (command === "stop-sparring" && sparring() && battle.phase !== "ended") {
      const outcome = zh() ? "友谊比试结束。" : "Friendly spar ended.";
      const next = { ...structuredClone(battle), phase: "ended", active: null, outcome };
      if (await commit(log(next, "Sparring ended", outcome), outcome)) setView(true);
      return;
    }
    if (command === "cancel-combat") {
      busy = true;
      historyControls.update();
      try {
        roster = await store.cancelCombat();
        battle = roster.combat;
      } finally {
        busy = false;
        historyControls.update();
      }
      clearEncounterEntry();
      setView(true);
      notify(zh() ? "战斗已取消。可用撤销恢复。" : "Combat canceled. Use Undo to restore it.");
      $("combat-setup").querySelector('[data-cmd="new"]').focus();
      return;
    }
    if (command === "cancel") {
      draft = correction = turnPrompt = pendingAdds = null;
      render();
      return;
    }
    if (command === "select") {
      selected = value;
      draft = correction = turnPrompt = pendingAdds = null;
      render();
      return;
    }
    if (command === "action") {
      const actor = battle.actors.find(entry => entry.id === selected);
      draft = null;
      const action = actions(actor).find(entry => entry.id === value);
      correction = turnPrompt = pendingAdds = null;
      if (action) startAction(actor, action, reason(actor, action));
      return;
    }
    if (command === "slot") {
      const action = slotChoices()[Number(value)];
      if (action) { chooseSlot(action); renderWorkflow(); }
      return;
    }
    if (command === "escape") {
      const actor = battle.actors.find(entry => entry.id === selected);
      const effect = actor.conditions.find(entry => entry.id === value && entry.escape);
      if (!effect) return;
      correction = turnPrompt = pendingAdds = null;
      draft = { stage: "escape", escape: effect, actorId: actor.id, root: {}, working: battle };
      render();
      return;
    }
    if (command === "death-burst") {
      turnPrompt = null;
      startAction(find(value), E.deathBurstAction(battle, value), "");
      return;
    }
    if (command === "dismiss-prompt") {
      if (await commit(E.resolvePrompt(battle, value, [], { dismiss: true }), "Death Burst recorded.")) {
        turnPrompt = null;
        render();
      }
      return;
    }
    if (command === "correct" || command === "prompt") {
      draft = null;
      correction = command === "correct" ? value : null;
      turnPrompt = command === "prompt" ? value : null;
      render();
      return;
    }
    if (command === "back") {
      draft.stage = draft.action.darts || draft.action.options ? "targets" : ["attack", "save", "check", "manual"].includes(draft.action.type) ? "roll" : "damage";
      draft.input = {};
      draft.optionsChosen = draft.wardsChosen = false;
      renderWorkflow();
      return;
    }
    if (command === "reaction" && value.includes("|")) {
      const [targetId, reactorId, actionId] = value.split("|");
      const reaction = { ...actions(find(reactorId)).find(action => action.id === actionId), reactorId };
      draft.input.reactions = { ...draft.input.reactions, [targetId]: reaction };
      draft.stage = "roll";
      renderWorkflow(); return;
    }
    if (command === "reaction") {
      const separator = value.indexOf(":");
      const targetId = value.slice(0, separator);
      const actionId = value.slice(separator + 1);
      draft.input.reactions = { ...draft.input.reactions, [targetId]: actions(find(targetId)).find(action => action.id === actionId) };
      renderWorkflow();
      return;
    }
    if (command === "apply") return applyDraft();
    if (drafting() || correction || turnPrompt || pendingAdds) throw new Error("Finish or cancel the current entry first.");
    draft = null;
    if (command === "initiative" || command === "setup") {
      const next = { ...battle, phase: command === "setup" ? "setup" : "initiative" };
      if (await commit(command === "initiative" ? E.fillEnemyInitiative(next) : next, "")) render();
      return;
    }
    if (command === "advance") {
      const active = find(battle.active);
      if (active && rechargeMoves(active).some(action => E.rechargeDue(active, action))) {
        throw new Error("Record the pending recharge roll before ending this turn.");
      }
      if (await commit(E.advance(battle), "")) setView(true);
      return;
    }
    if (command === "activate") {
      const actor = find(value);
      if (actor?.reserve && actor.inactive) await addEnemies([actor], true);
      return;
    }
    if (command === "remove" || command === "restore") {
      const actor = find(value);
      let next = structuredClone(battle);
      if (battle.phase === "setup") next.actors = next.actors.filter(entry => entry.id !== value);
      else {
        if (next.active === value && next.order.length > 1) next = E.advance(next);
        next = E.correct(next, value, { inactive: command === "remove" });
        // Inactive creatures retain their initiative anchor so sourced effects can expire.
        // They receive no actions; the engine advances through their timing boundaries.
        if (next.active === value) next.active = null;
        if (command === "restore") {
          if (actor.side === "party" && !actor.npc && !actor.object && participants().some(other => other.slot === actor.slot)) {
            throw new Error("That saved character already has an active entry.");
          }
          if (!next.order.includes(value)) next.order.push(value);
          sortOrder(next);
          if (!next.active) next.active = value;
        }
      }
      const message = `${actor.name} ${command === "remove" ? "removed" : "rejoined"}.`;
      if (await commit(log(next, "Participants", message), message)) setView(true);
    }
  }

  function readWards(data) {
    const ids = draft.targets.filter(id => data.has(`ward-${id}`));
    return { sanctuary: { ...draft.input.sanctuary, ...Object.fromEntries(ids.map(id => [id, [formNumber(data, `ward-${id}`), formNumber(data, `ward2-${id}`)].filter(value => value != null)])) },
      wardModes: { ...draft.input.wardModes, ...Object.fromEntries(ids.map(id => [id, data.get(`wardMode-${id}`)])) },
      wardBless: { ...draft.input.wardBless, ...Object.fromEntries(ids.filter(id => data.has(`wardBless-${id}`)).map(id => [id, formNumber(data, `wardBless-${id}`)])) } };
  }

  function readRoll(data) {
    const { action, targets } = draft;
    const modeValues = Object.fromEntries(targets.map(target => [target, data.get(`mode-${target}`)]).filter(([, mode]) => mode !== "auto"));
    const cover = Object.fromEntries(targets.map(target => [target, Number(data.get(`cover-${target}`))]));
    const modifiers = Object.fromEntries(targets.map(target => [target, formNumber(data, `modifier-${target}`) ?? 0]));
    const checkedTargets = prefix => Object.fromEntries(targets.filter(target => data.has(`${prefix}-${target}`)).map(target => [target, true]));
    const close = Object.fromEntries(targets.map(target => [target, data.get(`distance-${target}`)])
      .filter(([, distance]) => distance === "close" || distance === "far").map(([target, distance]) => [target, distance === "close"]));
    const input = { ...draft.input, ...readWards(data), modes: modeValues, cover, modifiers, charged: checkedTargets("charged"),
      packTactics: checkedTargets("pack"), sunlight: checkedTargets("sunlight"), close };
    if (action.type === "attack") {
      input.attack = [formNumber(data, "attack"), formNumber(data, "attack2")].filter(value => value != null);
      if (targets.some(target => E.attackMode(working(), draft.actorId, target, { ...input, action }) !== "normal") && input.attack.length !== 2) {
        throw new Error("Enter the second shared d20 for Advantage or Disadvantage.");
      }
      input.ac = Object.fromEntries(targets.map(target => [target, formNumber(data, `ac-${target}`)]).filter(([, value]) => value != null));
      if (data.has("bless-attack")) input.bless = { attack: Number(data.get("bless-attack")) };
    } else {
      input.saves = Object.fromEntries(targets.map(target => {
        const dice = [formNumber(data, `save-${target}`), formNumber(data, `save2-${target}`)].filter(value => value != null);
        const mode = E.saveMode(working(), draft.actorId, target, { ...input, ability: action.save.ability, action });
        if (dice.length && mode !== "normal" && dice.length !== 2) throw new Error(`Enter the second d20 for ${actorName(find(target))}.`);
        return [target, dice];
      }));
      input.bless = { saves: Object.fromEntries(targets.filter(target => data.has(`bless-${target}`))
        .map(target => [target, Number(data.get(`bless-${target}`))])) };
    }
    return input;
  }

  async function runForm(formElement, event) {
    if (!store || busy || !battle) return;
    const data = new FormData(formElement);
    const kind = formElement.dataset.form;
    if (kind === "enemy" || kind === "character") {
      if (drafting() || correction || turnPrompt || pendingAdds) throw new Error("Finish or cancel the current entry first.");
      draft = null;
      if (kind === "character") {
        const slot = Number(data.get("slot"));
        if (!availableSlots().some(([index]) => index === slot)) return;
        const actor = pc(slot);
        if (battle.phase === "fight") { pendingAdds = actor; render(); return; }
        return addActor(actor);
      }
      const monster = data.get("monster");
      if (!Object.hasOwn(enemyChoices(), monster)) return;
      const group = preparedGroup(monster, Number(data.get("count")), data.has("scale"));
      if (group.length !== 1 || battle.phase !== "fight") return addEnemies(group);
      const [actor] = group;
      const similar = participants().find(entry => entry.monster === monster && entry.roll);
      const roll = battle.initiativeMode === "group" && similar ? { ...similar.roll }
        : { dice: [Math.floor(Math.random() * 20) + 1], mode: "normal", source: "automatic" };
      if (battle.phase === "fight") {
        pendingAdds = { ...actor, roll };
        renderWorkflow();
        historyControls.update();
        return;
      }
      return addActor(actor, roll);
    }
    if (kind === "companion") {
      if (drafting() || correction || turnPrompt || pendingAdds) throw new Error("Finish or cancel the current entry first.");
      const monster = data.get("monster"), card = catalog[monster];
      if (!card) throw new Error("Choose a reviewed creature card.");
      const actor = enemy(monster, 4, card.hp, 1, { printed: true, name: data.get("name").trim() || [card.name, card.zh || card.name] });
      actor.side = "party"; actor.npc = true; actor.companionId = actor.id;
      actor.active = true; actor.remainingFights = data.get("duration") === "one" ? 1 : null;
      actor.roll = { dice: [Math.floor(Math.random() * 20) + 1], mode: "normal", source: "automatic" };
      if (battle.phase === "fight") { pendingAdds = actor; render(); return; }
      return addActor(actor);
    }
    if (kind === "join") {
      const first = formNumber(data, "die"), second = formNumber(data, "extra"), override = formNumber(data, "total");
      const dice = [first, second].filter(value => value != null);
      const mode = data.get("mode");
      const prior = pendingAdds.roll;
      const source = prior?.source === "automatic" && prior.mode === mode && prior.dice.join() === dice.join()
        && prior.override === override ? "automatic" : "manual";
      const roll = { dice, mode, override, source };
      if (E.initiativeTotal({ ...pendingAdds, roll }) == null) throw new Error("Enter a complete initiative roll or total override.");
      if (pendingAdds.side === "enemy" && battle.initiativeMode === "group" && source === "manual") {
        pendingAdds.initiativeGroup = `solo-${pendingAdds.id}`;
      }
      return addActor(pendingAdds, roll);
    }
    if (kind === "initiative") {
      const intent = event.submitter?.value ?? "save";
      const edited = readInitiative(formElement);
      if (intent === "roll") {
        for (const actor of edited.actors) {
          if (actor.side === "enemy" && actor.roll?.source !== "manual") actor.roll = { dice: [], mode: actor.roll?.mode ?? "normal" };
        }
      }
      const next = E.fillEnemyInitiative(edited);
      if (intent === "swap") {
        const first = next.actors.find(actor => actor.id === data.get("swapFrom"));
        const second = next.actors.find(actor => actor.id === data.get("swapTo"));
        if (first.id === second.id) throw new Error("Choose two different characters.");
        const a = E.initiativeTotal(first), b = E.initiativeTotal(second);
        if (a == null || b == null) throw new Error("Enter both characters’ initiative before swapping.");
        first.roll = { ...first.roll, override: b };
        second.roll = { ...second.roll, override: a };
        const message = `${first.name} and ${second.name} swapped initiative (${a} ↔ ${b}).`;
        if (await commit(log(next, "Initiative swap", message), message)) render();
        return;
      }
      if (intent === "start") {
        if (next.actors.some(actor => !actor.inactive && !bound(actor))) throw new Error("A character sheet changed. Remove and re-add that character first.");
        if (await commit(E.start(next), "")) setView(true);
      } else if (await commit(next, "Initiative rolls saved.")) render();
      return;
    }
    if (kind === "second-wind-check") {
      for (const key of ["previousCheckTotal", "checkDC", "windRoll"]) draft.input[key] = formNumber(data, key);
      draft.preview = E.preview(working(), draft.actorId, draft.action, draft.targets, draft.input);
      if (!draft.preview.complete) throw new Error(draft.preview.warnings[0] ?? "Enter a failed check total, DC and d10.");
      draft.stage = "preview"; renderWorkflow(); return;
    }
    if (["spell-options", "wards", "kit", "check"].includes(kind)) {
      if (kind === "spell-options") {
        for (const key of Object.keys(draft.action.options ?? {})) draft.input[key] = data.get(`option-${key}`);
        draft.optionsChosen = true; draft.stage = "targets";
      } else if (kind === "wards") { Object.assign(draft.input, readWards(data)); draft.wardsChosen = true; draft.stage = "damage"; }
      else if (kind === "kit") { draft.input.kitRoll = formNumber(data, "kitRoll"); draft.stage = "damage"; }
      else { draft.input.checkRolls = [formNumber(data, "check"), formNumber(data, "check2")].filter(value => value != null); draft.input.checkMode = data.get("checkMode"); draft.input.guidance = formNumber(data, "guidance"); draft.stage = "damage"; }
      renderWorkflow(); return;
    }
    if (kind === "targets") {
      const targets = data.getAll("target");
      if (!targets.length) throw new Error("Select at least one target.");
      draft.targets = targets;
      for (const key of Object.keys(draft.action.options ?? {})) draft.input[key] = data.get(`option-${key}`);
      if (draft.action.darts) {
        draft.input.allocations = Object.fromEntries(targets.map(id => [id, formNumber(data, `darts-${id}`) ?? 0]));
        if (Object.values(draft.input.allocations).reduce((a, b) => a + b, 0) !== draft.action.darts) throw new Error(`Allocate exactly ${draft.action.darts} darts among selected targets.`);
      }
      draft.stage = "roll";
      renderWorkflow();
      return;
    }
    if (kind === "roll") {
      draft.input = readRoll(data);
      draft.stage = "damage";
      renderWorkflow();
      return;
    }
    if (kind === "damage") {
      const dice = draft.preview.dice ?? draft.action.dice ?? [];
      draft.input.damage = dice.map((_, index) => data.getAll(`damage-${index}`).map(Number));
      if (draft.preview.needsCritical) draft.input.critical = dice.map((_, index) => data.getAll(`critical-${index}`).map(Number));
      draft.input.knockout = (sparring() && draft.action.melee === true) || data.has("knockout");
      draft.input.damageTypeRoll = formNumber(data, "damageType");
      draft.preview = E.preview(working(), draft.actorId, draft.action, draft.targets, draft.input);
      if (!draft.preview.complete) throw new Error("Enter all required dice.");
      draft.stage = "preview";
      renderWorkflow();
      return;
    }
    if (kind === "fortitude") {
      const checks = draft.preview.fortitude.filter(check => check.success == null);
      draft.input.fortitude = Object.fromEntries(checks.map(({ actorId }) => [actorId,
        [formNumber(data, `fortitude-${actorId}`), formNumber(data, `fortitude2-${actorId}`)].filter(value => value != null)]));
      draft.input.fortitudeBless = Object.fromEntries(checks.filter(({ actorId }) => data.has(`fortitudeBless-${actorId}`))
        .map(({ actorId }) => [actorId, formNumber(data, `fortitudeBless-${actorId}`)]));
      draft.preview = E.preview(working(), draft.actorId, draft.action, draft.targets, draft.input);
      renderWorkflow();
      return;
    }
    if (kind === "manual") {
      draft.input.note = data.get("note");
      draft.preview = E.preview(working(), draft.actorId, draft.action, draft.targets, draft.input);
      if (!draft.preview.complete) throw new Error(draft.preview.warnings[0] ?? "This action is unavailable.");
      draft.stage = "preview";
      renderWorkflow();
      return;
    }
    if (kind === "correction") {
      const change = Object.fromEntries(["hp", "maxHp", "tempHp", "ac", "speed"].map(key => [key, formNumber(data, key)]));
      if (change.hp > change.maxHp) throw new Error("Current HP cannot exceed maximum HP.");
      change.damage = formNumber(data, "damage");
      change.heal = formNumber(data, "heal");
      const exhaustionLevels = formNumber(data, "exhaustionLevels");
      if (exhaustionLevels != null) change.exhaustionLevels = exhaustionLevels;
      if (change.damage != null && change.heal != null) throw new Error("Apply damage and healing separately.");
      const label = data.get("condition").trim();
      const effectNumbers = { ac: formNumber(data, "effectAC"), speed: formNumber(data, "effectSpeed"), attackBonus: formNumber(data, "effectAttack"), saveBonus: formNumber(data, "effectSave"), abilityBonus: formNumber(data, "effectAbility") };
      if (!label && Object.values(effectNumbers).some(value => value != null && value !== 0)) throw new Error("Enter a name for the temporary stat effect.");
      if (label) change.addCondition = { name: label, ...effectNumbers,
        ...(data.get("effectExpiry") !== "none" ? { expiry: data.get("effectExpiry"), rounds: formNumber(data, "effectRounds"), sourceId: data.get("effectSource") } : {}) };
      if (data.get("removeCondition")) change.removeCondition = data.get("removeCondition");
      const life = data.get("life");
      if (life === "stable" || life === "dying" || life === "dead") change.hp = 0;
      if (life) {
        change.dead = life === "dead";
        if (life !== "dead") change.stable = life === "stable";
      }
      if (life === "conscious" && change.hp === 0) throw new Error("Enter positive HP to mark this character conscious.");
      change.note = data.get("note");
      change.endConcentration = data.has("endConcentration");
      const next = E.correct(battle, correction, change);
      const total = formNumber(data, "total");
      const actor = next.actors.find(entry => entry.id === correction);
      if (total != null && total !== E.initiativeTotal(actor)) {
        actor.roll = { ...actor.roll, override: total };
        sortOrder(next);
        log(next, "Initiative adjustment", `${actor.name}: initiative set to ${total}.`);
      }
      if (await commit(next, "Adjustment saved.")) { correction = null; render(); }
      return;
    }
    if (kind === "prompt") {
      const prompt = promptEntries().find(entry => entry.key === turnPrompt);
      if (!prompt) return;
      const { actorId } = prompt;
      const die = Number(data.get("die"));
      const second = formNumber(data, "extra");
      const rolls = second == null ? [die] : [die, second];
      let next;
      if (prompt.kind === "death") next = E.deathSave(battle, actorId, rolls, data.get("mode") ?? undefined, formNumber(data, "bless"));
      else if (prompt.kind === "recharge") next = E.recharge(battle, actorId, prompt.action, die);
      else if (prompt.kind === "concentration") next = E.concentrationSave(battle, actorId, rolls, data.get("mode"), formNumber(data, "bless"));
      else next = E.resolvePrompt(battle, prompt.id, prompt.kind === "effect-damage"
        ? prompt.dice.map((_, index) => data.getAll(`effect-${index}`).map(Number)) : rolls,
        { mode: data.get("mode") ?? undefined, bless: formNumber(data, "bless") });
      if (await commit(next, "Roll recorded.")) { turnPrompt = null; render(); }
      return;
    }
    if (kind === "escape") {
      const second = formNumber(data, "extra");
      const rolls = [Number(data.get("die")), second].filter(value => value != null);
      const next = E.escapeEffect(battle, draft.actorId, draft.escape.id, rolls,
        { mode: data.get("mode"), modifier: formNumber(data, "modifier") });
      if (await commit(next, "Escape check recorded.")) { draft = null; render(); }
      return;
    }
    if (kind === "end") {
      if (drafting() || correction || turnPrompt || pendingAdds) throw new Error("Finish or cancel the current entry first.");
      draft = null;
      const next = structuredClone(battle);
      const result = data.get("result");
      if (result === "Bandit ambush defeat") {
        const fallen = next.actors.filter(actor => actor.side === "party" && !actor.npc && !actor.inactive);
        if (!fallen.length || fallen.some(actor => actor.hp > 0 || !actor.death?.stable || !bound(actor))) {
          throw new Error("The printed ambush defeat applies when every participating character is stable at 0 HP.");
        }
        if (!confirm("Record the printed defeat? The party wakes one hour later at 1 HP and each character loses up to 10 GP.")) return;
        for (const actor of fallen) {
          actor.hp = 1;
          actor.gold = Math.max(0, character(actor).gold - 10);
          actor.death = { successes: 0, failures: 0, stable: false, dead: false };
          actor.conditions = actor.conditions.filter(effect => effect.key !== "unconscious");
        }
      }
      next.phase = "ended";
      next.outcome = result === "Bandit ambush defeat" ? "The party wakes one hour later at 1 HP. Each loses up to 10 GP." : result;
      next.active = null;
      if (await commit(log(next, "Combat ended", next.outcome), "Combat ended. Character HP and resources are saved.")) setView(true);
    }
  }

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-cmd]");
    if (target) runClick(target.dataset.cmd, target.dataset.value).catch(error => notify(error.message, true));
  });
  document.addEventListener("submit", event => {
    if (!event.target.matches("[data-form]")) return;
    event.preventDefault();
    runForm(event.target, event).catch(error => notify(error.message, true));
  });
  $("combat-initiative").addEventListener("input", event => {
    const formElement = event.target.closest("form");
    if (!formElement) return;
    const next = readInitiative(formElement);
    for (const actor of next.actors) {
      const cell = formElement.querySelector(`[data-init-total="${actor.id}"]`);
      if (cell) {
        try { cell.textContent = E.initiativeTotal(actor) ?? "—"; }
        catch { cell.textContent = "—"; }
      }
    }
  });
  for (const [element, value] of [["lang-en", "en"], ["lang-zh", "zh-Hans"]]) {
    $(element).addEventListener("click", () => {
      if (drafting() || correction || turnPrompt || pendingAdds) return;
      language = value;
      localStorage.setItem(languageKey, language);
      if (store) render();
    });
  }

  Promise.all([borderlandsStorage.load(), fetch("/api/adventure/creatures", { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("Restart the Borderlands launcher to load the monster library.");
    return response.json();
  })]).then(async ([result, cards]) => {
    const defenses = { ...globalThis.combatOrdinaryDefenses, ...globalThis.combatFixedDefenses };
    const names = { ...globalThis.combatOrdinaryNames, ...globalThis.combatFixedNames };
    catalog = Object.fromEntries(Object.entries(cards).map(([slug, card]) =>
      [slug, { ...card, zh: C.enemies[slug]?.zh ?? names[slug], defenses: defenses[slug] ?? {} }]));
    store = result;
    roster = borderlandsSession.ensure(store.roster);
    battle = roster.combat;
    if (offerEncounter && (!battle || battle.phase === "ended")) {
      if (await commit(newBattle(incoming ? "encounter" : "ambush"), "Encounter loaded.")) clearEncounterEntry();
    } else if (fromAmbush && battle?.source === "ambush" || incoming && battle?.back === incoming.back) {
      clearEncounterEntry();
      notify(result.notice);
    } else notify(result.notice);
    setView(true);
  }).catch(error => notify(error.message, true));
})();
