(() => {
  "use strict";

  const modes = ["normal", "advantage", "disadvantage"];
  const neverActs = actor => actor.inactive || actor.object || actor.death?.dead;
  const copy = value => structuredClone(value);
  const actionProvider = () => globalThis.borderlandsCombatActions ?? globalThis.combatActions;
  const fail = message => { throw new Error(message); };
  const sum = values => values.reduce((total, value) => total + value, 0);
  const emptyDeath = () => ({ successes: 0, failures: 0, stable: false, dead: false });
  const canUseBless = actor => has(actor, "bless");

  function find(battle, id) {
    return battle.actors.find(actor => actor.id === id) ?? fail("Choose a combatant.");
  }

  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      fail(`${label} must be a whole number from ${min} to ${max}.`);
    }
    return value;
  }

  function die(value, sides) {
    return integer(value, 1, sides, `d${sides}`);
  }

  function checkedMode(mode) {
    if (!modes.includes(mode)) fail("Choose normal, Advantage, or Disadvantage.");
    return mode;
  }

  function chosenDie(dice, mode) {
    if (!dice?.length) return null;
    const [first, second] = dice.map(face => face === null || face === "" || face === undefined ? null : die(face, 20));
    if (first === null) return null;
    if (mode === "normal") return first;
    if (second == null) return null;
    return mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
  }

  function initiativeTotal(actor) {
    const roll = actor.roll;
    if (!roll) return null;
    if (roll.override != null) return integer(roll.override, -999, 999, "Initiative total");
    const face = chosenDie(roll.dice, checkedMode(roll.mode ?? "normal"));
    return face === null ? null : face + (roll.resolvedModifier ?? currentStats(actor).initiative);
  }

  function initiativeGroup(battle, actor) {
    if (battle.initiativeMode !== "group" || actor.side !== "enemy" || actor.object) return null;
    return actor.initiativeGroup ?? actor.monster ?? null;
  }

  function initiativeMode(actor) {
    return combineMode(has(actor, "invisible") || actor.classFeatures?.initiativeAdvantage, incapacitated(actor) || rollDisadvantage(actor, "initiative"));
  }

  function setInitiative(battle, id, roll, { split = false } = {}) {
    const next = copy(battle);
    const actor = find(next, id);
    if (split) actor.initiativeGroup = `solo-${id}`;
    const group = initiativeGroup(next, actor);
    for (const member of next.actors) {
      if (member !== actor && (!group || initiativeGroup(next, member) !== group)) continue;
      const rank = member.roll?.rank;
      member.roll = roll == null ? null : member === actor ? copy(roll) : { ...copy(roll), ...(rank == null ? {} : { rank }) };
      initiativeTotal(member);
    }
    return next;
  }

  function fillEnemyInitiative(battle, random = Math.random) {
    const next = copy(battle);
    const groups = new Map();
    for (const actor of next.actors) {
      const group = initiativeGroup(next, actor);
      if (group && actor.roll && initiativeTotal(actor) !== null) groups.set(group, actor.roll);
    }
    for (const actor of next.actors) {
      if ((actor.side !== "enemy" && !actor.npc) || neverActs(actor) || initiativeTotal(actor) !== null) continue;
      const group = initiativeGroup(next, actor);
      const mode = actor.roll?.mode ?? initiativeMode(actor);
      const dice = group && groups.has(group) ? null : Array.from(
        { length: mode === "normal" ? 1 : 2 }, () => Math.floor(random() * 20) + 1
      );
      actor.roll = dice ? { dice, mode, source: "automatic" } : copy(groups.get(group));
      if (group) groups.set(group, actor.roll);
    }
    return next;
  }

  function conditionKey(value) {
    return String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const keyOf = condition => typeof condition === "string" ? conditionKey(condition) : condition.key ?? conditionKey(condition.name);
  const has = (actor, key) => (actor.conditions ?? []).some(condition => keyOf(condition) === key);
  const incapacitated = actor => ["incapacitated", "unconscious", "paralyzed", "petrified", "stunned"].some(key => has(actor, key));
  const withKeys = (actor, keys) => keys.some(key => has(actor, key));
  const grappledBy = (actor, sourceId) => actor.conditions?.some(effect =>
    ["grappled", "engulfed"].includes(keyOf(effect)) && effect.sourceId === sourceId);

  function combineMode(advantage, disadvantage) {
    if (Boolean(advantage) === Boolean(disadvantage)) return "normal";
    return advantage ? "advantage" : "disadvantage";
  }

  function attackMode(battle, actorId, targetId, input = {}) {
    const explicit = input.modes?.[targetId];
    if (explicit) return checkedMode(explicit);
    const actor = find(battle, actorId);
    const target = find(battle, targetId);
    const action = input.action;
    const advantage = has(actor, "steady-aim") || (actor.classFeatures?.assassin && battle.round === 1 && (target.turns ?? 0) === (target.combatStartTurns ?? 0)) || (has(actor, "invisible") && !has(actor, "faerie-fire") && !seesInvisible(target) && input.canSeeActor?.[targetId] !== true)
      || target.conditions?.some(effect => keyOf(effect) === "vex" && effect.sourceId === actor.id)
      || (["hobgoblin-warrior", "kobold-warrior"].includes(actor.monster) && input.packTactics?.[targetId])
      || ((action?.advantageAgainstGrappled || action?.advantageIf === "grappled-by-actor") && grappledBy(target, actor.id))
      || withKeys(target, ["blinded", "restrained", "engulfed", "unconscious", "paralyzed", "petrified", "stunned", "guiding-bolt"])
      || (has(target, "faerie-fire") && input.cannotSee?.[targetId] !== true)
      || (has(target, "prone") && input.close?.[targetId] === true);
    const disadvantage = input.reactions?.[targetId]?.reaction?.disadvantage || rollDisadvantage(actor, "attack") || protectedFrom(target, actor) || withKeys(actor, ["blinded", "poisoned", "prone", "restrained", "engulfed", "sap"])
      || actor.conditions?.some(effect => keyOf(effect) === "grappled" && effect.sourceId && effect.sourceId !== target.id)
      || (has(actor, "frightened") && input.fearVisible?.[targetId] === true)
      || (target.monster === "steam-mephit" && !incapacitated(target))
      || (["kobold-warrior", "kuo-toa-marauder", "wight-lifedrinker"].includes(actor.monster) && input.sunlight?.[targetId])
      || (has(target, "prone") && input.close?.[targetId] === false)
      || (has(target, "invisible") && !seesInvisible(actor) && !has(target, "faerie-fire") && input.canSeeTarget?.[targetId] !== true)
      || (has(target, "dodge") && !incapacitated(target) && currentStats(target).speed !== 0
        && input.cannotSee?.[targetId] !== true);
    return combineMode(advantage, disadvantage);
  }

  function saveMode(battle, actorId, targetId, input = {}) {
    const explicit = input.modes?.[targetId];
    if (explicit) return checkedMode(explicit);
    const target = find(battle, targetId);
    const dexterity = input.ability === "DEX";
    const magic = input.action?.magic || input.action?.isMagic || input.action?.spell || input.action?.isSpell || input.magic;
    const magicResistance = magic && (target.monster === "curate" || target.traits?.includes?.("magic-resistance"));
    const conditionKeys = input.condition ? [input.condition] : (input.action?.effects ?? []).map(effect => keyOf(effect));
    const racialAdvantage = (conditionKey(target.species).includes("elf") && conditionKeys.includes("charmed"))
      || (target.species === "halfling" && conditionKeys.includes("frightened"))
      || (target.species === "dwarf" && conditionKeys.includes("poisoned"));
    const advantage = magicResistance || racialAdvantage || (dexterity && has(target, "dodge") && !incapacitated(target)
      && currentStats(target).speed !== 0);
    return combineMode(advantage, rollDisadvantage(target, "save") || kindMatches(target, input.action?.save?.disadvantageKinds) || dexterity && withKeys(target, ["restrained", "engulfed"]));
  }

  const rollDisadvantage = (actor, kind) => (actor.conditions ?? []).some(effect => effect.rollDisadvantage?.some(value => value === "all" || value === kind));

  function checkTotal(actor, skill, rolls, input = {}) {
    const stats = currentStats(actor);
    const effects = actor.conditions ?? [];
    const advantage = actor.classFeatures?.skillAdvantage?.includes(skill) || effects.some(effect => effect.skillAdvantage && effect.skill === skill);
    const disadvantage = rollDisadvantage(actor, "check") || has(actor, "poisoned") || (has(actor, "frightened") && input.fearVisible === true);
    const mode = checkedMode(input.mode ?? combineMode(advantage, disadvantage));
    const face = chosenDie(Array.isArray(rolls) ? rolls : [rolls], mode);
    const guidance = effects.some(effect => keyOf(effect) === "guidance" && effect.skill === skill);
    const fallbackAbility = { Acrobatics: "DEX", "Animal Handling": "WIS", Arcana: "INT", Athletics: "STR", Deception: "CHA", History: "INT", Insight: "WIS", Intimidation: "CHA", Investigation: "INT", Medicine: "WIS", Nature: "INT", Perception: "WIS", Performance: "CHA", Persuasion: "CHA", Religion: "INT", "Sleight of Hand": "DEX", Stealth: "DEX", Survival: "WIS" }[skill] ?? skill;
    const bonus = input.modifier ?? stats.skills[skill] ?? (stats.abilities[fallbackAbility] ?? 0) + stats.abilityCheckModifier;
    const extra = input.extraModifier ?? 0;
    return { mode, bonus: bonus + extra, guidance, complete: face !== null && (!guidance || input.guidance != null),
      total: face === null ? null : face + bonus + extra + (guidance && input.guidance != null ? die(input.guidance, 4) : 0) };
  }

  function effectiveAc(actor) {
    const armor = !actor.armorEquipped && (actor.conditions ?? []).some(effect => keyOf(effect) === "mage-armor");
    const base = armor ? Math.max(actor.ac, 13 + (actor.abilities?.DEX ?? 0) + effectModifier(actor, "abilities", "DEX")) : actor.ac;
    return Math.max(0, base + effectModifier(actor, "ac"));
  }

  function syncMaximum(actor) {
    const bonus = effectModifier(actor, "maxHp");
    actor.baseMaxHp ??= Math.max(1, actor.maxHp - bonus);
    actor.maxHp = Math.max(1, actor.baseMaxHp + bonus);
    actor.hp = Math.min(actor.hp, actor.maxHp);
  }
  const kindMatches = (actor, kinds = []) => kinds.some(kind => conditionKey(actor.kind).split("-").includes(conditionKey(kind)));
  const protectedFrom = (target, source) => (target.conditions ?? []).some(effect => keyOf(effect) === "protection-evil-good" && kindMatches(source, effect.creatureKinds));
  const seesInvisible = actor => has(actor, "see-invisibility");


  // Effects alter the view of a saved base value, never the character sheet's
  // permanent stat. Removing/expiring an effect therefore restores it exactly.
  function effectModifier(actor, field, ability) {
    const grouped = new Map();
    for (const effect of actor.conditions ?? []) {
      const value = ability ? effect[field]?.[ability] : effect[field];
      if (!Number.isSafeInteger(value)) continue;
      const key = keyOf(effect);
      if (!grouped.has(key) || Math.abs(value) >= Math.abs(grouped.get(key))) grouped.set(key, value);
    }
    return sum([...grouped.values()]);
  }

  function currentStats(actor) {
    const effects = actor.conditions ?? [];
    const exhaustion = Math.max(0, ...effects.filter(effect => keyOf(effect) === "exhaustion")
      .map(effect => Number.isSafeInteger(effect.levels) ? effect.levels : Number.isSafeInteger(effect.level) ? effect.level : 0));
    const abilityCheckModifier = effectModifier(actor, "abilityBonus") - exhaustion * 2;
    const attackModifier = effectModifier(actor, "attackBonus") - exhaustion * 2;
    const saveModifier = effectModifier(actor, "saveBonus") - exhaustion * 2;
    const abilities = Object.fromEntries(Object.entries(actor.abilities ?? {}).map(([ability, value]) =>
      [ability, value + effectModifier(actor, "abilities", ability)]));
    const saves = Object.fromEntries(Object.entries(actor.saves ?? {}).map(([ability, value]) =>
      [ability, value + effectModifier(actor, "abilities", ability) + effectModifier(actor, "saves", ability) + saveModifier]));
    const skillAbilities = { Athletics: "STR", Acrobatics: "DEX", "Sleight of Hand": "DEX", Stealth: "DEX",
      Arcana: "INT", History: "INT", Investigation: "INT", Nature: "INT", Religion: "INT", "Animal Handling": "WIS",
      Insight: "WIS", Medicine: "WIS", Perception: "WIS", Survival: "WIS", Deception: "CHA", Intimidation: "CHA",
      Performance: "CHA", Persuasion: "CHA" };
    const skills = Object.fromEntries(Object.entries(actor.skills ?? {}).filter(([, value]) => Number.isSafeInteger(value))
      .map(([skill, value]) => [skill, value + effectModifier(actor, "abilities", skillAbilities[skill]) + abilityCheckModifier]));
    const rawMovement = actor.movement ?? (actor.speed && typeof actor.speed === "object" ? actor.speed : {});
    const baseMovement = Object.fromEntries(Object.entries(rawMovement).filter(([, value]) => Number.isSafeInteger(value) && value >= 0));
    if (Number.isSafeInteger(actor.speed)) baseMovement.walk = actor.speed;
    const baseSpeed = Number.isSafeInteger(baseMovement.walk) ? baseMovement.walk : null;
    const speedChange = effectModifier(actor, "speed") - exhaustion * 5
      // Earlier saves recorded Ray of Frost only by its key/name.
      + (has(actor, "ray-of-frost") && !effects.some(effect => keyOf(effect) === "ray-of-frost" && Number.isSafeInteger(effect.speed)) ? -10 : 0);
    const halved = withKeys(actor, ["slowed-breath", "slowing-breath"]);
    const immobile = Boolean(actor.death?.dead || actor.object || withKeys(actor,
      ["grappled", "restrained", "engulfed", "paralyzed", "petrified", "unconscious", "steady-aim-speed"]));
    const movement = Object.fromEntries(Object.entries(baseMovement).map(([mode, value]) =>
      [mode, immobile ? 0 : Math.max(0, Math.floor((value + speedChange) * (halved ? 0.5 : 1)))]));
    const speed = immobile ? 0 : Number.isSafeInteger(movement.walk) ? movement.walk : null;
    const notes = [];
    const note = (en, zh) => notes.push({ en, zh });
    if (immobile) note("Speed is 0 and cannot increase while the blocking condition remains.", "当前限制状态持续期间，速度为 0 且不能提高。");
    if (halved) note("Slowing Breath halves all speeds, prevents Reactions, and permits an Action or a Bonus Action, not both.", "迟缓吐息使所有速度减半，不能进行反应，且动作与附赠动作只能选其一。");
    if (has(actor, "prone")) note(`Prone: crawl, or spend half your current Speed to stand${speed === null ? "." : ` (${Math.floor(speed / 2)} ft.; cannot stand at Speed 0).`}`,
      `倒地：可以爬行，或花费当前速度的一半起身${speed === null ? "。" : `（${Math.floor(speed / 2)} 英尺；速度为 0 时不能起身）。`}`);
    for (const effect of effects) {
      if (keyOf(effect) === "guidance") note(`Guidance: add a physical d4 to ${effect.skill ?? "the chosen skill"} checks.`, `神导术：${effect.skill ?? "所选技能"}检定另加实体 d4。`);
      if (effect.skillAdvantage) note(`${effect.skill} checks have Advantage.`, `${effect.skill}检定具有优势。`);
      if (effect.rollDisadvantage?.includes("all")) note("All D20 Tests have Disadvantage.", "所有 D20 检定具有劣势。");
    }
    if (canUseBless(actor)) note("Bless: add a physical d4 to attack rolls and saving throws; this is not a fixed bonus.", "祝福术：攻击检定与豁免另加实体 d4，并非固定加值。");
    if (has(actor, "poisoned")) note("Poisoned: Disadvantage on attack rolls and ability checks.", "中毒：攻击检定与属性检定具有劣势。");
    if (has(actor, "sap")) note("Sap: the next attack roll has Disadvantage before the source's next turn starts.", "削弱：在来源的下回合开始前，下一次攻击检定具有劣势。");
    if (has(actor, "vex")) note("Vex: its source has Advantage on its next attack against this target before the source's turn ends.", "扰袭：来源在其本回合结束前，对此目标的下一次攻击具有优势。");
    if (has(actor, "restrained") || has(actor, "engulfed")) note("Restrained: attacks against you have Advantage; your attacks and Dexterity saves have Disadvantage.", "束缚：对你的攻击具有优势，你的攻击与敏捷豁免具有劣势。");
    if (withKeys(actor, ["paralyzed", "petrified", "stunned", "unconscious"])) note("Strength and Dexterity saving throws automatically fail while this condition applies.", "此状态持续时，力量与敏捷豁免自动失败。");
    if (incapacitated(actor)) note("Incapacitated: no Action, Bonus Action or Reaction; Concentration ends.", "失能：不能执行动作、附赠动作或反应，且专注结束。");
    if (has(actor, "frightened")) note("Frightened: cannot willingly approach the fear source; attacks and ability checks have Disadvantage while it is visible.", "恐慌：不能主动接近恐惧来源；看得见来源时，攻击和属性检定具有劣势。");
    if (exhaustion) note(`Exhaustion ${exhaustion}: D20 Tests −${exhaustion * 2}, all speeds −${exhaustion * 5} ft.`, `力竭 ${exhaustion} 级：D20 检定 −${exhaustion * 2}，所有速度 −${exhaustion * 5} 英尺。`);
    else if (has(actor, "exhaustion")) note("Exhaustion level has not been recorded; apply its printed level penalties at the table.", "尚未记录力竭等级，请按印刷规则在桌上处理相应减值。");
    if (halved && speedChange) note("The supplied material does not specify the order of flat and halving Speed changes. This preview applies flat changes before halving; the DM can adjust the result.", "所供资料未说明固定速度调整与减半的先后顺序。此预览先调整固定值再减半，DM 可作调整。");
    return { ac: effectiveAc(actor), baseAc: actor.ac, maxHp: actor.maxHp, baseMaxHp: actor.baseMaxHp ?? actor.maxHp - effectModifier(actor, "maxHp"), speed, baseSpeed, movement, baseMovement,
      abilities, saves, skills, attackModifier, saveModifier, abilityCheckModifier, exhaustion,
      speedNeedsRuling: Boolean(halved && speedChange),
      initiative: actor.initiative + effectModifier(actor, "abilities", "DEX") + abilityCheckModifier,
      notes, effects };
  }

  function effectiveAttackBonus(actor, action) {
    return (action.bonus ?? 0) + currentStats(actor).attackModifier
      + (action.attackAbility ? effectModifier(actor, "abilities", action.attackAbility) : 0);
  }

  function effectiveSaveDC(actor, action) {
    return (action.save?.dc ?? 0) + (action.saveAbility ? effectModifier(actor, "abilities", action.saveAbility) : 0);
  }

  function addEffect(target, effect) {
    target.conditions ??= [];
    if (effect.objectId) {
      target.conditions.push(effect);
      return;
    }
    const same = target.conditions.findIndex(current => keyOf(current) === effect.key
      && current.sourceId === effect.sourceId);
    if (same !== -1) target.conditions.splice(same, 1);
    target.conditions.push(effect);
  }

  function endConcentration(battle, actor) {
    if (actor.concentration) {
      for (const target of battle.actors) {
        syncMaximum(target);
        target.conditions = (target.conditions ?? []).filter(effect => effect.concentration !== actor.concentration);
        syncMaximum(target);
      }
      delete actor.concentration;
    }
    delete actor.pendingConcentration;
  }

  function clearExpiredConcentration(battle) {
    for (const source of battle.actors) {
      if (source.concentration && !battle.actors.some(target =>
        target.conditions?.some(effect => effect.concentration === source.concentration))) endConcentration(battle, source);
    }
  }

  function expire(battle, actor, phase) {
    const expired = [];
    for (const target of battle.actors) {
      syncMaximum(target);
      target.conditions = (target.conditions ?? []).filter(effect => {
        const expiry = effect.expires;
        const finished = expiry && (phase === "round-start"
          ? expiry.phase === phase && expiry.round <= battle.round
          : expiry.actorId === actor?.id && expiry.phase === phase && expiry.turn <= actor.turns);
        if (finished) expired.push(`${target.name}: ${effect.name ?? keyOf(effect)}`);
        return !finished;
      });
      syncMaximum(target);
    }
    clearExpiredConcentration(battle);
    if (expired.length) append(battle, "Effects expired", expired.join(" · "));
  }

  function queue(battle, prompt) {
    battle.pending ??= [];
    battle.pending.push(prompt);
  }

  function removeEffect(battle, target, effect) {
    const removed = new Set([effect.id]);
    for (const entry of target.conditions) {
      if (entry.sourceId === effect.sourceId && entry.actionId === effect.actionId && entry.requiresEffect === keyOf(effect)) {
        removed.add(entry.id);
      }
    }
    syncMaximum(target);
    target.conditions = target.conditions.filter(entry => !removed.has(entry.id));
    syncMaximum(target);
    battle.pending = battle.pending?.filter(prompt => prompt.actorId !== target.id || !removed.has(prompt.effectId));
    if (effect.objectId) {
      const object = battle.actors.find(entry => entry.id === effect.objectId);
      if (object) object.inactive = true;
    }
  }

  function endSourceEffects(battle, actor) {
    for (const target of battle.actors) {
      for (const effect of (target.conditions ?? []).filter(effect => effect.sourceId === actor.id
        && (["grappled", "engulfed", "stirge-attachment"].includes(keyOf(effect)) || effect.sourceEnds))) {
        removeEffect(battle, target, effect);
      }
    }
  }

  function queueTurnEffects(battle, actor, phase) {
    for (const target of battle.actors) {
      if (target.inactive || target.death?.dead || target.object) continue;
      for (const effect of target.conditions ?? []) {
        const repeat = effect.repeatSave;
        const tick = effect.tick;
        const source = battle.actors.find(entry => entry.id === effect.sourceId);
        if (repeat?.phase === phase && target.id === actor.id) {
          const suffix = `effect-save:${target.id}:${effect.id}:${actor.turns}`;
          queue(battle, {
            id: suffix, kind: "effect-save", actorId: target.id, sourceId: effect.sourceId,
            effectId: effect.id, label: effect.name, ability: repeat.ability, dc: repeat.dc,
            mode: protectedFrom(target, source ?? actor) && ["charmed", "frightened"].includes(keyOf(effect)) ? "advantage" : saveMode(battle, source?.id ?? actor.id, target.id, { ability: repeat.ability, magic: repeat.magic, condition: keyOf(effect) }),
          });
        }
        const holder = tick?.owner === "source" ? source : target;
        if (tick?.phase === phase && holder?.id === actor.id) {
          queue(battle, {
            id: `effect-damage:${target.id}:${effect.id}:${actor.turns}`, kind: "effect-damage",
            actorId: target.id, sourceId: effect.sourceId, effectId: effect.id, label: effect.name, dice: tick.dice,
          });
        }
      }
    }
  }

  function beginTurn(battle, actor) {
    actor.turns = (actor.turns ?? 0) + 1;
    actor.spent = {};
    for (const participant of battle.actors) {
      if (participant !== actor && participant.spent) delete participant.spent.spell;
      for (const key of Object.keys(participant.spent ?? {})) if (key.startsWith("once:")) delete participant.spent[key];
    }
    expire(battle, actor, "start");
    queueTurnEffects(battle, actor, "start");
  }

  function append(battle, action, summary, actor, rolls) {
    battle.log.push({
      round: battle.round, action, summary,
      ...(actor ? { actor: actor.id } : {}), ...(rolls !== undefined ? { rolls } : {}),
    });
  }

  function start(battle) {
    if (!["setup", "initiative"].includes(battle.phase)) fail("This battle has already started.");
    const next = copy(battle);
    for (const actor of next.actors) {
      actor.combatStartTurns = actor.turns ?? 0;
      actor.conditions = (actor.conditions ?? []).filter(effect => !effect.endsOnInitiative);
      if (actor.roll) delete actor.roll.resolvedModifier;
      if (actor.hp === 0 && actor.side === "party" && !actor.npc && !actor.death?.dead) {
        addEffect(actor, { id: "unconscious", key: "unconscious", name: "Unconscious", zh: "昏迷" });
      }
    }
    const actors = next.actors.filter(actor => !neverActs(actor));
    if (!actors.some(actor => actor.side === "party") || !actors.some(actor => actor.side === "enemy")) {
      fail("Add at least one character and one enemy.");
    }
    if (actors.some(actor => initiativeTotal(actor) === null)) fail("Finish entering initiative for every combatant.");
    const prior = new Map(next.order.map((id, index) => [id, index]));
    actors.sort((first, second) => initiativeTotal(second) - initiativeTotal(first)
      || (first.roll.rank ?? Number.MAX_SAFE_INTEGER) - (second.roll.rank ?? Number.MAX_SAFE_INTEGER)
      || (prior.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (prior.get(second.id) ?? Number.MAX_SAFE_INTEGER));
    next.phase = "fight";
    next.order = actors.map(actor => actor.id);
    next.active = actors[0].id;
    next.round = 1;
    for (const actor of actors) actor.roll.resolvedModifier = currentStats(actor).initiative;
    expire(next, null, "round-start");
    beginTurn(next, actors[0]);
    append(next, "Initiative", actors.map(actor => `${actor.name} ${initiativeTotal(actor)}`).join(" · "), null,
      actors.map(actor => ({ id: actor.id, name: actor.name, modifier: actor.roll.resolvedModifier, ...actor.roll, total: initiativeTotal(actor) })));
    return next;
  }

  function advance(battle) {
    if (battle.phase !== "fight") fail("Start combat first.");
    if (prompts(battle).length) fail("Resolve the pending rolls before ending the turn.");
    const next = copy(battle);
    const current = next.actors.find(actor => actor.id === next.active);
    if (current) {
      if (current.endProcessed !== current.turns) {
        current.endProcessed = current.turns;
        queueTurnEffects(next, current, "end");
        if (next.pending?.length) return next;
      }
      expire(next, current, "end");
    }
    const from = next.order.indexOf(next.active);
    for (let offset = 1; offset <= next.order.length; offset++) {
      const position = from + offset;
      if (position % next.order.length === 0) {
        next.round++;
        expire(next, null, "round-start");
      }
      const candidate = next.actors.find(actor => actor.id === next.order[position % next.order.length]);
      if (!candidate) continue;
      if (neverActs(candidate)) {
        // A dead or removed source still has a timing anchor at its former
        // initiative slot. Expire its effects without giving it actions/ticks.
        candidate.turns = (candidate.turns ?? 0) + 1;
        expire(next, candidate, "start");
        expire(next, candidate, "end");
        continue;
      }
      next.active = candidate.id;
      beginTurn(next, candidate);
      append(next, "Turn", `Round ${next.round} · ${candidate.name}'s turn.`, candidate);
      return next;
    }
    next.active = null;
    return next;
  }

  function prompts(battle) {
    if (battle.phase !== "fight") return [];
    const active = battle.actors.find(actor => actor.id === battle.active);
    const death = active && active.side === "party" && !active.npc && !neverActs(active) && active.hp === 0 && !active.death?.stable
      && active.death?.lastTurn !== active.turns ? [{ kind: "death", actorId: active.id, mode: combineMode(false, rollDisadvantage(active, "save")) }] : [];
    const concentration = battle.actors.flatMap(actor => actor.concentration && actor.pendingConcentration?.length
      ? [{ kind: "concentration", actorId: actor.id, dc: actor.pendingConcentration[0], mode: saveMode(battle, actor.id, actor.id, { ability: "CON" }) }] : []);
    return [...(battle.pending ?? []), ...concentration, ...death];
  }

  function setDeath(actor, changes) {
    actor.death = { ...emptyDeath(), ...actor.death, ...changes };
  }

  function wake(actor) {
    const wasUnconscious = has(actor, "unconscious");
    actor.death = emptyDeath();
    actor.conditions = (actor.conditions ?? []).filter(effect => keyOf(effect) !== "unconscious");
    if (wasUnconscious) addEffect(actor, { id: "prone", key: "prone", name: "Prone", zh: "倒地" });
  }

  function markZero(battle, actor, remainder, critical = false, wasZero = false) {
    if (actor.object || actor.side === "enemy" || actor.npc || remainder >= actor.maxHp) {
      setDeath(actor, { dead: true, stable: false });
    } else {
      const failures = Math.min(3, (actor.death?.failures ?? 0) + (wasZero ? (critical ? 2 : 1) : 0));
      setDeath(actor, { dead: failures >= 3, stable: false, failures });
      if (!actor.death.dead) addEffect(actor, { id: "unconscious", key: "unconscious", name: "Unconscious", zh: "昏迷" });
    }
    if (actor.death?.dead) {
      battle.pending = battle.pending?.filter(prompt => prompt.actorId !== actor.id || prompt.kind === "death-burst");
    }
    if (actor.object) clearWeb(battle, actor);
    if (actor.death?.dead && !actor.deathBurstTriggered) {
      const action = actionProvider()?.deathBurstAction?.(actor, battle);
      if (action) {
        actor.deathBurstTriggered = true;
        queue(battle, { id: `death-burst:${actor.id}`, kind: "death-burst", actorId: actor.id,
          label: action.name ?? "On-defeat action", ability: action.save?.ability, dc: action.save?.dc,
          action: copy(action) });
      }
    }
    endConcentration(battle, actor);
    endSourceEffects(battle, actor);
  }

  function clearWeb(battle, object) {
    const target = battle.actors.find(actor => actor.id === (object.effectTargetId ?? object.webTarget));
    if (target) target.conditions = (target.conditions ?? []).filter(effect => effect.objectId !== object.id);
    object.inactive = true;
  }

  function damageActor(battle, actor, amount, critical = false, knockout = false, ambush = false) {
    if (!amount || actor.death?.dead) return;
    const ward = actor.conditions?.find(effect => keyOf(effect) === "arcane-ward");
    if (ward?.remaining > 0) {
      const wardDamage = Math.min(ward.remaining, amount); ward.remaining -= wardDamage; amount -= wardDamage;
      ward.name = `Arcane Ward (${ward.remaining}/9 HP)`; ward.zh = `奥术护盾（${ward.remaining}/9 HP）`;
      if (!amount) return;
    }
    for (const effect of [...(actor.conditions ?? [])]) {
      if (effect.receivedDamageEnds || effect.sourceEnds && effect.endsOnDamage) removeEffect(battle, actor, effect);
      else if (effect.repeatSave?.afterDamage) queue(battle, { id: `damage-save:${actor.id}:${effect.id}:${battle.log.length}:${battle.pending?.length ?? 0}`,
        kind: "effect-save", actorId: actor.id, sourceId: effect.sourceId, effectId: effect.id, label: effect.name,
        ability: effect.repeatSave.ability, dc: effect.repeatSave.dc, mode: "advantage" });
    }

    const previous = actor.hp;
    const absorbed = Math.min(actor.tempHp ?? 0, amount);
    actor.tempHp = (actor.tempHp ?? 0) - absorbed;
    const remaining = amount - absorbed;
    if (remaining >= previous && knockout && !actor.object && previous > 0) {
      actor.hp = 1;
      addEffect(actor, { id: "knockout", key: "unconscious", name: "Unconscious (knocked out)", zh: "昏迷（被击倒）" });
      endConcentration(battle, actor);
      endSourceEffects(battle, actor);
      return;
    }
    actor.hp = Math.max(0, previous - remaining);
    if (!actor.hp && ambush && actor.side === "party") {
      setDeath(actor, { ...emptyDeath(), stable: true });
      addEffect(actor, { id: "unconscious", key: "unconscious", name: "Unconscious", zh: "昏迷" });
      endConcentration(battle, actor);
      endSourceEffects(battle, actor);
    } else if (!actor.hp) {
      markZero(battle, actor, remaining - previous, critical, previous === 0);
    } else if (actor.concentration) {
      actor.pendingConcentration ??= [];
      actor.pendingConcentration.push(Math.min(30, Math.max(10, Math.floor(amount / 2))));
    }
  }

  function deathSave(battle, id, value, mode, blessRoll) {
    if (!prompts(battle).some(prompt => prompt.kind === "death" && prompt.actorId === id)) {
      fail("There is no death save due for this character.");
    }
    const next = copy(battle);
    const actor = find(next, id);
    const faces = Array.isArray(value) ? value : [value];
    const face = chosenDie(faces, checkedMode(mode ?? combineMode(false, rollDisadvantage(actor, "save"))));
    if (face === null) fail("Enter all required death-save d20s.");
    const bless = canUseBless(actor) && blessRoll != null ? die(blessRoll, 4) : 0;
    const total = face + bless + currentStats(actor).saveModifier;
    let outcome;
    if (face === 20) {
      actor.hp = 1;
      wake(actor);
      outcome = "natural 20 · regains 1 HP";
    } else {
      const successes = (actor.death?.successes ?? 0) + Number(total >= 10);
      const failures = (actor.death?.failures ?? 0) + (face === 1 ? 2 : Number(total < 10));
      const stable = successes >= 3;
      setDeath(actor, {
        successes: stable ? 0 : successes, failures: stable ? 0 : Math.min(3, failures),
        stable, dead: failures >= 3, lastTurn: actor.turns,
      });
      outcome = stable ? "stable at 0 HP" : failures >= 3 ? "dies" : `${successes} successes · ${failures} failures`;
    }
    append(next, "Death save", `${actor.name}: ${face}${total !== face ? ` (${total} total)` : ""} · ${outcome}.`, actor, { death: faces, ...(blessRoll == null ? {} : { bless }) });
    return next;
  }

  function concentrationSave(battle, id, rolls, mode = "normal", blessRoll) {
    const next = copy(battle);
    const actor = find(next, id);
    const dc = actor.pendingConcentration?.[0];
    if (!actor.concentration || dc == null) fail("There is no Concentration save due for this combatant.");
    const faces = Array.isArray(rolls) ? rolls : [rolls];
    const face = chosenDie(faces, checkedMode(mode));
    if (face === null) fail("Enter the required d20 roll.");
    const bless = canUseBless(actor) && blessRoll != null ? die(blessRoll, 4) : 0;
    const total = face + (currentStats(actor).saves.CON ?? 0) + bless;
    if (total >= dc) actor.pendingConcentration.shift();
    else endConcentration(next, actor);
    append(next, "Concentration save", `${actor.name}: ${total} vs DC ${dc} · ${total >= dc ? "holds" : "ends"} Concentration.`,
      actor, { concentration: faces, ...(blessRoll == null ? {} : { bless }) });
    return next;
  }

  function deathBurstAction(battle, actorId) {
    const prompt = (battle.pending ?? []).find(entry => entry.kind === "death-burst" && entry.actorId === actorId);
    if (!prompt) {
      fail("Death Burst is not pending.");
    }
    const action = prompt.action ?? actionProvider()?.deathBurstAction?.(find(battle, actorId), battle);
    if (!action) fail("The private action provider does not define this on-defeat action.");
    return { ...copy(action), timing: "free", deathBurst: true };
  }

  function resolvePrompt(battle, id, rolls, input = {}) {
    const next = copy(battle);
    const prompt = next.pending?.find(entry => entry.id === id);
    if (!prompt) fail("That roll is no longer pending.");
    const target = find(next, prompt.actorId);
    next.pending = next.pending.filter(entry => entry.id !== id);
    if (prompt.kind === "death-burst") {
      if (!input.dismiss) fail("Select Death Burst targets first.");
      append(next, prompt.label, `${target.name} · no targets affected.`, target);
      return next;
    }
    if (prompt.kind === "effect-damage") {
      const components = prompt.dice.map((entry, index) =>
        rollComponent(entry, index, target, { damage: rolls }, false));
      if (components.includes(null)) fail("Enter all the required damage dice.");
      const damage = sum(damageComponents(components, target, false).map(part => part.amount));
      damageActor(next, target, damage);
      const sourceEffect = target.conditions.find(effect => effect.id === prompt.effectId);
      if (sourceEffect?.tick?.once) removeEffect(next, target, sourceEffect);
      append(next, prompt.label, `${target.name} takes ${damage} damage · ${target.hp} HP.`, target, { damage: rolls });
      return next;
    }
    const mode = checkedMode(input.mode ?? prompt.mode ?? "normal");
    const faces = Array.isArray(rolls) ? rolls : [rolls];
    const face = chosenDie(faces, mode);
    if (face === null) fail("Enter the required d20 roll.");
    const bless = canUseBless(target) && input.bless != null ? die(input.bless, 4) : 0;
    const total = face + (currentStats(target).saves[prompt.ability] ?? 0) + bless;
    const success = total >= prompt.dc;
    if (prompt.kind === "fortitude") {
      if (target.hp === 0 && success) target.hp = 1;
      else if (target.hp === 0) markZero(next, target, 0);
    } else if (prompt.kind === "effect-save" && success) {
      const effect = target.conditions.find(entry => entry.id === prompt.effectId);
      if (effect) {
        removeEffect(next, target, effect);
        for (const paired of target.conditions.filter(entry => entry.sourceId === effect.sourceId
          && effect.repeatSave?.clears?.includes(keyOf(entry)))) removeEffect(next, target, paired);
      }
    }
    if (prompt.kind === "effect-save" && !success) {
      const effect = target.conditions.find(entry => entry.id === prompt.effectId);
      if (effect?.repeatSave?.onFailure === "sleep") {
        effect.key = "unconscious"; effect.name = "Sleep (Unconscious)"; effect.zh = "睡眠术（昏迷）"; effect.sleepStage = 2;
        delete effect.repeatSave;
        addEffect(target, { id: `${effect.id}:prone`, key: "prone", name: "Prone", zh: "倒地" });
        endConcentration(next, target); endSourceEffects(next, target);
      }
    }
    clearExpiredConcentration(next);
    append(next, prompt.label, `${target.name}: ${total} vs DC ${prompt.dc} · ${success ? "succeeds" : "fails"}.`,
      target, { saves: { [target.id]: faces }, ...(input.bless == null ? {} : { bless }) });
    return next;
  }

  function escapeEffect(battle, actorId, effectId, rolls, input = {}) {
    const next = copy(battle);
    const actor = find(next, actorId);
    const effect = actor.conditions.find(entry => entry.id === effectId);
    if (!effect?.escape) fail("That effect has no escape check.");
    if (next.active !== actorId || actor.spent?.action || incapacitated(actor)) fail("Escaping requires an available Action on this turn.");
    const mode = checkedMode(input.mode ?? (has(actor, "poisoned") ? "disadvantage" : effect.escape.mode ?? "normal"));
    const face = chosenDie(rolls, mode);
    if (face === null) fail("Enter the required d20 roll.");
    const stats = currentStats(actor);
    const total = face + (input.modifier ?? stats.abilities[input.ability ?? effect.escape.ability ?? "STR"] ?? 0)
      + stats.abilityCheckModifier;
    const success = total >= effect.escape.dc;
    actor.spent ??= {};
    actor.spent.action = true;
    if (success) removeEffect(next, actor, effect);
    append(next, "Escape", `${actor.name}: ${total} vs DC ${effect.escape.dc} · ${success ? "escapes" : "fails"} ${effect.name}.`, actor, { dice: rolls, mode });
    return next;
  }

  function recharge(battle, id, action, value) {
    const next = copy(battle);
    const actor = find(next, id);
    if (next.phase !== "fight" || next.active !== id || !rechargeDue(actor, action)) {
      fail("This ability is not due to recharge.");
    }
    actor.rechargeTurns ??= {};
    const face = die(value, 6);
    const recovered = action.recharge.includes(face);
    const key = action.rechargeKey ?? action.id;
    actor.rechargeTurns[key] = actor.turns;
    actor.recharge[key] = recovered;
    append(next, "Recharge", `${actor.name} · ${action.name}: ${face} · ${recovered ? "ready" : "still spent"}.`,
      actor, { recharge: [face] });
    return next;
  }

  function rechargeDue(actor, action) {
    const key = action.rechargeKey ?? action.id;
    return !neverActs(actor) && Boolean(action.recharge && actor.recharge?.[key] === false
      && actor.rechargeTurns?.[key] !== actor.turns);
  }

  function availability(battle, actor, action) {
    if (battle.phase !== "fight") return "Start combat first.";
    if (action.deathBurst) return actor.death?.dead && (battle.pending ?? []).some(prompt =>
      prompt.kind === "death-burst" && prompt.actorId === actor.id) ? "" : "Death Burst is not pending.";
    if (neverActs(actor)) return "This combatant is out of the fight.";
    if (actor.hp === 0 || incapacitated(actor)) return "This combatant is Incapacitated.";
    if (action.unavailable) return action.unavailable;
    if (action.requiredEffect && !has(actor, action.requiredEffect)) return "The maintained spell has ended.";
    if (action.cost && action.remaining === 0) return "This ability or item has no uses left.";
    if (action.requiresLightAttack && (battle.active !== actor.id || !actor.spent?.light || actor.spent?.extraLight)) {
      return "Make a Light weapon attack as part of the Attack action first. Only one Light extra attack is available per turn.";
    }
    if (["action", "bonus"].includes(action.timing) && battle.active !== actor.id) return "It is not this combatant’s turn.";
    if (action.actionSurge && battle.active !== actor.id) return "Action Surge can only be used on your turn.";
    if (action.oncePerTurnKey && actor.spent?.[`once:${action.oncePerTurnKey}`]) return "This once-per-turn feature was already used this turn.";
    if (action.timing !== "free" && actor.spent?.[action.timing] && !(action.timing === "action" && actor.spent?.surgeAction && !(action.spell || action.isSpell || action.isMagic || action.magic))) return `The ${action.timing} was already used.`;
    if (action.recharge && actor.recharge?.[action.rechargeKey ?? action.id] === false) return "This ability has not recharged.";
    if (Number.isInteger(action.uses) && (actor.uses?.[action.useKey ?? action.id] ?? 0) >= action.uses) return "This ability has no uses left.";
    if (action.requiresBloodiedHit && !actor.spent?.bloodiedHit) return "Rampage requires damage to a creature at half its maximum HP or lower.";
    if (action.attachedAttack && battle.actors.some(target => target.conditions?.some(effect =>
      keyOf(effect) === "stirge-attachment" && effect.sourceId === actor.id))) return "The stirge is already attached.";
    if ((action.spell || action.isSpell) && has(actor, "engulfed")) return "This creature cannot cast spells while Engulfed.";
    if (withKeys(actor, ["slowed-breath", "slowing-breath"])) {
      if (action.timing === "reaction") return "Slowing Breath prevents Reactions.";
      if (action.timing === "action" && actor.spent?.bonus || action.timing === "bonus" && actor.spent?.action) {
        return "Slowing Breath allows an Action or a Bonus Action.";
      }
    }
    if ((action.spell || action.isSpell) && action.cost?.power && actor.spent?.spell) {
      return "A spellcasting Power Token was already spent this turn.";
    }
    return "";
  }

  function reactionFor(battle, actor, target, action, input, row) {
    const reaction = input.reactions?.[target.id];
    if (!reaction) return null;
    if (!(row.hit || reaction.reaction?.trigger === "attack" || action.darts && reaction.reaction?.magicMissile) || !reaction.reaction || !["hit", "attack"].includes(reaction.reaction.trigger) ||
      (reaction.reaction.melee && !action.melee)) {
      fail(`${reaction.name} cannot trigger on this attack.`);
    }
    const reactor = reaction.reactorId ? find(battle, reaction.reactorId) : target;
    const unavailable = availability(battle, reactor, reaction);
    if (unavailable) fail(`${reactor.name}: ${unavailable}`);
    if (actor.id === reactor.id && actor.spent?.reaction) fail("The reaction was already used.");
    return reaction;
  }

  function addAttackResult(battle, actor, target, action, input, row) {
    const mode = attackMode(battle, actor.id, target.id, { ...input, action });
    const value = chosenDie(input.attack, mode);
    const cover = input.cover?.[target.id] ?? 0;
    row.ac = input.ac?.[target.id] == null ? effectiveAc(target) + cover : integer(input.ac[target.id], 0, 999, "AC");
    row.mode = mode;
    const bless = canUseBless(actor) && input.bless?.attack != null ? die(input.bless.attack, 4) : 0;
    row.bonus = effectiveAttackBonus(actor, action) + (input.modifiers?.[target.id] ?? 0) + bless;
    if (value === null) return;
    row.die = value;
    row.total = value + row.bonus;
    row.hit = value !== 1 && (value >= (actor.classFeatures?.criticalRange ?? 20) || row.total >= row.ac);
    const reaction = reactionFor(battle, actor, target, action, input, row);
    if (reaction) {
      row.reaction = reaction;
      row.ac += reaction.reaction.ac ?? 0;
      row.hit = value !== 1 && (value >= (actor.classFeatures?.criticalRange ?? 20) || row.total >= row.ac);
    }
    row.critical = row.hit && (value >= (actor.classFeatures?.criticalRange ?? 20) || input.criticalOnHit?.[target.id] === true
      || (input.close?.[target.id] === true && withKeys(target, ["paralyzed", "unconscious"])));
  }

  function addSaveResult(battle, actor, target, action, input, row) {
    const ability = action.save.ability;
    row.mode = saveMode(battle, actor.id, target.id, { ...input, ability, action });
    row.dc = effectiveSaveDC(actor, action);
    const bless = canUseBless(target) && input.bless?.saves?.[target.id] != null ? die(input.bless.saves[target.id], 4) : 0;
    row.bonus = (currentStats(target).saves[ability] ?? 0) + (input.modifiers?.[target.id] ?? 0) + bless
      + (ability === "DEX" && !action.save.ignoreCover ? input.cover?.[target.id] ?? 0 : 0);
    const kindWords = conditionKey(target.kind).split("-");
    const sleepImmune = action.sleep && ((conditionKey(target.species).includes("elf")) || target.sleepImmune
      || target.defenses?.conditionImmunities?.some(value => conditionKey(value) === "exhaustion")
      || target.defenses?.conditions?.some(value => conditionKey(value) === "exhaustion"));
    const autoFail = action.save.autoFailKinds?.some(kind => kindWords.includes(conditionKey(kind)))
      || ["STR", "DEX"].includes(ability) && withKeys(target, ["paralyzed", "petrified", "stunned", "unconscious"]);
    const value = chosenDie(input.saves?.[target.id], row.mode);
    if (sleepImmune) { row.saved = true; row.autoSuccess = true;
    } else if (autoFail) {
      row.saved = false;
      row.autoFail = true;
    } else if (value !== null) {
      row.die = value;
      row.total = value + row.bonus;
      row.saved = row.total >= row.dc;
    }
  }

  function faces(dice, expected, sides) {
    if (expected === 0) return [];
    if (!Array.isArray(dice) || dice.length < expected || dice.some(face => face === null || face === "" || face === undefined)) {
      return null;
    }
    if (dice.length > expected) fail(`Enter exactly ${expected} d${sides} result(s).`);
    return dice.map(face => die(face, sides));
  }

  function matchingSize(target, sizes) {
    return !sizes || !target.size || sizes.some(size => conditionKey(size) === conditionKey(target.size));
  }

  function applicable(effect, row, actor, target, input) {
    if (!matchingSize(target, effect.sizes)) return false;
    if (effect.when === "check-success") return row.check?.success === true;
    if (effect.when === "charged") return row.hit === true && input.charged?.[target.id] === true;
    if (effect.when === "hit") return row.hit === true;
    if (effect.when === "fail") return row.saved === false;
    return true;
  }

  function diceApply(descriptor, actor, target, row, input) {
    if (!matchingSize(target, descriptor.sizes)) return false;
    if (descriptor.when === "advantage") return row.mode === "advantage";
    if (descriptor.when === "grappled-by-actor" || descriptor.when === "source-grapple") return grappledBy(target, actor.id);
    if (descriptor.when === "charged") return Boolean(input.charged?.[target.id]);
    return true;
  }

  function rollComponent(descriptor, index, target, input, critical, rolledType, actor) {
    const sides = descriptor.woundedSides && target.hp < target.maxHp ? descriptor.woundedSides : descriptor.sides;
    const base = faces(input.damageByTarget?.[target.id]?.[index] ?? input.damage?.[index], descriptor.count, sides);
    const extra = critical ? faces(input.critical?.[index], descriptor.count, sides) : [];
    if (base === null || extra === null) return null;
    let abilityChange = actor && descriptor.ability ? effectModifier(actor, "abilities", descriptor.ability) : 0;
    if (actor && descriptor.abilityNonpositive) {
      const base = actor.abilities?.[descriptor.ability] ?? 0;
      abilityChange = Math.min(0, base + abilityChange) - Math.min(0, base);
    }
    return {
      type: rolledType ?? descriptor.type ?? "untyped",
      raw: Math.max(0, sum(base) + sum(extra) + (descriptor.flat ?? 0)
        + abilityChange),
    };
  }

  function defenseHas(target, kind, type) {
    const defenses = target.defenses ?? {};
    const group = {
      resistance: defenses.resistance ?? defenses.resistances,
      immunity: defenses.immunity ?? defenses.immunities,
      vulnerability: defenses.vulnerability ?? defenses.vulnerabilities,
    }[kind];
    return Array.isArray(group) && group.some(value => conditionKey(value) === conditionKey(type));
  }

  function damageComponents(components, target, half) {
    // Combine each damage type before rounding or applying its defenses.
    const totals = new Map();
    for (const { type, raw } of components) totals.set(type, (totals.get(type) ?? 0) + raw);
    return [...totals].map(([type, raw]) => {
      let amount = half ? Math.floor(raw / 2) : raw;
      if (defenseHas(target, "immunity", type)) amount = 0;
      if (defenseHas(target, "resistance", type) || has(target, "petrified")) amount = Math.floor(amount / 2);
      if (defenseHas(target, "vulnerability", type)) amount *= 2;
      return { type, raw, amount };
    });
  }

  function conditionImmune(actor, effect) {
    return (keyOf(effect) === "poisoned" && has(actor, "petrified"))
      || actor.defenses?.conditionImmunities?.some(value => conditionKey(value) === keyOf(effect))
      || actor.defenses?.conditionImmunity?.some(value => conditionKey(value) === keyOf(effect))
      || actor.defenses?.conditions?.some(value => conditionKey(value) === keyOf(effect));
  }

  function fortitudeCheck(battle, target, row, input) {
    if (!["zombie", "ogre-zombie"].includes(target.monster) || target.death?.dead || target.hp <= 0
      || row.critical || row.components?.some(part => conditionKey(part.type) === "radiant" && part.amount > 0)
      || row.damage < target.hp + (target.tempHp ?? 0) || input.knockout) return null;
    const id = `fortitude:${target.id}`;
    const mode = input.fortitudeModes?.[target.id] ?? saveMode(battle, target.id, target.id, { ability: "CON" });
    const dc = 5 + row.damage;
    const roll = input.fortitude?.[target.id];
    const face = roll == null ? null : chosenDie(Array.isArray(roll) ? roll : [roll], checkedMode(mode));
    const blessRoll = input.fortitudeBless?.[target.id];
    const bless = canUseBless(target) && blessRoll != null ? die(blessRoll, 4) : 0;
    const total = face == null ? null : face + (currentStats(target).saves.CON ?? 0) + bless;
    return {
      id, kind: "fortitude", actorId: target.id, label: "Undead Fortitude", ability: "CON", dc, mode,
      total, ...(total == null ? {} : { success: total >= dc }),
    };
  }

  function affectsTarget(action, row) {
    if (row.wardBlocked) return false;
    if (action.type === "check") return row.check?.success === true;
    if (action.type === "attack") return row.hit === true || action.halfOnMiss || action.potentCantrip;
    if (action.type === "save") return row.saved === false || row.saved === true && (action.save.onSuccess === "half" || action.potentCantrip);
    return true;
  }

  function addOutcome(row, target, actor, action, descriptors, input, rolledType) {
    const components = affectsTarget(action, row) ? descriptors.flatMap((entry, index) =>
      diceApply(entry, actor, target, row, input) ? [rollComponent(entry, index, target, input, row.critical, rolledType, actor)] : []) : [];
    if (components.includes(null)) return false;
    if (action.type === "heal") {
      row.heal = target.death?.dead ? 0 : Math.max(0, Math.min(target.maxHp - target.hp, sum(components.map(part => part.raw))));
    } else if (["attack", "save", "damage"].includes(action.type)) {
      if (action.sneakAttack && actor.classFeatures?.assassin && row.hit && input.battleRound === 1 && components.length) components[0].raw += 3;
      row.components = damageComponents(components, target, action.type === "save" && row.saved || action.type === "attack" && !row.hit);
      if (action.darts) {
        const allocation = input.allocations?.[target.id] ?? 0;
        row.components = row.components.map(part => ({ ...part, raw: part.raw * allocation, amount: (has(target, "shield") || row.reaction?.reaction?.magicMissile) ? 0 : part.amount * allocation }));
      }
      row.damage = sum(row.components.map(part => part.amount));
    }
    const effects = (row.wardBlocked ? [] : action.effects ?? []).filter(effect => applicable(effect, row, actor, target, input))
      .filter(effect => !target.death?.dead && (effect.key !== "stable" || target.hp === 0) && !target.object && !conditionImmune(target, effect));
    row.effects = effects.filter(effect => !effect.requiresEffect || effects.some(entry => keyOf(entry) === effect.requiresEffect)
      || target.conditions?.some(entry => entry.sourceId === actor.id && keyOf(entry) === effect.requiresEffect)).map(effect => effect.name);
    return true;
  }

  function getTargets(battle, actor, action, ids) {
    if (action.target === "none") return [];
    if (action.target === "self") return [actor];
    if (new Set(ids).size !== ids.length) fail("Choose each target once for this roll.");
    return ids.map(id => find(battle, id));
  }

  function physicalWarnings(battle, actor, action, targets) {
    const warnings = [];
    if (action.enemiesOnly && targets.some(target => target.side === actor.side)) {
      warnings.push("The scaled card describes enemy targets. Check the selection at the table.");
    }
    if (targets.some(target => actor.conditions?.some(effect => keyOf(effect) === "charmed" && effect.sourceId === target.id))) {
      warnings.push("The Charmed condition prevents targeting its source with harmful abilities. Check the selection at the table.");
    }
    if (action.id === "engulf") {
      const current = battle.actors.filter(target => target.conditions?.some(effect =>
        keyOf(effect) === "engulfed" && effect.sourceId === actor.id));
      const candidates = new Map([...current, ...targets].map(target => [target.id, target]));
      if (candidates.size > 4 || candidates.size > 1 && [...candidates.values()].some(target => conditionKey(target.size) === "large")) {
        warnings.push("Engulf capacity is one Large creature or up to four Medium or Small creatures. Check available space at the table.");
      }
    }
    return warnings;
  }

  function describeRow(row) {
    let result = row.name;
    if (row.check) result += ` · ${row.check.total ?? "pending"} vs DC ${row.check.dc} · ${row.check.success ? "succeeds" : "fails"}`;
    if (row.hit !== undefined) result += ` · ${row.total} vs AC ${row.ac} · ${row.critical ? "critical hit" : row.hit ? "hit" : "miss"}`;
    if (row.saved !== undefined) result += ` · ${row.autoFail ? "automatic failure" : `${row.total} vs DC ${row.dc}`} · ${row.saved ? "succeeds" : "fails"}`;
    if (row.damage) result += ` · ${row.damage} damage`;
    if (row.heal !== undefined) result += ` · heals ${row.heal} HP`;
    if (row.ward) result += ` · Sanctuary ${row.ward.total ?? "pending"} vs DC ${row.ward.dc}${row.wardBlocked ? " · ward blocks this target" : ""}`;
    if (row.effects?.length) result += ` · ${row.effects.join(", ")}`;
    return result;
  }

  function preview(battle, actorId, action, targetIds = [], input = {}) {
    const actor = find(battle, actorId);
    const targets = getTargets(battle, actor, action, targetIds);
    const warnings = physicalWarnings(battle, actor, action, targets);
    const unavailable = availability(battle, actor, action);
    if (unavailable) warnings.push(unavailable);
    if ((action.targetCap ?? action.maxTargets) < targets.length) {
      warnings.push(`The card lists up to ${action.targetCap ?? action.maxTargets} target(s). Check your selection at the table.`);
    }
    if (action.type === "attack" && canUseBless(actor) && input.bless?.attack == null) {
      warnings.push("Bless adds 1d4 to the attack. Enter it as a roll modifier.");
    }
    if (action.type === "save" && targets.some(target => canUseBless(target) && input.bless?.saves?.[target.id] == null)) {
      warnings.push("Bless adds 1d4 to affected targets’ saving throws. Enter it as a roll modifier.");
    }
    const rows = targets.map(target => {
      const row = { id: target.id, name: target.name };
      if (action.type === "attack") addAttackResult(battle, actor, target, action, input, row);
      if (action.type === "check") {
        const check = checkTotal(actor, action.check.skill, input.checkRolls ?? [], { mode: input.checkMode, guidance: input.guidance });
        row.check = { ...check, dc: action.check.dc, success: check.complete ? check.total >= action.check.dc : undefined };
      }
      if (action.type === "save") addSaveResult(battle, actor, target, action, input, row);
      const sanctuary = target.conditions?.find(effect => keyOf(effect) === "sanctuary");
      if (sanctuary && !action.area && (action.type === "attack" || action.spell && (action.dice?.some(die => die.type !== "Healing") || action.darts))) {
        const wardMode = input.wardModes?.[target.id] ?? saveMode(battle, target.id, actor.id, { ability: "WIS", magic: true });
        const wardFace = chosenDie(input.sanctuary?.[target.id], wardMode);
        row.ward = { mode: wardMode, dc: sanctuary.saveDC ?? 13, total: wardFace == null ? null : wardFace + (currentStats(actor).saves.WIS ?? 0)
          + (canUseBless(actor) && input.wardBless?.[target.id] != null ? die(input.wardBless[target.id], 4) : 0) };
        row.wardBlocked = row.ward.total !== null && row.ward.total < row.ward.dc;
      }
      if (action.darts && input.reactions?.[target.id]) row.reaction = reactionFor(battle, actor, target, action, input, row);
      return row;
    });
    const costs = [];
    if (action.cost && !(action.secondWindCheck && input.previousCheckTotal != null && input.checkDC != null && input.windRoll != null && input.previousCheckTotal + die(input.windRoll, 10) < input.checkDC)) costs.push({ id: actor.id, ...action.cost });
    if (action.kitCheck && input.kitRoll != null && die(input.kitRoll, 10) === 1) costs.push({ id: actor.id, item: "healer-s-kit" });
    for (const row of rows) {
      if (row.reaction?.cost) costs.push({ id: row.reaction.reactorId ?? row.id, ...row.reaction.cost });
    }
    const needsCritical = rows.some(row => row.critical);
    let complete = !unavailable && (action.target !== "pick" || targets.length > 0);
    if (rows.some(row => (action.type === "attack" && row.hit === undefined) || (action.type === "save" && row.saved === undefined))) complete = false;
    if (action.type === "check" && rows.some(row => !row.check?.complete)) complete = false;
    if (action.secondWindCheck && (input.previousCheckTotal == null || input.checkDC == null || input.windRoll == null || input.previousCheckTotal >= input.checkDC)) { warnings.push("Enter a failed ability-check total, DC, and the Second Wind d10."); complete = false; }
    if (action.targetKinds && targets.some(target => !kindMatches(target, action.targetKinds))) { warnings.push("Choose a creature of the type listed on the card."); complete = false; }
    if (action.kitCheck && input.kitRoll == null) { warnings.push("Roll a d10 to check whether the Healer’s Kit is expended."); complete = false; }
    if (action.combatHealer && targets.some(target => has(target, "combat-healer-treated"))) { warnings.push("Combat Healer already treated this creature; it must finish a Long Rest first."); complete = false; }
    if (rows.some(row => row.ward?.total === null)) complete = false;
    for (const [key, choices] of Object.entries(action.options ?? {})) {
      if (!choices.includes(input[key])) { warnings.push(`Choose ${key}.`); complete = false; }
    }
    if (action.darts && (Object.values(input.allocations ?? {}).some(value => !Number.isSafeInteger(value) || value < 0)
      || sum(targets.map(target => input.allocations?.[target.id] ?? 0)) !== action.darts)) { warnings.push(`Allocate exactly ${action.darts} darts to the selected targets.`); complete = false; }
    if (action.requiresNoArmor && targets.some(target => target.armorEquipped)) { warnings.push("Mage Armor requires a target wearing no armor."); complete = false; }
    if (action.requiresDying && targets.some(target => target.hp !== 0 || target.death?.dead)) { warnings.push("Choose a living creature at 0 HP."); complete = false; }
    if (action.consumeEffect && !find(battle, action.consumeEffect.actorId).conditions?.some(effect => effect.id === action.consumeEffect.effectId && effect.remaining > 0)) { warnings.push("There are no berries left in this batch."); complete = false; }
    const resolved = rows.filter(row => affectsTarget(action, row));
    const dice = (action.dice ?? []).filter(entry => resolved.some(row =>
      diceApply(entry, actor, find(battle, row.id), row, input))).map(entry => ({
      ...entry, ...(entry.woundedSides && resolved.some(row => { const target = find(battle, row.id); return target.hp < target.maxHp; }) ? { sides: entry.woundedSides } : {}), criticalRequired: resolved.some(row => row.critical && diceApply(entry, actor, find(battle, row.id), row, input)),
    }));
    const damageTypeRoll = resolved.length ? action.damageTypeRoll : undefined;
    const rolledType = damageTypeRoll && input.damageTypeRoll != null
      ? damageTypeRoll.choices[die(input.damageTypeRoll, damageTypeRoll.sides) - 1] : undefined;
    const needsDamage = Boolean(dice.some(entry => entry.count > 0) || damageTypeRoll);
    if (damageTypeRoll && rolledType === undefined) complete = false;
    if (!input.hitsOnly && complete) {
      for (const [index, row] of rows.entries()) {
        if (!addOutcome(row, targets[index], actor, action, dice, { ...input, battleRound: battle.round }, rolledType)) complete = false;
      }
    } else if (input.hitsOnly && needsDamage) {
      complete = false;
    }
    const fortitude = complete ? rows.flatMap((row, index) => {
      const target = targets[index];
      const check = row.damage > 0 ? fortitudeCheck(battle, target, row, { ...input, knockout: input.knockout && action.melee }) : null;
      if (check) row.fortitude = check;
      return check ? [check] : [];
    }) : [];
    return {
      targets: rows, complete, needsCritical, needsDamage, dice, damageTypeRoll, costs, warnings,
      fortitude,
      summary: [`${actor.name} · ${action.name}`, ...rows.map(describeRow)].join(" | "),
    };
  }

  function effectExpiry(effect, actor, target, battle) {
    if (!effect.expiry) return undefined;
    if (effect.expiry === "round-start") {
      return { phase: "round-start", round: battle.round + (effect.rounds ?? 1) };
    }
    const [phase, who] = effect.expiry.split("-");
    const holder = who === "target" ? target : actor;
    const rounds = effect.rounds ?? (phase === "start" ? 1 : 0);
    return { actorId: holder.id, phase, turn: (holder.turns ?? 0) + rounds };
  }

  function applyEffect(battle, actor, target, effect, action, row, concentration, input = {}) {
    if (!applicable(effect, row, actor, target, input) || target.object || target.death?.dead || conditionImmune(target, effect)) return;
    if (effect.requiresEffect && !target.conditions?.some(entry => entry.sourceId === actor.id && keyOf(entry) === effect.requiresEffect)) return;
    if (row.wardBlocked) return;
    if (protectedFrom(target, actor) && ["charmed", "frightened"].includes(keyOf(effect))) return;
    let key = effect.key ?? conditionKey(effect.name);
    if (key === "thaumaturgy") {
      key = `thaumaturgy-${conditionKey(input.manifestation)}`;
      const maintained = target.conditions?.filter(entry => keyOf(entry).startsWith("thaumaturgy-")) ?? [];
      if (!maintained.some(entry => keyOf(entry) === key) && maintained.length >= 3) removeEffect(battle, target, maintained[0]);
    }
    if (key === "stable") {
      if (target.hp === 0) setDeath(target, { ...emptyDeath(), stable: true });
      return;
    }
    const expires = effectExpiry(effect, actor, target, battle);
    const saved = {
      id: `${actor.id}:${action.id}:${key}`, key, name: effect.name, sourceId: actor.id, actionId: action.id,
      ...(effect.zh ? { zh: effect.zh } : {}),
      ...(expires ? { expires } : {}), ...(effect.ac != null ? { ac: effect.ac } : {}),
      ...(effect.concentration && concentration ? { concentration } : {}),
      ...(effect.repeatSave ? { repeatSave: effect.repeatSave } : {}),
      ...(effect.escape ? { escape: effect.escape } : {}),
      ...(effect.tick ? { tick: effect.tick } : {}),
      ...(Number.isInteger(effect.speed) ? { speed: effect.speed } : {}),
      ...Object.fromEntries(["attackBonus", "saveBonus", "abilityBonus"].filter(field => Number.isSafeInteger(effect[field]))
        .map(field => [field, effect[field]])),
      ...(effect.abilities ? { abilities: copy(effect.abilities) } : {}),
      ...(effect.saves ? { saves: copy(effect.saves) } : {}),
      ...(effect.endsOnAttack ? { endsOnAttack: true } : {}),
      ...(effect.endsOnDamage ? { endsOnDamage: true } : {}),
      ...(effect.requiresEffect ? { requiresEffect: effect.requiresEffect } : {}),
      ...Object.fromEntries(["durationSeconds", "acBase", "maxHp", "skill", "remaining", "saveDC", "sleepStage", "repeatAction", "creatureKinds", "locksProne", "receivedDamageEnds", "endsOnSpell", "rollDisadvantage", "untilLongRest", "skillAdvantage", "sourceEnds", "endsOnInitiative"].filter(field => effect[field] !== undefined).map(field => [field, copy(effect[field])])),
      ...(action.options?.skill ? { skill: input.skill } : {}),
      ...(effect.key === "thaumaturgy" ? { manifestation: input.manifestation, ...(input.manifestation === "Booming Voice" ? { skill: "Intimidation", skillAdvantage: true } : {}) } : {}),
    };
    const suppliedObject = actionProvider()?.effectObject?.(actor, target, effect, action, battle);
    if (suppliedObject) {
      const object = { ...copy(suppliedObject),
        id: suppliedObject.id ?? `effect-object-${battle.log.length}-${battle.actors.length}`,
        name: suppliedObject.name ?? effect.name, side: suppliedObject.side ?? actor.side,
        object: true, effectTargetId: target.id, scalePlayers: actor.scalePlayers,
        hp: integer(suppliedObject.hp, 1, 9999, "Effect object HP"),
        maxHp: integer(suppliedObject.maxHp ?? suppliedObject.hp, 1, 9999, "Effect object maximum HP"),
        ac: integer(suppliedObject.ac, 0, 999, "Effect object AC"),
        tempHp: suppliedObject.tempHp ?? 0, initiative: suppliedObject.initiative ?? 0,
        saves: copy(suppliedObject.saves ?? {}), recharge: copy(suppliedObject.recharge ?? {}),
        conditions: copy(suppliedObject.conditions ?? []), roll: null };
      saved.id = object.id;
      saved.objectId = object.id;
      battle.actors.push(object);
    }
    if (saved.maxHp) { syncMaximum(target); const prior = target.maxHp, wasZero = target.hp === 0; addEffect(target, saved); syncMaximum(target); target.hp = Math.min(target.maxHp, target.hp + Math.max(0, target.maxHp - prior)); if (wasZero && target.hp > 0) wake(target); }
    else addEffect(target, saved);
    if (incapacitated(target)) {
      target.conditions = target.conditions.filter(entry => !(keyOf(entry) === "invisible" && target.monster === "sprite-skirmisher"));
      endConcentration(battle, target);
      endSourceEffects(battle, target);
    }
  }

  function markSpent(actor, action) {
    actor.spent ??= {};
    if (action.actionSurge) actor.spent.surgeAction = true;
    if (action.timing === "action" && actor.spent.surgeAction && !(action.spell || action.isSpell || action.isMagic || action.magic)) delete actor.spent.surgeAction;
    else if (action.timing !== "free") actor.spent[action.timing] = true;
    if (action.oncePerTurnKey) actor.spent[`once:${action.oncePerTurnKey}`] = true;
    if ((action.spell || action.isSpell) && action.cost?.power) actor.spent.spell = true;
    if (action.timing === "action" && action.lightWeapon) actor.spent.light = true;
    if (action.requiresLightAttack) actor.spent.extraLight = true;
    if (action.recharge) {
      actor.recharge ??= {};
      const key = action.rechargeKey ?? action.id;
      actor.recharge[key] = false;
      actor.rechargeTurns ??= {};
      actor.rechargeTurns[key] = actor.turns ?? 0;
    }
    if (Number.isInteger(action.uses)) {
      actor.uses ??= {};
      const key = action.useKey ?? action.id;
      actor.uses[key] = (actor.uses[key] ?? 0) + 1;
    }
  }

  function apply(battle, actorId, action, targetIds = [], input = {}) {
    const outcome = preview(battle, actorId, action, targetIds, { ...input, hitsOnly: false });
    if (!outcome.complete) fail(outcome.warnings[0] ?? "Enter all required dice and choose targets.");
    const next = copy(battle);
    const actor = find(next, actorId);
    let concentration;
    if (action.concentration || [...(action.effects ?? []), ...(action.selfEffects ?? [])].some(effect => effect.concentration)) {
      endConcentration(next, actor);
      concentration = `${actor.id}:${action.id}:${next.log.length}`;
      actor.concentration = concentration;
    }
    if (action.deathBurst) next.pending = (next.pending ?? []).filter(prompt =>
      !(prompt.kind === "death-burst" && prompt.actorId === actor.id));
    else markSpent(actor, action.type === "attack" && !outcome.targets.some(row => row.hit) ? { ...action, oncePerTurnKey: undefined } : action);
    if (action.consumeEffect) {
      const holder = find(next, action.consumeEffect.actorId);
      const resource = holder.conditions?.find(effect => effect.id === action.consumeEffect.effectId);
      if (!resource || resource.remaining < 1) fail("There are no berries left in this batch.");
      resource.remaining--;
    }
    if (action.spell || action.isSpell) actor.conditions = (actor.conditions ?? []).filter(effect => !effect.endsOnSpell);
    if (action.type === "attack") {
      actor.conditions = (actor.conditions ?? []).filter(effect => keyOf(effect) !== "sap" && !effect.endsOnAttack
        && !(keyOf(effect) === "invisible" && actor.monster === "sprite-skirmisher"));
    }
    for (const row of outcome.targets) {
      const target = find(next, row.id);
      if (row.reaction) {
        const reactor = row.reaction.reactorId ? find(next, row.reaction.reactorId) : target;
        markSpent(reactor, row.reaction);
        const reaction = row.reaction.reaction;
        if (reaction.expiry) applyEffect(next, target, target, {
          key: row.reaction.reaction.magicMissile ? "shield" : row.reaction.id, name: row.reaction.name, ac: reaction.ac, expiry: reaction.expiry, durationSeconds: reaction.durationSeconds,
        }, row.reaction, row);
      }
      if (action.type === "attack") target.conditions = (target.conditions ?? []).filter(effect => keyOf(effect) !== "guiding-bolt"
        && !(keyOf(effect) === "vex" && effect.sourceId === actor.id));
      const ambush = action.stableAtZero || next.source === "ambush" && ["pral", "bandit"].includes(actor.monster);
      if (row.damage) {
        if (row.fortitude) {
          target.tempHp = 0;
          target.hp = 0;
          if (row.fortitude.success === true) target.hp = 1;
          else if (row.fortitude.success === false) markZero(next, target, 0);
          else queue(next, row.fortitude);
        } else {
          damageActor(next, target, row.damage, row.critical, input.knockout === true && action.melee === true, ambush);
        }
        if (action.healFromDamage && !actor.death?.dead) actor.hp = Math.min(actor.maxHp, actor.hp + row.damage);
        if (!action.deathBurst && actor.monster === "gnoll-warrior" && target.hp * 2 <= target.maxHp) {
          actor.spent.bloodiedHit = true;
        }
        actor.conditions = (actor.conditions ?? []).filter(effect => !effect.endsOnDamage
          && !(keyOf(effect) === "invisible" && actor.monster === "sprite-skirmisher"));
      }
      if (row.hit && target.monster === "gray-ooze-glob" && action.melee && !actor.death?.dead) {
        const [acid] = damageComponents([{ type: "Acid", raw: 2 }], actor, false);
        damageActor(next, actor, acid.amount);
        row.corrosive = acid.amount;
      }
      if (row.heal) {
        const unconscious = has(target, "unconscious") || target.hp === 0;
        target.hp += row.heal;
        if (unconscious) wake(target);
      }
      if (action.combatHealer) applyEffect(next, actor, target, { key: "combat-healer-treated", name: "Combat Healer (treated until Long Rest)", zh: "战地医师（长休前不能再次治疗）", untilLongRest: true }, action, row);
      if (action.wakeSleep) for (const effect of [...(target.conditions ?? [])]) { if (effect.sleepStage) removeEffect(next, target, effect); }
      if (action.removeEffect && input.removeEffectId || action.removeEffectId) {
        const removable = target.conditions?.find(effect => effect.id === (action.removeEffectId ?? input.removeEffectId));
        if (removable) removeEffect(next, target, removable);
      }
      if (action.removeCondition && input.condition) for (const effect of [...(target.conditions ?? [])]) {
        if (keyOf(effect) === input.condition) removeEffect(next, target, effect);
      }
      for (const effect of action.effects ?? []) applyEffect(next, actor, target, effect, action, row, concentration, input);
      if (row.hit && action.mastery === "sap") applyEffect(next, actor, target,
        { key: "sap", name: "Sap (next attack Disadvantage)", zh: "削弱（下一次攻击劣势）", expiry: "start-actor" }, action, row);
      if (row.hit && row.damage > 0 && action.mastery === "vex") applyEffect(next, actor, target,
        { key: "vex", name: "Vex (source's next attack Advantage)", zh: "扰袭（来源下次攻击优势）", expiry: "end-actor", rounds: 0 }, action, row);
      row.hpAfter = target.hp;
      row.tempHpAfter = target.tempHp;
      if (target.death?.stable) row.stable = true;
      if (target.death?.dead) row.dead = true;
    }
    for (const effect of action.selfEffects ?? []) applyEffect(next, actor, actor, effect, action, {}, concentration, input);
    if (action.wardRecharge) {
      let ward = actor.conditions?.find(effect => keyOf(effect) === "arcane-ward");
      if (!ward) { ward = { id: `${actor.id}:arcane-ward`, key: "arcane-ward", name: "Arcane Ward", zh: "奥术护盾", remaining: 0, untilLongRest: true }; addEffect(actor, ward); }
      ward.remaining = Math.min(9, ward.remaining + action.wardRecharge); ward.name = `Arcane Ward (${ward.remaining}/9 HP)`; ward.zh = `奥术护盾（${ward.remaining}/9 HP）`;
    }
    clearExpiredConcentration(next);
    const summary = outcome.targets.map(row => {
      const result = [describeRow(row)];
      if (row.reaction) result.push(row.reaction.name);
      if (row.fortitude) result.push(row.fortitude.success == null ? "Undead Fortitude pending"
        : `Undead Fortitude ${row.fortitude.success ? "succeeds" : "fails"}`);
      if (row.corrosive !== undefined) result.push(`Corrosive Form deals ${row.corrosive} Acid to ${actor.name}`);
      if (row.dead) result.push("dead");
      else if (row.stable) result.push("Stable at 0 HP");
      if (row.damage || row.heal) result.push(`${row.hpAfter} HP${row.tempHpAfter ? ` + ${row.tempHpAfter} temp HP` : ""}`);
      return result.join(" · ");
    });
    append(next, action.name, [`${actor.name} · ${action.name}`, ...summary, ...(action.secondWindCheck ? [`Ability check ${input.previousCheckTotal} + ${input.windRoll} = ${input.previousCheckTotal + input.windRoll} vs DC ${input.checkDC}${input.previousCheckTotal + input.windRoll < input.checkDC ? " · still fails; token restored" : " · succeeds"}`] : []), ...(action.narrative ? [input.manifestation ?? "", action.descriptionZh ?? action.description ?? ""] : []), ...(input.note ? [String(input.note)] : [])].join(" | "), actor, {
      ...(input.attack?.length ? { attack: input.attack } : {}),
      ...(input.damage?.length ? { damage: input.damage } : {}),
      ...(input.damageByTarget ? { damageByTarget: input.damageByTarget } : {}),
      ...(input.critical?.length ? { critical: input.critical } : {}),
      ...(input.damageTypeRoll ? { damageTypeRoll: input.damageTypeRoll } : {}),
      ...(input.fortitude ? { fortitude: input.fortitude } : {}),
      ...(input.saves ? { saves: input.saves } : {}),
      ...(input.bless ? { bless: input.bless } : {}),
      ...(input.modifiers ? { modifiers: input.modifiers } : {}),
      ...Object.fromEntries(["allocations", "sanctuary", "wardModes", "wardBless", "checkRolls", "checkMode", "guidance", "kitRoll", "condition", "skill", "manifestation"].filter(key => input[key] !== undefined).map(key => [key, input[key]])),
    });
    return { battle: next, outcome };
  }

  function correct(battle, id, change) {
    const next = copy(battle);
    const actor = find(next, id);
    const note = [];
    const startingHp = actor.hp;
    for (const [key, low, high] of [["maxHp", 1, 9999], ["hp", 0, 9999], ["tempHp", 0, 9999], ["ac", 0, 999], ["initiative", -99, 99], ["speed", 0, 999]]) {
      if (change[key] !== undefined) {
        const value = integer(change[key], low, high, key);
        if (actor[key] !== value) note.push(`${key}: ${actor[key]} → ${value}`);
        actor[key] = value;
        if (key === "maxHp") actor.baseMaxHp = Math.max(1, value - effectModifier(actor, "maxHp"));
      }
    }
    actor.hp = Math.min(actor.hp, actor.maxHp);
    if (change.damage !== undefined) {
      const amount = integer(change.damage, 0, 9999, "Damage");
      damageActor(next, actor, amount);
      note.push(`${amount} damage`);
    } else if (change.hp !== undefined && startingHp > 0 && actor.hp === 0) {
      markZero(next, actor, 0);
    }
    if (change.heal !== undefined) {
      if (actor.death?.dead) fail("A dead creature cannot regain HP through ordinary healing.");
      const amount = integer(change.heal, 0, 9999, "Healing");
      actor.hp = Math.min(actor.maxHp, actor.hp + amount);
      note.push(`heals ${amount} HP`);
    }
    if (actor.hp > 0 && (startingHp === 0 || change.heal > 0) && !actor.death?.dead) wake(actor);
    if (change.dead !== undefined) {
      if (change.dead) {
        actor.hp = 0;
        setDeath(actor, { dead: true, stable: false });
        markZero(next, actor, actor.maxHp);
      } else {
        setDeath(actor, emptyDeath());
        if (actor.hp > 0) wake(actor);
        else addEffect(actor, { id: "unconscious", key: "unconscious", name: "Unconscious", zh: "昏迷" });
      }
      note.push(change.dead ? "dead" : "death cleared");
    }
    if (change.stable !== undefined) {
      if (change.stable && (actor.hp !== 0 || actor.death?.dead)) fail("Only a living creature at 0 HP can be stabilized.");
      setDeath(actor, { ...emptyDeath(), stable: Boolean(change.stable) });
      note.push(change.stable ? "stable" : "stability cleared");
    }
    if (change.inactive !== undefined) {
      actor.inactive = Boolean(change.inactive);
      if (actor.inactive && actor.object) clearWeb(next, actor);
      if (actor.inactive) endSourceEffects(next, actor);
      note.push(actor.inactive ? "removed from the fight" : "returned to the fight");
    }
    if (change.exhaustionLevels !== undefined) {
      const levels = integer(change.exhaustionLevels, 0, 6, "Exhaustion level");
      actor.conditions = (actor.conditions ?? []).filter(effect => keyOf(effect) !== "exhaustion");
      if (levels) addEffect(actor, { id: "manual-exhaustion", key: "exhaustion", name: "Exhaustion", zh: "力竭", levels });
      if (levels === 6) {
        actor.hp = 0;
        setDeath(actor, { dead: true, stable: false });
        markZero(next, actor, actor.maxHp);
      }
      note.push(`Exhaustion level: ${levels}`);
    }
    if (change.addCondition) {
      const condition = typeof change.addCondition === "string" ? { name: change.addCondition } : copy(change.addCondition);
      const name = condition.name?.trim();
      if (!name) fail("Enter a condition name.");
      const key = condition.key ?? conditionKey(name);
      for (const field of ["ac", "speed", "attackBonus", "saveBonus", "abilityBonus"]) {
        if (condition[field] !== undefined) integer(condition[field], -999, 999, `Effect ${field}`);
      }
      for (const field of ["abilities", "saves"]) {
        if (condition[field] !== undefined && (typeof condition[field] !== "object" || condition[field] === null || Array.isArray(condition[field]))) fail(`Effect ${field} must be an ability map.`);
        for (const [ability, value] of Object.entries(condition[field] ?? {})) {
          if (!["STR", "DEX", "CON", "INT", "WIS", "CHA"].includes(ability)) fail("Choose a known ability.");
          integer(value, -99, 99, `Effect ${ability}`);
        }
      }
      if (condition.expiry) {
        if (!["start-actor", "end-actor", "start-target", "end-target", "round-start"].includes(condition.expiry)) fail("Choose an effect expiration.");
        const rounds = condition.rounds ?? 1;
        integer(rounds, condition.expiry === "round-start" ? 1 : 0, 9999, "Effect duration");
        condition.rounds = rounds;
        const source = condition.sourceId ? find(next, condition.sourceId) : actor;
        condition.sourceId = source.id;
        condition.expires = effectExpiry(condition, source, actor, next);
      }
      addEffect(actor, { ...condition, id: condition.id ?? `manual-${key}`, key, name });
      note.push(`added ${name}`);
    }
    if (change.removeCondition) {
      const removed = (actor.conditions ?? []).filter(effect => (effect.id ?? effect) === change.removeCondition);
      const matches = removed.length ? removed : (actor.conditions ?? []).filter(effect => keyOf(effect) === change.removeCondition);
      for (const effect of matches) {
        removeEffect(next, actor, effect);
        note.push(`removed ${effect.name ?? effect}`);
      }
    }
    if (change.endConcentration || incapacitated(actor)) endConcentration(next, actor);
    if (incapacitated(actor)) {
      actor.conditions = actor.conditions.filter(entry => !(keyOf(entry) === "invisible" && actor.monster === "sprite-skirmisher"));
      endSourceEffects(next, actor);
    }
    clearExpiredConcentration(next);
    if (change.endConcentration) note.push("ended Concentration");
    if (change.note) note.push(String(change.note));
    if (note.length) append(next, "DM adjustment", `${actor.name} · ${note.join(" · ")}`, actor);
    return next;
  }

  globalThis.combatEngine = {
    initiativeTotal, initiativeGroup, initiativeMode, setInitiative, fillEnemyInitiative,
    effectiveAc, currentStats, effectiveAttackBonus, effectiveSaveDC, attackMode, saveMode, availability, start, advance, prompts,
    deathSave, concentrationSave, recharge, rechargeDue, preview, apply, correct,
    resolvePrompt, deathBurstAction, escapeEffect, checkTotal, refreshMaxHp: syncMaximum,
  };
})();
