import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FlatMemory } from "../src/memory.js";
import { Z80 } from "../src/z80.js";

const TEST_DIR = "vendor/SingleStepTests-z80/v1";
const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const stopOnFail = !args.has("--no-bail");

if (!existsSync(TEST_DIR)) {
  console.error(
    "Missing SingleStep vectors. Clone https://github.com/SingleStepTests/z80 into vendor/SingleStepTests-z80 before running this suite."
  );
  process.exit(1);
}

const files = fileArg
  ? [fileArg.split("=")[1]]
  : readdirSync(TEST_DIR)
      .filter((file) => file.endsWith(".json"))
      .sort();

let executed = 0;
let failed = 0;

for (const file of files) {
  const tests = JSON.parse(readFileSync(join(TEST_DIR, file), "utf8"));

  for (const test of tests) {
    if (executed >= limit) break;
    executed += 1;

    const failure = runTest(test);
    if (failure) {
      failed += 1;
      console.error(`FAIL ${file} ${test.name}: ${failure}`);
      if (stopOnFail) {
        console.error(`Executed ${executed}, failed ${failed}`);
        process.exit(1);
      }
    }
  }

  if (executed >= limit) break;
}

console.log(`Executed ${executed}, failed ${failed}`);
if (failed > 0) process.exit(1);

function runTest(test) {
  const memory = new FlatMemory();
  const readPorts = test.ports?.filter(([, , kind]) => kind === "r") ?? [];
  const expectedWrites = test.ports?.filter(([, , kind]) => kind === "w") ?? [];
  const actualWrites = [];
  let readIndex = 0;

  for (const [address, value] of test.initial.ram) {
    memory.write8(address, value);
  }

  const cpu = new Z80(memory, {
    read: (port) => {
      const expected = readPorts[readIndex];
      readIndex += 1;
      if (!expected) return 0xff;
      return expected[1];
    },
    write: (port, value) => {
      actualWrites.push([port & 0xffff, value & 0xff, "w"]);
    }
  });

  applyInitialState(cpu, test.initial);
  const cycles = cpu.step();

  const registerFailure = compareFinalState(cpu, test.final);
  if (registerFailure) return registerFailure;

  for (const [address, value] of test.final.ram) {
    const actual = memory.read8(address);
    if (actual !== value) {
      return `ram[0x${hex(address, 4)}] expected 0x${hex(value, 2)} got 0x${hex(actual, 2)}`;
    }
  }

  if (readIndex !== readPorts.length) {
    return `port reads expected ${readPorts.length} got ${readIndex}`;
  }

  if (actualWrites.length !== expectedWrites.length) {
    return `port writes expected ${expectedWrites.length} got ${actualWrites.length}`;
  }

  for (let index = 0; index < expectedWrites.length; index += 1) {
    const expected = expectedWrites[index];
    const actual = actualWrites[index];
    if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
      return `port write ${index} expected [0x${hex(expected[0], 4)},0x${hex(expected[1], 2)}] got [0x${hex(actual[0], 4)},0x${hex(actual[1], 2)}]`;
    }
  }

  if (cycles !== test.cycles.length) {
    return `cycles expected ${test.cycles.length} got ${cycles}`;
  }

  return null;
}

function applyInitialState(cpu, state) {
  cpu.A = state.a;
  cpu.F = state.f;
  cpu.B = state.b;
  cpu.C = state.c;
  cpu.D = state.d;
  cpu.E = state.e;
  cpu.H = state.h;
  cpu.L = state.l;
  cpu.I = state.i;
  cpu.R = state.r;
  cpu.IX = state.ix;
  cpu.IY = state.iy;
  cpu.PC = state.pc;
  cpu.SP = state.sp;
  cpu.A_ = (state.af_ >> 8) & 0xff;
  cpu.F_ = state.af_ & 0xff;
  cpu.B_ = (state.bc_ >> 8) & 0xff;
  cpu.C_ = state.bc_ & 0xff;
  cpu.D_ = (state.de_ >> 8) & 0xff;
  cpu.E_ = state.de_ & 0xff;
  cpu.H_ = (state.hl_ >> 8) & 0xff;
  cpu.L_ = state.hl_ & 0xff;
  cpu.IFF1 = Boolean(state.iff1);
  cpu.IFF2 = Boolean(state.iff2);
  cpu.interruptMode = state.im;
  cpu.Q = state.q ?? 0;
  cpu.WZ = state.wz ?? 0;
}

function compareFinalState(cpu, expected) {
  const comparisons = [
    ["a", cpu.A],
    ["f", cpu.F],
    ["b", cpu.B],
    ["c", cpu.C],
    ["d", cpu.D],
    ["e", cpu.E],
    ["h", cpu.H],
    ["l", cpu.L],
    ["i", cpu.I],
    ["r", cpu.R],
    ["ix", cpu.IX],
    ["iy", cpu.IY],
    ["pc", cpu.PC],
    ["sp", cpu.SP],
    ["wz", cpu.WZ],
    ["q", cpu.Q],
    ["af_", (cpu.A_ << 8) | cpu.F_],
    ["bc_", (cpu.B_ << 8) | cpu.C_],
    ["de_", (cpu.D_ << 8) | cpu.E_],
    ["hl_", (cpu.H_ << 8) | cpu.L_],
    ["iff1", Number(cpu.IFF1)],
    ["iff2", Number(cpu.IFF2)],
    ["im", cpu.interruptMode]
  ];

  for (const [name, actual] of comparisons) {
    if (actual !== expected[name]) {
      return `${name} expected 0x${hex(expected[name], expected[name] > 0xff ? 4 : 2)} got 0x${hex(actual, actual > 0xff ? 4 : 2)}`;
    }
  }

  return null;
}

function hex(value, width) {
  return (value & (width === 2 ? 0xff : 0xffff)).toString(16).padStart(width, "0");
}
