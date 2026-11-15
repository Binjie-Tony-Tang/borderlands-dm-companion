(() => {
  "use strict";
  const config = globalThis.borderlandsAdventureConfig?.transactions;
  if (!config || !config.handlers || typeof config.handlers !== "object" || Array.isArray(config.handlers)) {
    throw new Error("Install adventure_page/private-config.js with transactions.handlers before opening the settlement. See docs/private-content-interface.md.");
  }
  const integerIn = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  const fail = message => { throw new Error(message); };
  const itemById = id => typeof id === "string" && Object.hasOwn(borderlandsItems, id) ? borderlandsItems[id] : null;
  const label = character => character.choice.name || character.job.en;
  const timeOrder = (day, hour) => day * 24 + hour;

  function empty() {
    return { day: 1, period: "day", hour: 12, quests: {}, flags: {}, uses: {}, effects: [], log: [] };
  }

  function equipRestriction(character, item) {
    const permissions = character.job.equipmentPermissions || config.permissions?.[character.choice.classId];
    if (!permissions) return "Equipment permissions are missing from the installed private content.";
    const type = borderlandsCharacter.equipmentType(item);
    if (type === "shield") return permissions.shield ? "" : "This character cannot equip this shield.";
    if (type === "armor") return permissions.armorWeights?.includes(item.armorWeight) ? "" : "This character cannot equip this armor.";
    if (type === "weapon") {
      const category = item.weaponCategory || "";
      const allowedCategory = (permissions.weaponCategories || []).some(value => category === value || category.startsWith(value + "-"));
      const allowedProperty = (permissions.weaponProperties || []).some(value => borderlandsCharacter.weaponHas(item, value));
      return permissions.anyWeapon || allowedCategory || allowedProperty ? "" : "This character cannot equip this weapon.";
    }
    return item?.wearable ? "" : "This item is carried or used from inventory.";
  }

  function rolled(dice, count, sides) {
    if (!Array.isArray(dice) || dice.length !== count || !dice.every(value => integerIn(value, 1, sides))) {
      fail(`Enter ${count} raw d${sides} result${count === 1 ? "" : "s"}.`);
    }
    return dice.reduce((total, value) => total + value, 0);
  }

  function dailyUse(keep, key, limit) {
    const useId = `${key}:${keep.day}`, used = keep.uses[useId] ?? 0;
    if (!integerIn(limit, 1, 999999) || used >= limit) fail("This configured service has no uses remaining today.");
    keep.uses[useId] = used + 1;
    return limit - used - 1;
  }

  function advanceTime(keep, hours) {
    if (!integerIn(hours, 0, 999999)) fail("Enter a nonnegative whole number of hours.");
    const elapsed = keep.hour + hours, day = keep.day + Math.floor(elapsed / 24);
    if (day > 999) fail("The fictional day cannot go past Day 999.");
    keep.day = day; keep.hour = elapsed % 24;
    keep.period = typeof config.periodAt === "function" ? config.periodAt(keep.hour) : keep.period;
    keep.effects = keep.effects.filter(effect => timeOrder(effect.untilDay, effect.untilHour) > timeOrder(keep.day, keep.hour));
  }

  function setEffect(keep, slot, kind, untilDay, untilHour) {
    keep.effects = keep.effects.filter(effect => effect.slot !== slot || effect.kind !== kind);
    keep.effects.push({ slot, kind, untilDay, untilHour });
  }

  function preview(roster, offer, options = {}) {
    roster = structuredClone(roster);
    if (globalThis.borderlandsSession) roster = borderlandsSession.ensure(roster);
    if (!offer || typeof offer.id !== "string" || !offer.id || offer.unavailable) fail("This offer is unavailable.");
    const handler = config.handlers[offer.handler || offer.id || offer.kind];
    if (typeof handler !== "function") fail(`Private transaction handler '${offer.handler || offer.id}' is missing. Install it in adventure_page/private-config.js.`);
    const buyer = options.buyer, patient = options.patient ?? buyer, quantity = options.quantity ?? 1;
    if (!integerIn(quantity, 1, 999999)) fail("Enter a positive whole quantity.");
    const keep = structuredClone(roster.keep ?? empty()), slots = [...roster.slots], lines = [], revivedSlots = [];
    const beforeHours = timeOrder(keep.day, keep.hour);
    function read(slot, role = "character") {
      if (!integerIn(slot, 0, slots.length - 1) || !slots[slot]) fail(`Choose a ${role} from the active roster.`);
      return borderlandsCharacter.derive(slots[slot]);
    }
    function update(slot, fields) {
      const { choice } = read(slot), sheet = { ...choice.sheet, ...fields };
      if (fields.stats) sheet.stats = { ...choice.sheet?.stats, ...fields.stats };
      slots[slot] = { ...choice, sheet };
    }
    function changeGold(slot, difference) {
      if (!Number.isSafeInteger(difference)) fail("Gold changes must be whole numbers.");
      if (!difference) return;
      const character = read(slot), gold = character.gold + difference;
      if (!integerIn(gold, 0, 999999)) fail("This change would put the character's gold outside the supported range.");
      update(slot, { stats: { gold } });
      lines.push(`${label(character)}: ${character.gold} → ${gold} GP.`);
    }
    function changeInventory(slot, id, count) {
      if (!Number.isSafeInteger(count)) fail("Inventory changes must be whole numbers.");
      const character = read(slot), item = itemById(id);
      if (!item) fail("This item is missing from the installed private library.");
      const inventory = { ...character.inventory }, after = (inventory[id] ?? 0) + count;
      if (!integerIn(after, 0, 999999)) fail("The resulting inventory quantity is outside the supported range.");
      if (after) inventory[id] = after; else delete inventory[id];
      update(slot, { inventory });
      if (count < 0) { const next = read(slot); update(slot, { equipped: next.equipped, wornIds: next.wornIds }); }
      lines.push(`${label(character)} ${count > 0 ? "receives" : "hands over"} ${Math.abs(count)} × ${item.en}.`);
    }
    function equip(slot, id) {
      const character = read(slot), item = itemById(id), restriction = equipRestriction(character, item);
      if (restriction) fail(restriction);
      const type = borderlandsCharacter.equipmentType(item), equipped = { ...character.equipped }, wornIds = [...character.wornIds];
      if (type === "armor") equipped.armor = id;
      else if (type === "weapon") { equipped.weapon = id; if (borderlandsCharacter.weaponHas(item, "Two-Handed")) equipped.offhand = null; }
      else if (type === "shield") { equipped.offhand = id; if (borderlandsCharacter.weaponHas(itemById(equipped.weapon), "Two-Handed")) equipped.weapon = null; }
      else if (!wornIds.includes(id)) wornIds.push(id);
      update(slot, { equipped, wornIds });
      const after = read(slot); lines.push(`${label(character)} equips ${item.en}.`);
      for (const previous of Object.values(character.equipped)) if (previous && !Object.values(after.equipped).includes(previous)) lines.push(`${itemById(previous)?.en || previous} stays in inventory.`);
      if (after.ac !== character.ac) lines.push(`AC: ${character.ac} → ${after.ac}.`);
      if (after.ac !== after.calculatedStats.ac) lines.push(`Manual AC ${after.ac} remains in use (equipment AC ${after.calculatedStats.ac}).`);
    }
    function heal(slot, amount, revival = false) {
      if (!integerIn(amount, 0, 9999)) fail("Healing must be a supported whole number.");
      const character = read(slot, "patient");
      if (!revival && character.choice.sheet?.state?.death.dead) fail("Ordinary healing cannot revive this character.");
      if (revival) revivedSlots.push(slot);
      const hp = revival ? Math.min(character.hp, amount) : Math.min(character.hp, character.currentHp + amount);
      update(slot, { stats: { currentHp: hp } }); lines.push(`${label(character)}: ${character.currentHp} → ${hp} HP.`);
    }
    function price(count = quantity) {
      const gp = options.waive ? 0 : offer.gp, total = gp * count;
      if (!integerIn(gp, 0, 999999) || !integerIn(total, 0, 999999)) fail("Enter a valid configured cost.");
      return total;
    }
    read(buyer, "buyer");
    const result = handler({ roster, offer, options: { ...options, buyer, patient, quantity }, keep, slots, lines,
      read, update, changeGold, changeInventory, equip, heal, price, rolled, dailyUse: (key, limit) => dailyUse(keep, key, limit),
      advanceTime: hours => advanceTime(keep, hours), setEffect: (slot, kind, day, hour) => setEffect(keep, slot, kind, day, hour),
      integerIn, fail, label, itemById });
    if (result && typeof result.then === "function") fail("Private transaction handlers must be synchronous so preview stays atomic.");
    keep.log.push(`${offer.name || offer.en || offer.id} · ${lines.join(" ")}`);
    let next = { ...roster, slots, keep };
    if (globalThis.borderlandsSession) {
      next = borderlandsSession.advanceTime(next, (timeOrder(keep.day, keep.hour) - beforeHours) * 3600);
      next = borderlandsSession.reconcile(next, { revivedSlots });
    }
    return { next, lines };
  }
  function consumePotion(roster, options) {
    if (!config.consumePotionOffer) fail("Install a private consumePotionOffer and handler before using this shortcut.");
    return preview(roster, config.consumePotionOffer, options);
  }
  globalThis.keepTransactions = { empty, preview, consumePotion, equipRestriction };
})();
