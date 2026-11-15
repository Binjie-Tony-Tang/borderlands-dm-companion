// Verify private-content hooks with invented descriptors, without a content pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clone = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({ structuredClone: clone });
vm.runInContext(fs.readFileSync(path.join(root, "combat_page/engine.js"), "utf8"), context);
const E = context.combatEngine;
const actor = (id, side, hp) => ({ id, side, name: id, hp, maxHp: hp, ac: 8, tempHp: 0,
  monster: "synthetic-device", initiative: 0, abilities: {}, saves: { WIS: 0 },
  conditions: [], recharge: {}, turns: 0, spent: {}, roll: null });
const battle = () => ({ phase: "fight", actors: [actor("operator", "party", 17), actor("device", "enemy", 6)],
  active: "operator", order: ["operator", "device"], round: 1, log: [], pending: [] });

let state = E.correct(battle(), "device", { damage: 9 });
assert.equal(state.actors[1].death.dead, true);
assert.equal(state.pending.length, 0, "No content provider means no invented on-defeat ability");
assert.throws(() => E.deathBurstAction(state, "device"), /not pending/);

const descriptor = { id: "example-ping", name: "Last Ping", type: "save", target: "pick",
  save: { ability: "WIS", dc: 7, onSuccess: "none" }, dice: [{ count: 1, sides: 3, type: "Example" }] };
context.borderlandsCombatActions = { deathBurstAction: entry => entry.id === "device" ? descriptor : null };
const input = battle(), inputSnapshot = clone(input);
state = E.correct(input, "device", { damage: 9 });
assert.deepEqual(clone(input), inputSnapshot, "Applying the trigger leaves the original snapshot untouched");
assert.equal(state.pending[0].dc, 7);
assert.equal(state.pending[0].label, "Last Ping");
descriptor.name = "Later provider edit";
const selected = E.deathBurstAction(state, "device");
assert.equal(selected.name, "Last Ping", "The queued descriptor is a snapshot");
assert.equal(selected.deathBurst, true);
assert.equal(selected.timing, "free");
selected.dice[0].count = 8;
assert.equal(E.deathBurstAction(state, "device").dice[0].count, 1, "Consumers cannot mutate the queued descriptor");
state = E.apply(state, "device", E.deathBurstAction(state, "device"), ["operator"],
  { saves: { operator: [1] }, damage: [[2]] }).battle;
assert.equal(state.actors[0].hp, 15);
assert.equal(state.pending.length, 0);

// The existing combatActions name is also supported for private adapters.
delete context.borderlandsCombatActions;
context.combatActions = { deathBurstAction: entry => entry.id === "device" ? descriptor : null };
assert.equal(E.correct(battle(), "device", { damage: 9 }).pending.length, 1);

// Object statistics and defenses come entirely from the provider.
const objectSpec = { name: "Example tether", hp: 9, ac: 7, defenses: { resistance: ["Example"] } };
context.combatActions = { effectObject: (_source, _target, effect) => effect.key === "example-link" ? objectSpec : null };
const move = { id: "link", name: "Create example link", type: "effect", target: "pick", timing: "free",
  effects: [{ key: "example-link", name: "Linked" }] };
state = E.apply(battle(), "operator", move, ["device"]).battle;
const object = state.actors.find(entry => entry.object);
assert.equal(object.hp, 9);
assert.equal(object.maxHp, 9);
assert.equal(object.ac, 7);
assert.equal(object.effectTargetId, "device");
assert.deepEqual(clone(object.defenses), objectSpec.defenses);
assert.equal(objectSpec.id, undefined, "The provider's object descriptor is not mutated");
assert.ok(state.actors[1].conditions.some(effect => effect.objectId === object.id));
state = E.correct(state, object.id, { hp: 0 });
assert.ok(!state.actors[1].conditions.some(effect => effect.objectId === object.id), "Destroying the linked object clears its effect");
assert.equal(state.actors.find(entry => entry.id === object.id).inactive, true);
delete context.combatActions;
assert.equal(E.apply(battle(), "operator", move, ["device"]).battle.actors.length, 2,
  "The public engine does not invent a default object profile");
console.log("Public combat content hooks passed using synthetic descriptors only.");
