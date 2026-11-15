(() => {
  const legacyKey = "borderlands.character.slot-1.v1";
  const rosterKey = "borderlands.character.roster.v2";
  const endpoint = "/api/character";
  const unsavedTag = '"uninitialized"';
  const maxBytes = 1024 * 1024;
  const historyLimit = 20;
  const conflictMessage = "The roster changed in another window. Reload this page to open the latest save.";
  const choiceFields = ["name", "classId", "backgroundId", "speciesId", "prepared"];
  const keepFields = ["day", "period", "hour", "quests", "flags", "uses", "effects", "log"];

  function hasShape(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === fields.length
      && fields.every(field => Object.hasOwn(value, field));
  }

  function checkedChoice(value) {
    const hasSheet = value !== null && typeof value === "object" && Object.hasOwn(value, "sheet");
    const optional = ["sheet", "level", "subclassId"].filter(key => value && Object.hasOwn(value, key));
    if (!hasShape(value, [...choiceFields, ...optional])
      || typeof value.name !== "string"
      || typeof value.classId !== "string"
      || typeof value.backgroundId !== "string"
      || typeof value.speciesId !== "string"
      || !Array.isArray(value.prepared)
      || !value.prepared.every(id => typeof id === "string")) {
      throw new Error("The character data is invalid.");
    }
    const { sheet, ...base } = value;
    const { choice, complete } = borderlandsCharacter.derive(base);
    if (!complete || choice.name !== value.name || choice.prepared.length !== value.prepared.length
      || choice.prepared.some((id, index) => id !== value.prepared[index])) {
      throw new Error("The character choices are invalid.");
    }
    return hasSheet ? { ...choice, sheet: borderlandsCharacter.checkedSheet(sheet) } : choice;
  }

  function empty() {
    return { version: 2, playerCount: 4, slots: [null, null, null, null], archive: [] };
  }

  function fromLegacy(character) {
    const roster = empty();
    if (character !== null) roster.slots[0] = checkedChoice(character);
    return roster;
  }

  function validTimestamp(value) {
    if (typeof value !== "string") return false;
    const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!parts || Number(parts[4] ?? 0) > 23 || Number(parts[5] ?? 0) > 59) return false;
    const dateText = `${parts[1]}.${(parts[2] ?? "").padEnd(3, "0")}Z`;
    const date = new Date(dateText);
    return date.getUTCFullYear() >= 1 && date.toISOString() === dateText;
  }

  const integerIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const counter = value => integerIn(value, 0, Number.MAX_SAFE_INTEGER);

  function checkedMap(value, test) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || !Object.entries(value).every(([key, entry]) => key.trim() && [...key].length <= 120 && test(entry))) {
      throw new Error("The Keep save contains an invalid table.");
    }
    return { ...value };
  }

  function checkedKeep(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The Keep save is invalid.");
    }
    // Older saves included physical stock and a separate Keep-only undo record.
    const { stock, undo, ...progress } = value;
    if (!hasShape(progress, keepFields)
      || !integerIn(value.day, 1, 999) || !["day", "night"].includes(value.period)
      || !integerIn(value.hour, 0, 23) || !Array.isArray(value.effects) || !Array.isArray(value.log)
      || !Array.from(value.log).every(entry => typeof entry === "string")) {
      throw new Error("The Keep save is invalid.");
    }
    return {
      day: value.day, period: value.period, hour: value.hour,
      quests: checkedMap(value.quests, entry => ["active", "completed", "rewarded"].includes(entry)),
      flags: checkedMap(value.flags, entry => typeof entry === "boolean"),
      uses: checkedMap(value.uses, counter),
      effects: Array.from(value.effects, effect => {
        if (!hasShape(effect, ["slot", "kind", "untilDay", "untilHour"])
          || !integerIn(effect.slot, 0, 7) || !["house-round", "research"].includes(effect.kind)
          || !integerIn(effect.untilDay, 1, 1000) || !integerIn(effect.untilHour, 0, 23)) {
          throw new Error("The Keep save contains an invalid effect.");
        }
        return { ...effect };
      }),
      log: [...value.log],
    };
  }

  function checkedAdventure(value) {
    if (!hasShape(value, ["rooms", "uses", "log"])
      || !Array.isArray(value.log) || !Array.from(value.log).every(entry => typeof entry === "string")) {
      throw new Error("The adventure map save is invalid.");
    }
    return {
      rooms: checkedMap(value.rooms, state => ["visited", "completed", "rewarded"].includes(state)),
      uses: checkedMap(value.uses, counter),
      log: [...value.log],
    };
  }

  function checkedCombat(value) {
    if (!value || !["setup", "initiative", "fight", "ended"].includes(value.phase)
      || !Array.isArray(value.actors) || !Array.isArray(value.order) || !Array.isArray(value.log)
      || !value.actors.every(actor => actor && typeof actor.id === "string" && Array.isArray(actor.conditions))) {
      throw new Error("The combat save is invalid.");
    }
    return value;
  }

  function decode(payload) {
    if (payload?.version === 1 && hasShape(payload, ["version", "character"])) {
      return fromLegacy(payload.character);
    }
    const fields = ["version", "playerCount", "slots", "archive"];
    if (payload?.version !== 2) {
      throw new Error("Choose a Borderlands roster save (version 1 or 2).");
    }
    const optional = ["keep", "adventure", "combat", "session"].filter(key => Object.hasOwn(payload, key));
    if (!hasShape(payload, [...fields, ...optional])) {
      throw new Error("Choose a Borderlands roster save (version 1 or 2).");
    }
    const { playerCount, slots, archive } = payload;
    if (!Number.isInteger(playerCount) || playerCount < 4 || playerCount > 8
      || !Array.isArray(slots) || slots.length !== playerCount || !Array.isArray(archive)) {
      throw new Error("The roster must have one slot per player and 4 to 8 players.");
    }
    const ids = new Set();
    const checkedArchive = Array.from(archive, entry => {
      if (!hasShape(entry, ["id", "deletedAt", "character"])
        || typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
        || !validTimestamp(entry.deletedAt)) {
        throw new Error("A removed character has an invalid archive entry.");
      }
      ids.add(entry.id);
      return { id: entry.id, deletedAt: entry.deletedAt, character: checkedChoice(entry.character) };
    });
    return {
      version: 2,
      playerCount,
      slots: Array.from(slots, choice => choice === null ? null : checkedChoice(choice)),
      archive: checkedArchive,
      ...(optional.includes("keep") ? { keep: checkedKeep(payload.keep) } : {}),
      ...(optional.includes("adventure") ? { adventure: checkedAdventure(payload.adventure) } : {}),
      ...(optional.includes("combat") ? { combat: checkedCombat(payload.combat) } : {}),
      ...(optional.includes("session") ? { session: checkedSession(payload.session) } : {}),
    };
  }

  function checkedSession(value) {
    if (!hasShape(value, ["elapsedSeconds", "companions", ...(Object.hasOwn(value || {}, "pending") ? ["pending"] : [])]) || !counter(value.elapsedSeconds)
      || !Array.isArray(value.companions) || value.companions.length > 64
      || value.companions.some(entry => !entry || typeof entry.id !== "string" || typeof entry.monster !== "string"
        || typeof entry.name !== "string" || typeof entry.active !== "boolean" || !Array.isArray(entry.conditions)
        || !integerIn(entry.hp, 0, entry.maxHp) || !integerIn(entry.maxHp, 1, 9999))) throw new Error("Invalid adventure companions.");
    return structuredClone(value);
  }
  const prepare = (roster, migrateLegacy = true) => globalThis.borderlandsSession?.ensure(roster, { migrateLegacy }) ?? roster;

  function hasData(roster) {
    return roster.playerCount !== 4 || roster.slots.some(Boolean) || roster.archive.length > 0
      || Boolean(roster.keep || roster.adventure || roster.combat);
  }

  function serialize(roster) {
    const body = JSON.stringify(roster);
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      throw new Error("This roster exceeds the 1 MiB save limit.");
    }
    return body;
  }

  function readBrowserSave() {
    let raw;
    let legacyRaw = null;
    try {
      raw = localStorage.getItem(rosterKey);
      if (raw === null) legacyRaw = localStorage.getItem(legacyKey);
    } catch {
      throw new Error("This browser couldn’t read its saved roster. Allow local storage and reload.");
    }
    try {
      const roster = raw !== null ? decode(JSON.parse(raw))
        : legacyRaw !== null ? fromLegacy(JSON.parse(legacyRaw)) : empty();
      return { raw, legacyRaw, roster: prepare(roster) };
    } catch {
      throw new Error("The existing browser save couldn’t be read. It is still in browser storage.");
    }
  }

  function conflictError() {
    const error = new Error(conflictMessage);
    error.conflict = true;
    return error;
  }

  function browserStore(snapshot) {
    let { raw, legacyRaw } = snapshot;
    const undo = [];
    const redo = [];

    function write(next) {
      const serialized = serialize(next);
      try {
        if (localStorage.getItem(rosterKey) !== raw
          || (raw === null && localStorage.getItem(legacyKey) !== legacyRaw)) {
          throw conflictError();
        }
        localStorage.setItem(rosterKey, serialized);
        raw = serialized;
      } catch (error) {
        if (error.conflict) throw error;
        throw new Error("This browser couldn’t save your roster. Allow local storage and try again.");
      }
      store.roster = next;
      return next;
    }

    function restore(source, destination) {
      if (!source.length) return store.roster;
      const previous = store.roster;
      const updated = write(source.at(-1));
      source.pop();
      destination.push(previous);
      return updated;
    }

    function commit(next) {
      const previous = store.roster;
      const updated = write(next);
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        undo.push(previous);
        if (undo.length > historyLimit) undo.shift();
        redo.length = 0;
      }
      return updated;
    }

    const store = {
      roster: snapshot.roster,
      get history() {
        return { canUndo: undo.length > 0, canRedo: redo.length > 0 };
      },
      async save(roster) {
        const next = prepare(decode(roster), false);
        for (const key of ["keep", "adventure", "combat", "session"]) {
          if (!Object.hasOwn(next, key) && store.roster[key]) next[key] = store.roster[key];
        }
        return commit(next);
      },
      async undo() { return restore(undo, redo); },
      async redo() { return restore(redo, undo); },
      async cancelCombat() {
        if (!store.roster.combat) return store.roster;
        const { combat, ...roster } = store.roster;
        return commit(roster);
      },
      async resetAdventure() {
        const { keep, adventure, combat, ...roster } = store.roster;
        return commit(roster);
      },
      async resetEverything() { return commit(empty()); },
    };
    return store;
  }

  async function loadBrowserStore() {
    const snapshot = readBrowserSave();
    const store = browserStore(snapshot);
    if (snapshot.raw === null && snapshot.legacyRaw !== null) {
      try {
        await store.save(store.roster);
        store.notice = "Your browser character was copied to slot 1.";
      } catch (error) {
        if (error.conflict) return browserStore(readBrowserSave());
        store.notice = "Your old character was loaded from browser storage. The new roster couldn’t be saved.";
      }
    }
    return store;
  }

  async function request({ query = "", ...options } = {}) {
    try {
      return await fetch(endpoint + query, {
        cache: "no-store",
        mode: "same-origin",
        redirect: "error",
        ...options,
      });
    } catch {
      throw new Error("The desktop save service couldn’t be reached. Check that it’s running and try again.");
    }
  }

  async function readResponse(response) {
    try {
      if (!response.ok) throw new Error("Save request failed");
      const etag = response.headers.get("ETag");
      if (!etag) throw new Error("Missing save revision");
      const [undo, redo] = (response.headers.get("X-Borderlands-History") ?? "").split(",");
      return {
        etag,
        roster: prepare(decode(await response.json())),
        history: { canUndo: undo === "1", canRedo: redo === "1" },
      };
    } catch {
      throw new Error("The desktop save couldn’t be read. Check the save file and reload the page.");
    }
  }

  async function load() {
    if (location.protocol === "file:") return loadBrowserStore();
    const response = await request();
    if (response.status === 404) return loadBrowserStore();
    let snapshot = await readResponse(response);
    function setSnapshot(updated) {
      snapshot = updated;
      store.roster = updated.roster;
      store.history = updated.history;
      return updated.roster;
    }

    async function mutate(method, query, body) {
      const headers = { "If-Match": snapshot.etag };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const result = await request({ method, query, headers, body });
      if (result.status === 409) throw conflictError();
      if (!result.ok) {
        throw new Error(result.status === 400
          ? "The desktop save service couldn’t accept this change."
          : "The desktop save couldn’t be updated. Check the save file and try again.");
      }
      return setSnapshot(await readResponse(result));
    }

    const store = {
      roster: snapshot.roster,
      history: snapshot.history,
      async save(roster) {
        return mutate("PUT", "", serialize(prepare(decode(roster), false)));
      },
      undo: () => mutate("POST", "?action=undo"),
      redo: () => mutate("POST", "?action=redo"),
      cancelCombat: () => mutate("POST", "?action=cancel-combat"),
      resetAdventure: () => mutate("POST", "?action=reset-adventure"),
      resetEverything: () => mutate("POST", "?action=reset-everything"),
    };

    // A saved empty roster can result from permanently clearing the bin.
    if (snapshot.etag === unsavedTag && !hasData(snapshot.roster)) {
      let browserRoster;
      try {
        browserRoster = readBrowserSave().roster;
      } catch {
        store.notice = "The browser save couldn’t be read for migration. Browser storage was left intact.";
      }
      if (browserRoster && hasData(browserRoster)) {
        try {
          await store.save(browserRoster);
          store.notice = "Your browser save was copied to the desktop roster.";
        } catch (error) {
          if (!error.conflict) throw error;
          setSnapshot(await readResponse(await request()));
          store.notice = "The desktop roster changed during the copy. Your browser save was kept.";
        }
      }
    }
    return store;
  }

  globalThis.borderlandsStorage = { load, decode, empty, maxBytes };
})();
