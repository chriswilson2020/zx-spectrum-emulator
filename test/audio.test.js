import assert from "node:assert/strict";
import test from "node:test";
import { createBeeperSamples } from "../public/audio.js";

test("creates beeper samples from timed transitions", () => {
  const result = createBeeperSamples(
    [
      { tState: 2, on: true },
      { tState: 6, on: false }
    ],
    {
      fromTState: 0,
      toTState: 10,
      initialLevel: false,
      sampleRate: 10,
      tStatesPerSecond: 10,
      amplitude: 0.5
    }
  );

  assert.deepEqual(Array.from(result.samples), [0, 0, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0]);
  assert.equal(result.level, false);
});

test("continues beeper level when no transition occurs", () => {
  const result = createBeeperSamples([], {
    fromTState: 0,
    toTState: 4,
    initialLevel: true,
    sampleRate: 4,
    tStatesPerSecond: 4,
    amplitude: 0.25
  });

  assert.deepEqual(Array.from(result.samples), [0.25, 0.25, 0.25, 0.25]);
  assert.equal(result.level, true);
});
