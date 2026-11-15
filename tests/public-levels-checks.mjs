// Tests the generic public algorithm with invented data, not licensed boards.
// Run with Node: node tests/public-levels-checks.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clone = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({ structuredClone: clone });
const beforeSource = fs.readFileSync(path.join(root, "character_page/levels.js"), "utf8");
const emptyContext = vm.createContext({ structuredClone: clone });
vm.runInContext(beforeSource, emptyContext);
assert.equal(emptyContext.borderlandsLevels.resolve("uninstalled"), null, "Missing private content does not break module initialization");
const baseClass = { hp: 14, shortRestHp: 2, skills: { Inventing: 1 }, powers: [{ en: "Battery", count: 2 }],
  spells: ["imaginary-signal"], attacks: [], features: [{ id: "obsolete", en: "Outdated instructions" }],
  prepared: { count: 1, choices: ["imaginary-signal", "invented-beacon"], defaults: ["imaginary-signal"] } };
context.borderlandsClasses = { navigator: clone(baseClass) };
context.borderlandsLevelData = {
  preparedCounts: { navigator: { 1: 1, 2: 2, 3: 3 } },
  subclasses: { navigator: { cartographer: { en: "Cartographer", zh: "制图员" } } },
  spellPoolLabels: { 1: { en: "Charge pool", zh: "充能池" } },
  boards: {
    "navigator-1": { classId: "navigator", level: 1, hp: 14, page: 101 },
    "navigator-2": { classId: "navigator", level: 2, hp: 27, page: 102, skills: { Inventing: 4 },
      powers: [{ en: "Battery", count: 4 }], powerAdds: [{ en: "Reserve", count: 3 }],
      spellAdds: ["invented-beacon"], featureRemoves: ["obsolete"], featureAdds: [{ en: "Example feature" }],
      attackAdds: [{ en: "Example tool", bonus: 7 }], spellSlots: { 1: 6 } },
    "navigator-3-cartographer": { classId: "navigator", level: 3, hp: 40, page: 103,
      preparedAdds: ["fictional-chart"], spellAdds: ["fictional-chart"], source: "private/example-record.md" },
  },
};
vm.runInContext(beforeSource, context, { filename: "character_page/levels.js" });
const L = context.borderlandsLevels;
const boardSnapshot = clone(context.borderlandsLevelData);
const resolved = L.resolve("navigator", 2);
assert.equal(resolved.hp, 27);
assert.equal(resolved.skills.Inventing, 4);
assert.equal(resolved.powers.find(power => power.en === "Charge pool").count, 6);
assert.equal(resolved.attacks[0].bonus, 7);
assert.ok(!resolved.features.some(feature => feature.id === "obsolete"));
assert.equal(resolved.prepared.count, 2);
assert.deepEqual(clone(context.borderlandsClasses.navigator), baseClass, "Resolution leaves base content untouched");
assert.deepEqual(clone(context.borderlandsLevelData), boardSnapshot, "Resolution leaves private content untouched");
assert.equal(L.resolve("missing"), null);
assert.throws(() => L.resolve("navigator", 3), /installed private content/);
assert.equal(L.resolve("navigator", 3, "cartographer").source, "private/example-record.md");
assert.equal(L.boardKey("navigator", 1, "cartographer"), "navigator-1");
assert.equal(L.boardKey("navigator", 3, "cartographer"), "navigator-3-cartographer");

// A synthetic character adapter exercises resource-capacity and saved-state logic.
context.borderlandsCharacter = {
  normalize: clone,
  derive(choice) {
    const job = L.resolve(choice.classId, choice.level ?? 1, choice.subclassId);
    return { complete: choice.complete !== false, choice: clone(choice), level: choice.level ?? 1,
      currentHp: choice.sheet?.stats?.currentHp ?? job.hp, gold: choice.sheet?.stats?.gold ?? 0,
      powers: job.powers.map(power => ({ ...power, id: power.en,
        remaining: choice.sheet?.power?.[power.en] ?? power.count })), defaultSpellIds: job.spells };
  },
};
const input = { classId: "navigator", level: 1, prepared: ["imaginary-signal"],
  sheet: { stats: { currentHp: 5, gold: 23, ac: 29 }, power: { Battery: 0 },
    inventory: { "invented-rope": 2 }, state: { conditions: [{ key: "example-effect" }] }, spellIds: ["imaginary-signal", "custom-charm"] } };
const inputSnapshot = clone(input);
const result = L.advance(input);
assert.equal(result.choice.level, 2);
assert.equal(result.choice.sheet.stats.currentHp, 5);
assert.equal(result.choice.sheet.stats.gold, 23);
assert.equal(result.choice.sheet.stats.ac, 29);
assert.equal(result.choice.sheet.power.Battery, 2, "Only the additional capacity is granted");
assert.equal(result.choice.sheet.power.Reserve, 3, "A new resource begins at its configured capacity");
assert.deepEqual(clone(result.choice.prepared), ["imaginary-signal", "invented-beacon"]);
assert.deepEqual(clone(result.choice.sheet.spellIds), ["imaginary-signal", "custom-charm", "invented-beacon"]);
assert.deepEqual(clone(result.choice.sheet.inventory), input.sheet.inventory);
assert.deepEqual(clone(result.choice.sheet.state), input.sheet.state);
assert.deepEqual(clone(input), inputSnapshot, "The original remains a usable Undo snapshot");
assert.throws(() => L.advance(result.choice), /installed private content/);
const third = L.advance(result.choice, "cartographer");
assert.equal(third.choice.subclassId, "cartographer");
assert.equal(third.after.currentHp, 5);
assert.equal(third.choice.prepared.length, 3);
assert.throws(() => L.advance(third.choice, "cartographer"), /installed private content/);
assert.throws(() => L.advance({ ...input, complete: false }), /complete character/);
console.log("Public progression checks passed using synthetic content only.");
