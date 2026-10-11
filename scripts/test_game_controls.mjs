import assert from "node:assert/strict";
import { isPlainSpaceShortcut, serializeCommanderDamage, suppressDragReleaseClick } from "../src/gameControls.js";

const background = { closest: () => null };
const noModal = { querySelector: () => null };
const space = { key: " ", code: "Space", target: background };
assert.equal(isPlainSpaceShortcut(space, noModal), true);
assert.equal(isPlainSpaceShortcut({ key: " ", target: background }, noModal), true);
assert.equal(isPlainSpaceShortcut({ key: "Enter", code: "Enter", target: background }, noModal), false);
for (const flag of ["repeat", "defaultPrevented", "isComposing", "metaKey", "ctrlKey", "altKey", "shiftKey"]) {
  assert.equal(isPlainSpaceShortcut({ ...space, [flag]: true }, noModal), false, `${flag} must preserve ordinary keyboard behavior`);
}
assert.equal(isPlainSpaceShortcut(space, { querySelector: () => ({}) }), false, "a modal blocks background turn passing");
assert.equal(isPlainSpaceShortcut({ ...space, target: { isContentEditable: true } }, noModal), false);
for (const selector of ["button", "input", "textarea", "select", "a[href]", "summary", "video[controls]", '[tabindex]:not([tabindex^="-"])',
  '[role="button"]', '[role="switch"]', '[role="listbox"]', '[role="option"]', '[role="tab"]',
  '[role="checkbox"]', '[role="combobox"]', '[role="menuitem"]']) {
  const interactive = { closest: (query) => query.split(",").includes(selector) ? {} : null };
  assert.equal(isPlainSpaceShortcut({ ...space, target: interactive }, noModal), false, `Space belongs to ${selector}`);
  assert.equal(isPlainSpaceShortcut({ ...space, composedPath: () => [interactive] }, noModal), false,
    "shadow-DOM descendants must retain their own activation");
  assert.equal(isPlainSpaceShortcut({ ...space, target: { nodeType: 3, parentElement: interactive } }, noModal), false);
}
assert.equal(isPlainSpaceShortcut(null, noModal), false);

const listeners = new Set();
let nextTask;
const fakeWindow = {
  addEventListener: (type, callback, capture) => { assert.equal(type, "click"); assert.equal(capture, true); listeners.add(callback); },
  removeEventListener: (_type, callback) => listeners.delete(callback),
  setTimeout: (callback, delay) => { assert.equal(delay, 0); nextTask = callback; return 1; },
  clearTimeout: () => {},
};
suppressDragReleaseClick(fakeWindow);
let prevented = false, stopped = false;
[...listeners][0]({ preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
assert.ok(prevented && stopped, "the synthesized drag release click must not reach identification");
assert.equal(listeners.size, 0, "later intentional clicks must work normally");
suppressDragReleaseClick(fakeWindow);
nextTask();
assert.equal(listeners.size, 0, "cancellation without a click must not swallow the next user action");

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const c = "10000000-0000-4000-8000-000000000003";
const roster = [
  { id: "a", membershipId: a, role: "player" },
  { id: "b", membershipId: b, role: "player" },
  { id: "visitor", membershipId: c, role: "visitor" },
  { id: "bad", membershipId: "mock-membership", role: "player" },
];
assert.deepEqual(serializeCommanderDamage({ a: 12, "p:a": 12, "p:b": 21 }, roster), { [a]: 12, [b]: 21 },
  "partners preserve the highest single commander, not a lethal sum");
assert.deepEqual(serializeCommanderDamage({ "p:a": 21, a: 6 }, roster), { [a]: 21 },
  "iteration order must not let the primary overwrite higher partner damage");
assert.deepEqual(serializeCommanderDamage({ a: 21, "p:a": 6 }, roster), { [a]: 21 });
assert.deepEqual(serializeCommanderDamage({ a: -4, "p:b": 5000 }, roster), { [a]: 0, [b]: 999 });
assert.deepEqual(serializeCommanderDamage({ a: "7", b: 12.9 }, roster), { [a]: 7, [b]: 12 });
for (const value of [NaN, Infinity, -Infinity, "bad", "", null, undefined, {}, [], true]) {
  assert.deepEqual(serializeCommanderDamage({ a: value }, roster), {}, "invalid numeric values must not reach the snapshot");
}
assert.deepEqual(serializeCommanderDamage({ missing: 21, "p:missing": 21, visitor: 21, bad: 21 }, roster), {});
assert.deepEqual(serializeCommanderDamage(null, roster), {});
assert.deepEqual(serializeCommanderDamage([], roster), {});
assert.deepEqual(serializeCommanderDamage({ a: 21 }, null), {});
const damage = { a: 9, "p:a": 21 };
serializeCommanderDamage(damage, roster);
assert.deepEqual(damage, { a: 9, "p:a": 21 }, "serialization must not mutate the live per-creature counters");
console.log("OK: plain Space preserves controls/modal focus; durable Commander damage retains bounded partner maxima by membership UUID");
