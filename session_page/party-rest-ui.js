(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  function mount({ getRoster, getLanguage, isBlocked, commit, notify }) {
    const word = (en, zh) => getLanguage() === "zh-Hans" ? zh : en;
    const nameOf = record => word(record.en, record.zh ? `${record.zh}（${record.en}）` : record.en);
    const dialog = byId("party-rest-dialog");
    const preview = byId("rest-preview");
    const confirm = byId("rest-confirm");
    const buttons = { short: byId("short-rest"), long: byId("long-rest") };
    let pending = null;

    function update() {
      const roster = getRoster();
      const unavailable = isBlocked() || !roster?.slots.some(Boolean);
      buttons.short.disabled = unavailable;
      buttons.long.disabled = unavailable;
      byId("party-rest-title").textContent = word("Party rest", "全队休息");
      byId("party-rest-hint").textContent = word(
        "Preview HP and Power Token recovery. Track time at the table and remove expired effects manually.",
        "预览生命值（HP）与能力标记（Power Tokens）的恢复。请在桌上记录时间，并手动移除到期效果。",
      );
      buttons.short.textContent = word("Short Rest", "短休（Short Rest）");
      buttons.long.textContent = word("Long Rest", "长休（Long Rest）");
    }

    function previewCharacter(row) {
      const character = row.character;
      const title = escape(character.choice.name || nameOf(character.job));
      const skip = row.skipped === "dead" ? word("Skipped: recorded dead.", "跳过：已记录为死亡。")
        : word("Skipped: characters need at least 1 HP to start a rest.", "跳过：角色开始休息时至少需要 1 点生命值。");
      if (row.skipped) return `<section class="rest-character"><h3>${title}</h3><p>${escape(skip)}</p></section>`;
      const powers = row.powers.map(power => `<li>${escape(nameOf(power))}: ${power.before} → ${power.after}</li>`).join("");
      const wizardLabel = word("Wizard recovery (optional)", "法师短休恢复（可选）");
      let recovery = "";
      if (row.wizardOptions?.length) {
        const choices = [{ value: "none", en: "Keep recovery token", zh: "保留短休恢复标记" }, ...row.wizardOptions];
        recovery = `<label>${escape(wizardLabel)} <select data-recovery-slot="${row.slot}">
          ${choices.map(option => `<option value="${option.value}"${row.wizardSelection === option.value ? " selected" : ""}>${escape(word(option.en, option.zh))}</option>`).join("")}
        </select></label>`;
      } else if (row.wizardOption) {
        recovery = `<label><input type="checkbox" data-recovery-slot="${row.slot}"${pending.options.wizardRecovery[row.slot] !== false ? " checked" : ""}>
          ${escape(word("Use the Short Rest recovery token to refill one empty Spellcasting space (optional).",
            "使用短休恢复标记填充一个空的施法（Spellcasting）标记位（可选）。"))}</label>`;
      }
      return `<section class="rest-character"><h3>${title}</h3><p>HP: ${row.before} → ${row.after} / ${character.hp}</p>
        ${powers ? `<ul>${powers}</ul>` : ""}${recovery}</section>`;
    }

    function renderPreview() {
      const { roster, kind, options } = pending;
      const plan = borderlandsRest.prepare(roster, kind, options);
      pending.plan = plan;
      const short = kind === "short";
      byId("rest-title").textContent = short ? word("Complete a Short Rest?", "结算短休（Short Rest）？")
        : word("Complete a Long Rest?", "结算长休（Long Rest）？");
      byId("rest-rules").textContent = short
        ? word("Confirm the party completed 1 hour of light activity without rolling initiative, taking damage, or casting a level 1+ spell. Check any location restrictions.",
          "请确认队伍已完成 1 小时的轻度活动，期间没有掷先攻、受到伤害或施放 1 环及以上法术。请核对地点限制。")
        : word("Confirm at least 8 hours of rest, including 6 hours of sleep. Add 1 hour for each interruption and wait at least 16 hours after the previous Long Rest before starting this rest. Check any location restrictions.",
          "请确认已完成至少 8 小时的休息，其中至少睡眠 6 小时。每次中断额外增加 1 小时，且开始本次长休前须距上次长休结束至少 16 小时。请核对地点限制。");
      preview.innerHTML = plan.rows.map(previewCharacter).join("");
      const living = plan.rows.filter(row => !row.skipped);
      const reminders = [word("Track rest time and effects with other durations at the table.", "请在桌上记录休息时间，并按各自持续时间处理其他效果。")];
      if (!short && living.some(row => row.character.choice.speciesId === "human")) reminders.push(word(
        "Give Humans their physical Heroic Inspiration tokens.", "请为人类（Human）发放实体英雄激励（Heroic Inspiration）标记。"));
      if (living.some(row => row.character.choice.backgroundId === "entertainer")) reminders.push(word(
        "An Entertainer may sing to grant Heroic Inspiration to up to two allies who hear them.", "艺人（Entertainer）可歌唱，使最多两名听见的盟友获得英雄激励（Heroic Inspiration）。"));
      if (!short) reminders.push(word(
        "The app removes one recorded Exhaustion level. Combat Healer can treat rested characters again. Wizards may edit their prepared spells.",
        "应用会移除 1 级已记录的力竭（Exhaustion）。战地治疗（Combat Healer）可再次治疗已长休的角色。法师（Wizard）可以编辑已准备的法术。"));
      byId("rest-reminders").textContent = reminders.join(" ");
      byId("rest-source").textContent = word("Rest rules ↗", "休息规则 ↗");
      byId("rest-cancel").textContent = word("Cancel", "取消");
      confirm.textContent = word("Apply completed rest", "结算已完成的休息");
      confirm.disabled = !plan.eligible;
    }

    for (const [kind, button] of Object.entries(buttons)) button.addEventListener("click", () => {
      if (isBlocked() || pending || document.querySelector("dialog[open]")) return;
      pending = { roster: getRoster(), kind, options: { wizardRecovery: {} } };
      try {
        renderPreview();
        dialog.returnValue = "cancel";
        dialog.showModal();
      } catch (error) {
        pending = null;
        notify(error.message, true);
      }
    });
    preview.addEventListener("change", event => {
      const input = event.target;
      if (!pending || input.dataset.recoverySlot === undefined) return;
      const slot = input.dataset.recoverySlot;
      pending.options.wizardRecovery[slot] = input.type === "checkbox" ? input.checked : input.value;
      renderPreview();
      preview.querySelector(`[data-recovery-slot="${slot}"]`)?.focus();
    });
    dialog.addEventListener("close", async () => {
      const rest = pending;
      pending = null;
      if (dialog.returnValue !== "confirm" || !rest?.plan.eligible) return;
      if (getRoster() !== rest.roster || isBlocked()) {
        notify(word("The party changed. Open a new rest preview.", "队伍已更改。请重新预览休息。"), true);
        return;
      }
      const message = rest.kind === "short"
        ? word("Party Short Rest completed. Use Undo to reverse it.", "全队短休已结算。可用撤销（Undo）还原。")
        : word("Party Long Rest completed. Use Undo to reverse it.", "全队长休已结算。可用撤销（Undo）还原。");
      await commit(rest.plan.roster, message);
    });

    return { update };
  }
  globalThis.borderlandsPartyRestUI = { mount };
})();
