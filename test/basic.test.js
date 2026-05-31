import assert from "node:assert/strict";
import test from "node:test";
import {
  BASIC_TOKENS,
  loadBasicProgram,
  renumberBasicProgram,
  tokenizeBasicBody,
  tokenizeBasicLine,
  tokenizeBasicProgram
} from "../public/basic.js";
import { Spectrum48 } from "../src/spectrum48.js";
import { basicTextToSpectrumKeyTaps } from "../public/keyboard.js";

function runFrames(machine, count) {
  for (let frame = 0; frame < count; frame += 1) machine.runFrame();
}

function tapSpectrumKeys(machine, keys) {
  for (const key of keys) machine.pressKey(key);
  runFrames(machine, 4);
  for (const key of keys) machine.releaseKey(key);
  runFrames(machine, 4);
}

function runLoadedBasic(program, frames = 240) {
  const machine = Spectrum48.fromRomFile("ROM/48.rom");
  runFrames(machine, 180);
  loadBasicProgram(machine, program);
  for (const keys of basicTextToSpectrumKeyTaps("RUN\n")) tapSpectrumKeys(machine, keys);
  runFrames(machine, frames);
  return machine;
}

test("defines the full 48K Spectrum BASIC token range", () => {
  const uniqueTokens = new Set(BASIC_TOKENS.values());

  assert.equal(uniqueTokens.size, 91);
  assert.equal(Math.min(...uniqueTokens), 0xa5);
  assert.equal(Math.max(...uniqueTokens), 0xff);
  assert.equal(BASIC_TOKENS.get("PRINT"), 0xf5);
  assert.equal(BASIC_TOKENS.get("COPY"), 0xff);
});

test("tokenizes BASIC keywords, strings, operators, and integer constants", () => {
  assert.deepEqual(tokenizeBasicBody("PRINT \"HELLO\""), [
    0xf5, 0x20, 0x22, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x22
  ]);
  assert.deepEqual(tokenizeBasicBody("FOR N=1 TO 5"), [
    0xeb, 0x20, 0x4e, 0x3d, 0x31, 0x0e, 0x00, 0x00, 0x01, 0x00, 0x00, 0x20, 0xcc, 0x20,
    0x35, 0x0e, 0x00, 0x00, 0x05, 0x00, 0x00
  ]);
  assert.deepEqual(tokenizeBasicBody("IF N<=10 THEN GO TO 20"), [
    0xfa, 0x20, 0x4e, 0xc7, 0x31, 0x30, 0x0e, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x20, 0xcb,
    0x20, 0xec, 0x20, 0x32, 0x30, 0x0e, 0x00, 0x00, 0x14, 0x00, 0x00
  ]);
});

test("tokenizes decimal constants with Spectrum floating-point markers", () => {
  assert.deepEqual(tokenizeBasicBody("PRINT .82"), [
    0xf5, 0x20, 0x2e, 0x38, 0x32, 0x0e, 0x80, 0x51, 0xeb, 0x85, 0x1e
  ]);
  assert.deepEqual(tokenizeBasicBody("PRINT .01"), [
    0xf5, 0x20, 0x2e, 0x30, 0x31, 0x0e, 0x7a, 0x23, 0xd7, 0x0a, 0x3d
  ]);
  assert.deepEqual(tokenizeBasicBody("PRINT .045"), [
    0xf5, 0x20, 0x2e, 0x30, 0x34, 0x35, 0x0e, 0x7c, 0x38, 0x51, 0xeb, 0x85
  ]);
  assert.deepEqual(tokenizeBasicBody("PRINT 1.37"), [
    0xf5, 0x20, 0x31, 0x2e, 0x33, 0x37, 0x0e, 0x81, 0x2f, 0x5c, 0x28, 0xf5
  ]);
});

test("tokenizes numbered BASIC lines with Spectrum line headers", () => {
  assert.deepEqual(tokenizeBasicLine("10 PRINT \"HELLO\""), [
    0x00, 0x0a, 0x0a, 0x00, 0xf5, 0x20, 0x22, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x22, 0x0d
  ]);
});

test("stores DEF FN numeric parameter placeholders for the ROM evaluator", () => {
  assert.deepEqual(tokenizeBasicLine("20 DEF FN r(n)=n+1"), [
    0x00, 0x14, 0x17, 0x00, 0xce, 0x20, 0x72, 0x28, 0x6e, 0x0e, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x29, 0x3d, 0x6e, 0x2b, 0x31, 0x0e, 0x00, 0x00, 0x01, 0x00, 0x00, 0x0d
  ]);
});

test("runs DEF FN calls loaded directly into program memory", () => {
  const machine = runLoadedBasic("10 DEF FN r(n)=n+1\n20 PRINT FN r(7)");

  assert.equal(machine.read8(0x5c3a), 0xff);
});

test("rejects line numbers outside the Spectrum BASIC range", () => {
  assert.throws(() => tokenizeBasicLine("10000 PRINT \"NOPE\""), /Invalid BASIC line number/);
});

test("renumbers BASIC listings that exceed the Spectrum line range", () => {
  assert.equal(
    renumberBasicProgram("9999 CLS\n10000 PRINT \"DONE\"\n10010 GO TO 9999"),
    "10 CLS\n20 PRINT \"DONE\"\n30 GO TO 10"
  );
});

test("renumbers line references without changing expression ranges", () => {
  assert.equal(
    renumberBasicProgram("800 IF INKEY$=\"\" THEN GO TO 800\n900 FOR N=1 TO 5\n1000 GO SUB 800"),
    "10 IF INKEY$=\"\" THEN GO TO 10\n20 FOR N=1 TO 5\n30 GO SUB 10"
  );
});

test("renumbers direct THEN and RESTORE line references", () => {
  assert.equal(
    renumberBasicProgram("100 IF A=1 THEN 300\n200 RESTORE 400\n300 PRINT A\n400 DATA 1"),
    "10 IF A=1 THEN 30\n20 RESTORE 40\n30 PRINT A\n40 DATA 1"
  );
});

test("does not renumber references inside strings or comments", () => {
  assert.equal(
    renumberBasicProgram("100 PRINT \"GO TO 200\"\n200 REM GO TO 100\n300 GO TO 100"),
    "10 PRINT \"GO TO 200\"\n20 REM GO TO 100\n30 GO TO 10"
  );
});

test("tokenizes multi-line BASIC programs", () => {
  const bytes = tokenizeBasicProgram("10 CLS\n20 PRINT \"HELLO\"\n30 RUN");

  assert.equal(bytes[0], 0x00);
  assert.equal(bytes[1], 0x0a);
  assert.equal(bytes[4], 0xfb);
  assert.equal(bytes.at(-2), 0xf7);
  assert.equal(bytes.at(-1), 0x0d);
});

test("loads a tokenized BASIC program into Spectrum RAM", () => {
  const machine = Spectrum48.fromRomFile("ROM/48.rom");
  runFrames(machine, 180);

  const { start, end, length } = loadBasicProgram(machine, "10 PRINT \"HELLO\"");

  assert.equal(length, 14);
  assert.equal(machine.read16(0x5c4b), end);
  assert.equal(machine.read16(0x5c59), end + 1);
  assert.equal(machine.read16(0x5c5b), end + 1);
  assert.equal(machine.read16(0x5c61), end + 3);
  assert.equal(machine.read16(0x5c63), end + 3);
  assert.equal(machine.read16(0x5c65), end + 3);
  assert.equal(machine.read8(end), 0x80);
  assert.equal(machine.read8(end + 1), 0x0d);
  assert.equal(machine.read8(end + 2), 0x80);
  assert.deepEqual(
    Array.from({ length }, (_, offset) => machine.read8(start + offset)),
    tokenizeBasicLine("10 PRINT \"HELLO\"")
  );
});
