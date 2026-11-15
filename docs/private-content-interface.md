# Private-content interface

The public source contains reusable application code. The full starter-set dashboard shown in the screenshots also uses a **separate private content pack**, including content embedded in JavaScript. That pack is intentionally omitted.

This document describes the current integration boundary. It is not a public pack download, a universal RPG schema or a claim that owning a source book supplies ready-made compatible files. The original OCR/import/rebuild tools are not distributed, and there is no automatic public installer.

**The public split introduces new adapters.** The original private v1.0 folder did not supply the new adventure configuration, Keep scaling JSON, optional Library bundles or the new action-provider hooks described here. Copying its old files alone is not guaranteed to work with this source release. The original private application is unchanged; a complete real private pack adapted to the new public core has not been tested end to end. Current public checks use synthetic fixtures.

## Installation model

For this release, private files occupy their **original relative paths** under a personal application checkout. The browser pages load their data adapters as local scripts before the UI uses the resulting globals. The Python server reads the matching reference and profile files from the same project root.

The launcher checks for required private content before serving the complete application. If it reports a missing content pack, the public source has not been configured for full-dashboard use. It does not silently download official material. Install a compatible pack you can supply for your personal installation, then launch again. Run `python3 launch_borderlands.py --check-content` on macOS, or `py -3 launch_borderlands.py --check-content` on Windows, for the presence check without starting the server. This checks file presence, not correctness, compatibility or rights to the content.

Do not store an API key or campaign save inside the reference pack. Keep private content out of public commits, including descriptions, stats and translations embedded in scripts. The repository's ignore rules document the private paths; ignore rules do not sanitize files already tracked by Git.

## Expected file groups

The complete current integration depends on these groups. The precise required-file list in the launcher is the operational check; this table explains their roles.

| Relative path or family | Supplied privately | Used by |
| --- | --- | --- |
| `database/records.jsonl` | Reference records, provenance, quality, visibility and optional structured facts | Offline Library and retrieval |
| `database/local-rules.json` | Optional private reference records and source/display metadata | Additional local rules, aliases and opted-in design notes |
| `database/records/<kind>/*.md` | Readable source-linked entity records; matching mechanical metadata where required by the integration | Library links, creature preparation and source views |
| `database/sources/<source-id>/*.md` | Identified page references and private source text | Citation links and DM review |
| `database/maps/**`, including `catalog.json` and `redraw-status.json` | Original/display images and map metadata | Local adventure/map pages and required-content check |
| `library_translations/**` | Private language content and its translation/summary labels | Chinese reader and search |
| `library_translations/private-rules.zh-Hans.json` | Optional localized bodies keyed by existing reference IDs | Chinese reader content for private local records |
| `character_page/classes.js` | Base class deck and its checked data | Character selection and derivation |
| `character_page/origins.js` | Background/species decks and their supported modifiers | Character derivation and feature references |
| `character_page/items-spells.js` | Item/spell deck initialization | Inventory, equipment, spells and reference UI |
| `character_page/adventure-catalog.js` | Additional private item/spell data | Inventory, spell lists and adventure transactions |
| `character_page/level-data.json` | Level/subclass data consumed by the public progression resolver | Level Up, prepared choices and server validation |
| `combat_page/actions.js` | Content-specific action factory and supported spell/class/item descriptors | Combat and Party actions |
| `combat_page/monsters-fixed.js`, `combat_page/monsters-ordinary.js` | Creature action factories, names, traits and defenses | Enemy/companion actions and details |
| `encounter_scaling/data/monster_profiles.json` | Per-creature profile assignments and authored ability mappings | Encounter preparation and creature catalogue |
| `keep_page/content.js` | Private locations, NPCs, shops, scenes and offers | Keep UI and transactions |
| `adventure_page/private-config.js` | New private Keep/trail configuration, equipment permissions and synchronous transaction handlers | Generic Keep/Maps UI and transaction core |
| `database/keep-scaling.json` | Source-specific nested encounter groups and their declared scaling profiles | Keep encounter-scaling API |
| `adventure_page/wilderness.js`, `caves-early.js`, `caves-late.js`, `intro.js` | Adventure/map/intro descriptors and private narrative data | Scene navigation and encounter handoff |
| `adventure_page/hazards.js`, `companions.js` | Content-specific hazard and recruitment descriptors/adapters | Adventure effects and companion services |
| Private rule/reference adapter data used by the Library | Source-specific definitions, aliases and reader content | The generic index's local content integration |

No official PDF or image is supplied by the public repository. Some archival provenance and OCR files are useful for a personal review workflow but are not replacements for the runtime adapters above. See [database format](../database/README.md).

`character_page/levels.js` is public resolver code. Its data stays private in `character_page/level-data.json`. The local route **`/api/level-data.js`** reads that JSON and initializes **`borderlandsLevelData`**; the HTML loads the route before `levels.js`. No separately distributed browser copy of the private level table is required.

Do not point the resolver at a different dataset without checking its supported class IDs, subclasses, powers, preparation choices and limits. The release documents its integration rather than promising arbitrary homebrew compatibility.

## Browser globals and load order

The current pages use classic deferred scripts. Data providers must initialize their globals before the corresponding application code executes.

| Global | High-level contract |
| --- | --- |
| `borderlandsClasses` | A keyed deck of class definitions, with labels, source identity, statistics, starting equipment/spells, power capacities and feature descriptions |
| `borderlandsBackgrounds`, `borderlandsSpecies` | Keyed origin decks, supported stat/skill modifiers, spells/powers and descriptive features |
| `borderlandsItems` | A keyed inventory deck; supported fields identify armor, weapons, quantities, slots and optional typed attack/damage metadata |
| `borderlandsSpells` | A keyed reference deck with labels, level, timing, source and descriptions; mechanical resolution also requires action descriptors |
| `borderlandsLevelData` | Board selection/progression data from the private JSON, served by `/api/level-data.js` and consumed by public `borderlandsLevels` |
| `combatActions` | `forActor(actor, character, battle)` supplies supported action descriptors; existing UI also uses the provider's creature catalogue and related helpers |
| `combatFixedMonsters`, `combatOrdinaryMonsters` | Keyed creature-action factories; matching `*Names`, `*Traits` and `*Defenses` globals provide display/mechanical metadata |
| `keepContent` | Locations, scenes, encounter hooks, offers and related content consumed by Keep |
| `borderlandsAdventureConfig` | New `{ keep, trail, transactions }` adapter supplied by private configuration |
| `borderlandsWilderness`, `borderlandsCavesEarly`, `borderlandsCavesLate` | Arrays of map/scene descriptors with stable IDs and source links |
| `borderlandsIntro` | Intro/story-mode content descriptor |
| `borderlandsHazards` | Content-aware lookup/open/resolve functions used by map hazard controls |
| `borderlandsMapCompanions` | Content-aware recruitment/service lookup and companion-add functions |

These contracts describe existing consumers, not an interchangeable plugin API. Values such as class IDs and item properties have specific supported meanings in the current derivation and combat code. A new provider must match those consumers or include an explicitly reviewed adapter change.

Private packs should provide data and mechanical descriptors without reaching into the API-key file or silently altering saved campaign state during script load. A browser data script runs as code, so do not install an untrusted pack merely because it is described as data.

## New adventure configuration adapter

The required private **`adventure_page/private-config.js`** initializes:

```js
globalThis.borderlandsAdventureConfig = {
  keep: {},
  trail: {},
  transactions: {
    permissions: {},
    handlers: {}
  }
};
```

This shows the container shape, not a usable game configuration. Keep and Maps load the file before their class/content consumers, `transactions.js`, `keep.js` or `maps.js`. The current public release supplies no filled configuration. A compatible pack needs to implement the behaviors its content uses.

### Keep configuration

The Keep context contains `roster`, `state`, `buyer`, `selected`, `language`, `scaling`, `locations`, `scenes` and `offers`. The generic UI defaults to the private `keepContent` arrays. Source-specific choices can be supplied through these optional `keep` members:

| Member | Result or role |
| --- | --- |
| `initialLocation` | Initial location number |
| `questKey(scene, ctx)` | Stable quest-state key |
| `eligible(scene, { ...ctx, completing })` | Whether the selected scene/action is currently eligible |
| `encounterGroups(scene, ctx)` | Prepared encounter groups for that scene |
| `sceneActions(scene, ctx)` | Action descriptors shaped as `{ id, label }` |
| `offerState(offer, ctx)` | `{ unavailable, label }` for an offer |
| `visibleNpc(npc, place, ctx)` | Whether to show an NPC |
| `locationSections(place, ctx)` | Extra display sections shaped as `{ title, text }` |
| `locationIntro(place, ctx)` | Introductory text, including bilingual text when provided |
| `randomScenes(ctx)` | Eligible random-scene collection |
| `specialEvents`, `specialEventId` | Configured special-event collection and selected identity |
| `offerFields(offer, ctx)` | Additional transaction input metadata |
| `rewardOffer(scene, ctx)` | Offer describing that scene's reward |
| `onSceneAction(compositeId, ctx)` | Result shaped as `{ next, lines }` |

These functions provide the scenario-specific rendering and routing behavior. The public UI does not supply printed quest rewards, NPC exceptions or story defaults when the adapter is absent.

### Trail configuration

Optional `trail` members provide:

- `baseCounts`: encounter ID to original count.
- `friends`: creature ID to `[npcId, bilingualName]`.
- `names`: creature ID to bilingual name.
- `offers`: encounter ID to an offer array.
- `combatRules`: `mapId:pointId` to the configured encounter rule.
- `storyLinkPointIds`: point IDs that open configured story content.

The names above are keys for locally supplied data. This document does not fill them with adventure text, encounter values or recruitable NPC identities.

### Transaction permissions and handlers

`transactions.handlers` is an object mapping a handler key to a **synchronous function**. An offer selects `offer.handler`, or falls back to `offer.id`. An unknown handler produces a missing-adapter error rather than a guessed transaction. Legacy private handlers need migration to this contract.

Equipment permissions can be supplied as `transactions.permissions[classId]` or `character.job.equipmentPermissions`. Supported permission keys are `shield`, `armorWeights`, `weaponCategories`, `weaponProperties` and `anyWeapon`; the list-valued keys hold arrays. Optional `periodAt(hour)` and `consumePotionOffer` support a configured calendar-period mapping and legacy shortcut.

Offer-specific input metadata lives on `offer.fields` or comes from `offerFields`. Each field has `name`, `type` and `label`; supported types are `number`, `checkbox`, `slots`, `select`, `dice` and `text`. Optional metadata includes `value`, `min`, `max`, `required`, `multiple`, `numeric`, `options`, `count` and `sides`. `options` maps values to display labels. The form parser supplies numbers, checkbox booleans or arrays where the field metadata requests them.

Each handler receives the transaction's cloned context, including:

- `roster`, `offer`, `keep`, `slots`, `lines`, and `options` including buyer, patient and quantity.
- Character helpers: `read(slot, role?)`, `update(slot, fields)`, `changeGold(slot, delta)`, `changeInventory(slot, itemId, delta)`, `equip(slot, itemId)` and `heal(slot, amount, revival = false)`.
- Calculation/ledger helpers: `price(count = quantity)`, `rolled(dice, count, sides)`, `dailyUse(key, limit)`, `advanceTime(hours)` and `setEffect(slot, kind, untilDay, untilHour)`.
- Supporting helpers: `integerIn`, `fail`, `label` and `itemById`.

The handler applies its privately configured behavior through those helpers and pushes result text to `lines`. It does not save independently or return a Promise. The public core owns cloning, reconciliation, logging and the final atomic preview/save workflow. It does not bundle printed service limits, healing dice, ritual durations, loan/rental rates or quest/NPC exceptions.

`tests/private-adventure-checks.mjs` exercises this boundary with original synthetic scenarios. It does not establish that the old private adventure pack has been migrated or that a complete real pack works end to end.

## Action and state boundary

An action descriptor identifies its type, timing and targets, then supplies the supported mechanical inputs for that type. Depending on the action, those can include attack bonus, save ability/DC, typed dice components, effects, resource costs, target limits, options and source references. The engine calculates a preview from the chosen targets and entered physical rolls; applying the action is a separate save step.

The public engine resolves its optional content provider as `globalThis.borderlandsCombatActions ?? globalThis.combatActions`. The existing UI convention is `combatActions`; an adapter using the alias should preserve the globals required by its UI consumers. Two optional provider functions replace the private v1.0 engine's content-specific fallbacks:

| Hook | Contract |
| --- | --- |
| `deathBurstAction(actor, battle)` | Return an on-defeat action descriptor, or `null`. The engine snapshots it into the pending action when the trigger occurs; the pending label and save DC come from that descriptor. Consumption supplies free timing and the on-defeat marker. Without a descriptor, no fallback ability is invented. |
| `effectObject(actor, target, effect, action, battle)` | Return an effect-linked object specification, or `null`. Supply numeric `hp` and `ac`; optional fields include `maxHp`, name, side, other supported stats and defenses. The engine assigns an ID if missing, marks the actor as an object, records its effect target and links the condition through `objectId`. Missing `maxHp` defaults to `hp`, name to the effect name and side to the source side. |

The original private `actions.js` did not define these hooks. A migrated pack must add its own descriptors to restore those content-specific features. The public engine does not carry a built-in creature burst or effect-object stat block. It still recognizes the older `webTarget` field when cleaning up an old save, without treating that compatibility field as a new object's data source.

The same distinction applies to creatures: a readable stat description is not a substitute for structured statistics, defenses and an action factory. Missing mechanics should produce an unsupported/missing-data result rather than guessed behavior.

The public engine and persistence layer do not make a new game's rules complete automatically. Current supported field meanings and action types are defined by their implementation. This document deliberately does not reproduce the private spell, monster, class, hazard or shop tables.

Mutable state is separate from reference content:

- The roster identifies saved player characters and their selected content IDs.
- Character sheets record current resources, inventory and explicit base overrides.
- Persistent state records conditions, death/Concentration and related tracking.
- Companions have independent saved state and service metadata.
- The adventure ledger records visited/resolved events, rewards and uses.

Content IDs should remain stable across pack revisions so saved characters continue to resolve. Back up a personal save before changing its pack; a different dataset can invalidate IDs or change their meaning.

## Synthetic JSON example

The following example shows a small **invented reference record**, not a mechanical creature profile or a complete content adapter:

```json
{
  "id": "locations:demo-observatory",
  "kind": "locations",
  "title": "Lantern Observatory",
  "authority": "local_design",
  "quality": "project_design",
  "visibility": "dm_review_before_reveal",
  "path": "records/locations/demo-observatory.md",
  "text": "Original demonstration content: a blue lantern marks an unlocked entrance.",
  "mechanics": { "entrance_locked": false },
  "occurrences": [],
  "limitations": ["Documentation example only; not wired to an adventure."]
}
```

Putting this into JSONL can illustrate reference ingestion, but it does not supply the other files needed by the current pages. No loader is promised for arbitrary example mechanics.

## Optional local rules and translations

The public Library loader can also read **`database/local-rules.json`**. Missing data produces no extra rule entries; the loader does not search arbitrary project files for content. A version-1 bundle has a `records` array and optional `metadata`. Each record needs nonempty `id`, `title` and `body`. `category` can be `rules` or `house-rules`; optional fields include aliases, source IDs, links, structured facts, quality, authority, visibility and a Chinese title.

An invented example:

```json
{
  "version": 1,
  "records": [
    {
      "id": "house-rules:demo-chime",
      "title": "Demonstration chime signal",
      "category": "house-rules",
      "body": "When the copper chime rings, rotate the demonstration marker to amber.",
      "authority": "local_design",
      "quality": "project_design",
      "visibility": "dm_only",
      "sources": ["demo-notes--001"],
      "aliases": ["sample chime"]
    }
  ],
  "metadata": {
    "books": { "demo-notes": "Original demonstration notes" },
    "design_documents": []
  }
}
```

Metadata can explicitly supply source labels (`books`), map names, NPC source IDs, named display values and alias arrays. `design_documents` is opt-in; its paths must stay inside `design/`. Listing a document adds a reference entry, not a new combat mechanic. Without explicit record labels, defaults are `authority: user_supplied`, `quality: local_reference` and `visibility: dm_only`; choose accurate labels for a real personal pack.

Optional Chinese bodies live in **`library_translations/private-rules.zh-Hans.json`**, keyed by IDs already present in the English index:

```json
{
  "version": 1,
  "entries": {
    "house-rules:demo-chime": {
      "title": "示例铜铃信号",
      "body": "铜铃响时，将示例标记转到琥珀色。",
      "status": "translated"
    }
  }
}
```

The supported status values are `translated`, `summary` and `source-guide`. This optional bundle does not create a missing English record or replace its provenance. The names and text above are original documentation examples, not imported game rules.

## Private Keep scaling data

The generic Keep scaling route reads `database/keep-scaling.json`. The top level has `version: 1` and an `encounters` object. Nested names organize groups; each leaf specifies a profile, original per-creature HP and original count. A completely invented example:

```json
{
  "version": 1,
  "encounters": {
    "demo-patrol": {
      "sentries": { "profile": "weaker", "hp": 9, "count": 2 },
      "leader": { "profile": "fixed", "hp": 31, "count": 1 },
      "visitor": { "profile": "printed", "hp": 6, "count": 1 }
    }
  }
}
```

The route recursively preserves the nesting and returns each group's calculated `{ "hp": ..., "count": ... }`:

- `weaker` applies count-first scaling from the original HP and count.
- `fixed` keeps count and scales HP.
- `printed` returns the original HP and count unchanged.

Attendance is four through eight players, excluding the DM. The arithmetic is documented in the main README. This adapter declares which groups use which profile; the generic route does not infer encounter identity or invent a profile from a group's name. The numbers and names above belong only to this synthetic example.

## Authority and quality layers

Keep the identity and context of a published reference separate from approved house rules, open proposals and raw extraction. The personal integration records source identity, one-based PDF page and separately labelled printed page where available. A local adjustment should refer to its decision/status, rather than overwrite a reference record and appear to be a published rule.

Verification status is also separate. A checked field, a reviewed transcription, a paraphrase, an unverified OCR occurrence and a visually approved map are different kinds of evidence. Preserve limitations, use absent/`null` for unresolved values, and do not import familiar values from another edition to fill gaps.

Player-facing text and private DM notes need separate selection at display time. A translation or summary should retain its relationship to the English source and any coverage limitations; translating a record does not make unverified numbers reliable or remove the need to keep that content private.

## What this release does not provide

- The private starter-set content pack or a public source for downloading it.
- A PDF-to-dashboard importer, OCR engine, extraction scripts or reconstruction of the owner's source corpus.
- A standalone fictional content pack that exercises every UI feature.
- A general guarantee that arbitrary RPG data works without adapter changes.
- The owner's campaign save, source PDFs, scans, translations or API key.
- A software license choice on the owner's behalf, or a license for excluded third-party material.

The public source can be read and developed as published. Running the full integration requires a compatible, privately supplied content layer and remains distinct from permission to redistribute that layer.
