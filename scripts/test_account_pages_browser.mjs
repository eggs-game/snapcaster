#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const baseUrl = args.url || "http://127.0.0.1:5173";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname), "Account UI tests must use a loopback origin.");
const output = args.output || ".cache/ui-audit/account-pages";
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile("scripts/fixtures/accessibility-mock-data.json", "utf8"));
const deck = fixture.saved_decks[1];
const cards = [
  { id: deck.commander_scryfall_id, name: "Malcolm, Keen-Eyed Navigator", cmc: 3, type_line: "Legendary Creature — Siren Pirate", colors: ["U"], color_identity: ["U"], oracle_text: "Flying\nPartner" },
  { id: deck.partner_scryfall_id, name: "Breeches, Brazen Plunderer", cmc: 4, type_line: "Legendary Creature — Goblin Pirate", colors: ["R"], color_identity: ["R"], oracle_text: "Menace\nPartner" },
  { id: "11111111-1111-4111-8111-111111111111", name: "Sol Ring", cmc: 1, type_line: "Artifact", colors: [], color_identity: [] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Island", cmc: 0, type_line: "Basic Land — Island", colors: [], color_identity: ["U"] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Mountain", cmc: 0, type_line: "Basic Land — Mountain", colors: [], color_identity: ["R"] },
  { id: "44444444-4444-4444-8444-444444444444", name: "Negate", cmc: 2, type_line: "Instant", colors: ["U"], color_identity: ["U"] },
];
for (const card of cards) Object.assign(card, { set: "test", set_name: "UI fixture", collector_number: "1", image_uris: { normal: `${baseUrl}/hero/commanders/030-chatterfang-squirrel-general.png` } });
deck.cards = cards.map((card, index) => ({
  id: `ui-card-${index}`, name: card.name, scryfall_id: card.id, mana_value: index === 5 ? null : card.cmc,
  type_line: card.type_line, colors: card.colors, quantity: index === 3 || index === 4 ? 10 : 1,
  board: index < 2 ? "commander" : index === 5 ? "sideboard" : "mainboard", tags: index === 2 ? ["Ramp"] : [],
}));
fixture.account.preferences.preferred_camera_id = "fixture-camera";
fixture.account.preferences.preferred_microphone_id = "fixture-microphone";
fixture.sent_reviews[0].editable_until = "2099-01-01T00:00:00.000Z";
const invitation = { id: "ui-invitation", kind: "game_invitation", reference_id: "ui-invitation-ref", game_id: fixture.games[0].game_id, read_at: null, created_at: new Date().toISOString(), actor: fixture.social.friends[0] };
fixture.social.notifications.push(invitation);
const publicOwner = fixture.profiles[fixture.social.friends[0].id].data;
publicOwner.decks ||= [];
publicOwner.decks.push({ ...structuredClone(deck), id: "21999999-9999-4999-8999-999999999999", label: "Read-only pirates" });
const errors = [];
const forbiddenRequests = [];
const checks = [];
let delayPrinting;
const browser = await chromium.launch({ headless: true, ...(args.chrome ? { executablePath: args.chrome } : {}) });
const context = await browser.newContext({ viewport: { width: 1375, height: 998 }, permissions: ["clipboard-read", "clipboard-write"] });
await context.route("**/mock-data.local.json", (route) => route.fulfill({ json: fixture }));
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(baseUrl).origin) return route.fallback();
  if (url.hostname === "api.scryfall.com") {
    if (url.searchParams.get("format") === "image") return route.fulfill({ body: await readFile("public/hero/commanders/030-chatterfang-squirrel-general.png"), contentType: "image/png" });
    if (url.pathname === "/cards/collection") {
      const requested = route.request().postDataJSON()?.identifiers || [];
      return route.fulfill({ json: { data: cards.filter((card) => requested.some((entry) => entry.name === card.name)) } });
    }
    if (url.pathname === "/cards/search") {
      if (delayPrinting) await delayPrinting;
      return route.fulfill({ json: { data: [{ ...cards[2], set_name: "Slow Sol Ring artwork" }] } });
    }
    const name = url.searchParams.get("fuzzy") || url.searchParams.get("exact");
    const card = name ? cards.find((item) => item.name.toLowerCase() === name.toLowerCase()) : cards.find((item) => url.pathname.endsWith(item.id));
    return card ? route.fulfill({ json: card }) : route.fulfill({ status: 404, json: { details: "Card not found." } });
  }
  if (!["GET", "HEAD"].includes(route.request().method())) forbiddenRequests.push({ url: url.origin + url.pathname, method: route.request().method() });
  return route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const go = (route) => page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
const choose = async (label, option) => {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`account UI passed: ${name}`);
};
try {
  await check("profile search, view, sort, history and stats", async () => {
    await go("/profile");
    await page.getByRole("link", { name: "Open Tiny pirates deck" }).waitFor();
    await page.locator(".site-account-button").click();
    await page.locator(".site-account-menu").waitFor();
    await page.getByRole("heading", { name: "Zach", exact: true }).click();
    assert.equal(await page.locator(".site-account-menu").count(), 0);
    await page.locator(".site-account-button").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".site-account-menu").count(), 0);
    assert.equal(await page.locator(".site-account-button").evaluate((button) => button === document.activeElement), true);
    await page.getByPlaceholder("Search decks or commanders").fill("Tiny pirates");
    assert.equal(await page.locator(".saved-deck-list > a").count(), 1);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await choose("Sort decks", "Colors");
    await choose("Sort decks", "Average CMC");
    await choose("Sort decks", "Name");
    await page.getByPlaceholder("Search decks or commanders").fill("");
    await page.getByRole("tab", { name: "Game history", exact: true }).click();
    assert.ok(await page.locator(".account-history-list article").count() > 0);
    await page.getByRole("tab", { name: "Stats", exact: true }).click();
    await page.getByRole("tabpanel").getByText("Win rate", { exact: true }).waitFor();
  });
  await check("settings save, theme, device clear and export", async () => {
    await go("/settings");
    await page.getByLabel("Display name", { exact: true }).fill("UI Tester");
    await page.locator(".account-device-row").filter({ hasText: "Camera" }).getByRole("button").click();
    await choose("Appearance", "Light");
    await page.getByRole("checkbox", { name: /Appear offline/ }).check();
    await page.getByRole("checkbox", { name: /Show recent games/ }).uncheck();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("status").getByText("Settings saved.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await page.reload();
    await page.getByLabel("Display name", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), "UI Tester");
    assert.equal(await page.getByRole("checkbox", { name: /Appear offline/ }).isChecked(), true);
    assert.equal(await page.getByRole("checkbox", { name: /Show recent games/ }).isChecked(), false);
    assert.ok((await page.locator(".account-device-row").filter({ hasText: "Camera" }).innerText()).includes("No device saved"));
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export my data", exact: true }).click();
    const download = await downloaded;
    const data = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(data.profile.display_name, "UI Tester");
  });
  await check("deck commander and partner remain selectable in text view", async () => {
    await go(`/profile/decks/${deck.id}`);
    await page.getByRole("button", { name: "Sol Ring Ramp", exact: true }).click();
    for (const name of cards.slice(0, 2).map((card) => card.name)) {
      await page.getByRole("button", { name, exact: true }).click();
      assert.equal(await page.locator(".deck-card-inspector h2").innerText(), name);
    }
    assert.equal(await page.getByRole("button", { name: "10× Island", exact: true }).count(), 1);
    await page.getByRole("textbox", { name: "Find cards in this deck", exact: true }).fill("Malcolm");
    assert.equal(await page.locator(".deck-card-library .deck-card-row").count(), 1);
    await page.getByRole("textbox", { name: "Find cards in this deck", exact: true }).fill("");
    await choose("Group cards", "Mana value");
    await page.getByRole("button", { name: "Card view", exact: true }).click();
    assert.deepEqual(await page.locator(".deck-card-library h3").allTextContents(), ["Mana value 1", "Mana value 3", "Mana value 4", "Mana value unknown", "Lands"]);
    await page.getByRole("button", { name: "Text view", exact: true }).click();
    await choose("Group cards", "Section");
    await page.getByRole("heading", { name: "Commander", exact: true }).waitFor();
    await page.getByRole("button", { name: "Card view", exact: true }).click();
    await page.getByRole("button", { name: "Text view", exact: true }).click();
  });
  await check("deck rename, add, remove, hand draw and clipboard export", async () => {
    await page.getByRole("button", { name: deck.label, exact: true }).click();
    await page.getByRole("textbox", { name: "Deck name", exact: true }).fill("UI pirates");
    await page.getByRole("textbox", { name: "Deck name", exact: true }).press("Enter");
    await page.getByRole("button", { name: "UI pirates", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Sol Ring");
    await page.getByLabel("Quantity", { exact: true }).fill("2");
    await page.locator(".deck-add-card-form").getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByRole("button", { name: "3× Sol Ring Ramp", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Analysis & hand", exact: true }).click();
    assert.equal(await page.locator(".deck-sample-cards figure").count(), 7);
    await page.getByRole("button", { name: "Draw one", exact: true }).click();
    assert.equal(await page.locator(".deck-sample-cards figure").count(), 8);
    await page.getByRole("button", { name: "Deal again", exact: true }).click();
    assert.equal(await page.locator(".deck-sample-cards figure").count(), 7);
    await page.getByRole("tab", { name: "Deck list", exact: true }).click();
    await page.locator(".deck-toolbar-actions > summary").click();
    await page.getByRole("button", { name: "Copy list", exact: true }).click();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes("3 Sol Ring"));
    await page.locator(".deck-card-actions > summary").click();
    await page.getByRole("button", { name: "Remove card", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "3× Sol Ring Ramp", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Negate", exact: true }).click();
    if ((await page.locator(".deck-card-actions").getAttribute("open")) === null) await page.locator(".deck-card-actions > summary").click();
    await page.getByRole("button", { name: "Remove card", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove card", exact: true }).click();
    await page.getByRole("button", { name: "Negate", exact: true }).waitFor({ state: "hidden" });
    assert.notEqual(await page.locator(".deck-card-inspector h2").innerText(), "Negate");
    await page.getByRole("button", { name: "3× Sol Ring Ramp", exact: true }).click();
  });
  await check("slow artwork response cannot populate a different selected card", async () => {
    let releasePrinting;
    delayPrinting = new Promise((resolve) => { releasePrinting = resolve; });
    if ((await page.locator(".deck-card-actions").getAttribute("open")) === null) await page.locator(".deck-card-actions > summary").click();
    await page.getByRole("button", { name: "Change artwork", exact: true }).click();
    await page.getByText("Loading printings…", { exact: true }).waitFor();
    await page.getByRole("button", { name: "10× Island", exact: true }).click();
    releasePrinting();
    delayPrinting = null;
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".deck-art-picker").count(), 0);
    assert.equal(await page.locator(".deck-card-inspector h2").innerText(), "Island");
    if ((await page.locator(".deck-card-actions").getAttribute("open")) === null) await page.locator(".deck-card-actions > summary").click();
    assert.equal(await page.getByRole("button", { name: "Change artwork", exact: true }).isEnabled(), true);
  });
  await check("public deck has no owner edit controls", async () => {
    await go("/profile/decks/21999999-9999-4999-8999-999999999999");
    await page.getByRole("heading", { name: "Read-only pirates", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Add card", exact: true }).count(), 0);
    assert.equal(await page.locator(".deck-card-actions").count(), 0);
    await page.locator(".deck-toolbar-actions > summary").click();
    assert.equal(await page.getByRole("button", { name: "Import", exact: true }).count(), 0);
  });
  await check("notifications tabs, friend acceptance and invitation decline", async () => {
    await go("/notifications");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).waitFor({ state: "hidden" });
    const invitationRow = page.locator(".notifications-feed article").filter({ hasText: "invited you to a game" });
    await invitationRow.getByRole("button", { name: "Decline", exact: true }).click();
    await invitationRow.waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: "Reviews received", exact: true }).click();
    await page.getByText(fixture.received_reviews[0].comment, { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Reviews sent", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    const respondToReviewPrompt = (dialog) => dialog.accept(dialog.message().includes("rating") ? "5" : "Updated fixture review");
    page.on("dialog", respondToReviewPrompt);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByText("Updated fixture review", { exact: true }).waitFor();
    page.off("dialog", respondToReviewPrompt);
    await page.getByRole("tab", { name: "Friend requests", exact: true }).click();
    await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
    await page.getByText("You’re all caught up.", { exact: true }).waitFor();
  });
  await check("expired invitation is a visible recoverable error", async () => {
    await page.evaluate((notification) => {
      const saved = JSON.parse(sessionStorage.getItem("snapcast-local-mock-state"));
      saved.social.notifications.push({ ...notification, id: "expired-invitation", reference_id: "expired-ref", game_id: "missing-game" });
      sessionStorage.setItem("snapcast-local-mock-state", JSON.stringify(saved));
    }, invitation);
    await go("/notifications");
    await page.locator(".notifications-feed").getByRole("button", { name: "Join", exact: true }).click();
    await page.getByRole("alert").getByText("Invitation expired.", { exact: true }).waitFor();
    assert.equal(await page.locator(".notifications-feed").getByRole("button", { name: "Join", exact: true }).isEnabled(), true);
  });
  await check("friend removal cancellation and fixture mutation", async () => {
    await go("/friends");
    const friend = page.locator(".profile-friend-row").filter({ hasText: "Drew" });
    await friend.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await friend.waitFor();
    await friend.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove friend", exact: true }).click();
    await friend.waitFor({ state: "hidden" });
  });
  await check("import pasted deck opens the complete editable deck", async () => {
    await go("/profile");
    await page.getByRole("button", { name: "Import deck", exact: true }).click();
    await page.getByLabel("Moxfield export", { exact: true }).fill("Commander\n1 Malcolm, Keen-Eyed Navigator\n1 Breeches, Brazen Plunderer\n\nMainboard\n1 Sol Ring #!Ramp\n10 Island\n10 Mountain");
    await page.getByRole("dialog").getByRole("button", { name: /^Import \d+ cards$/ }).click();
    await page.waitForURL(/\/profile\/decks\/[a-f0-9-]+$/);
    await page.getByRole("button", { name: "10× Mountain", exact: true }).waitFor();
    assert.equal(await page.locator(".deck-card-library .deck-card-row").count(), 5);
    await page.locator(".deck-card-library").getByRole("button", { name: "Malcolm, Keen-Eyed Navigator", exact: true }).waitFor();
  });
  assert.deepEqual(errors, [], "No unhandled page errors are allowed.");
  assert.deepEqual(forbiddenRequests, [], "No production mutation request is allowed.");
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ baseUrl, checks, errors, forbiddenRequests }, null, 2));
  await context.close();
  await browser.close();
}
