export const BASIC_TOKENS = new Map([
  ["RND", 0xa5],
  ["INKEY$", 0xa6],
  ["PI", 0xa7],
  ["FN", 0xa8],
  ["POINT", 0xa9],
  ["SCREEN$", 0xaa],
  ["ATTR", 0xab],
  ["AT", 0xac],
  ["TAB", 0xad],
  ["VAL$", 0xae],
  ["CODE", 0xaf],
  ["VAL", 0xb0],
  ["LEN", 0xb1],
  ["SIN", 0xb2],
  ["COS", 0xb3],
  ["TAN", 0xb4],
  ["ASN", 0xb5],
  ["ACS", 0xb6],
  ["ATN", 0xb7],
  ["LN", 0xb8],
  ["EXP", 0xb9],
  ["INT", 0xba],
  ["SQR", 0xbb],
  ["SGN", 0xbc],
  ["ABS", 0xbd],
  ["PEEK", 0xbe],
  ["IN", 0xbf],
  ["USR", 0xc0],
  ["STR$", 0xc1],
  ["CHR$", 0xc2],
  ["NOT", 0xc3],
  ["BIN", 0xc4],
  ["OR", 0xc5],
  ["AND", 0xc6],
  ["<=", 0xc7],
  [">=", 0xc8],
  ["<>", 0xc9],
  ["LINE", 0xca],
  ["THEN", 0xcb],
  ["TO", 0xcc],
  ["STEP", 0xcd],
  ["DEF FN", 0xce],
  ["CAT", 0xcf],
  ["FORMAT", 0xd0],
  ["MOVE", 0xd1],
  ["ERASE", 0xd2],
  ["OPEN #", 0xd3],
  ["CLOSE #", 0xd4],
  ["MERGE", 0xd5],
  ["VERIFY", 0xd6],
  ["BEEP", 0xd7],
  ["CIRCLE", 0xd8],
  ["INK", 0xd9],
  ["PAPER", 0xda],
  ["FLASH", 0xdb],
  ["BRIGHT", 0xdc],
  ["INVERSE", 0xdd],
  ["OVER", 0xde],
  ["OUT", 0xdf],
  ["LPRINT", 0xe0],
  ["LLIST", 0xe1],
  ["STOP", 0xe2],
  ["READ", 0xe3],
  ["DATA", 0xe4],
  ["RESTORE", 0xe5],
  ["NEW", 0xe6],
  ["BORDER", 0xe7],
  ["CONTINUE", 0xe8],
  ["DIM", 0xe9],
  ["REM", 0xea],
  ["FOR", 0xeb],
  ["GO TO", 0xec],
  ["GOTO", 0xec],
  ["GO SUB", 0xed],
  ["GOSUB", 0xed],
  ["INPUT", 0xee],
  ["LOAD", 0xef],
  ["LIST", 0xf0],
  ["LET", 0xf1],
  ["PAUSE", 0xf2],
  ["NEXT", 0xf3],
  ["POKE", 0xf4],
  ["PRINT", 0xf5],
  ["PLOT", 0xf6],
  ["RUN", 0xf7],
  ["SAVE", 0xf8],
  ["RANDOMIZE", 0xf9],
  ["RAND", 0xf9],
  ["IF", 0xfa],
  ["CLS", 0xfb],
  ["DRAW", 0xfc],
  ["CLEAR", 0xfd],
  ["RETURN", 0xfe],
  ["COPY", 0xff]
]);

const TOKEN_MATCHES = [...BASIC_TOKENS.entries()].sort((a, b) => b[0].length - a[0].length);
const TOKEN_TEXT = new Map(
  [...BASIC_TOKENS.entries()]
    .filter(([keyword]) => keyword !== "GOTO" && keyword !== "GOSUB" && keyword !== "RAND")
    .map(([keyword, token]) => [token, keyword])
);
const EMPTY_NUMERIC_PARAMETER = [0x0e, 0x00, 0x00, 0x00, 0x00, 0x00];

function isWordByte(value) {
  return /[A-Z0-9$#]/.test(value);
}

function matchesBoundary(text, start, length) {
  const before = start === 0 ? "" : text[start - 1];
  const after = text[start + length] ?? "";
  return !isWordByte(before) && !isWordByte(after);
}

function numberMarker(numberText) {
  const value = Number(numberText);
  if (!Number.isFinite(value)) return [];
  if (!numberText.includes(".") && Number.isInteger(value) && value >= 0 && value <= 0xffff) {
    return [0x0e, 0x00, 0x00, value & 0xff, (value >> 8) & 0xff, 0x00];
  }
  if (value === 0) return [0x0e, 0x00, 0x00, 0x00, 0x00, 0x00];

  const sign = value < 0 ? 0x80 : 0x00;
  const magnitude = Math.abs(value);
  const exponent = Math.floor(Math.log2(magnitude)) + 129;
  const scaled = magnitude / (2 ** (exponent - 128));
  let mantissa = Math.floor(scaled * 0x100000000);
  if (mantissa >= 0x100000000) mantissa = 0x80000000;

  return [
    0x0e,
    exponent & 0xff,
    ((mantissa >> 24) & 0x7f) | sign,
    (mantissa >> 16) & 0xff,
    (mantissa >> 8) & 0xff,
    mantissa & 0xff
  ];
}

export function tokenizeBasicBody(body) {
  const bytes = [];
  const upper = body.toUpperCase();
  let inString = false;
  let inRem = false;
  let defFnAwaitingParameters = false;
  let defFnInParameters = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (!inRem && char === "\"") {
      inString = !inString;
      bytes.push(char.charCodeAt(0));
      continue;
    }

    if (!inString && !inRem && defFnAwaitingParameters) {
      bytes.push(char.charCodeAt(0));
      if (char === "(") {
        defFnAwaitingParameters = false;
        defFnInParameters = true;
      }
      continue;
    }

    if (!inString && !inRem && defFnInParameters) {
      if (char === ")") {
        bytes.push(char.charCodeAt(0));
        defFnInParameters = false;
        continue;
      }

      if (/[A-Za-z]/.test(char)) {
        bytes.push(char.charCodeAt(0));
        if (body[index + 1] === "$") {
          bytes.push(0x24);
          index += 1;
        }
        bytes.push(...EMPTY_NUMERIC_PARAMETER);
        continue;
      }

      bytes.push(char.charCodeAt(0));
      continue;
    }

    if (!inString && !inRem && /[0-9.]/.test(char)) {
      const numberMatch = body.slice(index).match(/^(\d+\.\d*|\.\d+|\d+)/);
      if (!numberMatch) {
        bytes.push(char.charCodeAt(0));
        continue;
      }
      const match = numberMatch[0];
      for (const digit of match) bytes.push(digit.charCodeAt(0));
      bytes.push(...numberMarker(match));
      index += match.length - 1;
      continue;
    }

    if (!inString && !inRem) {
      const tokenMatch = TOKEN_MATCHES.find(([keyword]) => {
        if (!upper.startsWith(keyword, index)) return false;
        if (/^[<>=]/.test(keyword)) return true;
        return matchesBoundary(upper, index, keyword.length);
      });
      if (tokenMatch) {
        bytes.push(tokenMatch[1]);
        if (tokenMatch[0] === "REM") inRem = true;
        if (tokenMatch[0] === "DEF FN") defFnAwaitingParameters = true;
        index += tokenMatch[0].length - 1;
        continue;
      }
    }

    bytes.push(char.charCodeAt(0));
  }

  return bytes;
}

export function tokenizeBasicLine(line) {
  const match = String(line).match(/^\s*(\d+)\s*(.*)$/);
  if (!match) return null;

  const lineNumber = Number(match[1]);
  if (!Number.isInteger(lineNumber) || lineNumber < 0 || lineNumber > 9999) {
    throw new Error(`Invalid BASIC line number: ${match[1]}`);
  }

  const body = tokenizeBasicBody(match[2]);
  const length = body.length + 1;
  return [
    (lineNumber >> 8) & 0xff,
    lineNumber & 0xff,
    length & 0xff,
    (length >> 8) & 0xff,
    ...body,
    0x0d
  ];
}

export function tokenizeBasicProgram(text) {
  const lines = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => /^\s*\d+/.test(line));

  return lines.flatMap((line) => tokenizeBasicLine(line));
}

function detokenizeBasicBody(bytes) {
  let text = "";
  let inString = false;
  let inRem = false;
  let defFnInParameters = false;

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];

    if (!inString && byte === 0x0e) {
      index += 5;
      continue;
    }

    if (!inRem && byte === 0x22) {
      inString = !inString;
      text += "\"";
      continue;
    }

    if (!inString && !inRem && defFnInParameters && /[A-Za-z]/.test(String.fromCharCode(byte))) {
      text += String.fromCharCode(byte);
      if (bytes[index + 1] === 0x24) {
        text += "$";
        index += 1;
      }
      if (bytes[index + 1] === 0x0e) index += 6;
      continue;
    }

    const token = !inString && !inRem ? TOKEN_TEXT.get(byte) : undefined;
    if (token) {
      text += token;
      if (token === "REM") inRem = true;
      if (token === "DEF FN") defFnInParameters = true;
      continue;
    }

    const char = String.fromCharCode(byte);
    text += char;
    if (!inString && defFnInParameters && char === ")") defFnInParameters = false;
  }

  return text;
}

export function detokenizeBasicProgram(programBytes) {
  const bytes = Uint8Array.from(programBytes);
  const lines = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const lineNumber = (bytes[offset] << 8) | bytes[offset + 1];
    const length = bytes[offset + 2] | (bytes[offset + 3] << 8);
    if (length === 0 || offset + 4 + length > bytes.length) break;
    const bodyEnd = offset + 4 + length - 1;
    lines.push(`${lineNumber} ${detokenizeBasicBody(bytes.slice(offset + 4, bodyEnd))}`);
    offset += 4 + length;
  }

  return lines.join("\n");
}

function splitBasicLines(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n");
}

function replaceLineReferences(segment, lineMap) {
  const replaceMappedLine = (match, keyword, lineNumber) => {
    const mapped = lineMap.get(Number(lineNumber));
    return mapped === undefined ? match : `${keyword} ${mapped}`;
  };

  return segment
    .replace(/\b(GO\s*TO|GOTO|GO\s*SUB|GOSUB|RESTORE|RUN|LIST)\s+(\d+)/gi, replaceMappedLine)
    .replace(/\b(THEN)\s+(\d+)/gi, replaceMappedLine);
}

function renumberReferences(body, lineMap) {
  const upper = body.toUpperCase();
  let result = "";
  let segment = "";
  let inString = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (!inString && upper.startsWith("REM", index) && matchesBoundary(upper, index, 3)) {
      result += replaceLineReferences(segment, lineMap);
      result += body.slice(index);
      return result;
    }

    if (char === "\"") {
      if (inString) {
        result += char;
        inString = false;
      } else {
        result += replaceLineReferences(segment, lineMap);
        segment = "";
        result += char;
        inString = true;
      }
      continue;
    }

    if (inString) {
      result += char;
    } else {
      segment += char;
    }
  }

  return result + replaceLineReferences(segment, lineMap);
}

export function renumberBasicProgram(text, { start = 10, step = 10, maxLine = 9999 } = {}) {
  const lines = splitBasicLines(text);
  const numberedLines = lines
    .map((line, index) => ({ line, index, match: line.match(/^(\s*)(\d+)(\s*)(.*)$/) }))
    .filter(({ match }) => match);

  if (numberedLines.length === 0) return String(text);

  const lastLineNumber = start + (numberedLines.length - 1) * step;
  if (lastLineNumber > maxLine) {
    throw new Error(`Renumbered BASIC program would exceed line ${maxLine}`);
  }

  const lineMap = new Map();
  numberedLines.forEach(({ match }, offset) => {
    lineMap.set(Number(match[2]), start + offset * step);
  });

  const renumberedLines = [...lines];
  numberedLines.forEach(({ index, match }, offset) => {
    const [, indent, , spacing, body] = match;
    const newLineNumber = start + offset * step;
    renumberedLines[index] = `${indent}${newLineNumber}${spacing}${renumberReferences(body, lineMap)}`;
  });

  return renumberedLines.join("\n");
}

export function loadBasicProgram(machine, text) {
  const program = tokenizeBasicProgram(text);
  return loadBasicProgramBytes(machine, program);
}

export function exportBasicProgram(machine) {
  const start = machine.read16(0x5c53);
  const vars = machine.read16(0x5c4b);
  if (vars < start) throw new Error("BASIC pointers are invalid");
  const bytes = Array.from({ length: vars - start }, (_, offset) => machine.read8(start + offset));
  return detokenizeBasicProgram(bytes);
}

export function loadBasicProgramBytes(machine, programBytes, { variablesOffset = programBytes.length } = {}) {
  const program = Uint8Array.from(programBytes);
  const start = machine.read16(0x5c53);
  for (let offset = 0; offset < program.length; offset += 1) {
    machine.write8(start + offset, program[offset]);
  }

  const end = start + program.length;
  machine.write16(0x5c4b, start + Math.min(variablesOffset, program.length));
  machine.write16(0x5c59, end + 1);
  machine.write16(0x5c5b, end + 1);
  machine.write8(end, 0x80);
  machine.write8(end + 1, 0x0d);
  machine.write8(end + 2, 0x80);
  machine.write16(0x5c61, end + 3);
  machine.write16(0x5c63, end + 3);
  machine.write16(0x5c65, end + 3);
  return { start, end, length: program.length };
}
