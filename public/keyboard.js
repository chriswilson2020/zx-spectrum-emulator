const DIRECT_KEYS = new Map([
  ["Enter", ["ENTER"]],
  [" ", ["SPACE"]],
  ["Backspace", ["CAPS SHIFT", "0"]],
  ["Shift", ["CAPS SHIFT"]],
  ["Alt", ["SYMBOL SHIFT"]]
]);

const SYMBOL_KEYS = new Map([
  ["!", ["SYMBOL SHIFT", "1"]],
  ["@", ["SYMBOL SHIFT", "2"]],
  ["#", ["SYMBOL SHIFT", "3"]],
  ["$", ["SYMBOL SHIFT", "4"]],
  ["%", ["SYMBOL SHIFT", "5"]],
  ["&", ["SYMBOL SHIFT", "6"]],
  ["'", ["SYMBOL SHIFT", "7"]],
  ["(", ["SYMBOL SHIFT", "8"]],
  [")", ["SYMBOL SHIFT", "9"]],
  ["_", ["SYMBOL SHIFT", "0"]],
  ["\"", ["SYMBOL SHIFT", "P"]],
  [";", ["SYMBOL SHIFT", "O"]],
  [":", ["SYMBOL SHIFT", "Z"]],
  [",", ["SYMBOL SHIFT", "N"]],
  [".", ["SYMBOL SHIFT", "M"]],
  ["-", ["SYMBOL SHIFT", "J"]],
  ["+", ["SYMBOL SHIFT", "K"]],
  ["=", ["SYMBOL SHIFT", "L"]],
  ["*", ["SYMBOL SHIFT", "B"]],
  ["/", ["SYMBOL SHIFT", "V"]],
  ["?", ["SYMBOL SHIFT", "C"]],
  ["<", ["SYMBOL SHIFT", "R"]],
  [">", ["SYMBOL SHIFT", "T"]]
]);

function isLetter(key) {
  return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

function isDigit(key) {
  return /^[0-9]$/.test(key);
}

const BASIC_KEYWORDS = new Map([
  ["PRINT", "p"],
  ["RUN", "r"]
]);

export function spectrumKeysForModernKey(event) {
  const direct = DIRECT_KEYS.get(event.key);
  if (direct) return direct;

  const symbol = SYMBOL_KEYS.get(event.key);
  if (symbol) return symbol;

  if (isLetter(event.key)) {
    const letter = event.key.toUpperCase();
    return event.key === letter ? ["CAPS SHIFT", letter] : [letter];
  }

  if (isDigit(event.key)) return [event.key];

  return null;
}

export function shouldCaptureModernKeyEvent(event) {
  const target = event.target;
  const tagName = target?.tagName?.toUpperCase();
  return !(target?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT");
}

export function modernTextToSpectrumKeyTaps(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  const taps = [];

  for (const character of normalized) {
    const key = character === "\n" ? "Enter" : character;
    const spectrumKeys = spectrumKeysForModernKey({ key });
    if (spectrumKeys) taps.push(spectrumKeys);
  }

  return taps;
}

export function basicTextToSpectrumKeyTaps(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  const taps = [];
  const lines = normalized.split("\n");

  lines.forEach((line, lineIndex) => {
    const keywordMatch = line.match(/^(\s*\d*\s*)([A-Za-z]+)/);
    if (!keywordMatch) {
      taps.push(...modernTextToSpectrumKeyTaps(line));
    } else {
      const [, prefix, word] = keywordMatch;
      const keywordKey = BASIC_KEYWORDS.get(word.toUpperCase());
      if (!keywordKey) {
        taps.push(...modernTextToSpectrumKeyTaps(line));
      } else {
        taps.push(...modernTextToSpectrumKeyTaps(prefix));
        taps.push(spectrumKeysForModernKey({ key: keywordKey }));
        taps.push(...modernTextToSpectrumKeyTaps(line.slice(keywordMatch[0].length).replace(/^ /, "")));
      }
    }

    if (lineIndex < lines.length - 1) {
      taps.push(spectrumKeysForModernKey({ key: "Enter" }));
    }
  });

  return taps;
}
