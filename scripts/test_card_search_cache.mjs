import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (url === "/carddata/names.json") {
    return {
      ok: true,
      json: async () => [
        "Jodah, the Unifier",
        "Jodah, Archmage Eternal",
        "Sol Ring",
        "Solemn Simulacrum",
      ],
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ name: "Sol Ring", type_line: "Artifact" }),
  };
};

const {
  fetchCardByName,
  suggestCardNames,
} = await import("../src/cardSearch.js");

assert.deepEqual(await suggestCardNames("jodah un"), ["Jodah, the Unifier"]);
assert.deepEqual(await suggestCardNames("jodah un"), ["Jodah, the Unifier"]);
assert.equal(calls.filter((url) => url === "/carddata/names.json").length, 1);
assert.equal(calls.some((url) => url.includes("/autocomplete")), false);

const [first, second] = await Promise.all([
  fetchCardByName("Sol Ring", { exact: true }),
  fetchCardByName("Sol Ring", { exact: true }),
]);
assert.equal(first.name, "Sol Ring");
assert.equal(second.name, "Sol Ring");
assert.equal(calls.filter((url) => url.includes("exact=Sol%20Ring")).length, 1);

console.log("card search local index and request cache passed");
