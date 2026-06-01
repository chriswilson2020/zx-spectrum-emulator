import { loadBasicProgramBytes } from "./basic.js";

const HEADER_TYPES = ["Program", "Number array", "Character array", "Code"];

function wordAt(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function longAt(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function checksumFor(bytes) {
  return bytes.reduce((checksum, value) => checksum ^ value, 0);
}

function decodeHeader(payload) {
  if (payload.length !== 17) return null;
  const type = payload[0];
  const name = String.fromCharCode(...payload.slice(1, 11)).trimEnd();
  return {
    type,
    typeName: HEADER_TYPES[type] ?? `Type ${type}`,
    name,
    length: wordAt(payload, 11),
    param1: wordAt(payload, 13),
    param2: wordAt(payload, 15)
  };
}

export function parseTap(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const blocks = [];
  let offset = 0;

  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) throw new Error("Truncated TAP block length");
    const length = wordAt(bytes, offset);
    offset += 2;
    if (length < 2) throw new Error(`Invalid TAP block length: ${length}`);
    if (offset + length > bytes.length) throw new Error("Truncated TAP block data");

    const raw = bytes.slice(offset, offset + length);
    const flag = raw[0];
    const payload = raw.slice(1, -1);
    const checksum = raw[raw.length - 1];
    blocks.push({
      index: blocks.length,
      length,
      flag,
      payload,
      checksum,
      checksumValid: checksumFor(raw) === 0,
      header: flag === 0x00 ? decodeHeader(payload) : null
    });
    offset += length;
  }

  return blocks;
}

function decodeTapeBlock(raw, index, source = "TAP", pauseMs = null) {
  const flag = raw[0];
  const payload = raw.slice(1, -1);
  const checksum = raw[raw.length - 1];
  return {
    index,
    source,
    length: raw.length,
    pauseMs,
    flag,
    payload,
    checksum,
    checksumValid: checksumFor(raw) === 0,
    header: flag === 0x00 ? decodeHeader(payload) : null
  };
}

export function parseTzx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = "ZXTape!\x1a";
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 8)) !== signature) {
    throw new Error("Invalid TZX signature");
  }

  const blocks = [];
  let offset = 10;
  while (offset < bytes.length) {
    const id = bytes[offset++];
    if (id === 0x10) {
      if (offset + 4 > bytes.length) throw new Error("Truncated TZX standard block header");
      const pauseMs = wordAt(bytes, offset);
      const length = wordAt(bytes, offset + 2);
      offset += 4;
      if (length < 2) throw new Error(`Invalid TZX standard block length: ${length}`);
      if (offset + length > bytes.length) throw new Error("Truncated TZX standard block data");
      blocks.push(decodeTapeBlock(bytes.slice(offset, offset + length), blocks.length, "TZX", pauseMs));
      offset += length;
      continue;
    }

    if (id === 0x20) {
      offset += 2;
    } else if (id === 0x21 || id === 0x30) {
      offset += 1 + bytes[offset];
    } else if (id === 0x22) {
      continue;
    } else if (id === 0x31) {
      offset += 2 + bytes[offset + 1];
    } else if (id === 0x32) {
      offset += 2 + wordAt(bytes, offset);
    } else if (id === 0x33) {
      offset += 1 + (bytes[offset] * 3);
    } else if (id === 0x35) {
      offset += 20 + longAt(bytes, offset + 16);
    } else {
      throw new Error(`Unsupported TZX block 0x${id.toString(16).padStart(2, "0")}`);
    }

    if (offset > bytes.length) throw new Error("Truncated TZX metadata block");
  }

  return blocks;
}

export function parseTapeFile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const isTzx = bytes.length >= 8 && String.fromCharCode(...bytes.slice(0, 8)) === "ZXTape!\x1a";
  return isTzx ? parseTzx(bytes) : parseTap(bytes);
}

export function tapEntries(blocks) {
  const entries = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block.header) continue;
    const dataBlock = blocks[index + 1]?.flag === 0xff ? blocks[index + 1] : null;
    entries.push({
      index: entries.length,
      headerBlock: block,
      dataBlock,
      header: block.header,
      loadable: Boolean(dataBlock && (block.header.type === 0 || block.header.type === 3))
    });
  }
  return entries;
}

export function loadTapEntry(machine, entry) {
  if (!entry?.dataBlock) throw new Error("TAP entry has no data block");
  if (!entry.headerBlock.checksumValid || !entry.dataBlock.checksumValid) {
    throw new Error("TAP checksum failed");
  }
  if (entry.header.length !== entry.dataBlock.payload.length) {
    throw new Error(`TAP data length mismatch for ${entry.header.name || "unnamed block"}`);
  }

  if (entry.header.type === 0) {
    const variablesOffset = entry.header.param2 <= entry.dataBlock.payload.length
      ? entry.header.param2
      : entry.dataBlock.payload.length;
    const result = loadBasicProgramBytes(machine, entry.dataBlock.payload, { variablesOffset });
    return {
      ...result,
      kind: "BASIC",
      name: entry.header.name,
      autoStartLine: entry.header.param1 < 0x8000 ? entry.header.param1 : null
    };
  }

  if (entry.header.type === 3) {
    const start = entry.header.param1;
    for (let offset = 0; offset < entry.dataBlock.payload.length; offset += 1) {
      machine.write8(start + offset, entry.dataBlock.payload[offset]);
    }
    return {
      kind: "CODE",
      name: entry.header.name,
      start,
      end: start + entry.dataBlock.payload.length,
      length: entry.dataBlock.payload.length
    };
  }

  throw new Error(`Unsupported TAP block type: ${entry.header.typeName}`);
}
