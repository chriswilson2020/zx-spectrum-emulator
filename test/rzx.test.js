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

function snapshotBlock(snapshot) {
  const block = new Uint8Array(17 + snapshot.length);
  block[0] = 0x30;
  write32(block, 1, block.length);
  block.set(new TextEncoder().encode("Z80"), 9);
  write32(block, 13, snapshot.length);
  block.set(snapshot, 17);
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
  assert.deepEqual(Array.from(recording.timeline[1].inputs), [0x5a]);
  assert.deepEqual(Array.from(recording.timeline[2].inputs), [0x5a]);
});

test("inflates compressed RZX input blocks", async () => {
  const frame = new Uint8Array(4);
  write16(frame, 0, 1);
  write16(frame, 2, 0);
  const recording = await parseRzx(join(rzxHeader(), creatorBlock(), inputBlock(frame, 1, { compressed: true })));
  assert.equal(recording.timeline[0].fetchCount, 1);
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
