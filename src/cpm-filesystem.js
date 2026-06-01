const SECTOR_SIZE = 128;
const BLOCK_SIZE = 1024;
const DIRECTORY_ENTRIES = 64;
const DIRECTORY_ENTRY_SIZE = 32;
const RESERVED_TRACKS = 2;
const SECTORS_PER_TRACK = 26;
const TOTAL_BLOCKS = 243;
const DIRECTORY_BLOCKS = new Set([0, 1]);
const RECORDS_PER_EXTENT = 128;
const BLOCKS_PER_EXTENT = 16;
const SKEW_TABLE = [1, 7, 13, 19, 25, 5, 11, 17, 23, 3, 9, 15, 21, 2, 8, 14, 20, 26, 6, 12, 18, 24, 4, 10, 16, 22];

export class CpmFileSystem {
  constructor(disk) {
    this.disk = disk;
    this.bytes = disk.bytes;
  }

  listFiles({ user = 0 } = {}) {
    const files = new Map();
    for (const entry of this.readDirectoryEntries()) {
      if (entry.deleted || entry.user !== user) continue;
      const key = entry.name;
      const existing = files.get(key) ?? {
        name: key,
        user: entry.user,
        records: 0,
        size: 0,
        extents: 0,
        readonly: false,
        system: false
      };
      existing.records += entry.records;
      existing.size += entry.records * SECTOR_SIZE;
      existing.extents += 1;
      existing.readonly ||= entry.readonly;
      existing.system ||= entry.system;
      files.set(key, existing);
    }

    return [...files.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  readFile(name, { user = 0, trimCtrlZ = false } = {}) {
    const normalized = normalizeCpmName(name);
    const entries = this.readDirectoryEntries()
      .filter((entry) => !entry.deleted && entry.user === user && entry.name === normalized)
      .sort((a, b) => a.extentIndex - b.extentIndex);
    if (entries.length === 0) throw new Error(`CP/M file not found: ${normalized}`);

    const chunks = [];
    for (const entry of entries) {
      let remaining = entry.records * SECTOR_SIZE;
      for (const block of entry.blocks) {
        if (remaining <= 0) break;
        const bytes = this.readBlock(block);
        const length = Math.min(remaining, BLOCK_SIZE);
        chunks.push(bytes.slice(0, length));
        remaining -= length;
      }
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    if (!trimCtrlZ) return output;
    let end = output.length;
    while (end > 0 && output[end - 1] === 0x1a) end -= 1;
    return output.slice(0, end);
  }

  writeFile(name, values, { user = 0, overwrite = true } = {}) {
    const normalized = normalizeCpmName(name);
    const bytes = Uint8Array.from(values);
    if (this.hasFile(normalized, { user })) {
      if (!overwrite) throw new Error(`CP/M file already exists: ${normalized}`);
      this.deleteFile(normalized, { user });
    }

    const records = Math.max(1, Math.ceil(bytes.length / SECTOR_SIZE));
    const requiredBlocks = Math.ceil((records * SECTOR_SIZE) / BLOCK_SIZE);
    const requiredExtents = Math.ceil(records / RECORDS_PER_EXTENT);
    const directorySlots = this.findFreeDirectorySlots(requiredExtents);
    const blocks = this.findFreeBlocks(requiredBlocks);

    for (let extent = 0; extent < requiredExtents; extent += 1) {
      const entryOffset = directorySlots[extent];
      const extentRecords = Math.min(RECORDS_PER_EXTENT, records - (extent * RECORDS_PER_EXTENT));
      const extentBlocks = blocks.slice(extent * BLOCKS_PER_EXTENT, (extent + 1) * BLOCKS_PER_EXTENT);
      this.writeDirectoryEntry(entryOffset, {
        user,
        name: normalized,
        extent,
        records: extentRecords,
        blocks: extentBlocks
      });
    }

    const paddedLength = records * SECTOR_SIZE;
    const padded = new Uint8Array(paddedLength).fill(0x1a);
    padded.set(bytes);

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      const offset = blockIndex * BLOCK_SIZE;
      this.writeBlock(block, padded.slice(offset, offset + BLOCK_SIZE));
    }

    this.disk.dirty = true;
  }

  deleteFile(name, { user = 0 } = {}) {
    const normalized = normalizeCpmName(name);
    let deleted = false;
    for (let index = 0; index < DIRECTORY_ENTRIES; index += 1) {
      const offset = index * DIRECTORY_ENTRY_SIZE;
      const entry = this.parseDirectoryEntry(index);
      if (!entry.deleted && entry.user === user && entry.name === normalized) {
        this.writeLogicalByte(offset, 0xe5);
        deleted = true;
      }
    }
    if (deleted) this.disk.dirty = true;
    return deleted;
  }

  hasFile(name, { user = 0 } = {}) {
    const normalized = normalizeCpmName(name);
    return this.readDirectoryEntries().some((entry) => !entry.deleted && entry.user === user && entry.name === normalized);
  }

  readDirectoryEntries() {
    const entries = [];
    for (let index = 0; index < DIRECTORY_ENTRIES; index += 1) {
      entries.push(this.parseDirectoryEntry(index));
    }
    return entries;
  }

  repairFullExtentRecordCounts() {
    let repaired = false;
    for (const entry of this.readDirectoryEntries()) {
      if (entry.deleted) continue;
      if (entry.rawRecords === 0 && entry.blocks.length === BLOCKS_PER_EXTENT) {
        this.writeLogicalByte(entry.offset + 15, RECORDS_PER_EXTENT);
        repaired = true;
      }
    }
    if (repaired) this.disk.dirty = true;
    return repaired;
  }

  parseDirectoryEntry(index) {
    const offset = index * DIRECTORY_ENTRY_SIZE;
    const user = this.readLogicalByte(offset);
    const rawName = this.readLogicalBytes(offset + 1, 11);
    const base = bytesToCpmPart(rawName.slice(0, 8));
    const extension = bytesToCpmPart(rawName.slice(8, 11));
    const extent = this.readLogicalByte(offset + 12);
    const s2 = this.readLogicalByte(offset + 14);
    const recordByte = this.readLogicalByte(offset + 15);
    const blocks = [...this.readLogicalBytes(offset + 16, 16)].filter((block) => block !== 0);
    const records = recordByte === 0 && blocks.length === BLOCKS_PER_EXTENT ? RECORDS_PER_EXTENT : recordByte;
    return {
      index,
      offset,
      deleted: user === 0xe5,
      user,
      name: extension ? `${base}.${extension}` : base,
      extent,
      extentIndex: extent + (s2 * 32),
      rawRecords: recordByte,
      records,
      blocks,
      readonly: (this.readLogicalByte(offset + 9) & 0x80) !== 0,
      system: (this.readLogicalByte(offset + 10) & 0x80) !== 0
    };
  }

  writeDirectoryEntry(offset, entry) {
    this.writeLogicalBytes(offset, new Uint8Array(DIRECTORY_ENTRY_SIZE));
    const { base, extension } = splitCpmName(entry.name);
    this.writeLogicalByte(offset, entry.user & 0x1f);
    writePaddedAscii(this, offset + 1, base, 8);
    writePaddedAscii(this, offset + 9, extension, 3);
    this.writeLogicalByte(offset + 12, entry.extent & 0x1f);
    this.writeLogicalByte(offset + 13, 0);
    this.writeLogicalByte(offset + 14, Math.floor(entry.extent / 32) & 0xff);
    this.writeLogicalByte(offset + 15, entry.records);
    this.writeLogicalBytes(offset + 16, Uint8Array.from(entry.blocks));
  }

  findFreeDirectorySlots(count) {
    const slots = [];
    for (let index = 0; index < DIRECTORY_ENTRIES; index += 1) {
      const offset = index * DIRECTORY_ENTRY_SIZE;
      if (this.readLogicalByte(offset) === 0xe5) slots.push(offset);
      if (slots.length === count) return slots;
    }
    throw new Error("CP/M directory is full");
  }

  findFreeBlocks(count) {
    const used = this.usedBlocks();
    const blocks = [];
    for (let block = 0; block < TOTAL_BLOCKS; block += 1) {
      if (used.has(block)) continue;
      blocks.push(block);
      if (blocks.length === count) return blocks;
    }
    throw new Error("CP/M disk is full");
  }

  usedBlocks() {
    const used = new Set(DIRECTORY_BLOCKS);
    for (const entry of this.readDirectoryEntries()) {
      if (entry.deleted) continue;
      for (const block of entry.blocks) used.add(block);
    }
    return used;
  }

  readBlock(block) {
    this.assertBlock(block);
    return this.readLogicalBytes(block * BLOCK_SIZE, BLOCK_SIZE);
  }

  writeBlock(block, values) {
    this.assertBlock(block);
    const bytes = Uint8Array.from(values);
    if (bytes.length > BLOCK_SIZE) throw new Error("CP/M block write is too large");
    const padded = new Uint8Array(BLOCK_SIZE).fill(0x1a);
    padded.set(bytes);
    this.writeLogicalBytes(block * BLOCK_SIZE, padded);
  }

  assertBlock(block) {
    if (!Number.isInteger(block) || block < 0 || block >= TOTAL_BLOCKS) {
      throw new Error(`Invalid CP/M block ${block}`);
    }
  }

  readLogicalByte(offset) {
    return this.bytes[this.logicalOffsetToPhysicalOffset(offset)];
  }

  writeLogicalByte(offset, value) {
    this.bytes[this.logicalOffsetToPhysicalOffset(offset)] = value & 0xff;
  }

  readLogicalBytes(offset, length) {
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) output[index] = this.readLogicalByte(offset + index);
    return output;
  }

  writeLogicalBytes(offset, values) {
    for (let index = 0; index < values.length; index += 1) this.writeLogicalByte(offset + index, values[index]);
  }

  logicalOffsetToPhysicalOffset(offset) {
    const logicalRecord = Math.floor(offset / SECTOR_SIZE);
    const byteInRecord = offset % SECTOR_SIZE;
    const logicalTrack = Math.floor(logicalRecord / SECTORS_PER_TRACK) + RESERVED_TRACKS;
    const logicalSectorIndex = logicalRecord % SECTORS_PER_TRACK;
    const physicalSector = SKEW_TABLE[logicalSectorIndex];
    return ((logicalTrack * SECTORS_PER_TRACK) + (physicalSector - 1)) * SECTOR_SIZE + byteInRecord;
  }
}

export function normalizeCpmName(name) {
  const { base, extension } = splitCpmName(name);
  return extension ? `${base}.${extension}` : base;
}

function splitCpmName(name) {
  const normalized = String(name).trim().toUpperCase();
  const parts = normalized.split(".");
  if (parts.length > 2 || parts[0].length === 0 || parts[0].length > 8 || (parts[1] ?? "").length > 3) {
    throw new Error(`Invalid CP/M filename: ${name}`);
  }
  const valid = /^[A-Z0-9_$~!#%&'()@^`{}-]+$/;
  if (!valid.test(parts[0]) || (parts[1] && !valid.test(parts[1]))) {
    throw new Error(`Invalid CP/M filename: ${name}`);
  }
  return { base: parts[0], extension: parts[1] ?? "" };
}

function bytesToCpmPart(bytes) {
  return String.fromCharCode(...bytes.map((byte) => byte & 0x7f)).trimEnd();
}

function writePaddedAscii(target, offset, text, length) {
  for (let index = 0; index < length; index += 1) {
    target.writeLogicalByte(offset + index, index < text.length ? text.charCodeAt(index) : 0x20);
  }
}
