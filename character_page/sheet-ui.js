(() => {
  const stats = [
    ["maxHp", "Base Max HP"],
    ["currentHp", "Current HP"],
    ["tempHp", "Temporary HP"],
    ["ac", "Base Armor Class"],
    ["initiative", "Base Initiative"],
    ["speed", "Base Speed (ft)"],
    ["gold", "Gold (GP)"],
    ["spellDC", "Spell save DC"],
  ];
  const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  const slots = [
    ["armor", "Armor"],
    ["weapon", "Main hand"],
    ["offhand", "Off hand"],
  ];
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => entities[character]);
  const nameOf = (record, language) => language === "zh-Hans" && record?.zh ? record.zh : record?.en;
  const sheetOf = character => character.sheet ?? character.choice?.sheet ?? {};
  const inventoryOf = character => character.inventory ?? character.defaultInventory ?? {};
  const equippedOf = character => character.equipped ?? character.defaultEquipped ?? {};
  const spellsOf = character => character.spellIds ?? character.defaultSpellIds ?? [];
  const typeOf = item => borderlandsCharacter.equipmentType(item);
  const hasProperty = (item, property) => borderlandsCharacter.weaponHas(item, property);

  function orderedEntries(deck, language) {
    return Object.entries(deck).sort(([, first], [, second]) =>
      nameOf(first, language).localeCompare(nameOf(second, language), language)
    );
  }

  function options(entries, language, selected, unavailable = []) {
    return entries.map(([id, record]) => `
      <option value="${escape(id)}"${id === selected ? " selected" : ""}${unavailable.includes(id) ? " disabled" : ""}>${escape(nameOf(record, language))}</option>
    `).join("");
  }

  function numberField({ group, key, label, min, max, value, fallback, required = false }) {
    return `
      <label class="sheet-number-field">
        <span>${escape(label)}</span>
        <input type="number" data-sheet-group="${group}" data-sheet-key="${escape(key)}"
          min="${min}" max="${max}" step="1" value="${escape(value)}"${required ? " required" : ""}
          ${fallback == null ? "" : `placeholder="${escape(fallback)}"`}>
      </label>`;
  }

  function statDefaults(character) {
    return { ...character.calculatedStats, currentHp: character.hp, tempHp: 0 };
  }

  function statControls(character, language) {
    const sheet = sheetOf(character);
    const calculated = statDefaults(character);
    const statFields = stats.map(([key, label]) => {
      const [min, max] = borderlandsCharacter.statLimits[key];
      const value = sheet.stats?.[key];
      return numberField({
        group: "stats", key, label, min, max: key === "currentHp" ? character.hp ?? max : max,
        value: key === "currentHp" && value != null ? character.currentHp : value, fallback: calculated[key],
      });
    }).join("");
    const abilityFields = abilities.map(key => numberField({
      group: "abilities", key, label: key, min: -20, max: 20,
      value: sheet.abilities?.[key], fallback: character.baseAbilities?.[key],
    })).join("");
    const powerFields = (character.powers ?? []).map(power => numberField({
      group: "power", key: power.id, label: nameOf(power, language), min: 0,
      max: Math.max(power.count, power.remaining ?? 0),
      value: sheet.power?.[power.id], fallback: power.count,
    })).join("");
    return `
      <div class="sheet-controls">
        <p class="muted">${language === "zh-Hans" ? "留空使用计算值。基础属性修改不会包含临时效果；当前生命值与临时生命值仍为实际值。" : "Leave a field blank to use its calculated value. Base stat edits exclude temporary effects; Current HP and Temporary HP are the actual tracked values."}</p>
        <div class="sheet-grid">${statFields}</div>
        <h3>Ability modifiers</h3>
        <div class="sheet-grid">${abilityFields}</div>
        ${powerFields ? `<h3>Remaining Power Tokens</h3><div class="sheet-grid">${powerFields}</div>` : ""}
      </div>`;
  }

  function canEquip(slot, item) {
    const type = typeOf(item);
    if (slot === "armor") return type === "armor";
    if (slot === "weapon") return type === "weapon";
    return type === "shield" || (type === "weapon" && hasProperty(item, "Light"));
  }

  function equippedCount(equipped, itemId) {
    return Object.values(equipped).filter(id => id === itemId).length;
  }

  function gearControls(character, language) {
    const inventory = inventoryOf(character);
    const equipped = equippedOf(character);
    const wornIds = character.wornIds ?? [];
    const twoHanded = hasProperty(borderlandsItems[equipped.weapon], "Two-Handed");
    const items = orderedEntries(borderlandsItems, language);
    const gear = slots.map(([key, label]) => `
      <label class="sheet-select-field">
        <span>${label}</span>
        <select data-sheet-equip="${key}"${key === "offhand" && twoHanded ? " disabled" : ""}>
          <option value="">${key === "offhand" && twoHanded ? "Unavailable with two-handed weapon" : "None"}</option>
          ${options(items.filter(([, item]) => canEquip(key, item)), language, equipped[key])}
        </select>
      </label>`).join("");
    const carried = items.filter(([id]) => Object.hasOwn(inventory, id)).map(([id, item]) => {
      const name = escape(nameOf(item, language));
      const action = wornIds.includes(id) ? "Take off" : "Wear";
      return `
        <div class="sheet-entry">
          <span lang="${language}">${name}</span>
          ${numberField({
            group: "inventory", key: id, label: "Quantity", min: Math.max(1, equippedCount(equipped, id)),
            max: Number.MAX_SAFE_INTEGER, value: inventory[id], required: true,
          })}
          ${item.wearable ? `<button class="secondary" type="button" data-sheet-wear="${escape(id)}"
            aria-label="${action} ${name}">${action}</button>` : ""}
          <button class="secondary" type="button" data-sheet-remove="${escape(id)}"
            aria-label="Remove ${name}">Remove</button>
        </div>`;
    }).join("");
    return `
      <div class="sheet-controls">
        <div class="sheet-grid">${gear}</div>
        <h3>Inventory</h3>
        <div class="sheet-picker">
          <label class="sheet-select-field">
            <span>Add item</span>
            <select id="sheet-add-item" data-sheet-picker="add-item">
              <option value="">Choose equipment</option>
              ${options(items, language)}
            </select>
          </label>
          <button class="secondary" type="button" data-sheet-apply="add-item" disabled>Add</button>
        </div>
        <div class="sheet-list">${carried || '<p class="muted">No items carried.</p>'}</div>
      </div>`;
  }

  function spellControls(character, language) {
    const learned = spellsOf(character);
    const spells = orderedEntries(borderlandsSpells, language);
    const entries = spells.filter(([id]) => learned.includes(id)).map(([id, spell]) => `
      <div class="sheet-entry">
        <span lang="${language}">${escape(nameOf(spell, language))}</span>
        <button class="secondary" type="button" data-sheet-forget="${escape(id)}"
          aria-label="Forget ${escape(nameOf(spell, language))}">Forget</button>
      </div>`).join("");
    return `
      <div class="sheet-controls">
        <div class="sheet-picker">
          <label class="sheet-select-field">
            <span>Learn spell</span>
            <select id="sheet-learn-spell" data-sheet-picker="learn-spell">
              <option value="">Choose spell</option>
              ${options(spells, language, "", learned)}
            </select>
          </label>
          <button class="secondary" type="button" data-sheet-apply="learn-spell" disabled>Learn</button>
        </div>
        <div class="sheet-list">${entries || '<p class="muted">No spells known.</p>'}</div>
      </div>`;
  }

  function sections(character, language) {
    if (!character.job) return { stats: "", equipment: "", spells: "" };
    return {
      stats: statControls(character, language),
      equipment: gearControls(character, language),
      spells: spellControls(character, language),
    };
  }

  function numericEdit(input, character) {
    const { sheetGroup: group, sheetKey: key } = input.dataset;
    if (!input.validity.valid || (input.value !== "" && !Number.isSafeInteger(input.valueAsNumber))) {
      return null;
    }
    const sheet = sheetOf(character);
    const next = { ...sheet };
    const values = { ...(group === "inventory" ? inventoryOf(character) : sheet[group]) };
    if (input.value === "") delete values[key];
    else values[key] = input.valueAsNumber;
    if (Object.keys(values).length === 0) delete next[group];
    else next[group] = values;
    return next;
  }

  function refresh(root, character) {
    const calculated = statDefaults(character);
    for (const input of root.querySelectorAll('input[data-sheet-group="stats"]')) {
      const key = input.dataset.sheetKey;
      input.placeholder = calculated[key] ?? "";
      if (key !== "currentHp" || character.hp == null) continue;
      input.max = character.hp;
      if (input !== root.ownerDocument.activeElement) {
        input.value = sheetOf(character).stats?.currentHp == null ? "" : character.currentHp;
      }
    }
  }

  function equipItem(character, slot, itemId) {
    const item = borderlandsItems[itemId];
    if (itemId && (!item || !canEquip(slot, item))) return null;
    const equipped = { ...equippedOf(character), [slot]: itemId || null };
    const inventory = { ...inventoryOf(character) };
    if (hasProperty(borderlandsItems[equipped.weapon], "Two-Handed")) equipped.offhand = null;
    if (itemId) inventory[itemId] = Math.max(inventory[itemId] ?? 0, equippedCount(equipped, itemId));
    return { ...sheetOf(character), equipped, inventory };
  }

  function bind(root, { getCharacter, update }) {
    root.addEventListener("input", event => {
      const input = event.target.closest("input[data-sheet-group]");
      if (!input) return;
      const next = numericEdit(input, getCharacter());
      if (next) update(next, false);
    });

    root.addEventListener("change", event => {
      const input = event.target.closest("input[data-sheet-group]");
      if (input) {
        const character = getCharacter();
        const { sheetGroup: group, sheetKey: key } = input.dataset;
        const sheet = sheetOf(character);
        if (!input.validity.valid) {
          const stored = group === "inventory" ? inventoryOf(character)[key] : sheet[group]?.[key];
          input.value = group === "stats" && key === "currentHp" && stored != null ? character.currentHp : stored ?? "";
        } else if (group === "stats" && key === "maxHp" && sheet.stats?.currentHp > character.hp) {
          update({ ...sheet, stats: { ...sheet.stats, currentHp: character.hp } }, false);
        }
      }
      const slot = event.target.closest("select[data-sheet-equip]");
      if (slot) {
        const key = slot.dataset.sheetEquip;
        const next = equipItem(getCharacter(), key, slot.value);
        if (next) {
          update(next, true);
          root.querySelector(`select[data-sheet-equip="${key}"]`)?.focus();
        }
      }
      const picker = event.target.closest("select[data-sheet-picker]");
      if (picker) {
        const button = root.querySelector(`button[data-sheet-apply="${picker.dataset.sheetPicker}"]`);
        if (button) button.disabled = !picker.value;
      }
    });

    root.addEventListener("click", event => {
      const button = event.target.closest("button[data-sheet-apply], button[data-sheet-remove], button[data-sheet-forget], button[data-sheet-wear]");
      if (!button) return;
      const character = getCharacter();
      const sheet = sheetOf(character);
      const { sheetApply, sheetRemove, sheetForget, sheetWear } = button.dataset;
      const wornIds = character.wornIds ?? [];
      if (sheetRemove) {
        const inventory = { ...inventoryOf(character) };
        const equipped = { ...equippedOf(character) };
        delete inventory[sheetRemove];
        for (const [slot, id] of Object.entries(equipped)) {
          if (id === sheetRemove) equipped[slot] = null;
        }
        const next = { ...sheet, inventory, equipped };
        if (wornIds.includes(sheetRemove)) next.wornIds = wornIds.filter(id => id !== sheetRemove);
        update(next, true);
        root.querySelector("#sheet-add-item")?.focus();
      } else if (sheetWear && borderlandsItems[sheetWear]?.wearable && Object.hasOwn(inventoryOf(character), sheetWear)) {
        const nextWornIds = wornIds.includes(sheetWear)
          ? wornIds.filter(id => id !== sheetWear)
          : [...wornIds, sheetWear];
        update({ ...sheet, wornIds: nextWornIds }, true);
        root.querySelector(`button[data-sheet-wear="${sheetWear}"]`)?.focus();
      } else if (sheetForget) {
        update({ ...sheet, spellIds: spellsOf(character).filter(id => id !== sheetForget) }, true);
        root.querySelector("#sheet-learn-spell")?.focus();
      } else {
        const picker = root.querySelector(`select[data-sheet-picker="${sheetApply}"]`);
        const id = picker?.value;
        if (sheetApply === "add-item" && Object.hasOwn(borderlandsItems, id)) {
          const inventory = { ...inventoryOf(character) };
          const quantity = (inventory[id] ?? 0) + 1;
          if (!Number.isSafeInteger(quantity)) return;
          inventory[id] = quantity;
          update({ ...sheet, inventory }, true);
        } else if (sheetApply === "learn-spell" && Object.hasOwn(borderlandsSpells, id)) {
          const learned = spellsOf(character);
          if (!learned.includes(id)) update({ ...sheet, spellIds: [...learned, id] }, true);
        }
        root.querySelector(`select[data-sheet-picker="${sheetApply}"]`)?.focus();
      }
    });

    root.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.closest("input[data-sheet-group]")) {
        event.preventDefault();
      }
    });
  }

  globalThis.borderlandsSheetUI = { sections, bind, refresh };
})();
