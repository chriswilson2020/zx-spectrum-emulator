import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTapeUrl } from "../public/tape-url.js";

test("rewrites GitHub blob links to raw file URLs", () => {
  assert.equal(normalizeTapeUrl("https://github.com/tuklusan/ZX-Carrom/blob/main/dist/zxcarrom.tzx","https://tuklusan.github.io/zx-spectrum-emulator/"),
    "https://raw.githubusercontent.com/tuklusan/ZX-Carrom/main/dist/zxcarrom.tzx");
});
test("keeps ordinary https tape URLs intact", () => {
  assert.equal(normalizeTapeUrl("https://example.com/games/carrom.tzx","https://example.com/emulator/"),"https://example.com/games/carrom.tzx");
});
test("resolves relative tape URLs against the current page", () => {
  assert.equal(normalizeTapeUrl("games/carrom.tzx","https://example.com/emulator/"),"https://example.com/emulator/games/carrom.tzx");
});
test("rejects non-web tape URL schemes", () => {
  assert.throws(() => normalizeTapeUrl("javascript:alert(1)","https://example.com/"),/scheme/);
});
