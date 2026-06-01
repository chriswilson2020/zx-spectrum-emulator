const V1_HEADER_LENGTH = 30;
const RAM_LENGTH = 0xc000;
const PAGE_LENGTH = 0x4000;
const V1_END_MARKER = [0x00, 0xed, 0xed, 0x00];
const PAGE_TO_RAM_OFFSET = new Map([
  [8, 0x0000],
  [4, 0x4000],
  [5, 0x8000]
]);

function bytesFrom(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readWord(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function writeWord(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function parseHeader(bytes, pc) {
  return {
    A: bytes[0],
    F: bytes[1],
    B: bytes[3],
    C: bytes[2],
    D: bytes[14],
    E: bytes[13],
    H: bytes[5],
    L: bytes[4],
    PC: pc,
    SP: readWord(bytes, 8),
    I: bytes[10],
    R: ((bytes[12] & 0x01) << 7) | (bytes[11] & 0x7f),
    B_: bytes[16],
    C_: bytes[15],
    D_: bytes[18],
    E_: bytes[17],
    H_: bytes[20],
    L_: bytes[19],
    A_: bytes[21],
    F_: bytes[22],
    IY: readWord(bytes, 23),
    IX: readWord(bytes, 25),
    IFF1: bytes[27] !== 0,
    IFF2: bytes[28] !== 0,
    interruptMode: bytes[29] & 0x03
  };
}

function isV1EndMarker(bytes, offset) {
  return V1_END_MARKER.every((byte, index) => bytes[offset + index] === byte);
}

function decodeCompressed(bytes, offset, expectedLength, { stopAtV1Marker = false } = {}) {
  const output = new Uint8Array(expectedLength);
  let source = offset;
  let target = 0;

  while (target < expectedLength && source < bytes.length) {
    if (stopAtV1Marker && source + 3 < bytes.length && isV1EndMarker(bytes, source)) break;
    if (source + 3 < bytes.length && bytes[source] === 0xed && bytes[source + 1] === 0xed) {
      const count = bytes[source + 2];
      const value = bytes[source + 3];
      if (target + count > expectedLength) throw new Error("Z80 snapshot compressed data overruns RAM");
      output.fill(value, target, target + count);
      target += count;
      source += 4;
      continue;
    }
    output[target] = bytes[source];
    target += 1;
    source += 1;
  }

  if (target < expectedLength && !stopAtV1Marker) {
    throw new Error("Z80 snapshot ended before the RAM page was complete");
  }
  return output;
}

function parseV1(bytes, pc) {
  const compressed = (bytes[12] & 0x20) !== 0;
  if (!compressed) {
    if (bytes.length < V1_HEADER_LENGTH + RAM_LENGTH) throw new Error("Z80 v1 snapshot is missing 48K RAM");
    return bytes.slice(V1_HEADER_LENGTH, V1_HEADER_LENGTH + RAM_LENGTH);
  }
  return decodeCompressed(bytes, V1_HEADER_LENGTH, RAM_LENGTH, { stopAtV1Marker: true });
}

function parseExtendedRam(bytes, blockOffset) {
  const ram = new Uint8Array(RAM_LENGTH);
  const loadedPages = new Set();
  let offset = blockOffset;

  while (offset + 3 <= bytes.length) {
    const length = readWord(bytes, offset);
    const page = bytes[offset + 2];
    offset += 3;
    const ramOffset = PAGE_TO_RAM_OFFSET.get(page);

    if (length === 0xffff) {
      if (offset + PAGE_LENGTH > bytes.length) throw new Error("Z80 snapshot page is truncated");
      if (ramOffset !== undefined) {
        ram.set(bytes.slice(offset, offset + PAGE_LENGTH), ramOffset);
        loadedPages.add(page);
      }
      offset += PAGE_LENGTH;
      continue;
    }

    if (offset + length > bytes.length) throw new Error("Z80 snapshot compressed page is truncated");
    if (ramOffset !== undefined) {
      ram.set(decodeCompressed(bytes.slice(offset, offset + length), 0, PAGE_LENGTH), ramOffset);
      loadedPages.add(page);
    }
    offset += length;
  }

  for (const page of PAGE_TO_RAM_OFFSET.keys()) {
    if (!loadedPages.has(page)) throw new Error(`Z80 snapshot is missing 48K RAM page ${page}`);
  }
  return ram;
}

export function parseZ80Snapshot(input) {
  const bytes = bytesFrom(input);
  if (bytes.length < V1_HEADER_LENGTH) throw new Error("Z80 snapshot is too short");

  const headerPc = readWord(bytes, 6);
  const isV1 = headerPc !== 0;
  const pc = isV1 ? headerPc : readWord(bytes, 32);
  const registers = parseHeader(bytes, pc);
  const borderColor = (bytes[12] >> 1) & 0x07;
  const ram = isV1
    ? parseV1(bytes, headerPc)
    : parseExtendedRam(bytes, 32 + readWord(bytes, 30));

  return {
    format: isV1 ? "Z80 v1" : "Z80 extended",
    registers,
    borderColor,
    ram
  };
}

export function applyZ80Snapshot(machine, snapshotOrBytes) {
  const snapshot = snapshotOrBytes?.ram ? snapshotOrBytes : parseZ80Snapshot(snapshotOrBytes);
  const cpu = machine.cpu;
  Object.assign(cpu, snapshot.registers);
  cpu.interruptMode = Math.min(2, snapshot.registers.interruptMode);
  cpu.interruptDelay = 0;
  cpu.pendingInterrupt = false;
  cpu.pendingNmi = false;
  cpu.interruptData = 0xff;
  cpu.Q = 0;
  cpu.WZ = cpu.PC;
  cpu.halted = false;
  cpu.tStates = 0;

  machine.ram.set(snapshot.ram);
  machine.borderColor = snapshot.borderColor & 0x07;
  machine.beeperOn = false;
  machine.beeperEvents = [];
  machine.frame = 0;
  machine.keyboardRows.fill(0x1f);
  machine.clearTape();
  return snapshot;
}

export function createZ80Snapshot(machine) {
  const bytes = new Uint8Array(V1_HEADER_LENGTH + RAM_LENGTH);
  const cpu = machine.cpu;
  bytes[0] = cpu.A & 0xff;
  bytes[1] = cpu.F & 0xff;
  bytes[2] = cpu.C & 0xff;
  bytes[3] = cpu.B & 0xff;
  bytes[4] = cpu.L & 0xff;
  bytes[5] = cpu.H & 0xff;
  writeWord(bytes, 6, cpu.PC);
  writeWord(bytes, 8, cpu.SP);
  bytes[10] = cpu.I & 0xff;
  bytes[11] = cpu.R & 0x7f;
  bytes[12] = ((cpu.R & 0x80) >> 7) | ((machine.borderColor & 0x07) << 1);
  bytes[13] = cpu.E & 0xff;
  bytes[14] = cpu.D & 0xff;
  bytes[15] = cpu.C_ & 0xff;
  bytes[16] = cpu.B_ & 0xff;
  bytes[17] = cpu.E_ & 0xff;
  bytes[18] = cpu.D_ & 0xff;
  bytes[19] = cpu.L_ & 0xff;
  bytes[20] = cpu.H_ & 0xff;
  bytes[21] = cpu.A_ & 0xff;
  bytes[22] = cpu.F_ & 0xff;
  writeWord(bytes, 23, cpu.IY);
  writeWord(bytes, 25, cpu.IX);
  bytes[27] = cpu.IFF1 ? 1 : 0;
  bytes[28] = cpu.IFF2 ? 1 : 0;
  bytes[29] = cpu.interruptMode & 0x03;
  bytes.set(machine.ram, V1_HEADER_LENGTH);
  return bytes;
}
