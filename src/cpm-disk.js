export const Z80SIM_FLOPPY_GEOMETRY = Object.freeze({
  tracks: 77,
  sectorsPerTrack: 26,
  sectorSize: 128
});

export class RawCpmDisk {
  constructor(image, geometry = Z80SIM_FLOPPY_GEOMETRY) {
    this.geometry = { ...geometry };
    this.size = this.geometry.tracks * this.geometry.sectorsPerTrack * this.geometry.sectorSize;
    if (!image || image.length !== this.size) {
      throw new Error(`RawCpmDisk requires a ${this.size} byte image`);
    }

    this.bytes = Uint8Array.from(image);
    this.dirty = false;
  }

  static z80simFloppy(image) {
    return new RawCpmDisk(image, Z80SIM_FLOPPY_GEOMETRY);
  }

  static blankZ80simFloppy({ fill = 0xe5 } = {}) {
    const size =
      Z80SIM_FLOPPY_GEOMETRY.tracks *
      Z80SIM_FLOPPY_GEOMETRY.sectorsPerTrack *
      Z80SIM_FLOPPY_GEOMETRY.sectorSize;
    return new RawCpmDisk(new Uint8Array(size).fill(fill), Z80SIM_FLOPPY_GEOMETRY);
  }

  sectorOffset(track, sector) {
    this.assertSectorAddress(track, sector);
    return ((track * this.geometry.sectorsPerTrack) + (sector - 1)) * this.geometry.sectorSize;
  }

  readSector(track, sector) {
    const offset = this.sectorOffset(track, sector);
    return this.bytes.slice(offset, offset + this.geometry.sectorSize);
  }

  writeSector(track, sector, values) {
    if (!values || values.length !== this.geometry.sectorSize) {
      throw new Error(`CP/M sector writes require ${this.geometry.sectorSize} bytes`);
    }

    const offset = this.sectorOffset(track, sector);
    this.bytes.set(values, offset);
    this.dirty = true;
  }

  toBytes() {
    return Uint8Array.from(this.bytes);
  }

  assertSectorAddress(track, sector) {
    if (!Number.isInteger(track) || track < 0 || track >= this.geometry.tracks) {
      throw new Error(`Invalid CP/M track ${track}`);
    }
    if (!Number.isInteger(sector) || sector < 1 || sector > this.geometry.sectorsPerTrack) {
      throw new Error(`Invalid CP/M sector ${sector}`);
    }
  }
}
