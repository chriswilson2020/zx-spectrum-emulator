import assert from "node:assert/strict";
import test from "node:test";
import { Trs80Model3Machine } from "../src/trs80-model3.js";

function makeRom(bytes = {}) {
  const rom = new Uint8Array(0x3800);
  for (const [address, value] of Object.entries(bytes)) {
    rom[Number(address)] = value;
  }
  return rom;
}

test("requires a 14K Model III ROM", () => {
  assert.throws(() => new Trs80Model3Machine({ rom: new Uint8Array(0x37ff) }), /14K Model III ROM/);
  assert.throws(() => new Trs80Model3Machine({ rom: new Uint8Array(0x3801) }), /14K Model III ROM/);
});

test("maps ROM at 0000-37ff and ignores writes to ROM", () => {
  const machine = new Trs80Model3Machine({
    rom: makeRom({
      0x0000: 0xf3,
      0x1234: 0x5a,
      0x37ff: 0xc9
    })
  });

  assert.equal(machine.read8(0x0000), 0xf3);
  assert.equal(machine.read8(0x1234), 0x5a);
  assert.equal(machine.read8(0x37ff), 0xc9);

  machine.write8(0x1234, 0x99);
  assert.equal(machine.read8(0x1234), 0x5a);
});

test("maps keyboard at 3800-3bff and ignores writes to keyboard", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  assert.equal(machine.read8(0x3800), 0x00);
  assert.equal(machine.read8(0x3bff), 0x00);

  machine.write8(0x3800, 0xff);
  assert.equal(machine.read8(0x3800), 0x00);
});

test("maps text video at 3c00-3fff", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.write8(0x3c00, 0x41);
  machine.write8(0x3fff, 0x5a);

  assert.equal(machine.read8(0x3c00), 0x41);
  assert.equal(machine.read8(0x3fff), 0x5a);
});

test("maps RAM at 4000-ffff", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.write8(0x4000, 0x12);
  machine.write8(0x8000, 0x34);
  machine.write8(0xffff, 0x56);

  assert.equal(machine.read8(0x4000), 0x12);
  assert.equal(machine.read8(0x8000), 0x34);
  assert.equal(machine.read8(0xffff), 0x56);
});

test("reads and writes 16-bit little-endian values through the memory map", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom({ 0x37ff: 0xaa }) });

  machine.write16(0x4000, 0x1234);
  assert.equal(machine.read8(0x4000), 0x34);
  assert.equal(machine.read8(0x4001), 0x12);
  assert.equal(machine.read16(0x4000), 0x1234);

  machine.write16(0x37ff, 0x5678);
  assert.equal(machine.read8(0x37ff), 0xaa);
  assert.equal(machine.read8(0x3800), 0x00);
});

test("keyboard keys read as active-high bits in selected rows", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.pressKey("A");
  machine.pressKey("ENTER");
  machine.pressKey("L");

  assert.equal(machine.read8(0x3801), 0x02);
  assert.equal(machine.read8(0x3802), 0x10);
  assert.equal(machine.read8(0x3840), 0x01);

  machine.releaseKey("A");
  assert.equal(machine.read8(0x3801), 0x00);
});

test("keyboard reads combine multiple selected rows", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.pressKey("A");
  machine.pressKey("ENTER");

  assert.equal(machine.read8(0x3841), 0x03);
});

test("reports currently pressed TRS-80 keys for diagnostics", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.pressKey("SPACE");
  machine.pressKey("RIGHT SHIFT");

  assert.deepEqual(machine.getPressedKeys(), ["RIGHT SHIFT", "SPACE"]);
});

test("renders video memory as 16 rows of 64 text characters", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.write8(0x3c00, 0x48);
  machine.write8(0x3c01, 0x49);
  machine.write8(0x3c40, 0x5a);
  machine.write8(0x3fff, 0x21);

  const rows = machine.renderTextDisplay();

  assert.equal(rows.length, 16);
  assert.equal(rows[0].length, 64);
  assert.equal(rows[0].slice(0, 2), "HI");
  assert.equal(rows[1][0], "Z");
  assert.equal(rows[15][63], "!");
});

test("renders non-printing and graphics display bytes as spaces", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  machine.write8(0x3c00, 0x00);
  machine.write8(0x3c01, 0x1f);
  machine.write8(0x3c02, 0x80);

  assert.equal(machine.renderTextDisplay()[0].slice(0, 3), "   ");
});

test("wires the CPU to fetch and execute bytes from Model III ROM", () => {
  const machine = new Trs80Model3Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });

  assert.equal(machine.step(), 7);
  assert.equal(machine.cpu.A, 0x42);
  assert.equal(machine.cpu.PC, 0x0002);
});

test("runs CPU work in t-state and frame-sized slices", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  assert.equal(machine.runTStates(8), 8);
  assert.equal(machine.cpu.PC, 0x0002);

  const frameStart = machine.cpu.tStates;
  const elapsed = machine.runFrame();

  assert.equal(machine.frame, 1);
  assert.equal(elapsed >= Trs80Model3Machine.T_STATES_PER_FRAME, true);
  assert.equal(machine.cpu.tStates - frameStart, elapsed);
  assert.equal(machine.cpu.pendingInterrupt, true);
});

test("reset restarts CPU and frame state without clearing RAM or video", () => {
  const machine = new Trs80Model3Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });

  machine.write8(0x3c00, 0x41);
  machine.write8(0x4000, 0x99);
  machine.step();
  machine.runFrame();
  machine.reset();

  assert.equal(machine.cpu.PC, 0x0000);
  assert.equal(machine.cpu.A, 0x00);
  assert.equal(machine.frame, 0);
  assert.equal(machine.read8(0x3c00), 0x41);
  assert.equal(machine.read8(0x4000), 0x99);
});

test("reports compact debug state for the TRS-80 Model III machine", () => {
  const machine = new Trs80Model3Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });
  machine.pressKey("A");
  machine.write8(0x3c00, 0x48);
  machine.step();

  const state = machine.getDebugState();

  assert.equal(state.profile, "trs80-model3");
  assert.equal(state.halted, false);
  assert.equal(state.frame, 0);
  assert.equal(state.cpu.registers.PC, machine.cpu.PC);
  assert.deepEqual(state.keyboard.pressedKeys, ["A"]);
  assert.deepEqual(state.keyboard.matrix.slice(0, 2), [
    { address: 0x3800, value: 0x02, keys: ["A"] },
    { address: 0x3880, value: 0x00, keys: [] }
  ]);
  assert.deepEqual(state.display, {
    columns: 64,
    rows: 16,
    videoStart: 0x3c00,
    videoEnd: 0x3fff,
    nonSpaceCharacters: 1
  });
});

test("saves and restores TRS-80 Model III machine state", () => {
  const machine = new Trs80Model3Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });
  machine.step();
  machine.write8(0x3c00, 0x48);
  machine.write8(0x4000, 0x99);
  machine.pressKey("A");
  machine.pressKey("ENTER");
  machine.runFrame();

  const state = machine.saveState();
  const restored = new Trs80Model3Machine({ rom: makeRom() });
  restored.write8(0x3c00, 0x20);
  restored.write8(0x4000, 0x20);
  restored.restoreState(state);

  assert.equal(state.format, "z80lab-trs80-session");
  assert.equal(state.profile, "trs80-model3");
  assert.equal(restored.cpu.A, state.cpu.registers.A);
  assert.equal(restored.cpu.PC, state.cpu.registers.PC);
  assert.equal(restored.read8(0x3c00), 0x48);
  assert.equal(restored.read8(0x4000), 0x99);
  assert.deepEqual(restored.getPressedKeys(), ["A", "ENTER"]);
  assert.equal(restored.frame, 1);
});

test("rejects incompatible TRS-80 session state", () => {
  const machine = new Trs80Model3Machine({ rom: makeRom() });

  assert.throws(() => machine.restoreState({ format: "z80lab-cpm-session", profile: "trs80-model3" }), /Unsupported TRS-80 session format/);
  assert.throws(() => machine.restoreState({ format: "z80lab-trs80-session", version: 99, profile: "trs80-model3" }), /Unsupported TRS-80 session version/);
  assert.throws(
    () => machine.restoreState({ format: "z80lab-trs80-session", version: 1, profile: "trs80-model1", ram: [], videoRam: [], keyboardRows: [] }),
    /Unsupported TRS-80 profile/
  );
});

test("bundled Model III ROM accepts ENTER at the cassette prompt", () => {
  const machine = Trs80Model3Machine.fromRomFile("ROM/Model3-RevC-2EF8.bin");

  runFrames(machine, 20);
  assert.match(screenText(machine), /Cass\? 0/);

  tapKey(machine, "ENTER");

  assert.match(screenText(machine), /Memory Size\? 0/);
});

test("bundled Model III ROM sees H and L as cassette speed answers", () => {
  for (const key of ["H", "L"]) {
    const machine = Trs80Model3Machine.fromRomFile("ROM/Model3-RevC-2EF8.bin");

    runFrames(machine, 20);
    tapKey(machine, key, 2);

    assert.match(screenText(machine), new RegExp(`Cass\\? ${key}`));
  }
});

test("bundled Model III ROM reaches BASIC READY after startup prompts", () => {
  const machine = Trs80Model3Machine.fromRomFile("ROM/Model3-RevC-2EF8.bin");

  runFrames(machine, 20);
  tapKey(machine, "H");
  tapKey(machine, "ENTER");
  runFrames(machine, 80);

  const text = screenText(machine);
  assert.match(text, /Radio Shack Model III Basic/);
  assert.match(text, /\(c\) '80 Tandy/);
  assert.match(text, /READY/);
});

function runFrames(machine, frames) {
  for (let frame = 0; frame < frames; frame += 1) machine.runFrame();
}

function tapKey(machine, key, heldFrames = 3) {
  machine.pressKey(key);
  runFrames(machine, heldFrames);
  machine.releaseKey(key);
  runFrames(machine, 25);
}

function screenText(machine) {
  return machine.renderTextDisplay().join("\n");
}
