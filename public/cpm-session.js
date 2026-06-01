const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

let crcTable;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
}

function crc32(bytes) {
  crcTable ??= makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

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

function read16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function read32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

async function deflateRaw(bytes) {
  if (!("CompressionStream" in globalThis)) return undefined;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in globalThis)) throw new Error("This browser cannot read compressed CP/M session files");
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new Error(`This browser cannot read compressed CP/M session files: ${error.message}`);
  }
}

function bytesFor(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return textEncoder.encode(value);
  return textEncoder.encode(JSON.stringify(value, null, 2));
}

export async function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const sourceBytes = bytesFor(entry.bytes);
    const crc = crc32(sourceBytes);
    const deflated = await deflateRaw(sourceBytes);
    const useDeflate = deflated && deflated.length < sourceBytes.length;
    const payload = useDeflate ? deflated : sourceBytes;
    const method = useDeflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length);
    write32(local, 0, ZIP_LOCAL_FILE_HEADER);
    write16(local, 4, 20);
    write16(local, 6, 0x0800);
    write16(local, 8, method);
    write16(local, 10, dosTime);
    write16(local, 12, dosDate);
    write32(local, 14, crc);
    write32(local, 18, payload.length);
    write32(local, 22, sourceBytes.length);
    write16(local, 26, nameBytes.length);
    write16(local, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, payload);

    const central = new Uint8Array(46 + nameBytes.length);
    write32(central, 0, ZIP_CENTRAL_DIRECTORY_HEADER);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write16(central, 8, 0x0800);
    write16(central, 10, method);
    write16(central, 12, dosTime);
    write16(central, 14, dosDate);
    write32(central, 16, crc);
    write32(central, 20, payload.length);
    write32(central, 24, sourceBytes.length);
    write16(central, 28, nameBytes.length);
    write16(central, 30, 0);
    write16(central, 32, 0);
    write16(central, 34, 0);
    write16(central, 36, 0);
    write32(central, 38, 0);
    write32(central, 42, localOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    localOffset += local.length + payload.length;
  }

  const centralDirectory = concat(centralParts);
  const end = new Uint8Array(22);
  write32(end, 0, ZIP_END_OF_CENTRAL_DIRECTORY);
  write16(end, 8, entries.length);
  write16(end, 10, entries.length);
  write32(end, 12, centralDirectory.length);
  write32(end, 16, localOffset);
  write16(end, 20, 0);
  return concat([...localParts, centralDirectory, end]);
}

export async function readZip(bytes) {
  const zip = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let eocdOffset = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 0xffff - 22); offset -= 1) {
    if (read32(zip, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP session: end of central directory not found");

  const entryCount = read16(zip, eocdOffset + 10);
  let centralOffset = read32(zip, eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (read32(zip, centralOffset) !== ZIP_CENTRAL_DIRECTORY_HEADER) throw new Error("Invalid ZIP session: central directory is corrupt");
    const method = read16(zip, centralOffset + 10);
    const compressedSize = read32(zip, centralOffset + 20);
    const uncompressedSize = read32(zip, centralOffset + 24);
    const nameLength = read16(zip, centralOffset + 28);
    const extraLength = read16(zip, centralOffset + 30);
    const commentLength = read16(zip, centralOffset + 32);
    const localOffset = read32(zip, centralOffset + 42);
    const name = textDecoder.decode(zip.slice(centralOffset + 46, centralOffset + 46 + nameLength));

    if (read32(zip, localOffset) !== ZIP_LOCAL_FILE_HEADER) throw new Error(`Invalid ZIP session: missing local header for ${name}`);
    const localNameLength = read16(zip, localOffset + 26);
    const localExtraLength = read16(zip, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.slice(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? await inflateRaw(compressed) : method === 0 ? compressed : undefined;
    if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    if (data.length !== uncompressedSize) throw new Error(`Invalid ZIP session: ${name} has the wrong size`);
    entries.set(name, data);

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export function jsonBytes(value) {
  return textEncoder.encode(JSON.stringify(value, null, 2));
}

export function parseJsonBytes(bytes) {
  return JSON.parse(textDecoder.decode(bytes));
}
