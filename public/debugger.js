const REGISTERS = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
const REGISTER_PAIRS = ["BC", "DE", "HL", "SP"];
const CONDITIONS = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const ALU = ["ADD A", "ADC A", "SUB", "SBC A", "AND", "XOR", "OR", "CP"];
const RST = ["00H", "08H", "10H", "18H", "20H", "28H", "30H", "38H"];

export const SYSTEM_VARIABLES = [
  ["ERR_NR", 0x5c3a, 1],
  ["FLAGS", 0x5c3b, 1],
  ["PPC", 0x5c45, 2],
  ["SUBPPC", 0x5c47, 1],
  ["BORDCR", 0x5c48, 1],
  ["VARS", 0x5c4b, 2],
  ["PROG", 0x5c53, 2],
  ["E_LINE", 0x5c59, 2],
  ["K_CUR", 0x5c5b, 2],
  ["WORKSP", 0x5c61, 2],
  ["STKBOT", 0x5c63, 2],
  ["STKEND", 0x5c65, 2]
];

export function hexByte(value) {
  return (value & 0xff).toString(16).padStart(2, "0").toUpperCase();
}

export function hexWord(value) {
  return (value & 0xffff).toString(16).padStart(4, "0").toUpperCase();
}

function signedByte(value) {
  return value > 0x7f ? value - 0x100 : value;
}

function wordAt(read8, address) {
  return read8(address) | (read8(address + 1) << 8);
}

function relativeTarget(address, displacement) {
  return (address + 2 + signedByte(displacement)) & 0xffff;
}

export function disassembleAt(read8, address) {
  const pc = address & 0xffff;
  const op = read8(pc);
  const next = read8(pc + 1);
  const word = wordAt(read8, pc + 1);
  let size = 1;
  let text;

  if (op === 0x00) text = "NOP";
  else if (op === 0x76) text = "HALT";
  else if (op === 0xc9) text = "RET";
  else if (op === 0xfb) text = "EI";
  else if (op === 0xf3) text = "DI";
  else if (op === 0x32) {
    size = 3;
    text = `LD (${hexWord(word)}H),A`;
  } else if (op === 0x3a) {
    size = 3;
    text = `LD A,(${hexWord(word)}H)`;
  } else if (op === 0xc3) {
    size = 3;
    text = `JP ${hexWord(word)}H`;
  } else if (op === 0xcd) {
    size = 3;
    text = `CALL ${hexWord(word)}H`;
  } else if (op === 0x18) {
    size = 2;
    text = `JR ${hexWord(relativeTarget(pc, next))}H`;
  } else if (op === 0x10) {
    size = 2;
    text = `DJNZ ${hexWord(relativeTarget(pc, next))}H`;
  } else if ((op & 0xc7) === 0x06) {
    size = 2;
    text = `LD ${REGISTERS[(op >> 3) & 0x07]},${hexByte(next)}H`;
  } else if ((op & 0xcf) === 0x01) {
    size = 3;
    text = `LD ${REGISTER_PAIRS[(op >> 4) & 0x03]},${hexWord(word)}H`;
  } else if ((op & 0xc7) === 0x04) {
    text = `INC ${REGISTERS[(op >> 3) & 0x07]}`;
  } else if ((op & 0xc7) === 0x05) {
    text = `DEC ${REGISTERS[(op >> 3) & 0x07]}`;
  } else if ((op & 0xc0) === 0x40) {
    text = `LD ${REGISTERS[(op >> 3) & 0x07]},${REGISTERS[op & 0x07]}`;
  } else if ((op & 0xc0) === 0x80) {
    text = `${ALU[(op >> 3) & 0x07]} ${REGISTERS[op & 0x07]}`;
  } else if ((op & 0xc7) === 0xc0) {
    text = `RET ${CONDITIONS[(op >> 3) & 0x07]}`;
  } else if ((op & 0xc7) === 0xc2) {
    size = 3;
    text = `JP ${CONDITIONS[(op >> 3) & 0x07]},${hexWord(word)}H`;
  } else if ((op & 0xc7) === 0xc4) {
    size = 3;
    text = `CALL ${CONDITIONS[(op >> 3) & 0x07]},${hexWord(word)}H`;
  } else if ((op & 0xc7) === 0xc7) {
    text = `RST ${RST[(op >> 3) & 0x07]}`;
  } else if (op === 0xdb) {
    size = 2;
    text = `IN A,(${hexByte(next)}H)`;
  } else if (op === 0xd3) {
    size = 2;
    text = `OUT (${hexByte(next)}H),A`;
  } else if ([0xcb, 0xdd, 0xed, 0xfd].includes(op)) {
    size = 2;
    text = `${hexByte(op)} ${hexByte(next)}`;
  } else {
    text = `DB ${hexByte(op)}H`;
  }

  const bytes = Array.from({ length: size }, (_, offset) => read8(pc + offset));
  return { address: pc, bytes, text, size };
}

export function disassembleWindow(read8, pc, { beforeBytes = 8, count = 10 } = {}) {
  const start = (pc - beforeBytes) & 0xffff;
  const rows = [];
  let address = start;
  for (let row = 0; row < count; row += 1) {
    const instruction = disassembleAt(read8, address);
    rows.push({ ...instruction, isPc: instruction.address === (pc & 0xffff) });
    address = (address + instruction.size) & 0xffff;
  }

  if (!rows.some((row) => row.isPc)) {
    return [disassembleAt(read8, pc), ...rows.slice(1)].map((row, index) => ({
      ...row,
      isPc: index === 0
    }));
  }

  return rows;
}

export function readMemoryRows(read8, start, { rows = 4, bytesPerRow = 8 } = {}) {
  return Array.from({ length: rows }, (_, row) => {
    const address = (start + row * bytesPerRow) & 0xffff;
    const bytes = Array.from({ length: bytesPerRow }, (_, offset) => read8(address + offset));
    return { address, bytes };
  });
}

export function readSystemVariables(machine) {
  return SYSTEM_VARIABLES.map(([name, address, size]) => ({
    name,
    address,
    size,
    value: size === 1 ? machine.read8(address) : machine.read16(address)
  }));
}

export function readBasicStatus(machine) {
  const err = machine.read8(0x5c3a);
  return {
    err,
    errText: err === 0xff ? "OK" : `${String.fromCharCode(65 + err)} error`,
    currentLine: machine.read16(0x5c45),
    subStatement: machine.read8(0x5c47),
    pointers: {
      PROG: machine.read16(0x5c53),
      VARS: machine.read16(0x5c4b),
      E_LINE: machine.read16(0x5c59),
      K_CUR: machine.read16(0x5c5b),
      WORKSP: machine.read16(0x5c61),
      STKBOT: machine.read16(0x5c63),
      STKEND: machine.read16(0x5c65)
    }
  };
}
