import assert from "node:assert/strict";
import test from "node:test";
import { Spectrum48 } from "../src/spectrum48.js";

function makeRom(bytes = {}) {
  const rom = new Uint8Array(0x4000);
  for (const [address, value] of Object.entries(bytes)) {
    rom[Number(address)] = value;
  }
  return rom;
}

test("requires a 16K ROM", () => {
  assert.throws(() => new Spectrum48({ rom: new Uint8Array(0x3fff) }), /16K ROM/);
  assert.throws(() => new Spectrum48({ rom: new Uint8Array(0x4001) }), /16K ROM/);
});

test("maps ROM at 0000-3fff and ignores writes to ROM", () => {
  const machine = new Spectrum48({
    rom: makeRom({
      0x0000: 0xf3,
      0x1234: 0x5a,
      0x3fff: 0xc9
    })
  });

  assert.equal(machine.read8(0x0000), 0xf3);
  assert.equal(machine.read8(0x1234), 0x5a);
  assert.equal(machine.read8(0x3fff), 0xc9);

  machine.write8(0x1234, 0x99);
  assert.equal(machine.read8(0x1234), 0x5a);
});

test("maps RAM at 4000-ffff", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.write8(0x4000, 0x12);
  machine.write8(0x8000, 0x34);
  machine.write8(0xffff, 0x56);

  assert.equal(machine.read8(0x4000), 0x12);
  assert.equal(machine.read8(0x8000), 0x34);
  assert.equal(machine.read8(0xffff), 0x56);
});

test("loads the bundled 48K Spectrum ROM from disk", () => {
  const machine = Spectrum48.fromRomFile("ROM/48.rom");

  assert.equal(machine.rom.length, 0x4000);
  assert.equal(machine.read8(0x0000), machine.rom[0]);
});

test("reads and writes 16-bit little-endian values through the memory map", () => {
  const machine = new Spectrum48({ rom: makeRom({ 0x3fff: 0xaa }) });

  machine.write16(0x4000, 0x1234);
  assert.equal(machine.read8(0x4000), 0x34);
  assert.equal(machine.read8(0x4001), 0x12);
  assert.equal(machine.read16(0x4000), 0x1234);

  machine.write16(0x3fff, 0x5678);
  assert.equal(machine.read8(0x3fff), 0xaa);
  assert.equal(machine.read8(0x4000), 0x56);
});

test("wires the CPU to fetch and execute bytes from Spectrum ROM", () => {
  const machine = new Spectrum48({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });

  assert.equal(machine.step(), 7);
  assert.equal(machine.cpu.A, 0x42);
  assert.equal(machine.cpu.PC, 0x0002);
});

test("port fe writes update border colour and beeper state", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.writePort(0x00fe, 0x13);

  assert.equal(machine.borderColor, 0x03);
  assert.equal(machine.beeperOn, true);
  assert.equal(machine.readPort(0x00fe), 0xff);
});

test("records beeper transitions with CPU timing", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.writePort(0x00fe, 0x10);
  machine.runTStates(12);
  machine.writePort(0x00fe, 0x00);

  assert.deepEqual(machine.drainBeeperEvents(), [
    { tState: 0, on: true },
    { tState: 12, on: false }
  ]);
  assert.deepEqual(machine.drainBeeperEvents(), []);
});

test("does not record beeper events when the beeper bit is unchanged", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.writePort(0x00fe, 0x10);
  machine.writePort(0x00fe, 0x17);
  machine.writePort(0x00fe, 0x00);

  assert.deepEqual(machine.drainBeeperEvents(), [
    { tState: 0, on: true },
    { tState: 0, on: false }
  ]);
});

test("port fe reads idle keyboard rows as unpressed", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  assert.equal(machine.readPort(0xfefe), 0xff);
  assert.equal(machine.readPort(0xfdfe), 0xff);
});

test("keyboard keys read as active-low bits in selected rows", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.pressKey("A");
  machine.pressKey("5");

  assert.equal(machine.readPort(0xfdfe), 0xfe);
  assert.equal(machine.readPort(0xf7fe), 0xef);

  machine.releaseKey("A");
  assert.equal(machine.readPort(0xfdfe), 0xff);
});

test("keyboard reads combine multiple selected rows", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.pressKey("A");
  machine.pressKey("Q");

  assert.equal(machine.readPort(0xf9fe), 0xfe);
});

test("reports currently pressed Spectrum keys for diagnostics", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.pressKey("SYMBOL SHIFT");
  machine.pressKey("P");

  assert.deepEqual(machine.getPressedKeys(), ["P", "SYMBOL SHIFT"]);
});

test("CPU IN instructions read the keyboard matrix through port fe", () => {
  const machine = new Spectrum48({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0xfd,
      0x0002: 0xdb,
      0x0003: 0xfe
    })
  });
  machine.pressKey("A");

  machine.step();
  machine.step();

  assert.equal(machine.cpu.A, 0xfe);
});

test("runs CPU work in t-state and frame-sized slices", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  assert.equal(machine.runTStates(8), 8);
  assert.equal(machine.cpu.PC, 0x0002);

  const frameStart = machine.cpu.tStates;
  const elapsed = machine.runFrame();

  assert.equal(machine.frame, 1);
  assert.equal(elapsed >= Spectrum48.T_STATES_PER_FRAME, true);
  assert.equal(machine.cpu.tStates - frameStart, elapsed);
  assert.equal(machine.cpu.pendingInterrupt, true);
});

test("runFrame asserts the interrupt before executing frame CPU work", () => {
  const machine = new Spectrum48({
    rom: makeRom({
      0x0000: 0xfb, // EI
      0x0001: 0x00, // NOP lets EI delay expire
      0x0002: 0xc3, // JP $0002
      0x0003: 0x02,
      0x0004: 0x00,
      0x0038: 0x3e, // LD A,$99
      0x0039: 0x99,
      0x003a: 0xc9 // RET
    })
  });

  machine.runFrame();

  assert.equal(machine.cpu.A, 0x99);
  assert.equal(machine.cpu.pendingInterrupt, false);
});

test("renders display bytes and attributes to an RGBA buffer", () => {
  const machine = new Spectrum48({ rom: makeRom() });
  machine.write8(0x4000, 0x80);
  machine.write8(0x5800, 0x0a); // blue paper, red ink

  const rgba = machine.renderDisplayRgba();

  assert.equal(rgba.length, Spectrum48.SCREEN_WIDTH * Spectrum48.SCREEN_HEIGHT * 4);
  assert.deepEqual(Array.from(rgba.slice(0, 4)), [205, 0, 0, 255]);
  assert.deepEqual(Array.from(rgba.slice(4, 8)), [0, 0, 205, 255]);
});

test("renders Spectrum screen memory using the ULA line address layout", () => {
  const machine = new Spectrum48({ rom: makeRom() });
  machine.write8(0x4020, 0x80);
  machine.write8(0x5820, 0x05); // black paper, cyan ink

  const rgba = machine.renderDisplayRgba();
  const pixelOffset = (8 * Spectrum48.SCREEN_WIDTH) * 4;

  assert.deepEqual(Array.from(rgba.slice(pixelOffset, pixelOffset + 4)), [0, 205, 205, 255]);
});

test("renders bright attributes", () => {
  const machine = new Spectrum48({ rom: makeRom() });
  machine.write8(0x4000, 0x80);
  machine.write8(0x5800, 0x42); // bright red ink

  const rgba = machine.renderDisplayRgba();

  assert.deepEqual(Array.from(rgba.slice(0, 4)), [255, 0, 0, 255]);
});

test("renders a full frame buffer with border around the display", () => {
  const machine = new Spectrum48({ rom: makeRom() });
  machine.writePort(0x00fe, 0x01);
  machine.write8(0x4000, 0x80);
  machine.write8(0x5800, 0x02);

  const rgba = machine.renderFrameRgba();
  const borderPixel = 0;
  const displayPixel =
    ((Spectrum48.BORDER_TOP * Spectrum48.FRAME_WIDTH) + Spectrum48.BORDER_LEFT) * 4;

  assert.equal(rgba.length, Spectrum48.FRAME_WIDTH * Spectrum48.FRAME_HEIGHT * 4);
  assert.deepEqual(Array.from(rgba.slice(borderPixel, borderPixel + 4)), [0, 0, 205, 255]);
  assert.deepEqual(Array.from(rgba.slice(displayPixel, displayPixel + 4)), [205, 0, 0, 255]);
});

test("reset restarts CPU and frame state without clearing RAM", () => {
  const machine = new Spectrum48({ rom: makeRom() });
  machine.write8(0x4000, 0x77);
  machine.runTStates(4);
  machine.runFrame();

  machine.reset();

  assert.equal(machine.cpu.PC, 0);
  assert.equal(machine.frame, 0);
  assert.equal(machine.read8(0x4000), 0x77);
});
