import assert from "node:assert/strict";
import test from "node:test";
import { Trs80KeyLatch, keyEventToTrs80Key } from "../public/trs80-keyboard.js";

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
