import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RawCpmDisk, Z80SIM_FLOPPY_GEOMETRY } from "../src/cpm-disk.js";

const DISK_PATH = "ROM/cpm22-1.dsk";
const DISK_SIZE =
  Z80SIM_FLOPPY_GEOMETRY.tracks *
  Z80SIM_FLOPPY_GEOMETRY.sectorsPerTrack *
  Z80SIM_FLOPPY_GEOMETRY.sectorSize;

function loadDiskImage() {
  return readFileSync(DISK_PATH);
}

test("z80pack CP/M disk image has the expected raw floppy size", () => {
  assert.equal(loadDiskImage().length, DISK_SIZE);
});

test("reads boot sector from track 0 sector 1", () => {
  const disk = RawCpmDisk.z80simFloppy(loadDiskImage());
  const sector = disk.readSector(0, 1);

  assert.deepEqual(Array.from(sector.slice(0, 3)), [0xc3, 0x19, 0x00]);
});

test("maps track and sector addresses to byte offsets", () => {
  const disk = RawCpmDisk.z80simFloppy(loadDiskImage());

  assert.equal(disk.sectorOffset(0, 1), 0);
  assert.equal(disk.sectorOffset(0, 2), 128);
  assert.equal(disk.sectorOffset(1, 1), 26 * 128);
  assert.equal(disk.sectorOffset(76, 26), DISK_SIZE - 128);
});

test("rejects invalid raw disk sizes and sector addresses", () => {
  assert.throws(() => RawCpmDisk.z80simFloppy(new Uint8Array(DISK_SIZE - 1)), /requires/);

  const disk = RawCpmDisk.z80simFloppy(loadDiskImage());
  assert.throws(() => disk.readSector(-1, 1), /track/);
  assert.throws(() => disk.readSector(77, 1), /track/);
  assert.throws(() => disk.readSector(0, 0), /sector/);
  assert.throws(() => disk.readSector(0, 27), /sector/);
});

test("writes sectors to the mounted image and marks it dirty", () => {
  const disk = RawCpmDisk.z80simFloppy(loadDiskImage());
  const values = new Uint8Array(128).fill(0xa5);

  disk.writeSector(3, 4, values);

  assert.equal(disk.dirty, true);
  assert.deepEqual(disk.readSector(3, 4), values);
  assert.deepEqual(disk.toBytes().slice(disk.sectorOffset(3, 4), disk.sectorOffset(3, 4) + 128), values);
});

test("rejects short and long sector writes", () => {
  const disk = RawCpmDisk.z80simFloppy(loadDiskImage());

  assert.throws(() => disk.writeSector(0, 1, new Uint8Array(127)), /128 bytes/);
  assert.throws(() => disk.writeSector(0, 1, new Uint8Array(129)), /128 bytes/);
});

test("creates blank z80sim floppy images initialized as CP/M empty space", () => {
  const disk = RawCpmDisk.blankZ80simFloppy();

  assert.equal(disk.bytes.length, DISK_SIZE);
  assert.equal(disk.dirty, false);
  assert.deepEqual(Array.from(disk.readSector(2, 1).slice(0, 4)), [0xe5, 0xe5, 0xe5, 0xe5]);
});
