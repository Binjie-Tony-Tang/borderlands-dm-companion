(() => {
  const abilityIds = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const equipmentSlots = ["armor", "weapon", "offhand"];
  const statLimits = {
    maxHp: [1, 9999], ac: [0, 999], initiative: [-99, 99], speed: [0, 999],
    gold: [0, 999999], spellDC: [0, 999], currentHp: [0, 9999], tempHp: [0, 9999],
  };
  const skillAbilities = {
    Athletics: "STR", Acrobatics: "DEX", "Sleight of Hand": "DEX", Stealth: "DEX",
    Arcana: "INT", History: "INT", Investigation: "INT", Nature: "INT", Religion: "INT",
    "Animal Handling": "WIS", Insight: "WIS", Medicine: "WIS", Perception: "WIS", Survival: "WIS",
    Deception: "CHA", Intimidation: "CHA", Performance: "CHA", Persuasion: "CHA",
  };
  // These abilities correspond to the attack rows on the four printed level-one boards.
  const attackRows = {
    fighter: { melee: 0, ranged: 1, abilities: ["STR", "DEX"] },
    rogue: { melee: 1, finesse: 0, ranged: 2, abilities: ["DEX", "STR", "DEX"] },
    cleric: { melee: 0, ranged: 1, spell: "WIS", abilities: ["STR", "DEX", "WIS"] },
    wizard: { spell: "INT", abilities: ["INT"] },
  };

  function fromDeck(deck, id) {
    return typeof id === "string" && Object.hasOwn(deck, id) ? deck[id] : null;
  }

  function isRecord(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function integerIn(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
  }

  function checkedMap(value, valid, label) {
    if (!isRecord(value) || !Object.entries(value).every(([key, entry]) => valid(key, entry))) {
      throw new Error(`Invalid ${label}.`);
    }
    return { ...value };
  }

  function checkedSheet(value) {
    const validators = {
      inventory: inventory => checkedMap(inventory, (id, quantity) =>
        fromDeck(borderlandsItems, id) && integerIn(quantity, 1, Number.MAX_SAFE_INTEGER), "inventory"),
      equipped: equipped => checkedMap(equipped, (slot, id) =>
        equipmentSlots.includes(slot) && (id === null || fromDeck(borderlandsItems, id)), "equipped items"),
      spellIds: ids => {
        if (!Array.isArray(ids) || new Set(ids).size !== ids.length
          || !Array.from(ids).every(id => fromDeck(borderlandsSpells, id))) {
          throw new Error("Invalid spell list.");
        }
        return [...ids];
      },
      wornIds: ids => {
        if (!Array.isArray(ids) || new Set(ids).size !== ids.length
          || !Array.from(ids).every(id => fromDeck(borderlandsItems, id)?.wearable === true)) {
          throw new Error("Invalid worn item list.");
        }
        return [...ids];
      },
      abilities: abilities => checkedMap(abilities, (id, modifier) =>
        abilityIds.includes(id) && integerIn(modifier, -20, 20), "ability modifiers"),
      stats: stats => checkedMap(stats, (id, number) =>
        Object.hasOwn(statLimits, id) && integerIn(number, ...statLimits[id]), "character statistics"),
      power: power => checkedMap(power, (_id, number) => integerIn(number, 0, 999), "Power Tokens"),
      state: state => globalThis.borderlandsSession.checkedState(state),
    };
    if (!isRecord(value) || !Object.keys(value).every(key => Object.hasOwn(validators, key))) {
      throw new Error("Invalid character sheet.");
    }
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, validators[key](field)]));
  }

  function normalize(input = {}) {
    const classId = fromDeck(borderlandsClasses, input.classId) ? input.classId : "";
    const level = input.level ?? 1;
    if (!integerIn(level, 1, 3)) throw new Error("Invalid character level.");
    const subclassId = level === 3 ? input.subclassId : "";
    const job = globalThis.borderlandsLevels ? borderlandsLevels.resolve(classId, level, subclassId) : borderlandsClasses[classId];
    const preparation = job?.prepared;
    const requested = Array.isArray(input.prepared) ? input.prepared : preparation?.defaults ?? [];
    const prepared = preparation
      ? [...new Set(requested)].filter(id => preparation.choices.includes(id)).slice(0, preparation.count)
      : [];
    const name = typeof input.name === "string" ? [...input.name.toWellFormed().trim()].slice(0, 60).join("").trimEnd() : "";
    const choice = {
      name,
      classId,
      backgroundId: fromDeck(borderlandsBackgrounds, input.backgroundId) ? input.backgroundId : "",
      speciesId: fromDeck(borderlandsSpecies, input.speciesId) ? input.speciesId : "",
      prepared,
    };
    if (Object.hasOwn(input, "level") || level > 1) choice.level = level;
    if (level === 3) choice.subclassId = subclassId;
    if (Object.hasOwn(input, "sheet")) choice.sheet = checkedSheet(input.sheet);
    return choice;
  }

  function equipmentType(item) {
    if (item?.kind === "shield" || typeof item?.acBonus === "number") return "shield";
    if (item?.kind === "armor" || typeof item?.ac === "number" || typeof item?.acDex === "number") return "armor";
    if (item?.kind === "weapon" || item?.dice) return "weapon";
    return null;
  }

  function weaponHas(item, property) {
    if (property === "Light" && item?.light) return true;
    if (property === "Two-Handed" && item?.twoHanded) return true;
    return item?.properties?.includes(property) ?? false;
  }

  function resolveEquipped(requested, inventory) {
    const available = slot => Object.hasOwn(inventory, requested[slot]) ? requested[slot] : null;
    const armor = available("armor");
    const weapon = available("weapon");
    const offhand = available("offhand");
    const mainItem = fromDeck(borderlandsItems, weapon);
    const otherItem = fromDeck(borderlandsItems, offhand);
    const offhandType = equipmentType(otherItem);
    const canUseOffhand = !weaponHas(mainItem, "Two-Handed")
      && (offhandType === "shield" || (offhandType === "weapon" && weaponHas(otherItem, "Light")))
      && (offhand !== weapon || inventory[offhand] >= 2);
    return {
      armor: equipmentType(fromDeck(borderlandsItems, armor)) === "armor" ? armor : null,
      weapon: equipmentType(mainItem) === "weapon" ? weapon : null,
      offhand: canUseOffhand ? offhand : null,
    };
  }

  function armorClass(job, armor, shield, dexterity) {
    if (!job) return null;
    let ac = job.unarmoredAC + dexterity - job.abilities.DEX;
    if (typeof armor?.ac === "number") ac = armor.ac;
    if (typeof armor?.acDex === "number") ac = armor.acDex + Math.min(dexterity, armor.dexCap ?? Infinity);
    return ac + (shield?.acBonus ?? 0);
  }

  function weaponStats(item, job, attackLayout, abilities) {
    if (!item.damageAbilities?.length) return {};
    const ability = item.damageAbilities.reduce((best, id) => abilities[id] > abilities[best] ? id : best);
    const magicBonus = item.magicBonus ?? 0;
    const ranged = item.ranged || item.weaponCategory?.endsWith("-ranged");
    const weaponRow = ranged ? attackLayout?.ranged
      : item.damageAbilities.length > 1 && attackLayout?.finesse != null ? attackLayout.finesse
      : attackLayout?.melee;
    const baseAbility = attackLayout?.abilities[weaponRow];
    const printed = job?.attacks[weaponRow]?.bonus;
    return {
      damageBonus: abilities[ability] == null ? null : abilities[ability] + magicBonus,
      attackBonus: printed == null ? null : printed - job.abilities[baseAbility] + abilities[ability] + magicBonus,
    };
  }

  function powerId(kind, cardId, title) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${kind}:${cardId}:${slug}`;
  }

  function derive(input) {
    const choice = normalize(input);
    const sheet = choice.sheet ?? {};
    const level = choice.level ?? 1;
    const job = globalThis.borderlandsLevels ? borderlandsLevels.resolve(choice.classId, level, choice.subclassId) : fromDeck(borderlandsClasses, choice.classId);
    const background = fromDeck(borderlandsBackgrounds, choice.backgroundId);
    const species = fromDeck(borderlandsSpecies, choice.speciesId);
    const cards = [job, background, species].filter(Boolean);
    const modifier = key => cards.reduce((total, card) => total + (card.mods?.[key] ?? 0), 0);
    const baseAbilities = { ...job?.abilities };
    const abilities = { ...baseAbilities, ...sheet.abilities };
    const delta = id => id && Object.hasOwn(baseAbilities, id) ? abilities[id] - baseAbilities[id] : 0;
    const attackLayout = choice.subclassId === "eldritch-knight"
      ? { ...attackRows.fighter, spell: "INT", abilities: ["STR", "DEX", "INT"] } : attackRows[choice.classId];

    const saves = Object.fromEntries(Object.entries(job?.saves ?? {}).map(([id, value]) => [id, value + delta(id)]));
    const skills = Object.fromEntries(Object.entries(job?.skills ?? {}).map(([id, value]) => [
      id, value + delta(skillAbilities[id]) + cards.reduce((total, card) => total + (card.mods?.skills?.[id] ?? 0), 0),
    ]));
    const attacks = (job?.attacks ?? []).map((attack, index) => ({
      ...attack, bonus: attack.bonus + delta(attackLayout?.abilities[index]),
      attackAbility: attackLayout?.abilities[index], ...(attack.en === "Spell attack" ? { spell: true } : {}),
    }));

    const defaultInventory = {};
    for (const id of job?.equipment ?? []) defaultInventory[id] = (defaultInventory[id] ?? 0) + 1;
    const inventory = { ...(sheet.inventory ?? defaultInventory) };
    const defaultEquipped = Object.fromEntries(equipmentSlots.map(slot => [slot, job?.[slot] ?? null]));
    const equipped = resolveEquipped({ ...defaultEquipped, ...sheet.equipped }, inventory);
    const wornIds = (sheet.wornIds ?? []).filter(id => Object.hasOwn(inventory, id));
    const armor = fromDeck(borderlandsItems, equipped.armor);
    const shield = fromDeck(borderlandsItems, equipped.offhand);
    const equipment = Object.entries(inventory).map(([id, qty]) => {
      const item = borderlandsItems[id];
      const slots = equipmentSlots.filter(slot => equipped[slot] === id);
      return {
        id, ...item, qty, slots, slot: slots[0] ?? null, worn: wornIds.includes(id),
        ...weaponStats(item, job, attackLayout, abilities),
      };
    });

    const spellOrigins = new Map();
    for (const card of cards) {
      const ids = card === job ? [...card.spells, ...choice.prepared] : card.spells;
      for (const id of ids) {
        if (!spellOrigins.has(id)) spellOrigins.set(id, []);
        spellOrigins.get(id).push(card);
      }
    }
    const defaultSpellIds = [...spellOrigins.keys()];
    const spellIds = [...(sheet.spellIds ?? defaultSpellIds)];
    const spells = spellIds
      .map(id => ({ id, ...borderlandsSpells[id], origins: spellOrigins.get(id) ?? [] }))
      .sort((a, b) => a.level - b.level || a.en.localeCompare(b.en));

    const powers = [
      ["class", choice.classId, job], ["background", choice.backgroundId, background],
      ["species", choice.speciesId, species],
    ].flatMap(([kind, cardId, card]) => (card?.powers ?? []).map(power => {
      const id = powerId(kind, cardId, power.en);
      return { ...power, id, remaining: sheet.power?.[id] ?? power.count, origin: card };
    }));

    const calculatedStats = {
      maxHp: job ? job.hp + modifier("hp") + (level - 1) * cards.reduce((total, card) => total + (card.hpPerLevel ?? 0), 0) : null,
      ac: armorClass(job, armor, shield, abilities.DEX),
      initiative: job ? job.initiative + delta("DEX") + modifier("initiative") : null,
      speed: species?.speedOverride ?? (job ? job.speed + modifier("speed") : null),
      gold: job?.gold ?? null,
      spellDC: job?.spellDC == null ? null : job.spellDC + delta(attackLayout?.spell),
    };
    const stats = { ...calculatedStats, ...sheet.stats };
    const baseHp = stats.maxHp;
    const hp = baseHp == null ? null : baseHp + (globalThis.borderlandsSession?.maxHpBonus(sheet.state) ?? 0);
    const currentHp = hp == null ? null : Math.min(hp, stats.currentHp ?? hp);
    return {
      choice, job, level, subclassId: choice.subclassId ?? "", background, species, hp, baseHp, currentHp, tempHp: stats.tempHp ?? 0,
      classFeatures: {
        initiativeAdvantage: ["champion", "assassin"].includes(choice.subclassId),
        ...(choice.subclassId === "champion" ? { criticalRange: 19, skillAdvantage: ["Athletics"] } : {}),
        ...(choice.subclassId === "assassin" ? { assassin: true } : {}),
        ...(choice.subclassId === "thief" ? { climbSpeed: 30 } : {}),
      },
      ac: stats.ac, initiative: stats.initiative, speed: stats.speed, gold: stats.gold, spellDC: stats.spellDC,
      castingAbility: attackLayout?.spell ?? null,
      optionalInitiative: background?.optional?.initiative ?? 0,
      baseAbilities, abilities, calculatedStats, saves, skills, attacks, powers, armor,
      defaultInventory, inventory, defaultEquipped, equipped, wornIds, equipment, defaultSpellIds, spellIds, spells,
      complete: Boolean(job && background && species && (!job.prepared || choice.prepared.length === job.prepared.count)),
    };
  }

  globalThis.borderlandsCharacter = { normalize, derive, checkedSheet, equipmentType, weaponHas, statLimits };
})();
