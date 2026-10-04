import { loadBasicProgramBytes } from "./basic.js";

const HEADER_TYPES = ["Program", "Number array", "Character array", "Code"];

function wordAt(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function tripletAt(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
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

function decodeTapeBlock(raw, index, source = "TAP", pauseMs = null, timing = null) {
  const flag = raw[0];
  const payload = raw.slice(1, -1);
  const checksum = raw[raw.length - 1];
  return {
    index, source,
    type: timing ? "turbo" : source === "TZX" ? "standard" : "tap",
    length: raw.length, pauseMs, flag, payload, checksum,
    checksumValid: checksumFor(raw) === 0,
    header: flag === 0x00 ? decodeHeader(payload) : null,
    timing, generalized: null, fastLoadable: true
  };
}

function requireBytes(bytes, offset, length, message) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) throw new Error(message);
}
function alphabetSize(value) { return value === 0 ? 256 : value; }
function bitsPerSymbol(size) { return size <= 1 ? 0 : Math.ceil(Math.log2(size)); }

function parseSymbolTable(bytes, offset, count, maxPulses, end, label) {
  const symbols = [];
  let cursor = offset;
  for (let symbolIndex = 0; symbolIndex < count; symbolIndex += 1) {
    requireBytes(bytes, cursor, 1 + (maxPulses * 2), "Truncated TZX generalized " + label + " symbol table");
    const flags = bytes[cursor++];
    const pulses = [];
    for (let pulse = 0; pulse < maxPulses; pulse += 1) {
      pulses.push(wordAt(bytes, cursor));
      cursor += 2;
    }
    symbols.push({ flags: flags & 0x03, pulses });
  }
  if (cursor > end) throw new Error("Truncated TZX generalized " + label + " symbol table");
  return { symbols, offset: cursor };
}

function parseGeneralizedBlock(bytes, offset, index) {
  requireBytes(bytes, offset, 4, "Truncated TZX generalized block length");
  const blockLength = longAt(bytes, offset);
  const start = offset + 4;
  const end = start + blockLength;
  requireBytes(bytes, start, blockLength, "Truncated TZX generalized block");
  if (blockLength < 14) throw new Error("Invalid TZX generalized block length");

  const pauseMs = wordAt(bytes, start);
  const pilotStreamCount = longAt(bytes, start + 2);
  const maxPilotPulses = bytes[start + 6];
  const pilotAlphabetSize = alphabetSize(bytes[start + 7]);
  const dataSymbolCount = longAt(bytes, start + 8);
  const maxDataPulses = bytes[start + 12];
  const dataAlphabetSize = alphabetSize(bytes[start + 13]);

  let cursor = start + 14;
  let pilotSymbols = [];
  const pilotStream = [];
  if (pilotStreamCount > 0) {
    const parsed = parseSymbolTable(bytes, cursor, pilotAlphabetSize, maxPilotPulses, end, "pilot");
    pilotSymbols = parsed.symbols;
    cursor = parsed.offset;
    requireBytes(bytes, cursor, pilotStreamCount * 3, "Truncated TZX generalized pilot stream");
    for (let entry = 0; entry < pilotStreamCount; entry += 1) {
      const symbol = bytes[cursor++];
      const repetitions = wordAt(bytes, cursor);
      cursor += 2;
      if (symbol >= pilotSymbols.length) throw new Error("Invalid TZX generalized pilot symbol " + symbol);
      pilotStream.push({ symbol, repetitions });
    }
  }

  let dataSymbols = [];
  let dataStream = new Uint8Array();
  const dataWidth = bitsPerSymbol(dataAlphabetSize);
  if (dataSymbolCount > 0) {
    const parsed = parseSymbolTable(bytes, cursor, dataAlphabetSize, maxDataPulses, end, "data");
    dataSymbols = parsed.symbols;
    cursor = parsed.offset;
    const dataBytes = Math.ceil((dataSymbolCount * dataWidth) / 8);
    requireBytes(bytes, cursor, dataBytes, "Truncated TZX generalized data stream");
    dataStream = bytes.slice(cursor, cursor + dataBytes);
    cursor += dataBytes;
  }
  if (cursor !== end) throw new Error("TZX generalized block length mismatch");

  return {
    block: {
      index, source: "TZX", type: "generalized", length: blockLength + 4, pauseMs,
      flag: null, payload: new Uint8Array(), checksum: null, checksumValid: true,
      header: null, timing: null,
      generalized: { pilotSymbols, pilotStream, dataSymbols, dataStream, dataSymbolCount, dataBitsPerSymbol: dataWidth },
      fastLoadable: false
    },
    offset: end
  };
}

export function parseTzx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = "ZXTape!\x1a";
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 8)) !== signature) throw new Error("Invalid TZX signature");

  const blocks = [];
  let offset = 10;
  while (offset < bytes.length) {
    const id = bytes[offset++];

    if (id === 0x10) {
      requireBytes(bytes, offset, 4, "Truncated TZX standard block header");
      const pauseMs = wordAt(bytes, offset);
      const length = wordAt(bytes, offset + 2);
      offset += 4;
      if (length < 2) throw new Error("Invalid TZX standard block length: " + length);
      requireBytes(bytes, offset, length, "Truncated TZX standard block data");
      blocks.push(decodeTapeBlock(bytes.slice(offset, offset + length), blocks.length, "TZX", pauseMs));
      offset += length;
      continue;
    }

    if (id === 0x11) {
      requireBytes(bytes, offset, 18, "Truncated TZX turbo block header");
      const timing = {
        pilotPulse: wordAt(bytes, offset),
        sync1: wordAt(bytes, offset + 2),
        sync2: wordAt(bytes, offset + 4),
        zero: wordAt(bytes, offset + 6),
        one: wordAt(bytes, offset + 8),
        pilotCount: wordAt(bytes, offset + 10),
        usedBitsLastByte: bytes[offset + 12]
      };
      const pauseMs = wordAt(bytes, offset + 13);
      const length = tripletAt(bytes, offset + 15);
      offset += 18;
      if (length < 2) throw new Error("Invalid TZX turbo block length: " + length);
      requireBytes(bytes, offset, length, "Truncated TZX turbo block data");
      blocks.push(decodeTapeBlock(bytes.slice(offset, offset + length), blocks.length, "TZX", pauseMs, timing));
      offset += length;
      continue;
    }

    if (id === 0x19) {
      const parsed = parseGeneralizedBlock(bytes, offset, blocks.length);
      blocks.push(parsed.block);
      offset = parsed.offset;
      continue;
    }

    if (id === 0x20) {
      requireBytes(bytes, offset, 2, "Truncated TZX pause block"); offset += 2;
    } else if (id === 0x21 || id === 0x30) {
      requireBytes(bytes, offset, 1, "Truncated TZX text block");
      const length = bytes[offset];
      requireBytes(bytes, offset, 1 + length, "Truncated TZX text block"); offset += 1 + length;
    } else if (id === 0x22) {
      continue;
    } else if (id === 0x31) {
      requireBytes(bytes, offset, 2, "Truncated TZX message block");
      const length = bytes[offset + 1];
      requireBytes(bytes, offset, 2 + length, "Truncated TZX message block"); offset += 2 + length;
    } else if (id === 0x32) {
      requireBytes(bytes, offset, 2, "Truncated TZX archive block");
      const length = wordAt(bytes, offset);
      requireBytes(bytes, offset, 2 + length, "Truncated TZX archive block"); offset += 2 + length;
    } else if (id === 0x33) {
      requireBytes(bytes, offset, 1, "Truncated TZX hardware block");
      const length = 1 + (bytes[offset] * 3);
      requireBytes(bytes, offset, length, "Truncated TZX hardware block"); offset += length;
    } else if (id === 0x35) {
      requireBytes(bytes, offset, 20, "Truncated TZX custom block");
      const length = 20 + longAt(bytes, offset + 16);
      requireBytes(bytes, offset, length, "Truncated TZX custom block"); offset += length;
    } else {
      throw new Error("Unsupported TZX block 0x" + id.toString(16).padStart(2, "0"));
    }
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
