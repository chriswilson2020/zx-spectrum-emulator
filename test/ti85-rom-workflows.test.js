import assert from "node:assert/strict";
import test from "node:test";
import { Ti85RomHarness, hasBundledTi85Rom } from "./helpers/ti85-rom-harness.js";

const POWER_ON_SIGNATURE = {
  lcdEnabled: true,
  baseAddress: 0xfc00,
  litPixelCount: 271,
  checksum: "4374343B"
};

const WORKFLOWS = [
  {
    name: "evaluates 2+3",
    keys: ["2", "+", "3", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 54,
      checksum: "CB6F32E2"
    }
  },
  {
    name: "evaluates 7*8",
    keys: ["CLEAR", "7", "*", "8", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 71,
      checksum: "B6048EA1"
    }
  },
  {
    name: "evaluates signed parenthesized expression",
    keys: ["CLEAR", "(", "(-)", "4", ")", "+", "9", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 72,
      checksum: "FC6BF4E6"
    }
  },
  {
    name: "evaluates SIN 0",
    keys: ["CLEAR", "SIN", "0", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 71,
      checksum: "5D73EE43"
    }
  },
  {
    name: "stores and recalls alpha A",
    keys: ["CLEAR", "4", "2", "STO", "ALPHA", "LOG", "ENTER", "CLEAR", "ALPHA", "LOG", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 660,
      checksum: "DF5B24DD"
    }
  },
  {
    name: "shows divide by zero error",
    keys: ["CLEAR", "1", "/", "0", "ENTER"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 663,
      checksum: "C71243CD"
    }
  },
  {
    name: "opens graph menu",
    keys: ["GRAPH"],
    signature: {
      lcdEnabled: true,
      baseAddress: 0xfc00,
      litPixelCount: 548,
      checksum: "AD291B01"
    }
  }
];

const testWithBundledRom = hasBundledTi85Rom() ? test : test.skip;

testWithBundledRom("TI-85 ROM powers on to a stable home display signature", () => {
  const harness = Ti85RomHarness.fromBundledRom();

  harness.powerOn();

  assert.deepEqual(harness.signature(), POWER_ON_SIGNATURE, harness.failureDetails("power-on", ["ON"]));
});

for (const workflow of WORKFLOWS) {
  testWithBundledRom(`TI-85 ROM workflow: ${workflow.name}`, () => {
    const harness = Ti85RomHarness.fromBundledRom();

    harness.powerOn();
    harness.runWorkflow(workflow.keys);

    assert.deepEqual(harness.signature(), workflow.signature, harness.failureDetails(workflow.name, workflow.keys));
  });
}
