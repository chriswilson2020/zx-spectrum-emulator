import assert from "node:assert/strict";
import test from "node:test";
import { applyZ80Snapshot, createZ80Snapshot, parseZ80Snapshot } from "../public/snapshot.js";
import { Spectrum48 } from "../src/spectrum48.js";

function makeMachine() {
  return new Spectrum48({ rom: new Uint8Array(0x4000) });
}

function writeWord(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeHeader(bytes, { pc = 0x8000, compressed = false } = {}) {
  bytes[0] = 0x12;
  bytes[1] = 0x34;
  bytes[2] = 0x56;
  bytes[3] = 0x78;
  bytes[4] = 0x9a;
  bytes[5] = 0xbc;
  writeWord(bytes, 6, pc);
  writeWord(bytes, 8, 0xddee);
  bytes[10] = 0x21;
  bytes[11] = 0x22;
  bytes[12] = 1 | (5 << 1) | (compressed ? 0x20 : 0);
  bytes[13] = 0x43;
  bytes[14] = 0x65;
  bytes[15] = 0x87;
  bytes[16] = 0xa9;
  bytes[17] = 0xcb;
  bytes[18] = 0xed;
  bytes[19] = 0x0f;
  bytes[20] = 0x10;
  bytes[21] = 0x32;
  bytes[22] = 0x54;
  writeWord(bytes, 23, 0x2468);
  writeWord(bytes, 25, 0x1357);
  bytes[27] = 1;
  bytes[28] = 0;
  bytes[29] = 2;
}

test("saves and restores an uncompressed Z80 v1 snapshot", () => {
  const machine = makeMachine();
  Object.assign(machine.cpu, {
    A: 0x12,
    F: 0x34,
    B: 0x56,
    C: 0x78,
    D: 0x9a,
    E: 0xbc,
    H: 0xde,
    L: 0xf0,
    A_: 0x11,
    F_: 0x22,
    B_: 0x33,
    C_: 0x44,
    D_: 0x55,
    E_: 0x66,
    H_: 0x77,
    L_: 0x88,
    IX: 0x1357,
    IY: 0x2468,
    SP: 0xff00,
    PC: 0x8123,
    I: 0x5a,
    R: 0xa5,
    IFF1: true,
    IFF2: true,
    interruptMode: 1
  });
  machine.borderColor = 6;
  machine.write8(0x4000, 0x01);
  machine.write8(0x8000, 0x02);
  machine.write8(0xffff, 0x03);

  const snapshot = createZ80Snapshot(machine);
  const restored = makeMachine();
  applyZ80Snapshot(restored, snapshot);

  assert.equal(restored.cpu.A, 0x12);
  assert.equal(restored.cpu.F, 0x34);
  assert.equal(restored.cpu.BC, 0x5678);
  assert.equal(restored.cpu.DE, 0x9abc);
  assert.equal(restored.cpu.HL, 0xdef0);
  assert.equal(restored.cpu.A_, 0x11);
  assert.equal(restored.cpu.F_, 0x22);
  assert.equal(restored.cpu.B_, 0x33);
  assert.equal(restored.cpu.C_, 0x44);
  assert.equal(restored.cpu.D_, 0x55);
  assert.equal(restored.cpu.E_, 0x66);
  assert.equal(restored.cpu.H_, 0x77);
  assert.equal(restored.cpu.L_, 0x88);
  assert.equal(restored.cpu.IX, 0x1357);
  assert.equal(restored.cpu.IY, 0x2468);
  assert.equal(restored.cpu.SP, 0xff00);
  assert.equal(restored.cpu.PC, 0x8123);
  assert.equal(restored.cpu.I, 0x5a);
  assert.equal(restored.cpu.R, 0xa5);
  assert.equal(restored.cpu.IFF1, true);
  assert.equal(restored.cpu.IFF2, true);
  assert.equal(restored.cpu.interruptMode, 1);
  assert.equal(restored.borderColor, 6);
  assert.equal(restored.read8(0x4000), 0x01);
  assert.equal(restored.read8(0x8000), 0x02);
  assert.equal(restored.read8(0xffff), 0x03);
});

test("loads compressed Z80 v1 RAM blocks", () => {
  const compressedRam = [0xaa, 0xed, 0xed, 0x04, 0xbb, 0xcc];
  let remaining = 0xc000 - 6;
  while (remaining > 0) {
    const count = Math.min(255, remaining);
    compressedRam.push(0xed, 0xed, count, 0x00);
    remaining -= count;
  }
  compressedRam.push(0x00, 0xed, 0xed, 0x00);
  const bytes = new Uint8Array([...new Array(30).fill(0), ...compressedRam]);
  writeHeader(bytes, { pc: 0x8123, compressed: true });

  const snapshot = parseZ80Snapshot(bytes);

  assert.equal(snapshot.registers.PC, 0x8123);
  assert.equal(snapshot.borderColor, 5);
  assert.deepEqual(Array.from(snapshot.ram.slice(0, 6)), [0xaa, 0xbb, 0xbb, 0xbb, 0xbb, 0xcc]);
  assert.equal(snapshot.ram.length, 0xc000);
});

test("loads 48K page blocks from extended Z80 snapshots", () => {
  const header = new Uint8Array(55);
  writeHeader(header, { pc: 0 });
  writeWord(header, 30, 23);
  writeWord(header, 32, 0x9abc);
  header[34] = 0;
  const page8 = new Uint8Array(0x4000).fill(0x40);
  const page4 = new Uint8Array(0x4000).fill(0x80);
  const page5 = new Uint8Array(0x4000).fill(0xc0);
  const snapshotBytes = new Uint8Array(55 + 3 * (3 + 0x4000));
  snapshotBytes.set(header);
  let offset = 55;
  for (const [page, data] of [[8, page8], [4, page4], [5, page5]]) {
    writeWord(snapshotBytes, offset, 0xffff);
    snapshotBytes[offset + 2] = page;
    snapshotBytes.set(data, offset + 3);
    offset += 3 + 0x4000;
  }

  const machine = makeMachine();
  applyZ80Snapshot(machine, snapshotBytes);

  assert.equal(machine.cpu.PC, 0x9abc);
  assert.equal(machine.read8(0x4000), 0x40);
  assert.equal(machine.read8(0x8000), 0x80);
  assert.equal(machine.read8(0xc000), 0xc0);
});
