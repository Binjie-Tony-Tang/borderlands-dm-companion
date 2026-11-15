(() => {
  "use strict";
  const clone = value => structuredClone(value);
  const emptyDeath = () => ({ successes: 0, failures: 0, stable: false, dead: false });
  const keyOf = effect => effect.key || String(effect.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const identity = choice => [choice?.name, choice?.classId, choice?.backgroundId, choice?.speciesId].join("\u0000");
  const uid = () => `character-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const stateFields = ["id", "conditions", "death", "uses", "turns", "concentration", "pendingConcentration", "baseMaxHp"];
  const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  function maxHpBonus(state) {
    const bonuses = new Map();
    for (const effect of state?.conditions || []) if (Number.isSafeInteger(effect.maxHp)) {
      const key = keyOf(effect);
      if (!bonuses.has(key) || Math.abs(effect.maxHp) >= Math.abs(bonuses.get(key))) bonuses.set(key, effect.maxHp);
    }
    return [...bonuses.values()].reduce((total, value) => total + value, 0);
  }

  function checkedState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !stateFields.includes(key))
      || typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)
      || !Array.isArray(value.conditions) || value.conditions.some(effect => !effect || typeof effect !== "object" || Array.isArray(effect))
      || !value.death || typeof value.death !== "object" || Array.isArray(value.death)
      || !value.uses || typeof value.uses !== "object" || Array.isArray(value.uses)
      || !integer(value.turns, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Invalid saved character condition state.");
    return clone(value);
  }

  function ensure(roster, { migrateLegacy = true } = {}) {
    const next = clone(roster);
    next.session ??= { elapsedSeconds: 0, companions: [] };
    next.session.elapsedSeconds ??= 0;
    next.session.companions ??= [];
    for (const [slot, choice] of next.slots.entries()) {
      if (!choice) continue;
      const original = JSON.stringify(choice);
      let legacy = migrateLegacy ? next.combat?.actors.find(actor => actor.side === "party" && !actor.npc && actor.slot === slot
        && (() => { try { return identity(JSON.parse(actor.binding)) === identity(choice); } catch { return false; } })()) : null;
      choice.sheet ??= {};
      if (!choice.sheet.state) {
        choice.sheet.state = { id: legacy?.id || uid(), conditions: clone(legacy?.conditions || []),
          death: { ...emptyDeath(), ...clone(legacy?.death || {}) }, uses: clone(legacy?.uses || {}), turns: legacy?.turns || 0,
          ...(legacy?.concentration ? { concentration: legacy.concentration } : {}) };
        // Positive HP after an old Temple revival must not inherit a stale dead flag.
        if ((choice.sheet.stats?.currentHp ?? legacy?.hp ?? 1) > 0 && choice.sheet.state.death.dead) {
          choice.sheet.state.death = emptyDeath();
          choice.sheet.state.conditions = choice.sheet.state.conditions.filter(effect => keyOf(effect) !== "unconscious");
        }
      }
      if (choice.sheet.state.conditions.some(effect => keyOf(effect) === "mage-armor")
        && globalThis.borderlandsCharacter?.derive(choice).equipped.armor) {
        choice.sheet.state.conditions = choice.sheet.state.conditions.filter(effect => keyOf(effect) !== "mage-armor");
      }
      if (legacy && (legacy.binding === original || next.combat.phase === "ended")) {
        legacy.binding = JSON.stringify(choice);
        if (next.combat.phase === "ended") {
          legacy.death = clone(choice.sheet.state.death);
          legacy.conditions = clone(choice.sheet.state.conditions);
          if (Number.isSafeInteger(choice.sheet.stats?.currentHp)) legacy.hp = choice.sheet.stats.currentHp;
        }
      }
    }
    return next;
  }

  function actorFor(roster, slot) {
    const choice = roster.slots[slot];
    if (!choice) throw new Error("Choose a saved character.");
    const character = borderlandsCharacter.derive(choice);
    const saved = choice.sheet?.state || { id: uid(), conditions: [], death: emptyDeath(), uses: {}, turns: 0 };
    return { id: saved.id, side: "party", slot, name: choice.name || character.job.en,
      zh: choice.name || character.job.zh, binding: JSON.stringify(choice), scalePlayers: roster.playerCount,
      hp: character.currentHp, maxHp: character.hp, baseMaxHp: character.baseHp ?? character.hp, tempHp: character.tempHp, ac: character.ac,
      initiative: character.initiative, saves: clone(character.saves), skills: clone(character.skills), abilities: clone(character.abilities),
      speed: character.speed, movement: { walk: character.speed, ...(character.classFeatures?.climbSpeed ? { climb: character.classFeatures.climbSpeed } : {}) }, kind: "Humanoid",
      classFeatures: clone(character.classFeatures || {}),
      subclassId: character.subclassId || "",
      size: ["halfling", "gnome"].includes(choice.speciesId) ? "Small" : "Medium",
      armorEquipped: Boolean(character.equipped.armor), species: choice.speciesId,
      castingAbility: character.castingAbility || ({ cleric: "WIS", wizard: "INT" }[choice.classId]),
      spellAttackBonus: character.attacks.find(entry => entry.spell)?.bonus ?? character.attacks.find(entry => entry.en === "Spell attack")?.bonus,
      defenses: { resistance: choice.speciesId === "dwarf" ? ["Poison"] : [] },
      conditions: clone(saved.conditions), death: clone(saved.death), uses: clone(saved.uses), turns: saved.turns,
      ...(saved.pendingConcentration?.length ? { pendingConcentration: clone(saved.pendingConcentration) } : {}),
      ...(saved.concentration ? { concentration: saved.concentration } : {}), recharge: {}, roll: null };
  }

  function remainingSeconds(effect, battle) {
    const expiry = effect.expires;
    if (!expiry) return integer(effect.durationSeconds, 0, Number.MAX_SAFE_INTEGER) ? effect.durationSeconds : null;
    if (expiry.phase === "round-start") return Math.max(1, expiry.round - battle.round) * 6;
    const anchor = battle.actors.find(actor => actor.id === expiry.actorId);
    return Math.max(1, expiry.turn - (anchor?.turns || 0)) * 6;
  }

  function capture(roster, battle) {
    const next = ensure(roster, { migrateLegacy: false });
    next.session.pending = clone(battle.pending || []).filter(prompt => battle.actors.some(actor => actor.id === prompt.actorId && actor.side === "party"));
    const elapsed = next.session.elapsedSeconds;
    for (const actor of battle.actors) {
      const conditions = clone(actor.conditions || []).map(effect => {
        const seconds = remainingSeconds(effect, battle);
        if (seconds !== null && (effect.expiresAtSeconds === undefined || effect.expiresAtSeconds <= elapsed && effect.expires)) effect.expiresAtSeconds = elapsed + seconds;
        return effect;
      });
      actor.conditions = clone(conditions);
      if (actor.npc && actor.companionId) {
        const companion = next.session.companions.find(entry => entry.id === actor.companionId);
        if (companion) Object.assign(companion, { hp: actor.hp, maxHp: actor.maxHp, baseMaxHp: actor.baseMaxHp ?? companion.baseMaxHp ?? companion.maxHp, tempHp: actor.tempHp, conditions,
          ac: actor.ac, initiative: actor.initiative, ...(actor.speed !== undefined ? { speed: clone(actor.speed) } : {}),
          ...(actor.movement ? { movement: clone(actor.movement) } : {}),
          death: clone(actor.death || emptyDeath()), uses: clone(actor.uses || {}), turns: actor.turns || 0, recharge: clone(actor.recharge || {}),
          ...(actor.concentration ? { concentration: actor.concentration } : {}) });
        if (companion) {
          if (!actor.concentration) delete companion.concentration;
          if (actor.pendingConcentration?.length) companion.pendingConcentration = clone(actor.pendingConcentration);
          else delete companion.pendingConcentration;
        }
        continue;
      }
      if (actor.side !== "party" || actor.slot === undefined || !next.slots[actor.slot]) continue;
      const choice = next.slots[actor.slot];
      if (choice.sheet?.state?.id !== actor.id) continue;
      if (actor.inactive && actor.binding !== JSON.stringify(choice)) continue;
      choice.sheet ??= {};
      choice.sheet.stats = { ...choice.sheet.stats, currentHp: actor.hp, tempHp: actor.tempHp || 0 };
      if (actor.baseMaxHp !== undefined && choice.sheet.stats.maxHp !== undefined) choice.sheet.stats.maxHp = actor.baseMaxHp;
      choice.sheet.state = { id: actor.id, conditions, death: clone(actor.death || emptyDeath()), uses: clone(actor.uses || {}),
        turns: actor.turns || 0, ...(actor.concentration ? { concentration: actor.concentration } : {}),
        ...(actor.pendingConcentration?.length ? { pendingConcentration: clone(actor.pendingConcentration) } : {}) };
      actor.binding = JSON.stringify(choice);
    }
    return next;
  }

  function syncBattle(roster) {
    if (!roster.combat) return roster;
    for (const actor of roster.combat.actors) {
      if (actor.npc) {
        const companion = roster.session?.companions.find(entry => entry.id === actor.companionId);
        if (companion) {
          for (const field of ["hp", "maxHp", "baseMaxHp", "tempHp", "conditions", "death", "uses", "turns", "recharge"]) {
            if (companion[field] !== undefined) actor[field] = clone(companion[field]);
          }
          if (companion.concentration) actor.concentration = companion.concentration;
          else delete actor.concentration;
          if (companion.pendingConcentration?.length) actor.pendingConcentration = clone(companion.pendingConcentration);
          else delete actor.pendingConcentration;
        }
        continue;
      }
      const choice = actor.side === "party" && !actor.npc ? roster.slots[actor.slot] : null;
      if (!choice?.sheet?.state || choice.sheet.state.id !== actor.id) continue;
      const derived = borderlandsCharacter.derive(choice);
      const fresh = actorFor(roster, actor.slot);
      for (const field of ["hp", "maxHp", "baseMaxHp", "tempHp", "ac", "initiative", "abilities", "saves", "skills", "speed", "movement", "armorEquipped", "castingAbility", "spellAttackBonus", "classFeatures", "subclassId"]) {
        if (fresh[field] !== undefined) actor[field] = clone(fresh[field]);
      }
      actor.conditions = clone(choice.sheet.state.conditions); actor.death = clone(choice.sheet.state.death);
      actor.uses = clone(choice.sheet.state.uses); actor.binding = JSON.stringify(choice);
      if (choice.sheet.state.concentration) actor.concentration = choice.sheet.state.concentration;
      else delete actor.concentration;
    }
    return roster;
  }

  function advanceTime(roster, seconds) {
    if (!integer(seconds, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Enter a valid elapsed time.");
    const next = ensure(roster);
    const states = [...next.slots.filter(Boolean).map(choice => choice.sheet.state), ...next.session.companions];
    if (seconds && (next.session.pending?.length || states.some(state => state.pendingConcentration?.length))) throw new Error("Resolve pending rolls on Party actions before advancing time or resting.");
    if (states.some(state => state.conditions.some(effect => effect.tick?.once && (effect.expiresAtSeconds ?? next.session.elapsedSeconds + 6) <= next.session.elapsedSeconds + seconds))) {
      throw new Error("Resolve pending ongoing damage on Party actions before advancing time or resting.");
    }
    next.session.elapsedSeconds += seconds;
    for (const saved of states) {
      saved.conditions = (saved.conditions || []).filter(effect => effect.expiresAtSeconds === undefined || effect.expiresAtSeconds > next.session.elapsedSeconds);
      if (saved.monster && globalThis.combatEngine) combatEngine.refreshMaxHp(saved);
    }
    for (const saved of states) if (saved.concentration && !states.some(target => target.conditions.some(effect => effect.concentration === saved.concentration))) {
      delete saved.concentration;
      delete saved.pendingConcentration;
    }
    return syncBattle(next);
  }

  function rebaseEffects(actors, elapsedSeconds) {
    for (const actor of actors) {
      actor.conditions = (actor.conditions || []).filter(effect => effect.expiresAtSeconds === undefined || effect.expiresAtSeconds > elapsedSeconds || effect.tick?.once);
      for (const effect of actor.conditions) {
        const remaining = effect.expiresAtSeconds === undefined ? null : Math.max(1, Math.ceil((effect.expiresAtSeconds - elapsedSeconds) / 6));
        if (!effect.expires && remaining !== null) effect.expires = { phase: "round-start", round: 1 + remaining };
        if (!effect.expires) continue;
        const anchor = actors.find(entry => entry.id === effect.expires.actorId);
        if (effect.expires.phase === "round-start" || !anchor) effect.expires = { phase: "round-start", round: 1 + (remaining ?? 1) };
        else if (remaining !== null) effect.expires.turn = (anchor.turns || 0) + remaining;
      }
      globalThis.combatEngine?.refreshMaxHp(actor);
    }
  }

  function reconcile(roster, { revivedSlots = [] } = {}) {
    const next = ensure(roster);
    for (const [slot, choice] of next.slots.entries()) {
      if (!choice) continue;
      const state = choice.sheet.state;
      const hp = borderlandsCharacter.derive(choice).currentHp;
      if (revivedSlots.includes(slot)) state.death = emptyDeath();
      if (hp > 0 && !state.death.dead) {
        const wasDown = state.conditions.some(effect => effect.id === "unconscious" || effect.id === "knockout");
        state.death = emptyDeath();
        state.conditions = state.conditions.filter(effect => effect.id !== "unconscious" && effect.id !== "knockout");
        if (wasDown && !state.conditions.some(effect => keyOf(effect) === "prone")) state.conditions.push({ id: "prone", key: "prone", name: "Prone", zh: "倒地" });
      }
    }
    return syncBattle(next);
  }

  function companionActor(companion, players = 4) {
    return { ...clone(companion), id: companion.id, companionId: companion.id, side: "party", npc: true,
      scalePlayers: 4, profile: "context", printed: true, conditions: clone(companion.conditions || []),
      death: clone(companion.death || emptyDeath()), uses: clone(companion.uses || {}), recharge: clone(companion.recharge || {}), roll: null };
  }

  function addCompanion(roster, spec) {
    const next = ensure(roster);
    const companion = { ...clone(spec), id: spec.id || `companion-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
      active: true, conditions: clone(spec.conditions || []), death: clone(spec.death || emptyDeath()), uses: {}, turns: 0,
      baseMaxHp: spec.baseMaxHp ?? spec.maxHp,
      tempHp: spec.tempHp || 0, recharge: {}, remainingFights: spec.remainingFights ?? null };
    next.session.companions.push(companion);
    const mapMatch = next.combat?.back?.match(/[?&]map=([^&]+)/);
    const combatMap = mapMatch ? decodeURIComponent(mapMatch[1]) : null;
    if (next.combat && next.combat.phase !== "ended" && companionEligible(companion, combatMap) && !next.combat.actors.some(actor => actor.id === companion.id)) {
      if (next.combat.actors.length >= 96) throw new Error("This combat has reached its participant limit.");
      const actor = companionActor(companion);
      next.combat.actors.push(actor);
      if (globalThis.combatEngine) next.combat = combatEngine.fillEnemyInitiative(next.combat);
      if (next.combat.phase === "fight") {
        next.combat.order.push(actor.id);
        next.combat.order.sort((a, b) => combatEngine.initiativeTotal(next.combat.actors.find(entry => entry.id === b)) - combatEngine.initiativeTotal(next.combat.actors.find(entry => entry.id === a)));
      }
    }
    return next;
  }

  function companionEligible(companion, map) {
    if (!companion.active || companion.serviceEnded || companion.death?.dead || companion.excludedMaps?.includes(map)) return false;
    if (!map || !companion.scope) return true;
    if (companion.scope === "wilderness") return ["wilderness", "trail", "woods", "fens", "tamarack-stand"].includes(map);
    if (companion.scope === "caves") return map === "caves-of-chaos" || map.startsWith("cave-");
    return companion.scope === map;
  }

  function partyBattle(roster, { actorSlot = null, environmentId = "environment" } = {}) {
    const prepared = ensure(roster);
    const actors = prepared.slots.flatMap((choice, slot) => choice ? [actorFor(prepared, slot)] : []);
    actors.push(...prepared.session.companions.filter(entry => companionEligible(entry, null)).map(entry => companionActor(entry, prepared.playerCount)));
    let active = actorSlot === null ? environmentId : actors.find(actor => actor.slot === actorSlot)?.id;
    if (actorSlot === null) actors.push({ id: active, side: "enemy", name: "Environment", hp: 1, maxHp: 1, tempHp: 0,
      ac: 0, initiative: 0, abilities: {}, saves: {}, conditions: [], recharge: {}, turns: 0 });
    if (!active) throw new Error("Choose the acting character.");
    return { phase: "fight", source: "manual", title: "Adventure action", scalePlayers: prepared.playerCount,
      round: 0, initiativeMode: "individual", actors, order: actors.map(actor => actor.id), active, log: [], pending: clone(prepared.session.pending || []) };
  }

  function resolve(roster, { action, actorSlot = null, actorId = null, targetSlots = [], targetIds = [], input = {}, title = "Adventure action", previewOnly = false, environmentId = "environment" }) {
    const next = ensure(roster);
    const activeFight = next.combat?.phase === "fight";
    if (activeFight && next.combat.actors.some(actor => actor.side === "party" && !actor.npc && !actor.object && !actor.inactive
      && actor.binding !== JSON.stringify(next.slots[actor.slot]))) throw new Error("A character sheet changed outside combat. Replace that character's Combat entry before resolving this action.");
    const previousActive = activeFight ? next.combat.active : null;
    const battle = activeFight ? clone(next.combat) : partyBattle(next, { actorSlot, environmentId });
    if (activeFight && actorSlot !== null) throw new Error("Use the Combat action workflow while a fight is active.");
    if (activeFight && !battle.actors.some(actor => actor.id === environmentId)) battle.actors.push({
      id: environmentId, side: "enemy", name: "Environment", hp: 1, maxHp: 1, tempHp: 0, ac: 0,
      initiative: 0, abilities: {}, saves: {}, conditions: [], recharge: {}, turns: 0 });
    if (activeFight) battle.active = environmentId;
    if (actorId) battle.active = actorId;
    const targets = battle.actors.filter(actor => targetIds.includes(actor.id) || targetSlots.includes(actor.slot)).map(actor => actor.id);
    const translatedInput = clone(input);
    for (const field of ["saves", "modes", "modifiers", "cover", "damageByTarget", "allocations"]) {
      if (!translatedInput[field]) continue;
      translatedInput[field] = Object.fromEntries(Object.entries(translatedInput[field]).map(([key, value]) =>
        [battle.actors.find(actor => String(actor.slot) === key)?.id || key, value]));
    }
    const move = { ...clone(action), timing: "free" };
    if (battle.active === environmentId) move.effects = (move.effects || []).map(effect => effect.durationSeconds && !effect.expiry
      ? { ...effect, expiry: "round-start", rounds: Math.ceil(effect.durationSeconds / 6) } : effect);
    const preview = combatEngine.preview(battle, battle.active, move, targets, translatedInput);
    if (previewOnly || !preview.complete) return { roster: next, preview, battle, costs: [] };
    const result = combatEngine.apply(battle, battle.active, move, targets, translatedInput);
    const costs = result.outcome.costs || [];
    for (const cost of costs) {
      const actor = result.battle.actors.find(entry => entry.id === cost.id);
      const choice = next.slots[actor?.slot];
      if (!choice) continue;
      const derived = borderlandsCharacter.derive(choice);
      choice.sheet ??= {};
      if (cost.power) choice.sheet.power = { ...choice.sheet.power, [cost.power]: (derived.powers.find(power => power.id === cost.power)?.remaining || 0) - 1 };
      if (cost.item) {
        choice.sheet.inventory = { ...derived.inventory };
        if (--choice.sheet.inventory[cost.item] <= 0) delete choice.sheet.inventory[cost.item];
      }
    }
    const captured = capture(next, result.battle);
    if (activeFight) {
      result.battle.actors = result.battle.actors.filter(actor => actor.id !== environmentId);
      result.battle.order = result.battle.order.filter(id => id !== environmentId);
      result.battle.active = previousActive;
      captured.combat = result.battle;
    }
    if (captured.adventure) captured.adventure.log.push(`${title}: ${result.outcome.summary || preview.summary}`);
    if (captured.keep) captured.keep.log.push(`${title}: ${result.outcome.summary || preview.summary}`);
    return { roster: reconcile(captured), preview, battle: result.battle, costs };
  }

  globalThis.borderlandsSession = { checkedState, maxHpBonus, ensure, actorFor, capture, syncBattle, reconcile, advanceTime,
    rebaseEffects, addCompanion, companionActor, companionEligible, partyBattle, resolve, isDead: (roster, slot) => Boolean(ensure(roster).slots[slot]?.sheet.state.death.dead) };
})();
