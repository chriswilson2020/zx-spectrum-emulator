export class FlatMemory {
  constructor(size = 0x10000) {
    this.bytes = new Uint8Array(size);
  }

  read8(address) {
    return this.bytes[address & 0xffff];
  }

  write8(address, value) {
    this.bytes[address & 0xffff] = value & 0xff;
  }

  read16(address) {
    const lo = this.read8(address);
    const hi = this.read8(address + 1);
    return lo | (hi << 8);
  }

  write16(address, value) {
    this.write8(address, value);
    this.write8(address + 1, value >> 8);
  }

  load(address, values) {
    for (let offset = 0; offset < values.length; offset += 1) {
      this.write8(address + offset, values[offset]);
    }
  }
}
