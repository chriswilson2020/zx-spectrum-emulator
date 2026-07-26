import { applyZ80Snapshot } from "./snapshot.js";

const RZX_HEADER_LENGTH = 10;
const SNAPSHOT_BLOCK = 0x30;
const INPUT_BLOCK = 0x80;
const CREATOR_BLOCK = 0x10;

function bytesFrom(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function read16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function read32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length)).replace(/\0.*$/, "");
}

async function inflate(bytes, expectedLength = null) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Compressed RZX data is not supported by this browser");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (expectedLength !== null && result.length !== expectedLength) {
    throw new Error(`RZX data expanded to ${result.length} bytes; expected ${expectedLength}`);
  }
  return result;
}

async function parseSnapshotBlock(block) {
  if (block.length < 17) throw new Error("RZX snapshot block is truncated");
  const flags = read32(block, 5);
  if (flags & 0x01) throw new Error("External RZX snapshots are not supported");
  const extension = readAscii(block, 9, 4).trim().toUpperCase();
  const uncompressedLength = read32(block, 13);
  const payload = block.slice(17);
  const data = flags & 0x02 ? await inflate(payload, uncompressedLength) : payload;
  if (!(flags & 0x02) && data.length !== uncompressedLength) {
    throw new Error("RZX snapshot length does not match its header");
  }
  return { type: "snapshot", extension, data };
}

async function parseInputBlock(block, previousInputs) {
  if (block.length < 18) throw new Error("RZX input recording block is truncated");
  const frameCount = read32(block, 5);
  const flags = read32(block, 14);
  if (flags & 0x01) throw new Error("Protected RZX recordings are not supported");
  const payload = flags & 0x02 ? await inflate(block.slice(18)) : block.slice(18);
  const frames = [];
  let offset = 0;
  let lastInputs = previousInputs;

  for (let index = 0; index < frameCount; index += 1) {
    if (offset + 4 > payload.length) throw new Error(`RZX frame ${index + 1} is truncated`);
    const fetchCount = read16(payload, offset);
    const inputCount = read16(payload, offset + 2);
    offset += 4;

    let inputs;
    if (inputCount === 0xffff) {
      if (!lastInputs) throw new Error("RZX repeated frame has no previous input frame");
      inputs = Uint8Array.from(lastInputs);
    } else {
      if (offset + inputCount > payload.length) throw new Error(`RZX frame ${index + 1} input log is truncated`);
      inputs = payload.slice(offset, offset + inputCount);
      offset += inputCount;
      lastInputs = inputs;
    }
    frames.push({ type: "frame", fetchCount, inputs });
  }

  if (offset !== payload.length) throw new Error("RZX input block contains trailing frame data");
  return { frames, previousInputs: lastInputs };
}

export async function parseRzx(input) {
  const bytes = bytesFrom(input);
  if (bytes.length < RZX_HEADER_LENGTH || readAscii(bytes, 0, 4) !== "RZX!") {
    throw new Error("RZX file has an invalid header");
  }

  const timeline = [];
  let creator = "Unknown";
  let offset = RZX_HEADER_LENGTH;
  let previousInputs = null;

  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) throw new Error("RZX block header is truncated");
    const blockLength = read32(bytes, offset + 1);
    if (blockLength < 5 || offset + blockLength > bytes.length) throw new Error("RZX block length is invalid");
    const block = bytes.slice(offset, offset + blockLength);

    if (block[0] === CREATOR_BLOCK) {
      if (block.length < 29) throw new Error("RZX creator block is truncated");
      creator = readAscii(block, 5, 20) || "Unknown";
    } else if (block[0] === SNAPSHOT_BLOCK) {
      timeline.push(await parseSnapshotBlock(block));
    } else if (block[0] === INPUT_BLOCK) {
      const parsed = await parseInputBlock(block, previousInputs);
      timeline.push(...parsed.frames);
      previousInputs = parsed.previousInputs;
    }
    offset += blockLength;
  }

  const frameCount = timeline.filter((event) => event.type === "frame").length;
  if (frameCount === 0) throw new Error("RZX file contains no input frames");
  return {
    version: `${bytes[4]}.${bytes[5]}`,
    creator,
    timeline,
    frameCount
  };
}

export class RzxPlayback {
  constructor(machine, recording) {
    this.machine = machine;
    this.recording = recording;
    this.eventIndex = 0;
    this.frameIndex = 0;
  }

  get done() {
    return this.eventIndex >= this.recording.timeline.length;
  }

  stepFrame() {
    while (this.eventIndex < this.recording.timeline.length) {
      const event = this.recording.timeline[this.eventIndex];
      this.eventIndex += 1;
      if (event.type === "snapshot") {
        if (event.extension !== "Z80") {
          throw new Error(`RZX snapshot type ${event.extension || "(missing)"} is not supported; use an embedded Z80 snapshot`);
        }
        applyZ80Snapshot(this.machine, event.data);
        continue;
      }

      this.machine.runRecordedFrame(event);
      this.frameIndex += 1;
      return event;
    }
    return null;
  }
}
