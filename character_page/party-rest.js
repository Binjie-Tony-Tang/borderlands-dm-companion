(() => {
  // Supplied Class Boards; Play Guide PDF 26 (Long Rest) and 28 (Short Rest).
  const shortRestHp = { fighter: 7, rogue: 5, cleric: 4, wizard: 4 };
  const secondWind = "class:fighter:second-wind";
  const wizardSpell = "class:wizard:spellcasting";
  const wizardRecovery = "class:wizard:short-rest-recovery";
  const identity = choice => [choice?.name, choice?.classId, choice?.backgroundId, choice?.speciesId];
  const sameCharacter = (actor, choice) => {
    try { return JSON.stringify(identity(JSON.parse(actor.binding))) === JSON.stringify(identity(choice)); }
    catch { return false; }
  };

  function prepare(roster, kind, options = {}) {
    if (!["short", "long"].includes(kind)) throw new Error("Choose a Short Rest or Long Rest.");
    if (roster.combat && roster.combat.phase !== "ended") {
      throw new Error("Finish or cancel the current combat before applying a party rest.");
    }
    const hours = kind === "short" ? 1 : 8;
    const source = globalThis.borderlandsSession?.ensure(roster) ?? roster;
    if (source.session?.pending?.length || [...source.slots.map(choice => choice?.sheet?.state), ...(source.session?.companions ?? [])]
      .some(state => state?.pendingConcentration?.length)) {
      throw new Error("Resolve pending rolls before applying a party rest.");
    }
    const next = structuredClone(source);
    const rows = [];
    for (const [slot, choice] of source.slots.entries()) {
      if (!choice) continue;
      const character = borderlandsCharacter.derive(choice);
      const actors = source.combat?.actors.filter(actor => actor.side === "party" && actor.slot === slot
        && sameCharacter(actor, choice)) ?? [];
      const dead = choice.sheet?.state?.death?.dead || actors.some(actor => actor.death?.dead);
      const skipped = dead ? "dead" : character.currentHp < 1 ? "zero-hp" : null;
      const row = { slot, name: choice.name || character.job.en, character, skipped, before: character.currentHp,
        after: character.currentHp, powers: [], wizardOption: false };
      rows.push(row);
      if (skipped) continue;
      if (kind === "long" && next.adventure?.uses) delete next.adventure.uses[`woods:sacred-spring:heal:${slot}`];
      const sheet = { ...choice.sheet, stats: { ...choice.sheet?.stats }, power: { ...choice.sheet?.power } };
      row.after = kind === "long" ? character.hp : Math.min(character.hp, character.currentHp + shortRestHp[choice.classId]);
      sheet.stats.currentHp = row.after;
      const recovered = power => {
        if (kind === "long") return Math.max(power.remaining, power.count);
        if (power.id === secondWind) return Math.max(power.remaining, Math.min(power.count, power.remaining + 1));
        if (["class:fighter:action-surge", "class:cleric:channel-divinity"].includes(power.id)) return Math.max(power.remaining, Math.min(power.count, power.remaining + 1));
        return power.remaining;
      };
      for (const power of character.powers) {
        const after = recovered(power);
        if (after !== power.remaining) {
          sheet.power[power.id] = after;
          row.powers.push({ ...power, before: power.remaining, after });
        }
      }
      const casting = character.powers.find(power => power.id === wizardSpell);
      const casting2 = character.powers.find(power => power.id === "class:wizard:spellcasting-level-2");
      const recovery = character.powers.find(power => power.id === wizardRecovery);
      row.wizardOption = kind === "short" && Boolean(recovery?.remaining > 0
        && (casting?.remaining < casting?.count || casting2?.remaining < casting2?.count));
      if (row.wizardOption && character.level === 3) {
        row.wizardOptions = [casting?.remaining < casting?.count ? { value: "1", en: "Recover up to two level 1 tokens", zh: "恢复最多 2 枚 1 环标记" } : null,
          casting2?.remaining < casting2?.count ? { value: "2", en: "Recover one level 2 token", zh: "恢复 1 枚 2 环标记" } : null].filter(Boolean);
        const requested = options.wizardRecovery?.[slot];
        row.wizardSelection = requested === false || requested === "none" ? "none"
          : row.wizardOptions.some(option => option.value === requested) ? requested : row.wizardOptions[0].value;
      }
      if (row.wizardOption && options.wizardRecovery?.[slot] !== false && row.wizardSelection !== "none") {
        const token = row.wizardSelection === "2" ? casting2 : casting;
        const amount = character.level === 3 && token === casting ? 2 : 1;
        const after = Math.min(token.count, token.remaining + amount);
        sheet.power[token.id] = after;
        sheet.power[recovery.id] = recovery.remaining - 1;
        row.powers.push({ ...token, before: token.remaining, after },
          { ...recovery, before: recovery.remaining, after: recovery.remaining - 1 });
      }
      if (kind === "long" && sheet.state?.conditions) sheet.state = { ...sheet.state,
        conditions: sheet.state.conditions.flatMap(effect => {
          if (effect.untilLongRest || ["combat-healer-treated", "arcane-ward"].includes(effect.key ?? effect.id)) return [];
          if ((effect.key ?? effect.id) !== "exhaustion") return [effect];
          const field = Number.isInteger(effect.levels) ? "levels" : Number.isInteger(effect.level) ? "level" : null;
          return !field ? [effect] : effect[field] <= 1 ? [] : [{ ...effect, [field]: effect[field] - 1 }];
        }) };
      if (kind === "long" && sheet.state) {
        delete sheet.state.concentration;
        delete sheet.state.pendingConcentration;
      }
      next.slots[slot] = { ...choice, sheet };
      // Keep the completed fight's party snapshot in sync, without discarding its log or other effects.
      for (const actor of next.combat?.actors ?? []) {
        if (actor.side !== "party" || actor.slot !== slot || actor.binding !== JSON.stringify(choice)) continue;
        actor.hp = row.after;
        actor.maxHp = character.hp;
        actor.binding = JSON.stringify(next.slots[slot]);
        actor.conditions = actor.conditions.filter(effect => effect.id !== "knockout");
        if (kind === "long") {
          actor.conditions = actor.conditions.flatMap(effect => {
            if (effect.untilLongRest || ["combat-healer-treated", "arcane-ward"].includes(effect.key ?? effect.id)) return [];
            if ((effect.key ?? effect.id) !== "exhaustion") return [effect];
            const field = Number.isInteger(effect.levels) ? "levels" : Number.isInteger(effect.level) ? "level" : null;
            if (!field) return [effect];
            return effect[field] <= 1 ? [] : [{ ...effect, [field]: effect[field] - 1 }];
          });
          const concentration = actor.concentration;
          delete actor.concentration;
          delete actor.pendingConcentration;
          if (concentration) for (const target of next.combat.actors) {
            target.conditions = target.conditions.filter(effect => effect.concentration !== concentration);
          }
        }
      }
    }
    if (!rows.some(row => !row.skipped)) return { roster: next, rows, hours, eligible: 0 };
    if (kind === "long" && globalThis.borderlandsSession) {
      const ended = new Set(rows.filter(row => !row.skipped).map(row => source.slots[row.slot].sheet?.state?.concentration).filter(Boolean));
      for (const state of [...next.slots.filter(Boolean).map(choice => choice.sheet?.state), ...(next.session?.companions ?? [])].filter(Boolean)) {
        state.conditions = state.conditions.filter(effect => !ended.has(effect.concentration));
      }
    }
    if (next.keep) {
      next.keep.log.push(`${kind === "short" ? "Short" : "Long"} Rest: ${rows.map(row =>
        `${row.name} ${row.skipped ? "skipped (" + row.skipped + ")" : row.before + " → " + row.after + " HP"}`).join("; ")}.`);
    }
    if (next.combat) next.combat.log.push({ round: next.combat.round, action: `${kind === "short" ? "Short" : "Long"} Rest`,
      summary: `Party rest completed (${hours}h). ${rows.filter(row => !row.skipped).map(row => `${row.name} ${row.before} → ${row.after} HP`).join("; ")}.` });
    return { roster: globalThis.borderlandsSession ? borderlandsSession.reconcile(next) : next, rows, hours, eligible: rows.filter(row => !row.skipped).length };
  }

  globalThis.borderlandsRest = { prepare };
})();
