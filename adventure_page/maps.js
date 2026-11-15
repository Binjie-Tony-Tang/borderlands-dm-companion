(() => {
  const privateConfig = globalThis.borderlandsAdventureConfig?.trail;
  if (!privateConfig) throw new Error("Install adventure_page/private-config.js with a trail adapter. See docs/private-content-interface.md.");
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const mapList = [...borderlandsWilderness, ...borderlandsCavesEarly, ...borderlandsCavesLate];
  const maps = new Map(mapList.map(map => [map.id, map]));
  const params = new URLSearchParams(location.search);
  let map = maps.get(params.get("map")) ?? maps.get("wilderness");
  const isCave = entry => /^cave-[a-k]$/.test(entry.id);
  const statusLabels = { visited: "Explored", completed: "Complete", rewarded: "Reward recorded" };
  const languageKey = "borderlands.content-language";
  let language = localStorage.getItem(languageKey) === "zh-Hans" ? "zh-Hans" : "en";
  let selected = map.points.find(point => point.id === params.get("point")) ?? null;
  let roll = null;
  let roster, store, pending;
  let buyer = null;
  let busy = false;
  let cards = {};

  const content = value => Array.isArray(value) ? value[language === "zh-Hans" ? 1 : 0] || value[0] : value;
  const itemName = item => language === "zh-Hans" ? item.zh || item.en : item.en;
  const mapURL = (id, point) => id === "keep" || id === "keep-on-the-borderlands" ? "../keep_page/?v=adventure-maps"
    : `./?map=${encodeURIComponent(id)}${point ? `&point=${encodeURIComponent(point)}` : ""}`;
  const ref = (path, label) => path?.startsWith("/database/")
    ? `<a href="${escape(path)}" target="_blank" rel="noopener">${escape(label)} ↗</a>` : "";
  const cardPath = (group, id) => `/database/records/${group}/${id}.md`;
  const paragraph = value => value ? `<p class="detail-copy" lang="${language}">${escape(content(value))}</p>` : "";
  const readAloud = value => value ? `<blockquote class="read-aloud"><strong>Read aloud</strong>
    <p lang="${language}">${escape(content(value))}</p></blockquote>` : "";
  const disclosure = (heading, body) => body ? `<details><summary>${escape(heading)}</summary>${body}</details>` : "";
  const action = (id, label, disabled = false) => `<button type="button" class="secondary" data-action="${id}"${disabled ? " disabled" : ""}>${escape(label)}</button>`;
  const state = () => roster?.adventure ?? { rooms: {}, uses: {}, log: [] };
  const pointKey = point => `${map.id}:${point.id}`;
  const roomStatus = point => state().rooms[pointKey(point)];
  const party = () => (roster?.slots ?? []).flatMap((choice, index) =>
    choice ? [{ index, character: borderlandsCharacter.derive(choice) }] : []);
  const characterName = character => character.choice.name || (language === "zh-Hans" ? character.job.zh : character.job.en);

  const trailBaseCounts = privateConfig.baseCounts || {};
  const trailFriends = privateConfig.friends || {};
  const trailNames = privateConfig.names || {};
  const trailEncounters = keepContent.trailEncounters.map(entry => ({
    id: entry.id, title: [entry.name, entry.zh], read: entry.intro, notes: entry.notes,
    treasure: entry.loot, source: entry.source,
    creatures: entry.creatures.filter(group => !trailFriends[group.id]).map(group => ({
      id: group.id, count: trailBaseCounts[entry.id] ?? group.count ?? 1, name: trailNames[group.id] ?? group.name,
      printed: !Object.hasOwn(trailBaseCounts, entry.id),
    })),
    npcs: entry.creatures.filter(group => trailFriends[group.id]).map(group => {
      const [id, name] = trailFriends[group.id];
      return { id, name, card: group.id, record: Boolean(id) };
    }),
    ...(privateConfig.offers?.[entry.id] ? { offers: privateConfig.offers[entry.id] } : {}),
  }));
  const story = params.get("map") === "intro";
  if (story) {
    map = borderlandsIntro(trailEncounters);
    selected = map.points.find(point => point.id === params.get("point")) ?? map.points[0];
    document.querySelector(".keep-board").classList.add("story-board");
    document.querySelector(".map-image").hidden = true;
    $("map-select").closest("label").hidden = true;
  }
  const randomPool = map.random === "trail" ? trailEncounters : map.random ?? [];
  const corePool = map.points.filter(point => point.core);
  const returnedDraw = randomPool.find(point => point.id === params.get("draw"));
  if (returnedDraw) roll = { point: returnedDraw, random: true, die: randomPool.indexOf(returnedDraw) + 1,
    key: `${map.id}:encounter:${params.get("drawKey")?.match(/^[a-z0-9-]{36}$/)?.[0] ?? crypto.randomUUID()}` };

  function notify(message = "", error = false) {
    const target = $("map-status");
    target.textContent = message;
    target.hidden = !message;
    target.classList.toggle("error", error);
  }

  const historyControls = borderlandsDashboardControls.mount({
    getStore: () => store,
    isBlocked: () => busy,
    setBusy(value) { busy = value; },
    onChange(updated) {
      roster = updated;
      render();
    },
    status: notify,
  });

  function syncBuyer() {
    if (buyer === null || !roster?.slots[buyer]) buyer = party()[0]?.index ?? null;
  }

  async function save(next, message) {
    if (busy || !store) return false;
    busy = true;
    historyControls.update();
    try {
      roster = await store.save(next);
      render();
      notify(message);
      return true;
    } catch (error) {
      notify(error.message, true);
      return false;
    } finally {
      busy = false;
      historyControls.update();
    }
  }

  function pointButton(point, pin) {
    const done = roomStatus(point);
    const label = point.label ?? "";
    const coords = pin ? ` style="left:${point.x}%;top:${point.y}%" aria-label="${escape(`${label} · ${content(point.title)}`)}" title="${escape(content(point.title))}"` : "";
    return `<button type="button" class="${pin ? "map-pin" : "place-choice"}" data-point="${escape(point.id)}"${coords}
      aria-pressed="${selected === point && !roll?.random}" data-visited="${Boolean(done)}">${pin ? escape(label.length > 3 ? label[0] : label)
      : `${label ? `<span class="place-number" aria-hidden="true">${escape(label)}</span>` : ""}
      <span lang="${language}">${escape(content(point.title))}${done ? `<small>${statusLabels[done]}</small>` : ""}</span>`}</button>`;
  }

  function imageURL(original = map.original) {
    const version = map.id === "caves-of-chaos" ? 2 : 1;
    return original ? `/database/maps/originals/${map.id}.png` : `/database/maps/${map.id}/${map.id}-redraw-v${version}.png`;
  }

  function renderMap() {
    if (story) {
      $("point-list").innerHTML = map.points.map(point => pointButton(point, false)).join("");
      return;
    }
    const image = $("map-art");
    if (image.getAttribute("src") !== imageURL()) image.src = imageURL();
    image.alt = content(map.title);
    const source = map.original ? imageURL(false) : imageURL(true);
    $("map-source").innerHTML = `<a href="${escape(source)}" target="_blank" rel="noopener">${map.original ? "Map redraw" : "Original map"} ↗</a>
      ${ref(map.source, "Adventure booklet")}`;
    $("map-pins").innerHTML = map.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(point => pointButton(point, true)).join("");
    $("point-list").innerHTML = map.points.map(point => pointButton(point, false)).join("");
  }

  function renderHeader() {
    $("map-title").textContent = content(map.title);
    document.title = `${content(map.title)} · Borderlands`;
    const parent = $("parent-map");
    const parentId = map.parent ?? (map.id === "caves-of-chaos" ? "wilderness" : null);
    parent.hidden = !parentId;
    if (parentId) {
      parent.href = mapURL(parentId);
      parent.textContent = `← ${content(maps.get(parentId).title)}`;
    }
    const option = entry => `<option value="${escape(entry.id)}"${entry === map ? " selected" : ""}>${escape(content(entry.title))}</option>`;
    const group = (label, entries) => `<optgroup label="${label}">${entries.map(option).join("")}</optgroup>`;
    $("map-select").innerHTML = '<option value="keep">Keep on the Borderlands</option>'
      + group("Wilderness", mapList.filter(entry => entry.id === "wilderness" || entry.parent === "wilderness"))
      + group("Caves of Chaos", mapList.filter(entry => entry.id === "caves-of-chaos" || isCave(entry)));
    $("random-encounter").hidden = !randomPool.length;
    $("core-encounter").hidden = !corePool.length;
    $("lang-en").setAttribute("aria-pressed", language === "en");
    $("lang-zh").setAttribute("aria-pressed", language === "zh-Hans");
  }

  function renderParty() {
    const characters = party();
    $("party-caption").textContent = roster ? `${roster.playerCount} players · ${characters.length} saved` : "Roster unavailable";
    $("party-list").innerHTML = characters.map(({ index, character }) => {
      const actor = borderlandsSession.actorFor(roster, index);
      const stats = combatEngine.currentStats(actor);
      const conditions = actor.conditions.map(effect => language === "zh-Hans" ? effect.zh || effect.name : effect.name).filter(Boolean);
      return `<button class="buyer" type="button"
      data-buyer="${index}" aria-pressed="${buyer === index}"><strong>${escape(characterName(character))}</strong>
      <span>${character.gold} GP · ${character.currentHp}/${character.hp} HP · AC ${stats.ac}${stats.speed === null ? "" : ` · ${language === "zh-Hans" ? "速度" : "Speed"} ${stats.speed} ft`}</span>${conditions.length ? `<small>${escape(conditions.join(" · "))}</small>` : ""}</button>`;
    }).join("")
      || '<p class="muted">Add characters on the Characters page to use rewards and services.</p>';
    $("map-log").innerHTML = state().log.slice(-15).reverse().map(line => `<li>${escape(line)}</li>`).join("");
    if (story) return;
    const caves = mapList.filter(isCave);
    const completed = caves.filter(cave => {
      const rooms = cave.points.filter(point => point.room !== false);
      return rooms.length && rooms.every(point => state().rooms[`${cave.id}:${point.id}`]);
    });
    const regions = mapList.filter(entry => entry.parent === "wilderness");
    const regionalProgress = regions.filter(region => Object.entries(state().rooms).some(([key, status]) =>
      key.startsWith(`${region.id}:`) && (status === "completed" || status === "rewarded")));
    $("cave-progress").innerHTML = map.id === "caves-of-chaos" || isCave(map)
      ? `<details class="side-details"><summary>Caves explored · ${completed.length}/${caves.length}</summary>
      <p class="cave-milestone">${completed.length >= 5 ? "Level 3 milestone reached."
        : completed.length >= 2 ? "Level 2 milestone reached. Level 3 after five caves."
          : "Level 2 after two caves. Level 3 after five."} A cave counts once every room is marked explored.</p>
      ${completed.length ? `<ul class="keep-log">${completed.map(cave => `<li>${escape(content(cave.title))}</li>`).join("")}</ul>` : ""}
      </details>` : `<details class="side-details"><summary>Wilderness encounters · ${regionalProgress.length}/${regions.length} regions</summary>
      <p class="cave-milestone">${regionalProgress.length === regions.length
        ? "Wilderness milestone reached. The party can gain one level, up to level 3."
        : "Complete one encounter in each region to reach the Wilderness milestone."}</p>
      ${regionalProgress.length ? `<ul class="keep-log">${regionalProgress.map(region => `<li>${escape(content(region.title))}</li>`).join("")}</ul>` : ""}
      </details>`;
  }

  function scale(group) {
    const players = roster?.playerCount ?? 4;
    const card = cards[group.id];
    const hp = group.hp ?? card?.hp;
    const count = group.perCharacter ? group.perCharacter * players : group.count;
    if (hp == null || group.printed || group.perCharacter || card?.profile === "context" && !group.fixed) return { hp, count };
    if (group.fixed || card?.profile === "fixed") return { count, hp: Math.ceil(hp * players / 4) };
    const adjusted = Math.floor(count * players / 4);
    return { count: adjusted, hp: Math.ceil(hp * count * players / (4 * adjusted)) };
  }

  function creatureCard(group) {
    const card = cards[group.id];
    const { count, hp } = scale(group);
    const name = content(group.name ?? card?.name ?? group.id);
    const ac = group.ac ?? card?.ac;
    const initiative = card?.initiative;
    const originalHp = group.hp ?? card?.hp;
    const changed = !group.perCharacter && originalHp != null && (count !== group.count || hp !== originalHp);
    return disclosure(`${count} × ${name}${hp != null ? ` · ${hp} HP each` : ""}${ac != null ? ` · AC ${ac}` : ""}${group.reinforcement ? " · Conditional reinforcement" : ""}`,
      `${initiative == null ? "" : `<p class="card-stats">Initiative ${initiative >= 0 ? "+" : ""}${initiative}</p>`}
      ${changed ? `<p class="card-stats">Printed: ${group.count} × ${originalHp} HP each.</p>` : ""}
      ${paragraph(group.note)}
      ${!group.summaryOnly && card?.actions?.length ? `<ul class="prepared-list">${card.actions.map(line => `<li>${escape(line)}</li>`).join("")}</ul>` : ""}
      ${group.record === false ? "" : `<div class="keep-links">${ref(cardPath("monsters", group.id), "Monster card")}</div>`}`);
  }

  function npcCard(npc) {
    const statCard = cards[npc.card];
    return disclosure(content(npc.name), `${paragraph(npc.notes)}
      ${statCard ? `<p class="card-stats">AC ${statCard.ac} · ${statCard.hp} HP</p>` : ""}
      <div class="keep-links">${npc.record === false ? "" : ref(cardPath("npcs", npc.id), "NPC card")}
      ${npc.card ? ref(cardPath("monsters", npc.card), "Monster card") : ""}</div>`);
  }

  function destinationLinks(point) {
    const links = point.links ?? [];
    return [...(point.link ? [{ map: point.link }] : []), ...links].map(link =>
      `<a class="secondary" href="${escape(mapURL(link.map, link.point))}">${escape(content(link.title
        ?? maps.get(link.map)?.title ?? "Keep on the Borderlands"))} →</a>`).join("");
  }

  function offerPrice(point, offer) {
    const encounterKey = roll?.random && roll.point === point ? roll.key : pointKey(point);
    const key = `${encounterKey}:offer:${offer.id}`;
    const used = state().uses[key] ?? 0;
    const alternate = offer.alternate && party().some(({ character }) =>
      (offer.alternate.classId && character.choice.classId === offer.alternate.classId)
      || (offer.alternate.backgroundId && character.choice.backgroundId === offer.alternate.backgroundId));
    const unit = alternate ? offer.alternate.gp : !used && offer.firstGp != null ? offer.firstGp : offer.gp;
    return { key, used, unit };
  }

  function offerCard(point, offer, index) {
    const { unit, used } = offerPrice(point, offer);
    return `<div class="offer-row"><div><strong lang="${language}">${escape(content(offer.title))}</strong>
      <small>${unit} GP${offer.perCharacter ? " per character" : ""}</small>${paragraph(offer.notes)}</div>
      ${action(`offer-${index}`, offer.once && used ? "Recorded" : "Pay", buyer === null || !store || Boolean(offer.once && used))}</div>`;
  }

  function renderPoint() {
    const point = roll?.random ? roll.point : selected;
    const target = $("point-panel");
    if (!point) {
      const recommended = map.level;
      target.innerHTML = `<h2>${escape(content(map.title))}</h2>${recommended ? `<p class="map-state">Recommended level ${recommended}${recommended < 3 ? "+" : ""}</p>` : ""}
        ${readAloud(map.intro)}${disclosure("DM notes", paragraph(map.notes))}
        <p class="muted">Choose a location on the map or from the list.</p>`;
      return;
    }
    const key = roll?.random ? roll.key : pointKey(point);
    const done = state().rooms[key];
    const creatures = point.creatures ?? [];
    const links = destinationLinks(point);
    const explore = !roll?.random && !point.link && !done
      ? action("explore", point.room === false ? "Mark visited" : "Mark explored", !store) : "";
    const complete = !point.link && point.room !== false && !["completed", "rewarded"].includes(done)
      ? action("complete", "Mark complete", !store) : "";
    const reward = point.reward && done !== "rewarded" ? action("reward", "Award treasure", !store || buyer === null) : "";
    const groups = creatures.flatMap(group => {
      if (!cards[group.id]) return [];
      const { hp, count } = scale(group);
      return [{ id: group.id, hp, count, name: group.name, ac: group.ac, printed: group.printed,
        fixed: group.fixed, note: group.note, reserve: Boolean(group.reinforcement || group.reserve) }];
    });
    const combatURL = groups.length ? combatHandoff.url({ title: point.title, groups,
      back: `../adventure_page/?map=${map.id}${roll?.random ? `&draw=${point.id}&drawKey=${roll.key.split(":").at(-1)}` : `&point=${point.id}`}`,
      rule: point.combatRule ?? privateConfig.combatRules?.[`${map.id}:${point.id}`] }) : "";
    const dashboardLink = (url, label, primary = false) => `<a class="${primary ? "primary" : "secondary"}" data-open-dashboard href="${escape(url)}">${escape(label)}</a>`;
    const combat = combatURL ? dashboardLink(combatURL, point.combatRule === "friendly-sparring"
      ? content(["Set up friendly spar", "设置友谊比试"]) : content(["Set up combat", "设置战斗"]), true) : "";
    const storyLinks = story && (privateConfig.storyLinkPointIds || []).includes(point.id) ? `<div class="event-actions">
      ${dashboardLink("../session_page/#party-rest", content(["Party rest", "队伍休息"]))}
      ${dashboardLink("../keep_page/", content(["Open the Keep", "打开要塞"]))}</div>` : "";
    const healed = state().uses[`${pointKey(point)}:heal:${buyer}`] ?? 0;
    const heal = point.heal ? `<div class="event-actions">
      ${action("heal", `Restore ${point.heal.hp} HP`, !store || buyer === null || Boolean(healed && point.heal.oncePerLongRest))}
      ${healed && point.heal.oncePerLongRest ? `<a class="secondary" href="../session_page/#party-rest">${language === "zh-Hans" ? "在队伍行动页面进行长休" : "Long Rest on Party Actions"}</a>` : ""}</div>` : "";
    target.innerHTML = `<h2 lang="${language}">${escape(content(point.title))}</h2>
      ${roll ? `<p class="map-state">${roll.random ? "Random encounter · d8" : "Regional encounter · d4"} rolled ${roll.die}</p>` : ""}
      ${done ? `<p class="map-state">${statusLabels[done]}</p>` : ""}
      ${readAloud(point.read)}
      ${links ? `<nav class="adventure-links" aria-label="Connected locations">${links}</nav>` : ""}
      ${disclosure("DM notes and checks", paragraph(point.notes))}
      ${(point.guidance ?? []).map(([heading, text]) => disclosure(content(heading), paragraph(text))).join("")}
      ${point.npcs?.length ? `<div class="map-encounters"><h3>NPCs</h3>${point.npcs.map(npcCard).join("")}</div>` : ""}
      ${creatures.length ? `<div class="map-encounters"><h3>Encounter preview</h3>
      <p class="card-stats">Prepared for ${roster?.playerCount ?? 4} players. Apply the scene’s triggers before placing creatures.</p>
      ${creatures.map(creatureCard).join("")}</div>` : ""}
      ${point.link && !point.treasure && !point.drops ? "" : disclosure("Treasure and drops",
        paragraph(point.treasure ?? ["No treasure listed.", "未列出宝藏。"])
        + paragraph(point.drops ?? ["No separate enemy drops listed.", "未列出额外的敌人掉落。"]))}
      ${point.offers?.length ? `<h3>Offers</h3>${point.offers.map((offer, index) => offerCard(point, offer, index)).join("")}` : ""}
      ${heal}
      ${borderlandsHazards.at(map.id, point.id).length ? `<div class="event-actions">${action("hazard", language === "zh-Hans" ? "结算冒险效果" : "Resolve adventure effect", !store)}</div>` : ""}
      ${borderlandsMapCompanions.at(map.id, point.id).map(entry => `<div class="event-actions">${action(`recruit-${entry.id}`, content([entry.name, entry.zh]), !store)}</div>`).join("")}
      ${combat || explore || complete || reward ? `<div class="event-actions">${combat}${explore}${complete}${reward}</div>` : ""}
      ${storyLinks}
      <div class="keep-links">${ref(point.source ?? map.source, "Adventure booklet")}</div>`;
  }

  function render() {
    syncBuyer();
    renderMap();
    renderPoint();
    renderParty();
    historyControls.update();
  }

  function showPoint(point) {
    selected = point;
    roll = null;
    const url = new URL(location.href);
    url.searchParams.set("map", map.id);
    url.searchParams.set("point", point.id);
    history.replaceState(null, "", url);
    renderMap();
    renderPoint();
    $("point-panel").scrollIntoView({ block: "nearest" });
  }

  function draw(pool, random) {
    if (!pool.length || busy) return;
    const die = Math.floor(Math.random() * pool.length);
    const point = pool[die];
    if (!random) showPoint(point);
    roll = { point, die: die + 1, random, key: `${map.id}:encounter:${crypto.randomUUID()}` };
    renderMap();
    renderPoint();
    $("point-panel").scrollIntoView({ block: "nearest" });
  }

  function dialog(title, fields, commit, label = "Confirm") {
    pending = commit;
    $("map-dialog-title").textContent = title;
    $("map-fields").innerHTML = fields;
    $("map-dialog-error").hidden = true;
    $("map-confirm").textContent = label;
    $("map-dialog").showModal();
  }

  const numberField = (name, label, value, min, max) => `<label>${escape(label)}
    <input type="number" name="${name}" min="${min}" max="${max}" step="1" value="${value}" required></label>`;
  const recipients = () => party().map(({ index, character }) => `<option value="${index}"${index === buyer ? " selected" : ""}>
    ${escape(characterName(character))}</option>`).join("");
  const recipientField = label => `<label>${label}<select name="recipient" required>${recipients()}</select></label>`;

  function updateCharacter(slots, index, { gold = 0, healing = 0, items = [] }) {
    if (!slots[index]) throw new Error("Choose a saved character.");
    const character = borderlandsCharacter.derive(slots[index]);
    const nextGold = character.gold + gold;
    if (nextGold < 0) throw new Error(`${characterName(character)} only has ${character.gold} GP.`);
    if (nextGold > 999999) throw new Error("The gold total exceeds the character sheet limit.");
    const sheet = { ...character.choice.sheet, stats: { ...character.choice.sheet?.stats } };
    if (gold) sheet.stats.gold = nextGold;
    if (healing) sheet.stats.currentHp = Math.min(character.hp, character.currentHp + healing);
    if (items.length) {
      sheet.inventory = { ...character.inventory };
      for (const [id, quantity] of items) {
        if (!Object.hasOwn(borderlandsItems, id)) throw new Error("Choose a card from the item library.");
        sheet.inventory[id] = (sheet.inventory[id] ?? 0) + quantity;
      }
    }
    slots[index] = { ...character.choice, sheet };
    return characterName(character);
  }

  function nextSave({ key, value, uses = state().uses, slots = roster.slots, message }) {
    const current = state();
    const rooms = key ? { ...current.rooms, [key]: value } : current.rooms;
    return save({ ...roster, slots, adventure: { rooms, uses, log: [...current.log, message] } }, message);
  }

  function openReward(point, key) {
    const reward = point.reward;
    const group = point.creatures?.find(entry => entry.id === reward.gpPerCreature?.id);
    const printed = group ? scale(group).count * reward.gpPerCreature.gp : reward.gp ?? 0;
    const members = party();
    const item = borderlandsItems[reward.item];
    const itemGroup = point.creatures?.find(entry => entry.id === reward.quantityFromCreature);
    const quantityDefault = itemGroup ? scale(itemGroup).count : reward.quantity ?? 1;
    const magicCount = Number(reward.magic ?? 0);
    const magicItems = Object.entries(borderlandsItems).filter(([, entry]) => entry.source?.includes("/magic-items/"));
    const magic = Array.from({ length: magicCount }, (_, index) =>
      `<label>Magic item drawn at the table${magicCount > 1 ? ` (${index + 1})` : ""}
        <select name="magic"><option value="">Skip this card</option>${magicItems.map(([id, entry]) =>
          `<option value="${escape(id)}">${escape(itemName(entry))}</option>`).join("")}</select></label>`).join("");
    const gpFields = members.map(({ index, character }) => numberField(`gp-${index}`, `${characterName(character)} · GP`,
      reward.perCharacter || buyer === index ? printed : 0, 0, 999999)).join("");
    const quantities = item && reward.itemPerCharacter ? members.map(({ index, character }) =>
      numberField(`item-${index}`, `${characterName(character)} · ${itemName(item)}`, quantityDefault, 0, 99)).join("")
      : item ? numberField("quantity", itemName(item), quantityDefault, 0, 99) : "";
    dialog(content(point.title), paragraph(point.treasure) + paragraph(point.drops) + gpFields
      + (magicCount || item && !reward.itemPerCharacter ? recipientField("Item recipient") : "") + quantities + magic,
      async data => {
        if (state().rooms[key] === "rewarded") throw new Error("This reward is already recorded.");
        const recipient = Number(data.get("recipient"));
        const drawn = data.getAll("magic").filter(Boolean);
        const slots = [...roster.slots];
        const lines = [];
        for (const { index } of members) {
          const gold = Number(data.get(`gp-${index}`));
          const quantity = Number(data.get(reward.itemPerCharacter ? `item-${index}` : "quantity"));
          const items = index === recipient ? drawn.map(id => [id, 1]) : [];
          if (item && quantity && (reward.itemPerCharacter || index === recipient)) items.push([reward.item, quantity]);
          if (!gold && !items.length) continue;
          const name = updateCharacter(slots, index, { gold, items });
          lines.push(`${name} receives ${[...(gold ? [`${gold} GP`] : []),
            ...items.map(([id, qty]) => `${qty} × ${itemName(borderlandsItems[id])}`)].join(", ")}.`);
        }
        if (!lines.length) throw new Error("Enter GP or choose an item to award.");
        return nextSave({ key, value: "rewarded", slots, message: `${content(point.title)} · ${lines.join(" ")}` });
      }, "Complete and award");
  }

  function openOffer(point, offer) {
    if (offer.split) return openSplitOffer(point, offer);
    const { unit } = offerPrice(point, offer);
    const fields = paragraph(offer.notes) + recipientField("Paying character")
      + (offer.perCharacter ? numberField("count", "Characters covered", party().length, 1, roster.playerCount)
        : offer.item ? numberField("count", "Quantity", 1, 1, 99) : "")
      + `<p class="detail-copy">${unit} GP${offer.perCharacter ? " per character covered" : offer.item ? " each" : ""}.</p>`;
    dialog(content(offer.title), fields, async data => {
      const { key, used, unit: price } = offerPrice(point, offer);
      if (offer.once && used) throw new Error("This offer has already been recorded.");
      const quantity = Number(data.get("count") ?? 1);
      const index = Number(data.get("recipient"));
      const total = price * quantity;
      const slots = [...roster.slots];
      const name = updateCharacter(slots, index, { gold: -total, items: offer.item ? [[offer.item, quantity]] : [] });
      const ally = borderlandsMapCompanions.hire[offer.id];
      if (ally) {
        let next = borderlandsMapCompanions.add({ ...roster, slots }, ally, cards);
        next.adventure ??= { rooms: {}, uses: {}, log: [] };
        next.adventure.uses[key] = used + 1;
        const message = `${name} paid ${total} GP · ${content(offer.title)}. ${content(ally.notes)}`;
        next.adventure.log.push(message);
        return save(next, message);
      }
      return nextSave({ uses: { ...state().uses, [key]: used + 1 }, slots,
        message: `${name} paid ${total} GP · ${content(offer.title)}.` });
    }, "Record payment");
  }

  function openSplitOffer(point, offer) {
    const { unit } = offerPrice(point, offer);
    const members = party();
    const fields = `<p class="detail-copy">${unit} GP total. Enter each character’s contribution.</p>`
      + members.map(({ index, character }) => numberField(`gp-${index}`,
        `${characterName(character)} · ${character.gold} GP available`,
        index === buyer ? Math.min(unit, character.gold) : 0, 0, Math.min(unit, character.gold))).join("");
    dialog(content(offer.title), fields, async data => {
      const { key, used, unit: total } = offerPrice(point, offer);
      if (offer.once && used) throw new Error("This offer has already been recorded.");
      if (roster.combat && roster.combat.phase !== "ended") throw new Error("End the current combat before recording the toll.");
      const contributions = members.map(({ index }) => ({ index, gold: Number(data.get(`gp-${index}`)) }));
      if (contributions.some(({ gold }) => !Number.isSafeInteger(gold) || gold < 0)
        || contributions.reduce((sum, { gold }) => sum + gold, 0) !== total) {
        throw new Error(`Contributions must add up to ${total} GP.`);
      }
      const slots = [...roster.slots];
      const lines = contributions.filter(({ gold }) => gold > 0).map(({ index, gold }) =>
        `${updateCharacter(slots, index, { gold: -gold })} paid ${gold} GP`);
      return nextSave({ uses: { ...state().uses, [key]: used + 1 }, slots,
        message: `${content(offer.title)} · ${lines.join(", ")}.` });
    }, "Record payment");
  }

  function openRecruit(point, entry) {
    const key = `companion:${entry.id}`;
    const used = state().uses[key] || 0;
    if (used >= (entry.limit || 1)) return notify(language === "zh-Hans" ? "此处的同伴已记录。" : "The printed allies at this location have already been recorded.", true);
    const fields = paragraph(entry.notes) + `<label class="check-line"><input type="checkbox" name="prerequisite" required> ${language === "zh-Hans" ? "已满足上面的原文条件。" : "The printed prerequisites above are satisfied."}</label>`
      + (entry.gp ? recipientField(language === "zh-Hans" ? "付款角色" : "Paying character") + numberField("fee", language === "zh-Hans" ? "实际贿赂 GP" : "Actual bribe GP", entry.gp, entry.gp, 999999) : "");
    dialog(content([entry.name, entry.zh]), fields, async data => {
      if (!data.has("prerequisite")) throw new Error("Confirm that the printed prerequisites are satisfied.");
      if ((state().uses[key] || 0) >= (entry.limit || 1)) throw new Error("These allies have already been recorded.");
      const slots = [...roster.slots];
      const fee = entry.gp ? Number(data.get("fee")) : 0;
      if (entry.gp && (!Number.isSafeInteger(fee) || fee < entry.gp)) throw new Error(`The printed bribe is at least ${entry.gp} GP.`);
      if (fee) updateCharacter(slots, Number(data.get("recipient")), { gold: -fee });
      const next = borderlandsMapCompanions.add({ ...roster, slots }, entry, cards);
      next.adventure ??= { rooms: {}, uses: {}, log: [] };
      next.adventure.uses[key] = (state().uses[key] || 0) + 1;
      const message = `${content([entry.name, entry.zh])}${fee ? ` · ${fee} GP` : ""}. ${content(entry.notes)}`;
      next.adventure.log.push(message);
      return save(next, message);
    }, language === "zh-Hans" ? "记录同伴" : "Record companion");
  }

  async function pointAction(id) {
    if (!store || busy) return;
    const point = roll?.random ? roll.point : selected;
    if (!point) return;
    const key = roll?.random ? roll.key : pointKey(point);
    if (id === "hazard") return borderlandsHazards.open({ roster, hazards: borderlandsHazards.at(map.id, point.id), language, save });
    if (id.startsWith("recruit-")) {
      const entry = borderlandsMapCompanions.at(map.id, point.id).find(entry => `recruit-${entry.id}` === id);
      if (entry) return openRecruit(point, entry);
    }
    if (id === "explore" || id === "complete") {
      const value = id === "explore" ? "visited" : "completed";
      return nextSave({ key, value, message: `${content(point.title)} · ${statusLabels[value]}.` });
    }
    if (id === "reward") return openReward(point, key);
    if (id.startsWith("offer-")) return openOffer(point, point.offers[Number(id.slice(6))]);
    const healKey = `${pointKey(point)}:heal:${buyer}`;
    const uses = { ...state().uses };
    if (id === "heal") {
      if (!point.heal || buyer === null || !roster.slots[buyer]) throw new Error("Choose a saved character.");
      if (point.heal.oncePerLongRest && uses[healKey]) throw new Error("This character must finish a Long Rest before the spring can heal them again.");
      if (borderlandsSession.isDead(roster, buyer)) throw new Error("The spring cannot restore a dead creature to life.");
      const character = borderlandsCharacter.derive(roster.slots[buyer]);
      const healing = Math.min(point.heal.hp, character.hp - character.currentHp);
      if (healing === 0) return notify("The selected character is already at full HP.");
      const result = borderlandsSession.resolve(roster, { action: { id: "sacred-spring", name: "Drink from Sacred Spring (action)", type: "heal", target: "pick", dice: [{ count: 0, sides: 1, flat: point.heal.hp, type: "Healing" }] },
        environmentId: "sacred-spring", targetSlots: [buyer], title: content(point.title) });
      if (!result.preview.complete) throw new Error("The spring effect could not be resolved.");
      const next = result.roster;
      next.adventure ??= { rooms: {}, uses: {}, log: [] };
      if (point.heal.oncePerLongRest) next.adventure.uses[healKey] = 1;
      return save(next, `${characterName(character)} recovered ${healing} HP · ${content(point.title)}.`);
    }
  }

  function onPointClick(event) {
    const marker = event.target.closest("[data-point]");
    if (marker) showPoint(map.points.find(point => point.id === marker.dataset.point));
  }

  $("map-pins").addEventListener("click", onPointClick);
  $("point-list").addEventListener("click", onPointClick);
  $("map-select").addEventListener("change", event => location.assign(mapURL(event.target.value)));
  $("core-encounter").addEventListener("click", () => draw(corePool, false));
  $("random-encounter").addEventListener("click", () => draw(randomPool, true));
  $("point-panel").addEventListener("click", event => {
    const link = event.target.closest("[data-open-dashboard]");
    if (story && link && window.opener && !window.opener.closed
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      window.opener.location.href = link.href;
      window.opener.focus();
    }
    const button = event.target.closest("[data-action]");
    if (button) pointAction(button.dataset.action).catch(error => notify(error.message, true));
  });
  $("party-list").addEventListener("click", event => {
    const button = event.target.closest("[data-buyer]");
    if (button) {
      buyer = Number(button.dataset.buyer);
      renderParty();
      renderPoint();
    }
  });
  $("map-cancel").addEventListener("click", () => { if (!busy) $("map-dialog").close(); });
  $("map-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  $("map-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !pending) return;
    const error = $("map-dialog-error");
    error.hidden = true;
    $("map-confirm").disabled = true;
    try {
      if (await pending(new FormData(event.target))) {
        $("map-dialog").close();
      } else {
        error.textContent = $("map-status").textContent;
        error.hidden = false;
      }
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    } finally {
      $("map-confirm").disabled = false;
    }
  });
  for (const [id, code] of [["lang-en", "en"], ["lang-zh", "zh-Hans"]]) {
    $(id).addEventListener("click", () => {
      language = code;
      localStorage.setItem(languageKey, code);
      renderHeader();
      render();
    });
  }

  renderHeader();
  render();
  let loading = false;
  async function loadRoster() {
    if (busy || loading || $("map-dialog").open) return;
    loading = true;
    try {
      const result = await borderlandsStorage.load();
      if (busy || $("map-dialog").open) return;
      const changed = !store || JSON.stringify(roster) !== JSON.stringify(result.roster);
      store = result;
      roster = store.roster;
      if (changed) {
        syncBuyer();
        renderMap();
        renderParty();
        // Keep the current scene and its expanded notes visible while switching windows.
        const expanded = new Set([...$("point-panel").querySelectorAll("details[open] > summary")]
          .map(summary => summary.textContent));
        renderPoint();
        for (const summary of $("point-panel").querySelectorAll("details > summary")) {
          summary.parentElement.open = expanded.has(summary.textContent);
        }
      }
      historyControls.update();
      if (store.notice) notify(store.notice);
    } catch (error) {
      notify(error.message, true);
    } finally {
      loading = false;
    }
  }
  loadRoster();
  if (story) {
    window.addEventListener("focus", loadRoster);
    $("map-dialog").addEventListener("close", loadRoster);
  }
  fetch("/api/adventure/creatures").then(response => {
    if (!response.ok) throw new Error("Could not load monster statistics. Restart the local launcher.");
    return response.json();
  }).then(result => {
    cards = result;
    renderPoint();
  }).catch(error => notify(error.message, true));
})();
