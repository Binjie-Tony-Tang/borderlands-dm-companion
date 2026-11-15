const borderlandsDashboardControls = (() => {
  const resets = {
    resetAdventure: {
      title: "Reset adventure?",
      detail: "Clear Keep quests, explored rooms, rewards, adventure logs, and combat. Keep time, bank records, and active effects also reset. The current party and character sheets carry over. Choose Undo to restore the previous adventure.",
      label: "Reset adventure",
      success: "Adventure reset.",
    },
    resetEverything: {
      title: "Reset everything?",
      detail: "Clear the adventure, all characters, and the Rubbish Bin. The roster returns to four empty slots. Choose Undo to restore the previous save.",
      label: "Reset everything",
      success: "Dashboard reset to four empty slots.",
    },
  };

  function historyButton(label, shortcuts, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-keyshortcuts", shortcuts);
    return button;
  }

  function mount({ getStore, isBlocked, setBusy, onChange, status, confirmReset }) {
    const history = document.querySelector("[data-dashboard-history]");
    const undo = historyButton("Undo", "Control+Z Meta+Z", "Undo last saved change (Ctrl+Z / Cmd+Z)");
    const redo = historyButton("Redo", "Control+Y Control+Shift+Z Meta+Y Meta+Shift+Z", "Redo last change (Ctrl+Y / Cmd+Shift+Z)");
    const resetButtons = document.querySelectorAll("[data-dashboard-reset]");
    let pending = false;

    history.setAttribute("role", "group");
    history.setAttribute("aria-label", "Dashboard history");
    history.append(undo, redo);

    function update() {
      const store = getStore();
      const blocked = pending || isBlocked();
      undo.disabled = blocked || !store?.history?.canUndo;
      redo.disabled = blocked || !store?.history?.canRedo;
      for (const button of resetButtons) {
        button.disabled = blocked || typeof store?.[button.dataset.dashboardReset] !== "function";
      }
    }

    async function run(action) {
      const store = getStore();
      if (pending || isBlocked() || !store || document.querySelector("dialog[open]")) return;
      if ((action === "undo" && undo.disabled) || (action === "redo" && redo.disabled)) return;
      const reset = resets[action];
      let saving = false;
      pending = true;
      update();
      try {
        if (reset && !await confirmReset(reset.title, reset.detail, reset.label)) return;
        saving = true;
        setBusy(true);
        const roster = await store[action]();
        await onChange(roster, action);
        status(reset?.success ?? (action === "undo" ? "Last saved change undone." : "Change redone."));
      } catch (error) {
        status(error.message, true);
      } finally {
        pending = false;
        if (saving) setBusy(false);
        update();
      }
    }

    undo.addEventListener("click", () => run("undo"));
    redo.addEventListener("click", () => run("redo"));
    for (const button of resetButtons) {
      button.addEventListener("click", () => run(button.dataset.dashboardReset));
    }

    document.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.target instanceof Element && (event.target.isContentEditable || event.target.closest("input, select, textarea"))) return;
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && !event.shiftKey)) {
        const action = key === "z" && !event.shiftKey ? "undo" : "redo";
        if ((action === "undo" ? undo : redo).disabled) return;
        event.preventDefault();
        run(action);
      }
    });

    window.addEventListener("pageshow", event => {
      if (event.persisted && !pending && !isBlocked() && !document.querySelector("dialog[open]")) location.reload();
    });

    update();
    return { update };
  }

  return { mount };
})();
