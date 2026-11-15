(() => {
  "use strict";
  const config = globalThis.borderlandsAdventureConfig?.keep;
  if (!config || !globalThis.keepContent) {
    throw new Error("Install adventure_page/private-config.js with a keep adapter and the private keep_page/content.js. See docs/private-content-interface.md.");
  }
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const locations = keepContent.locations || [], scenes = keepContent.scenes || [], offers = keepContent.offers || [];
  const sceneById = new Map(scenes.map(scene => [scene.id, scene])), offerById = new Map(offers.map(offer => [offer.id, offer]));
  const params = new URLSearchParams(location.search);
  let selected = locations.find(place => place.number === Number(params.get("place")))?.number ?? config.initialLocation ?? locations[0]?.number;
  let language = localStorage.getItem("borderlands.content-language") === "zh-Hans" ? "zh-Hans" : "en";
  let store, roster, scaling, checkout, activeEvent = sceneById.get(params.get("event")) || null, buyer = null, busy = false;
  const chinese = () => language === "zh-Hans";
  const text = value => Array.isArray(value) ? value[chinese() ? 1 : 0] || value[0] : value;
  const title = record => record ? chinese() ? record.zh || record.name || record.en || record.title : record.name || record.en || record.title : "";
  const keep = () => roster?.keep ?? keepTransactions.empty();
  const party = () => (roster?.slots || []).flatMap((choice, index) => choice ? [{ index, character: borderlandsCharacter.derive(choice) }] : []);
  const characterName = character => character.choice.name || title(character.job);
  const clock = (day, hour) => `Day ${day}, ${String(hour).padStart(2, "0")}:00`;
  const copy = value => value ? `<p class="detail-copy" lang="${language}">${safe(text(value))}</p>` : "";
  const readAloud = value => value ? `<blockquote class="read-aloud"><strong>Read aloud</strong>${copy(value)}</blockquote>` : "";
  const button = (action, id, label, disabled = false) => `<button class="secondary" type="button" data-action="${action}" data-id="${safe(id)}"${disabled ? " disabled" : ""}>${safe(text(label))}</button>`;
  const link = (href, label) => typeof href === "string" && href.startsWith("/database/") ? `<a href="${safe(href)}" target="_blank" rel="noopener">${safe(text(label))} ↗</a>` : "";
  const context = () => ({ roster, state: keep(), buyer, selected, language, scaling, locations, scenes, offers });
  const finished = value => ["completed", "rewarded"].includes(value);
  const questKey = scene => config.questKey?.(scene, context()) || scene.id;
  const eligible = (scene, completing = false) => Boolean(scene && !finished(keep().quests[questKey(scene)])
    && (!scene.period || scene.period === keep().period)
    && (!scene.prerequisite || finished(keep().quests[scene.prerequisite]))
    && (config.eligible?.(scene, { ...context(), completing }) ?? true));

  function status(message = "", error = false) {
    $("keep-status").textContent = message; $("keep-status").hidden = !message;
    $("keep-status").classList.toggle("error", error);
  }
  const historyControls = borderlandsDashboardControls.mount({ getStore: () => store, isBlocked: () => busy,
    setBusy: value => { busy = value; }, status,
    onChange: async updated => { roster = updated; if (!roster.slots[buyer]) buyer = party()[0]?.index ?? null; render(); await refreshScaling(); } });
  async function save(next, message) {
    if (busy || !store) return false;
    busy = true; historyControls.update();
    try { roster = await store.save(next); if (!roster.slots[buyer]) buyer = party()[0]?.index ?? null; render(); status(message); return true; }
    catch (error) { status(error.message, true); return false; }
    finally { busy = false; historyControls.update(); }
  }
  function updateKeep(change, message) {
    const previous = keep(), next = { ...previous, ...change, log: [...previous.log, ...(message ? [message] : [])] };
    return save({ ...roster, keep: next }, message);
  }
  function sceneRow(scene) {
    return `<div class="scene-row"><div><strong>${safe(title(scene))}</strong><small>${safe(keep().quests[questKey(scene)] || (eligible(scene) ? "Available" : "See conditions"))}</small></div>${button("scene", scene.id, "Open")}</div>`;
  }
  function npcSection(npc, quests = []) {
    return `<details><summary>${safe(title(npc))} · ${safe(text(npc.role))}</summary>${copy(npc.notes)}${copy(npc.stats)}
      <div class="keep-links">${link(npc.record, "Reference")}${link(npc.monster, "Statistics")}</div>
      ${quests.map(sceneRow).join("")}</details>`;
  }
  function encounterPreview(scene) {
    const groups = config.encounterGroups?.(scene, context()) ?? scene.groups ?? [];
    if (!groups.length) return "";
    const href = combatHandoff.url({ title: [title(scene), scene.zh || title(scene)], groups,
      back: `../keep_page/?place=${selected}&event=${encodeURIComponent(scene.id)}` });
    return `<details open><summary>Encounter preview</summary><ul class="prepared-list">${groups.map(group =>
      `<li>${safe(group.count ?? "—")} × ${safe(text(group.name) || group.id)} · ${safe(group.hp ?? "—")} HP${group.ac == null ? "" : ` · AC ${safe(group.ac)}`}</li>`).join("")}</ul>
      ${roster ? `<a class="primary" href="${safe(href)}">Set up combat</a>` : ""}</details>`;
  }
  function sceneCard(scene) {
    const current = keep().quests[questKey(scene)], trackable = sceneById.has(scene.id), canRun = trackable && eligible(scene), isFinished = finished(current);
    const extraActions = config.sceneActions?.(scene, context()) || [];
    return `<section class="event-card"><div class="event-head"><h3>${safe(title(scene))}</h3>${button("close", "", "Close")}</div>
      ${readAloud(scene.intro)}<details open><summary>DM notes</summary>${copy(scene.notes)}</details>${encounterPreview(scene)}
      <details><summary>Finds and rewards</summary>${copy(scene.loot)}</details><div class="keep-links">${link(scene.source, "Reference")}</div>
      ${globalThis.borderlandsHazards?.at("keep", scene.id).length ? button("hazard", scene.id, "Resolve adventure effect", !store) : ""}
      <div class="event-actions">${!current && canRun ? button("start", scene.id, "Mark active", !store) : ""}
      ${trackable && !isFinished && eligible(scene, true) ? button("complete", scene.id, "Mark complete", !store) : ""}
      ${current === "completed" && scene.reward ? button("reward", scene.id, "Record reward", !store || buyer === null) : ""}
      ${extraActions.map(action => button("private", `${scene.id}|${action.id}`, action.label, !store)).join("")}</div></section>`;
  }
  function offerRow(offer) {
    const state = config.offerState?.(offer, context()) || {};
    const unavailable = offer.unavailable || state.unavailable;
    return `<div class="offer-row"><div><strong>${safe(title(offer))}</strong><small>${safe(offer.gp == null ? "" : `${offer.gp} GP`)} ${safe(text(state.label))}</small></div>
      ${button("offer", offer.id, "Select", !store || buyer === null || unavailable)}</div>`;
  }
  function renderParty() {
    const state = keep(); $("party-caption").textContent = roster ? `${roster.playerCount} players · ${clock(state.day, state.hour)}` : "Roster unavailable";
    $("party-list").innerHTML = party().map(({ index, character }) => {
      const actor = borderlandsSession.actorFor(roster, index), stats = combatEngine.currentStats(actor);
      const conditions = actor.conditions.map(effect => chinese() ? effect.zh || effect.name : effect.name).filter(Boolean);
      return `<div><button class="buyer" data-buyer="${index}" aria-pressed="${buyer === index}"><strong>${safe(characterName(character))}</strong>
        <span>${character.gold} GP · ${character.currentHp}/${character.hp} HP · AC ${stats.ac}${stats.speed == null ? "" : ` · ${stats.speed} ft`}</span>${conditions.length ? `<small>${safe(conditions.join(" · "))}</small>` : ""}</button></div>`;
    }).join("") || '<p class="muted">Add a character on the Characters page.</p>';
    $("keep-day").value = state.day; $("keep-hour").value = state.hour;
    $("clock-form").querySelector("button").disabled = !store;
    $("keep-log").innerHTML = state.log.slice(-12).reverse().map(line => `<li>${safe(line)}</li>`).join("");
  }
  function renderPlace() {
    const place = locations.find(entry => entry.number === selected);
    if (!place) { $("place-panel").innerHTML = '<p class="muted">No locations are installed in the private content pack.</p>'; return; }
    const residents = (place.npcs || []).filter(npc => config.visibleNpc?.(npc, place, context()) ?? true);
    const localScenes = scenes.filter(scene => scene.location === selected);
    const privateSections = config.locationSections?.(place, context()) || [];
    $("place-panel").innerHTML = `<h2 class="place-title"><span class="place-number">${safe(place.number)}</span>${safe(title(place))}</h2>
      ${activeEvent ? sceneCard(activeEvent) : readAloud(config.locationIntro?.(place, context()) ?? place.intro)}
      ${offers.filter(offer => offer.location === selected).map(offerRow).join("")}
      ${residents.map(npc => npcSection(npc, localScenes.filter(scene => scene.giver === npc.id))).join("")}
      ${localScenes.filter(scene => !residents.some(npc => npc.id === scene.giver)).map(sceneRow).join("")}
      ${privateSections.map(section => `<details><summary>${safe(text(section.title))}</summary>${copy(section.text)}</details>`).join("")}
      <details><summary>Location notes</summary>${copy(place.notes)}</details><div class="keep-links">${link(place.source, "Reference")}</div>`;
  }
  function render() {
    $("lang-en").setAttribute("aria-pressed", String(!chinese())); $("lang-zh").setAttribute("aria-pressed", String(chinese()));
    $("map-pins").innerHTML = locations.map(place => `<button class="map-pin" data-place="${safe(place.number)}" style="left:${Number(place.x)}%;top:${Number(place.y)}%" aria-label="${safe(title(place))}">${safe(place.number)}</button>`).join("");
    $("place-list").innerHTML = locations.map(place => `<button class="place-choice" data-place="${safe(place.number)}" aria-pressed="${place.number === selected}">${safe(title(place))}</button>`).join("");
    const special = config.specialEvents?.[config.specialEventId];
    $("call-watch").hidden = !special; if (special) $("call-watch").textContent = title(special);
    renderParty(); renderPlace(); historyControls.update();
  }
  function fieldHTML(field) {
    const value = field.value ?? "", label = safe(text(field.label) || field.name), name = safe(field.name);
    if (field.type === "checkbox") return `<label><input type="checkbox" name="${name}"${value ? " checked" : ""}> ${label}</label>`;
    if (field.type === "slots" || field.type === "select") {
      const options = field.type === "slots" ? party().map(({ index, character }) => [index, characterName(character)]) : Object.entries(field.options || {});
      return `<label>${label}<select name="${name}"${field.multiple ? " multiple" : ""}${field.type === "slots" || field.numeric ? ' data-number="true"' : ""}>${options.map(([id, optionLabel]) => `<option value="${safe(id)}"${String(id) === String(value) ? " selected" : ""}>${safe(text(optionLabel))}</option>`).join("")}</select></label>`;
    }
    if (field.type === "dice") return `<fieldset><legend>${label}</legend>${Array.from({ length: field.count }, (_, i) => `<label>d${field.sides} · ${i + 1}<input type="number" name="${name}" data-array="true" min="1" max="${field.sides}" step="1" required></label>`).join("")}</fieldset>`;
    return `<label>${label}<input name="${name}" type="${field.type === "number" ? "number" : "text"}" value="${safe(value)}"${field.min == null ? "" : ` min="${field.min}"`}${field.max == null ? "" : ` max="${field.max}"`}${field.required === false ? "" : " required"}${field.type === "number" ? ' step="1"' : ""}></label>`;
  }
  function openOffer(offer, rewardScene = null) {
    if (!offer) throw new Error("The private content adapter did not provide an offer.");
    checkout = { offer, buyer, rewardScene };
    const fields = config.offerFields?.(offer, context()) ?? offer.fields ?? [];
    $("checkout-title").textContent = title(offer); $("checkout-fields").innerHTML = copy(offer.notes) + fields.map(fieldHTML).join("");
    $("checkout").showModal(); previewCheckout();
  }
  function readOptions() {
    const form = $("checkout-form"), data = new FormData(form), result = { buyer: checkout.buyer };
    for (const name of new Set(data.keys())) {
      const nodes = [...form.querySelectorAll("[name]")].filter(node => node.name === name), first = nodes[0];
      const convert = value => first?.type === "number" || first?.dataset.number === "true" ? Number(value) : value;
      result[name] = first?.type === "checkbox" ? data.has(name) : nodes.length > 1 || first?.multiple || first?.dataset.array === "true" ? data.getAll(name).map(convert) : convert(data.get(name));
    }
    for (const field of form.querySelectorAll('input[type="checkbox"]')) result[field.name] = data.has(field.name);
    return result;
  }
  function previewCheckout() {
    if (!checkout) return null;
    let result = null;
    try {
      if (![...$("checkout-form").querySelectorAll("input")].every(input => !input.willValidate || input.validity.valid)) throw new Error("Fill in the required values.");
      result = keepTransactions.preview(roster, checkout.offer, readOptions());
      if (checkout.rewardScene) {
        result.next.keep.quests[questKey(checkout.rewardScene)] = "rewarded";
      }
      $("checkout-preview").innerHTML = `<ul>${result.lines.map(line => `<li>${safe(line)}</li>`).join("")}</ul>`;
      $("checkout-preview").classList.remove("error");
    } catch (error) { $("checkout-preview").textContent = error.message; $("checkout-preview").classList.add("error"); }
    $("checkout-confirm").disabled = !result || busy; return result;
  }
  function openPlace(id) { if (locations.some(place => place.number === id)) { selected = id; activeEvent = null; render(); } }
  for (const root of [$("map-pins"), $("place-list")]) root.addEventListener("click", event => { const marker = event.target.closest("[data-place]"); if (marker) openPlace(Number(marker.dataset.place)); });
  $("party-list").addEventListener("click", event => { const row = event.target.closest("[data-buyer]"); if (row) { buyer = Number(row.dataset.buyer); render(); } });
  $("draw-scene").addEventListener("click", () => {
    const pool = config.randomScenes?.(context()) ?? keepContent.trailEncounters ?? [];
    if (!pool.length) { status("No random scenes are configured here."); return; }
    activeEvent = pool[Math.floor(Math.random() * pool.length)]; renderPlace();
  });
  $("call-watch").addEventListener("click", () => { activeEvent = config.specialEvents?.[config.specialEventId] || null; renderPlace(); });
  $("place-panel").addEventListener("click", async event => {
    const control = event.target.closest("[data-action]"); if (!control || busy) return;
    const action = control.dataset.action, id = control.dataset.id, scene = sceneById.get(id);
    try {
      if (action === "scene") activeEvent = scene;
      else if (action === "close") activeEvent = null;
      else if (action === "offer") { openOffer(offerById.get(id)); return; }
      else if (action === "reward") {
        const offer = config.rewardOffer?.(scene, context());
        if (!offer) throw new Error("Install keep.rewardOffer in the private adventure adapter to record this reward.");
        openOffer(offer, scene); return;
      } else if (["start", "complete"].includes(action) && eligible(scene, action === "complete")) {
        const value = action === "start" ? "active" : "completed";
        await updateKeep({ quests: { ...keep().quests, [questKey(scene)]: value } }, `${title(scene)} marked ${value}.`);
      } else if (action === "hazard") { borderlandsHazards.open({ roster, hazards: borderlandsHazards.at("keep", id), language, save }); return; }
      else if (action === "private") {
        if (typeof config.onSceneAction !== "function") throw new Error("Install keep.onSceneAction in the private adventure adapter.");
        const result = config.onSceneAction(id, context());
        if (result?.next) await save(result.next, result.lines?.join(" ") || "Action recorded.");
      }
      renderPlace();
    } catch (error) { status(error.message, true); }
  });
  $("clock-form").addEventListener("submit", event => {
    event.preventDefault(); const state = keep(), day = Number($("keep-day").value), hour = Number($("keep-hour").value);
    if (!Number.isSafeInteger(day) || day < 1 || day > 999 || !Number.isSafeInteger(hour) || hour < 0 || hour > 23 || day * 24 + hour < state.day * 24 + state.hour) { status("Enter a supported time; use Undo to move backwards.", true); return; }
    const period = globalThis.borderlandsAdventureConfig.transactions.periodAt?.(hour) ?? state.period;
    updateKeep({ day, hour, period, effects: state.effects.filter(effect => effect.untilDay * 24 + effect.untilHour > day * 24 + hour) }, `Time set to ${clock(day, hour)}.`);
  });
  $("checkout-close").addEventListener("click", () => { if (!busy) $("checkout").close(); });
  $("checkout").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  $("checkout").addEventListener("close", () => { checkout = null; });
  for (const event of ["input", "change"]) $("checkout-form").addEventListener(event, previewCheckout);
  $("checkout-form").addEventListener("submit", async event => { event.preventDefault(); const result = previewCheckout(); if (result && await save(result.next, result.lines.join(" "))) $("checkout").close(); });
  for (const [id, value] of [["lang-en", "en"], ["lang-zh", "zh-Hans"]]) $(id).addEventListener("click", () => { language = value; localStorage.setItem("borderlands.content-language", value); render(); });
  async function refreshScaling() {
    if (!roster) return;
    try { const response = await fetch(`/api/keep/scaling?players=${roster.playerCount}`, { cache: "no-store" }); if (response.ok) scaling = await response.json(); }
    catch { scaling = null; }
    renderPlace();
  }
  async function initialize() {
    render();
    try { store = await borderlandsStorage.load(); roster = store.roster; buyer = party()[0]?.index ?? null; render(); await refreshScaling(); }
    catch (error) { status(error.message, true); }
  }
  initialize();
})();
