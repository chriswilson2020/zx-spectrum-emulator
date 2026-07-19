import assert from "node:assert/strict";
import test from "node:test";
import { Trs80KeyLatch, Trs80TextTyper, keyEventToTrs80Key, textToTrs80KeyTaps } from "../public/trs80-keyboard.js";

test("maps browser keys to TRS-80 key names", () => {
  assert.equal(keyEventToTrs80Key({ key: "h", code: "KeyH" }), "H");
  assert.equal(keyEventToTrs80Key({ key: "4", code: "Digit4" }), "4");
  assert.equal(keyEventToTrs80Key({ key: "Enter", code: "Enter" }), "ENTER");
  assert.equal(keyEventToTrs80Key({ key: " ", code: "Space" }), "SPACE");
  assert.equal(keyEventToTrs80Key({ key: "Shift", code: "ShiftLeft" }), "LEFT SHIFT");
  assert.equal(keyEventToTrs80Key({ key: "Shift", code: "ShiftRight" }), "RIGHT SHIFT");
  assert.equal(keyEventToTrs80Key({ key: "ArrowLeft", code: "ArrowLeft" }), "LEFT");
});

test("holds released keys for a few frame ticks so ROM polling sees quick taps", () => {
  const events = [];
  const latch = new Trs80KeyLatch({
    pressKey: (key) => events.push(["press", key]),
    releaseKey: (key) => events.push(["release", key])
  }, { releaseHoldFrames: 2 });

  assert.equal(latch.press("ENTER"), true);
  assert.equal(latch.release("ENTER"), true);
  assert.deepEqual(events, [["press", "ENTER"]]);

  latch.advanceFrame();
  assert.deepEqual(events, [["press", "ENTER"]]);

  latch.advanceFrame();
  assert.deepEqual(events, [["press", "ENTER"], ["release", "ENTER"]]);
});

test("does not release a key while it is physically pressed again", () => {
  const events = [];
  const latch = new Trs80KeyLatch({
    pressKey: (key) => events.push(["press", key]),
    releaseKey: (key) => events.push(["release", key])
  }, { releaseHoldFrames: 2 });

  latch.press("H");
  latch.release("H");
  latch.press("H");
  latch.advanceFrame();
  latch.advanceFrame();

  assert.deepEqual(events, [["press", "H"]]);

  latch.release("H");
  latch.advanceFrame();
  latch.advanceFrame();

  assert.deepEqual(events, [["press", "H"], ["release", "H"]]);
});

test("converts plain text to TRS-80 key taps", () => {
  assert.deepEqual(textToTrs80KeyTaps("PRINT 42\n"), [
    ["P"],
    ["R"],
    ["I"],
    ["N"],
    ["T"],
    ["SPACE"],
    ["4"],
    ["2"],
    ["ENTER"]
  ]);
});

test("converts punctuation to shifted TRS-80 key chords", () => {
  assert.deepEqual(textToTrs80KeyTaps(`"HELLO"? A+B=(C)`), [
    ["LEFT SHIFT", "2"],
    ["H"],
    ["E"],
    ["L"],
    ["L"],
    ["O"],
    ["LEFT SHIFT", "2"],
    ["LEFT SHIFT", "/"],
    ["SPACE"],
    ["A"],
    ["LEFT SHIFT", ";"],
    ["B"],
    ["LEFT SHIFT", "-"],
    ["LEFT SHIFT", "8"],
    ["C"],
    ["LEFT SHIFT", "9"]
  ]);
});

test("rejects unsupported pasted characters with a helpful error", () => {
  assert.throws(() => textToTrs80KeyTaps("HELLO_"), /Unsupported TRS-80 character: _/);
});

test("types queued text as key taps over frame ticks", () => {
  const events = [];
  const latch = new Trs80KeyLatch({
    pressKey: (key) => events.push(["press", key]),
    releaseKey: (key) => events.push(["release", key])
  }, { releaseHoldFrames: 1 });
  const typer = new Trs80TextTyper(latch, { holdFrames: 1, gapFrames: 1 });

  typer.enqueue("A+\n");

  assert.equal(typer.pendingCount(), 3);
  assert.equal(typer.advanceFrame(), true);
  assert.deepEqual(events, [["press", "A"]]);
  assert.equal(typer.advanceFrame(), true);
  assert.deepEqual(events, [["press", "A"], ["release", "A"]]);
  assert.equal(typer.advanceFrame(), true);
  assert.deepEqual(events, [["press", "A"], ["release", "A"], ["press", "LEFT SHIFT"], ["press", ";"]]);
  assert.equal(typer.advanceFrame(), true);
  assert.deepEqual(events, [
    ["press", "A"],
    ["release", "A"],
    ["press", "LEFT SHIFT"],
    ["press", ";"],
    ["release", "LEFT SHIFT"],
    ["release", ";"]
  ]);
  assert.equal(typer.advanceFrame(), true);
  assert.deepEqual(events.at(-1), ["press", "ENTER"]);
});
