import { FlatMemory } from "../src/memory.js";
import { Z80 } from "../src/z80.js";

const GROUPS = [
  {
    name: "base",
    makeProgram: (opcode) => [opcode, 0x00, 0x00, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "CB",
    makeProgram: (opcode) => [0xcb, opcode, 0x00, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "ED",
    makeProgram: (opcode) => [0xed, opcode, 0x00, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "DD",
    makeProgram: (opcode) => [0xdd, opcode, 0x00, 0x00, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "FD",
    makeProgram: (opcode) => [0xfd, opcode, 0x00, 0x00, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "DDCB",
    makeProgram: (opcode) => [0xdd, 0xcb, 0x00, opcode, 0x00],
    opcodes: range(0x00, 0xff)
  },
  {
    name: "FDCB",
    makeProgram: (opcode) => [0xfd, 0xcb, 0x00, opcode, 0x00],
    opcodes: range(0x00, 0xff)
  }
];

const results = GROUPS.map((group) => {
  const missing = [];

  for (const opcode of group.opcodes) {
    if (!executes(group.makeProgram(opcode))) missing.push(opcode);
  }

  return {
    name: group.name,
    implemented: group.opcodes.length - missing.length,
    total: group.opcodes.length,
    missing
  };
});

for (const result of results) {
  const percent = ((result.implemented / result.total) * 100).toFixed(1);
  console.log(`${result.name}: ${result.implemented}/${result.total} (${percent}%)`);

  if (result.missing.length > 0) {
    console.log(`  missing: ${formatOpcodes(result.missing)}`);
  }
}

function executes(program) {
  const memory = new FlatMemory();
  memory.load(0, program);
  const cpu = new Z80(memory);
  cpu.SP = 0x8000;

  try {
    cpu.step();
    return true;
  } catch (error) {
    if (error.message.includes("Unimplemented")) return false;
    throw error;
  }
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatOpcodes(opcodes) {
  return opcodes.map((opcode) => `0x${opcode.toString(16).padStart(2, "0")}`).join(" ");
}
