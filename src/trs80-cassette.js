const BASIC_SYNC = 0xa5;
const BASIC_HEADER = [0xd3, 0xd3, 0xd3];
const TXTTAB = 0x40a4;
const VARTAB = 0x40f9;
const ARYTAB = 0x40fb;
const STREND = 0x40fd;
const DATPTR = 0x40ff;
const DEFAULT_BASIC_START = 0x42e9;

export function parseCas(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const blocks = [];
  let offset = 0;

  while (offset < bytes.length) {
    const syncOffset = findByte(bytes, BASIC_SYNC, offset);
    if (syncOffset < 0) break;

    if (matchesAt(bytes, syncOffset + 1, BASIC_HEADER)) {
      const block = parseBasicCasBlock(bytes, syncOffset, blocks.length);
      blocks.push(block);
      offset = block.endOffset;
    } else {
      offset = syncOffset + 1;
    }
  }

  if (blocks.length === 0) {
    const blockHeader = detectBlockStructuredCas(bytes);
    if (blockHeader) {
      throw new Error(`Unsupported block-structured CAS file ${blockHeader.name || "(unnamed)"}: this is not TRS-80 Model III BASIC cassette data`);
    }
    throw new Error("No supported TRS-80 CAS blocks found");
  }
  return blocks;
}

export function trs80CasEntries(blocks) {
  return blocks.map((block, index) => ({
    index,
    block,
    kind: block.kind,
    name: block.name,
    lineCount: block.lineCount,
    loadable: block.kind === "BASIC" && block.checksumValid
  }));
}

export function loadTrs80CasEntry(machine, entry) {
  const block = entry?.block ?? entry;
  if (!block || block.kind !== "BASIC") throw new Error("TRS-80 CAS entry is not a BASIC program");
  if (block.checksumValid === false) throw new Error(`TRS-80 CAS BASIC ${block.name || "(unnamed)"} is corrupt`);

  const start = machine.read16(TXTTAB) || DEFAULT_BASIC_START;
  const relocated = relocateBasicRecords(block.program, start);
  for (let offset = 0; offset < relocated.length; offset += 1) {
    machine.write8(start + offset, relocated[offset]);
  }

  const end = start + relocated.length;
  machine.write16(VARTAB, end);
  machine.write16(ARYTAB, end);
  machine.write16(STREND, end);
  machine.write16(DATPTR, start);
  return {
    kind: "BASIC",
    name: block.name,
    start,
    end,
    length: relocated.length,
    lineCount: block.lineCount
  };
}

export function buildCasPulseSequence(blocks, {
  halfWaveTStates,
  initialSilenceTStates = 0
} = {}) {
  if (!halfWaveTStates || halfWaveTStates <= 0) throw new Error("CAS pulse timing requires a positive half-wave duration");
  const bytes = blocks.flatMap((block) => [...(block.raw ?? [])]);
  const durations = [];
  const toggles = [];
  const pushBit = () => {
    durations.push(halfWaveTStates);
    toggles.push(1);
  };

  if (initialSilenceTStates > 0) {
    durations.push(initialSilenceTStates);
    toggles.push(0);
  }

  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit += 1) {
      const waves = (byte & (0x80 >> bit)) === 0 ? 2 : 4;
      for (let wave = 0; wave < waves; wave += 1) pushBit();
    }
  }

  return {
    durations: Uint32Array.from(durations),
    toggles: Uint8Array.from(toggles)
  };
}

function parseBasicCasBlock(bytes, syncOffset, index) {
  const nameOffset = syncOffset + 1 + BASIC_HEADER.length;
  if (nameOffset >= bytes.length) throw new Error("Truncated TRS-80 BASIC CAS header");

  const programOffset = nameOffset + 1;
  const programEnd = findBasicProgramEnd(bytes, programOffset);
  const endOffset = programEnd + 2;
  const raw = bytes.slice(syncOffset, endOffset);
  const program = bytes.slice(programOffset, endOffset);
  return {
    index,
    kind: "BASIC",
    source: "CAS",
    name: String.fromCharCode(bytes[nameOffset] & 0x7f),
    startOffset: syncOffset,
    dataOffset: programOffset,
    endOffset,
    raw,
    program,
    length: program.length,
    lineCount: countBasicLines(program),
    checksumValid: true
  };
}

function findBasicProgramEnd(bytes, offset) {
  let cursor = offset;
  while (cursor + 1 < bytes.length) {
    const next = wordAt(bytes, cursor);
    if (next === 0x0000) return cursor;

    cursor += 4;
    while (cursor < bytes.length && bytes[cursor] !== 0x00) cursor += 1;
    if (cursor >= bytes.length) break;
    cursor += 1;
  }
  throw new Error("Truncated TRS-80 BASIC CAS program");
}

function countBasicLines(program) {
  let cursor = 0;
  let count = 0;
  while (cursor + 1 < program.length) {
    const next = wordAt(program, cursor);
    if (next === 0x0000) return count;
    count += 1;
    cursor += 4;
    while (cursor < program.length && program[cursor] !== 0x00) cursor += 1;
    cursor += 1;
  }
  return count;
}

function relocateBasicRecords(program, start) {
  const relocated = Uint8Array.from(program);
  let cursor = 0;
  while (cursor + 1 < relocated.length) {
    const next = wordAt(relocated, cursor);
    if (next === 0x0000) break;

    let lineEnd = cursor + 4;
    while (lineEnd < relocated.length && relocated[lineEnd] !== 0x00) lineEnd += 1;
    if (lineEnd >= relocated.length) throw new Error("TRS-80 BASIC line is missing its terminator");
    const nextAddress = start + lineEnd + 1;
    relocated[cursor] = nextAddress & 0xff;
    relocated[cursor + 1] = nextAddress >> 8;
    cursor = lineEnd + 1;
  }
  return relocated;
}

function findByte(bytes, value, start) {
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] === value) return index;
  }
  return -1;
}

function matchesAt(bytes, offset, pattern) {
  if (offset + pattern.length > bytes.length) return false;
  return pattern.every((byte, index) => bytes[offset + index] === byte);
}

function wordAt(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function detectBlockStructuredCas(bytes) {
  for (let offset = 0; offset + 5 < bytes.length; offset += 1) {
    if (bytes[offset] !== 0x3c) continue;
    const type = bytes[offset + 1];
    const length = bytes[offset + 2];
    const dataOffset = offset + 3;
    const checksumOffset = dataOffset + length;
    const footerOffset = checksumOffset + 1;
    if (footerOffset >= bytes.length || bytes[footerOffset] !== 0x55) continue;

    const checksum = bytes[checksumOffset];
    const sum = bytes.slice(offset + 1, checksumOffset).reduce((total, byte) => (total + byte) & 0xff, 0);
    if (checksum !== sum) continue;

    if (type === 0x00 && length >= 8) {
      return {
        type,
        name: asciiName(bytes.slice(dataOffset, dataOffset + 8))
      };
    }
    return { type, name: "" };
  }
  return null;
}

function asciiName(bytes) {
  return String.fromCharCode(...bytes)
    .replace(/\0+$/g, "")
    .trimEnd();
}
