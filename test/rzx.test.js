import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { createZ80Snapshot } from "../public/snapshot.js";
import { parseRzx, RzxPlayback } from "../public/rzx.js";
import { Spectrum48 } from "../src/spectrum48.js";

function write16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function write32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function rzxHeader() {
  return Uint8Array.from([0x52, 0x5a, 0x58, 0x21, 0x00, 0x0d, 0, 0, 0, 0]);
}

function creatorBlock() {
  const block = new Uint8Array(29);
  block[0] = 0x10;
  write32(block, 1, block.length);
  block.set(new TextEncoder().encode("Z80 Machine Lab"), 5);
  return block;
}

function snapshotBlock(snapshot, extension = "Z80") {
  const block = new Uint8Array(17 + snapshot.length);
  block[0] = 0x30;
  write32(block, 1, block.length);
  block.set(new TextEncoder().encode(extension), 9);
  write32(block, 13, snapshot.length);
  block.set(snapshot, 17);
  return block;
}

function externalSnapshotBlock(filename, extension = "Z80") {
  const name = new TextEncoder().encode(`${filename}\0`);
  const block = new Uint8Array(17 + 4 + name.length);
  block[0] = 0x30;
  write32(block, 1, block.length);
  write32(block, 5, 1);
  block.set(new TextEncoder().encode(extension), 9);
  block.set(name, 21);
  return block;
}

function inputBlock(payload, frameCount, { compressed = false } = {}) {
  const stored = compressed ? deflateSync(payload) : payload;
  const block = new Uint8Array(18 + stored.length);
  block[0] = 0x80;
  write32(block, 1, block.length);
  write32(block, 5, frameCount);
  write32(block, 14, compressed ? 0x02 : 0);
  block.set(stored, 18);
  return block;
}

function join(...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

test("parses RZX creator, snapshot, input, and repeated frames", async () => {
  const machine = new Spectrum48({ rom: new Uint8Array(0x4000) });
  const snapshot = createZ80Snapshot(machine);
  const frames = new Uint8Array(9);
  write16(frames, 0, 2);
  write16(frames, 2, 1);
  frames[4] = 0x5a;
  write16(frames, 5, 3);
  write16(frames, 7, 0xffff);

  const recording = await parseRzx(join(
    rzxHeader(),
    creatorBlock(),
    snapshotBlock(snapshot),
    inputBlock(frames, 2)
  ));

  assert.equal(recording.creator, "Z80 Machine Lab");
  assert.equal(recording.frameCount, 2);
  assert.equal(recording.timeline[0].extension, "Z80");
  assert.equal(recording.timeline[1].type, "input-start");
  assert.deepEqual(Array.from(recording.timeline[2].inputs), [0x5a]);
  assert.deepEqual(Array.from(recording.timeline[3].inputs), [0x5a]);
});

test("inflates compressed RZX input blocks", async () => {
  const frame = new Uint8Array(4);
  write16(frame, 0, 1);
  write16(frame, 2, 0);
  const recording = await parseRzx(join(rzxHeader(), creatorBlock(), inputBlock(frame, 1, { compressed: true })));
  assert.equal(recording.timeline[0].type, "input-start");
  assert.equal(recording.timeline[1].fetchCount, 1);
});

test("plays RZX frames from an embedded Z80 snapshot", async () => {
  const rom = new Uint8Array(0x4000);
  rom.set([0x00, 0xdb, 0xfe, 0x00]);
  const source = new Spectrum48({ rom });
  source.cpu.PC = 1;
  const snapshot = createZ80Snapshot(source);
  const frame = new Uint8Array(5);
  write16(frame, 0, 2);
  write16(frame, 2, 1);
  frame[4] = 0x42;
  const recording = await parseRzx(join(rzxHeader(), snapshotBlock(snapshot), inputBlock(frame, 1)));
  const target = new Spectrum48({ rom });
  const playback = new RzxPlayback(target, recording);

  playback.stepFrame();

  assert.equal(target.cpu.A, 0x42);
  assert.equal(playback.frameIndex, 1);
  assert.equal(playback.done, true);
});

test("resolves external RZX snapshots supplied beside the recording", async () => {
  const supplied = new Uint8Array([1, 2, 3]);
  const frame = new Uint8Array(4);
  write16(frame, 0, 1);
  const recording = await parseRzx(join(
    rzxHeader(),
    externalSnapshotBlock("start.z80"),
    inputBlock(frame, 1)
  ), {
    resolveExternalSnapshot: ({ filename }) => filename === "start.z80" ? supplied : null
  });
  assert.equal(recording.timeline[0].external, true);
  assert.equal(recording.timeline[0].filename, "start.z80");
  assert.deepEqual(Array.from(recording.timeline[0].data), [1, 2, 3]);
});

test("plays RZX frames from an embedded 48K SNA snapshot", async () => {
  const sna = new Uint8Array(27 + 0xc000);
  write16(sna, 23, 0x8000);
  write16(sna, 27 + 0x4000, 0x9000);
  sna[27 + 0x5000] = 0x00;
  const frame = new Uint8Array(4);
  write16(frame, 0, 1);
  const recording = await parseRzx(join(rzxHeader(), snapshotBlock(sna, "SNA"), inputBlock(frame, 1)));
  const machine = new Spectrum48({ rom: new Uint8Array(0x4000) });
  const playback = new RzxPlayback(machine, recording);
  playback.stepFrame();
  assert.equal(machine.cpu.PC, 0x9001);
});

test("rejects protected and external RZX data", async () => {
  const protectedBlock = inputBlock(new Uint8Array(4), 1);
  write32(protectedBlock, 14, 1);
  await assert.rejects(() => parseRzx(join(rzxHeader(), protectedBlock)), /Protected/);

  const external = new Uint8Array(17);
  external[0] = 0x30;
  write32(external, 1, external.length);
  write32(external, 5, 1);
  await assert.rejects(() => parseRzx(join(rzxHeader(), external)), /External/);
});
