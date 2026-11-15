// Synthetic checks: no campaign data or published adventure values are loaded.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const clone=value=>JSON.parse(JSON.stringify(value));
const code=fs.readFileSync(path.join(root,"keep_page/transactions.js"),"utf8");
assert.throws(()=>vm.runInNewContext(code,{}),/private-config\.js/);
const handlers={
  samplePurchase(c){c.changeGold(c.options.buyer,-c.price());c.changeInventory(c.options.buyer,c.offer.item,c.options.quantity);},
  sampleHealing(c){c.heal(c.options.patient,c.rolled(c.options.dice,1,3));},
  sampleFailure(c){c.changeGold(c.options.buyer,-1);c.fail("Synthetic rollback");},
  sampleTime(c){c.dailyUse("sample",3);c.advanceTime(2);c.setEffect(c.options.buyer,"sample",c.keep.day+1,c.keep.hour);},
};
const context=vm.createContext({structuredClone:clone,borderlandsAdventureConfig:{keep:{},trail:{},transactions:{handlers,permissions:{sample:{anyWeapon:true}},periodAt:()=>"day"}},
  borderlandsItems:{"supply-box":{en:"Supply box"}},borderlandsCharacter:{
    derive(choice){return {choice,job:{en:"Sample role"},gold:choice.sheet.stats.gold,hp:20,currentHp:choice.sheet.stats.currentHp,inventory:clone(choice.sheet.inventory),equipped:{},wornIds:[],ac:0,calculatedStats:{ac:0}};},
    equipmentType:item=>item?.type,weaponHas:()=>false,
  }});
vm.runInContext(code,context);
const T=context.keepTransactions;
const roster={slots:[{name:"Sample character",classId:"sample",sheet:{stats:{gold:30,currentHp:8},inventory:{}}}],keep:T.empty()};
const original=clone(roster);
let outcome=T.preview(roster,{id:"sample-purchase",handler:"samplePurchase",item:"supply-box",gp:7},{buyer:0,quantity:2});
assert.equal(outcome.next.slots[0].sheet.stats.gold,16);
assert.equal(outcome.next.slots[0].sheet.inventory["supply-box"],2);
assert.deepEqual(clone(roster),original,"Preview never mutates the original save");
outcome=T.preview(roster,{id:"sample-healing",handler:"sampleHealing"},{buyer:0,dice:[3]});
assert.equal(outcome.next.slots[0].sheet.stats.currentHp,11);
assert.throws(()=>T.preview(roster,{id:"sample-failure",handler:"sampleFailure"},{buyer:0}),/Synthetic rollback/);
assert.deepEqual(clone(roster),original);
outcome=T.preview(roster,{id:"sample-time",handler:"sampleTime"},{buyer:0});
assert.equal(outcome.next.keep.hour,14);assert.equal(outcome.next.keep.uses["sample:1"],1);assert.equal(outcome.next.keep.effects.length,1);
assert.throws(()=>T.preview(roster,{id:"missing-handler"},{buyer:0}),/Private transaction handler/);
for(const file of ["keep_page/keep.js","keep_page/transactions.js","adventure_page/maps.js"])new vm.Script(fs.readFileSync(path.join(root,file),"utf8"),{filename:file});
for(const file of ["keep_page/index.html","adventure_page/index.html"]){const html=fs.readFileSync(path.join(root,file),"utf8");assert.ok(html.indexOf("private-config.js")<html.indexOf("classes.js"),"Private config is loaded before consumers");}
export const result="Private adventure checks passed: required adapters, atomic purchase/healing/time helpers, rollback, missing-handler errors and consumer script order.";
