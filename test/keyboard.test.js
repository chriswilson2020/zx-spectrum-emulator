import assert from "node:assert/strict";
import test from "node:test";
import {
  basicTextToSpectrumKeyTaps,
  shouldCaptureModernKeyEvent,
  modernTextToSpectrumKeyTaps,
  spectrumKeysForModernKey
} from "../public/keyboard.js";
import { Spectrum48 } from "../src/spectrum48.js";

function event(key) {
  return { key };
}

function read16(machine, address) {
  return machine.read8(address) | (machine.read8(address + 1) << 8);
}

function runFrames(machine, count) {
  for (let frame = 0; frame < count; frame += 1) machine.runFrame();
}

function tapModernKey(machine, key) {
  const spectrumKeys = spectrumKeysForModernKey(event(key));
  for (const spectrumKey of spectrumKeys) machine.pressKey(spectrumKey);
  runFrames(machine, 4);
  for (const spectrumKey of spectrumKeys) machine.releaseKey(spectrumKey);
  runFrames(machine, 4);
}

test("maps ordinary letters and digits to Spectrum keys", () => {
  assert.deepEqual(spectrumKeysForModernKey(event("a")), ["A"]);
  assert.deepEqual(spectrumKeysForModernKey(event("A")), ["CAPS SHIFT", "A"]);
  assert.deepEqual(spectrumKeysForModernKey(event("7")), ["7"]);
});

test("maps modern editing keys to Spectrum chords", () => {
  assert.deepEqual(spectrumKeysForModernKey(event("Enter")), ["ENTER"]);
  assert.deepEqual(spectrumKeysForModernKey(event(" ")), ["SPACE"]);
  assert.deepEqual(spectrumKeysForModernKey(event("Backspace")), ["CAPS SHIFT", "0"]);
});

test("maps common modern punctuation to Symbol Shift chords", () => {
  const expectations = new Map([
    ["\"", ["SYMBOL SHIFT", "P"]],
    ["'", ["SYMBOL SHIFT", "7"]],
    [";", ["SYMBOL SHIFT", "O"]],
    [":", ["SYMBOL SHIFT", "Z"]],
    [",", ["SYMBOL SHIFT", "N"]],
    [".", ["SYMBOL SHIFT", "M"]],
    ["-", ["SYMBOL SHIFT", "J"]],
    ["+", ["SYMBOL SHIFT", "K"]],
    ["=", ["SYMBOL SHIFT", "L"]],
    ["*", ["SYMBOL SHIFT", "B"]],
    ["/", ["SYMBOL SHIFT", "V"]],
    ["?", ["SYMBOL SHIFT", "C"]],
    ["(", ["SYMBOL SHIFT", "8"]],
    [")", ["SYMBOL SHIFT", "9"]],
    ["<", ["SYMBOL SHIFT", "R"]],
    [">", ["SYMBOL SHIFT", "T"]],
    ["!", ["SYMBOL SHIFT", "1"]]
  ]);

  for (const [key, expected] of expectations) {
    assert.deepEqual(spectrumKeysForModernKey(event(key)), expected);
  }
});

test("ignores keys without a Spectrum mapping", () => {
  assert.equal(spectrumKeysForModernKey(event("F5")), null);
});

test("does not capture modern keys while editing form controls", () => {
  assert.equal(shouldCaptureModernKeyEvent({ target: { tagName: "TEXTAREA" } }), false);
  assert.equal(shouldCaptureModernKeyEvent({ target: { tagName: "INPUT" } }), false);
  assert.equal(shouldCaptureModernKeyEvent({ target: { tagName: "SELECT" } }), false);
  assert.equal(shouldCaptureModernKeyEvent({ target: { isContentEditable: true } }), false);
  assert.equal(shouldCaptureModernKeyEvent({ target: { tagName: "CANVAS" } }), true);
});

test("converts pasted modern text into Spectrum key taps", () => {
  assert.deepEqual(modernTextToSpectrumKeyTaps("10 PRINT \"HI\"\nRUN"), [
    ["1"],
    ["0"],
    ["SPACE"],
    ["CAPS SHIFT", "P"],
    ["CAPS SHIFT", "R"],
    ["CAPS SHIFT", "I"],
    ["CAPS SHIFT", "N"],
    ["CAPS SHIFT", "T"],
    ["SPACE"],
    ["SYMBOL SHIFT", "P"],
    ["CAPS SHIFT", "H"],
    ["CAPS SHIFT", "I"],
    ["SYMBOL SHIFT", "P"],
    ["ENTER"],
    ["CAPS SHIFT", "R"],
    ["CAPS SHIFT", "U"],
    ["CAPS SHIFT", "N"]
  ]);
});

test("converts pasted BASIC keywords into Spectrum keyword keys", () => {
  assert.deepEqual(basicTextToSpectrumKeyTaps("10 PRINT \"HELLO\"\nRUN"), [
    ["1"],
    ["0"],
    ["SPACE"],
    ["P"],
    ["SYMBOL SHIFT", "P"],
    ["CAPS SHIFT", "H"],
    ["CAPS SHIFT", "E"],
    ["CAPS SHIFT", "L"],
    ["CAPS SHIFT", "L"],
    ["CAPS SHIFT", "O"],
    ["SYMBOL SHIFT", "P"],
    ["ENTER"],
    ["R"]
  ]);
});

test("translated punctuation chords are visible through Spectrum keyboard rows", () => {
  const machine = new Spectrum48({ rom: new Uint8Array(0x4000) });

  for (const key of spectrumKeysForModernKey(event("\""))) machine.pressKey(key);

  assert.equal(machine.readPort(0x7ffe) & 0x02, 0x00);
  assert.equal(machine.readPort(0xdffe) & 0x01, 0x00);
});

test("modern keyboard translation can enter a quoted BASIC line through the ROM", () => {
  const machine = Spectrum48.fromRomFile("ROM/48.rom");
  runFrames(machine, 180);

  for (const key of "10p\"hello\"") tapModernKey(machine, key);
  tapModernKey(machine, "Enter");
  runFrames(machine, 20);

  const programStart = read16(machine, 0x5c53);
  const variablesStart = read16(machine, 0x5c4b);
  const programBytes = Array.from(
    { length: variablesStart - programStart },
    (_, offset) => machine.read8(programStart + offset)
  );

  assert.deepEqual(programBytes, [
    0x00, 0x0a, 0x09, 0x00, 0xf5, 0x22, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x22, 0x0d
  ]);
});
