import assert from "node:assert/strict";
import test from "node:test";
import { MachineHistory } from "../public/history.js";
import { Spectrum48 } from "../src/spectrum48.js";

function machineWithIncrementProgram() {
  const rom = new Uint8Array(0x4000);
  rom.set([0x3c, 0x3c, 0x3c]);
  return new Spectrum48({ rom });
}

test("restores prior instruction states in reverse order", () => {
  const machine = machineWithIncrementProgram();
  const history = new MachineHistory({ limit: 4 });

  history.capture(machine);
  machine.step();
  history.capture(machine);
  machine.step();
  assert.equal(machine.cpu.A, 2);

  history.stepBack(machine);
  assert.equal(machine.cpu.A, 1);
  assert.equal(machine.cpu.PC, 1);
  history.stepBack(machine);
  assert.equal(machine.cpu.A, 0);
  assert.equal(machine.cpu.PC, 0);
});

test("bounds reverse history and clears it", () => {
  const machine = machineWithIncrementProgram();
  const history = new MachineHistory({ limit: 2 });
  for (let index = 0; index < 3; index += 1) {
    history.capture(machine);
    machine.step();
  }
  assert.equal(history.size, 2);
  history.clear();
  assert.equal(history.size, 0);
  assert.equal(history.stepBack(machine), null);
});

test("compacts older checkpoints into reverse RAM deltas", () => {
  const machine = machineWithIncrementProgram();
  const history = new MachineHistory({ limit: 10 });
  history.capture(machine, "first");
  machine.write8(0x4001, 0xaa);
  machine.step();
  history.capture(machine, "second");
  machine.write8(0x4002, 0xbb);
  machine.step();

  assert.equal(history.entries[0].state.ram, undefined);
  assert.deepEqual(Array.from(history.entries[0].ramOffsets), [1]);
  history.stepBack(machine);
  history.stepBack(machine);
  assert.equal(machine.read8(0x4001), 0);
  assert.equal(machine.read8(0x4002), 0);
  assert.equal(machine.cpu.PC, 0);
});
