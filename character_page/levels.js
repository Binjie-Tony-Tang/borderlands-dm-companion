// Generic progression logic. Private content must set borderlandsLevelData first.
// The public repository intentionally contains no class boards or card prose.
(() => {
  "use strict";
  const data = globalThis.borderlandsLevelData ?? { boards: {}, subclasses: {}, preparedCounts: {} };
  const clone = value => structuredClone(value);
  const has = (object, key) => Object.hasOwn(object ?? {}, key);

  function boardKey(classId, level, subclassId = "") {
    const key = `${classId}-${level}`;
    return has(data.boards, key) || !subclassId ? key : `${key}-${subclassId}`;
  }

  function resolve(classId, level = 1, subclassId = "") {
    const base = globalThis.borderlandsClasses?.[classId];
    if (!base) return null;
    const selected = data.boards?.[boardKey(classId, level, subclassId)];
    if (!selected) throw new Error("Choose a level and subclass present in the installed private content.");
    const job = clone(base);
    for (let current = 1; current <= level; current++) {
      const board = data.boards[boardKey(classId, current, subclassId)];
      if (!board) throw new Error(`Private content is missing level ${current} for this class.`);
      for (const key of ["hp", "shortRestHp", "spellDC", "spellSlots"]) {
        if (has(board, key)) job[key] = clone(board[key]);
      }
      if (board.skills) job.skills = { ...job.skills, ...clone(board.skills) };
      if (board.powers) job.powers = clone(board.powers);
      if (board.powerAdds) (job.powers ??= []).push(...clone(board.powerAdds));
      if (board.spellAdds) (job.spells ??= []).push(...board.spellAdds);
      if (board.preparedAdds) {
        if (!job.prepared) throw new Error("Private content adds prepared choices without preparation settings.");
        (job.prepared.choices ??= []).push(...board.preparedAdds);
      }
      if (board.featureRemoves) job.features = (job.features ?? []).filter(feature =>
        !board.featureRemoves.includes(feature.id ?? feature.en));
      if (board.featureAdds) (job.features ??= []).push(...clone(board.featureAdds));
      if (board.attacks) job.attacks = clone(board.attacks);
      if (board.attackAdds) (job.attacks ??= []).push(...clone(board.attackAdds));
    }
    if (job.spellSlots) {
      job.powers ??= [];
      for (const [spellLevel, count] of Object.entries(job.spellSlots)) {
        // Labels are UI defaults; a private data pack may supply its own labels.
        const labels = data.spellPoolLabels?.[spellLevel] ?? {
          en: spellLevel === "1" ? "Spellcasting" : `Spellcasting level ${spellLevel}`,
          zh: `施法（${spellLevel} 环）`,
        };
        const existing = job.powers.find(power => power.en === labels.en || power.spellLevel === Number(spellLevel));
        if (existing) Object.assign(existing, { count, spellLevel: Number(spellLevel) });
        else job.powers.push({ ...labels, count, spellLevel: Number(spellLevel) });
      }
    }
    if (job.prepared) {
      job.prepared.count = data.preparedCounts?.[classId]?.[String(level)] ?? job.prepared.count;
      const defaults = job.prepared.defaults ?? [];
      job.prepared.defaults = [...defaults,
        ...(job.prepared.choices ?? []).filter(id => !defaults.includes(id))].slice(0, job.prepared.count);
    }
    job.level = level;
    job.subclassId = subclassId;
    job.subclass = data.subclasses?.[classId]?.[subclassId] ?? null;
    job.sourcePage = selected.page;
    job.source = selected.source ?? `../database/records/classes/${boardKey(classId, level, subclassId)}.md`;
    return job;
  }

  function advance(input, subclassId = "") {
    const before = globalThis.borderlandsCharacter.derive(input);
    if (!before.complete) throw new Error("Save a complete character before leveling up.");
    const level = before.level + 1;
    const selectedSubclass = subclassId || before.choice.subclassId || "";
    const selected = data.boards?.[boardKey(input.classId, level, selectedSubclass)];
    if (!selected) throw new Error("Choose a level and subclass present in the installed private content.");
    const subclassLevel = !has(data.boards, `${input.classId}-${level}`);
    if (subclassLevel && !has(data.subclasses?.[input.classId], selectedSubclass)) {
      throw new Error("Choose an installed subclass for this level.");
    }
    const candidate = { ...clone(before.choice), level,
      ...(subclassLevel ? { subclassId: selectedSubclass } : {}) };
    // Increasing capacity is distinct from resting. Preserve wounds and uses.
    const nextJob = resolve(input.classId, level, selectedSubclass);
    if (nextJob.prepared) {
      const prepared = before.choice.prepared ?? [];
      candidate.prepared = [...prepared,
        ...(nextJob.prepared.choices ?? []).filter(id => !prepared.includes(id))].slice(0, nextJob.prepared.count);
    }
    const sheet = candidate.sheet ??= {};
    sheet.stats = { ...sheet.stats, currentHp: before.currentHp, gold: before.gold };
    sheet.power = { ...sheet.power };
    const interim = globalThis.borderlandsCharacter.derive(candidate);
    for (const power of interim.powers) {
      const old = before.powers.find(entry => entry.id === power.id);
      sheet.power[power.id] = old ? Math.min(999, old.remaining + Math.max(0, power.count - old.count)) : power.count;
    }
    if (sheet.spellIds) {
      sheet.spellIds = [...new Set([...sheet.spellIds,
        ...interim.defaultSpellIds.filter(id => !before.defaultSpellIds.includes(id))])];
    }
    const choice = globalThis.borderlandsCharacter.normalize(candidate);
    return { choice, before, after: globalThis.borderlandsCharacter.derive(choice) };
  }
  globalThis.borderlandsLevels = { data, resolve, advance, boardKey };
})();
