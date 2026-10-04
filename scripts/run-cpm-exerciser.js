import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { FlatMemory } from "../src/memory.js";
import { Z80 } from "../src/z80.js";

const LOAD_ADDRESS = 0x0100;
const DEFAULT_SP = 0xf000;
const DEFAULT_MAX_INSTRUCTIONS = 50_000_000;

export function runCpmProgram(program, options = {}) {
  const memory = new FlatMemory();
  const output = [];
  const maxInstructions = options.maxInstructions ?? DEFAULT_MAX_INSTRUCTIONS;
  const loadAddress = options.loadAddress ?? LOAD_ADDRESS;
  const stackPointer = options.stackPointer ?? DEFAULT_SP;
  let instructions = 0;
  let terminatedReason = null;

  installCpmZeroPage(memory, stackPointer);
  memory.load(loadAddress, program);
  const cpu = new Z80(memory, options.io);
  cpu.PC = loadAddress;
  cpu.SP = stackPointer;

  while (instructions < maxInstructions) {
    if (cpu.PC === 0x0000) {
      terminatedReason = "warm boot";
      break;
    }

    if (cpu.PC === 0x0005) {
      const result = handleBdosCall(cpu, memory, output);
      if (result === "terminate") {
        terminatedReason = "BDOS terminate";
        break;
      }
      instructions += 1;
      continue;
    }

    cpu.step();
    instructions += 1;
  }

  if (terminatedReason === null) {
    const error = new Error(`CP/M program exceeded ${maxInstructions} instructions`);
    error.output = output.join("");
    error.instructions = instructions;
    error.cpu = cpu;
    throw error;
  }

  return {
    cpu,
    instructions,
    memory,
    output: output.join(""),
    terminatedReason,
    tStates: cpu.tStates
  };
}

function installCpmZeroPage(memory, stackPointer) {
  memory.write8(0x0000, 0xc3); // JP warm boot placeholder.
  memory.write16(0x0001, 0x0000);
  memory.write8(0x0005, 0xc3); // JP BDOS placeholder; calls are intercepted at PC=5.
  memory.write16(0x0006, stackPointer);
}

function handleBdosCall(cpu, memory, output) {
  switch (cpu.C) {
    case 0x00:
      return "terminate";
    case 0x02:
      output.push(String.fromCharCode(cpu.E));
      if (cpu.streamOutput) process.stdout.write(String.fromCharCode(cpu.E));
      returnFromBdos(cpu, memory);
      return "continue";
    case 0x09:
      writeDollarTerminatedString(memory, cpu.DE, output);
      returnFromBdos(cpu, memory);
      return "continue";
    default:
      throw new Error(`Unsupported CP/M BDOS function ${hex(cpu.C, 2)} at PC=${hex(cpu.PC, 4)}`);
  }
}

function returnFromBdos(cpu, memory) {
  const address = memory.read16(cpu.SP);
  cpu.SP = (cpu.SP + 2) & 0xffff;
  cpu.PC = address;
}

function writeDollarTerminatedString(memory, address, output) {
  for (let offset = 0; offset < 0x10000; offset += 1) {
    const value = memory.read8(address + offset);
    if (value === 0x24) return;
    output.push(String.fromCharCode(value));
  }

  throw new Error(`BDOS string at ${hex(address, 4)} was not dollar-terminated`);
}

function parseArgs(argv) {
  const options = {};
  let file = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg === "--expect") {
      options.expect = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--expect=")) {
      options.expect = arg.slice("--expect=".length);
    } else if (arg === "--max-instructions") {
      options.maxInstructions = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--max-instructions=")) {
      options.maxInstructions = Number(arg.slice("--max-instructions=".length));
    } else if (!file) {
      file = arg;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }

  if (!file) throw new Error("Usage: node scripts/run-cpm-exerciser.js --file path/to/zexdoc.com [--expect text]");
  return { file, options };
}

function main() {
  const { file, options } = parseArgs(process.argv.slice(2));
  const program = readFileSync(file);
  let result;
  try {
    result = runCpmProgram(program, options);
  } catch (error) {
    if (error.output) process.stdout.write(error.output);
    if (error.output && !error.output.endsWith("\n")) process.stdout.write("\n");
    throw error;
  }

  process.stdout.write(result.output);
  if (result.output.length > 0 && !result.output.endsWith("\n")) process.stdout.write("\n");
  console.log(`${basename(file)} terminated via ${result.terminatedReason} after ${result.instructions} instructions`);

  if (options.expect && !result.output.includes(options.expect)) {
    console.error(`Expected output to include: ${options.expect}`);
    process.exit(1);
  }
}

function hex(value, width) {
  return `0x${(value & (width === 2 ? 0xff : 0xffff)).toString(16).padStart(width, "0")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
