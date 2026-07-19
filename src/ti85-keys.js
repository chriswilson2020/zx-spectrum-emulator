export const TI85_KEY_ROWS = [
  ["DOWN", "ENTER", "(-)", ".", "0", undefined, "F5"],
  ["LEFT", "+", "3", "2", "1", "STO", "F4"],
  ["RIGHT", "-", "6", "5", "4", ",", "F3"],
  ["UP", "*", "9", "8", "7", "X^2", "F2"],
  [undefined, "/", ")", "(", "EE", "LN", "F1"],
  [undefined, "^", "TAN", "COS", "SIN", "LOG", "2ND"],
  [undefined, "CLEAR", "CUSTOM", "PRGM", "STAT", "GRAPH", "EXIT"],
  [undefined, undefined, undefined, "DEL", "X-VAR", "ALPHA", "MORE"]
];

export const TI85_KEY_LAYOUT = [
  [
    { key: "F1", label: "F1", shift: "M1", className: "function" },
    { key: "F2", label: "F2", shift: "M2", className: "function" },
    { key: "F3", label: "F3", shift: "M3", className: "function" },
    { key: "F4", label: "F4", shift: "M4", className: "function" },
    { key: "F5", label: "F5", shift: "M5", className: "function" }
  ],
  [
    { key: "2ND", label: "2nd", className: "modifier second" },
    { key: "EXIT", label: "EXIT", shift: "QUIT" },
    { key: "MORE", label: "MORE", shift: "MODE" },
    { key: "UP", label: "▲", className: "arrow" },
    { key: "DOWN", label: "▼", className: "arrow" }
  ],
  [
    { key: "ALPHA", label: "ALPHA", shift: "alpha", className: "modifier alpha" },
    { key: "X-VAR", label: "x-VAR", shift: "LINK", alpha: "x" },
    { key: "DEL", label: "DEL", shift: "INS" },
    { key: "LEFT", label: "◀", className: "arrow" },
    { key: "RIGHT", label: "▶", className: "arrow" }
  ],
  [
    { key: "GRAPH", label: "GRAPH", shift: "SOLVER" },
    { key: "STAT", label: "STAT", shift: "SIMULT" },
    { key: "PRGM", label: "PRGM", shift: "POLY" },
    { key: "CUSTOM", label: "CUSTOM", shift: "CATALOG" },
    { key: "CLEAR", label: "CLEAR", shift: "TOLER" }
  ],
  [
    { key: "LOG", label: "LOG", shift: "10^x", alpha: "A" },
    { key: "SIN", label: "SIN", shift: "SIN^-1", alpha: "B" },
    { key: "COS", label: "COS", shift: "COS^-1", alpha: "C" },
    { key: "TAN", label: "TAN", shift: "TAN^-1", alpha: "D" },
    { key: "^", label: "^", shift: "π", alpha: "E", className: "operator" }
  ],
  [
    { key: "LN", label: "LN", shift: "e^x", alpha: "F" },
    { key: "EE", label: "EE", shift: "x^-1", alpha: "G" },
    { key: "(", label: "(", shift: "[", alpha: "H" },
    { key: ")", label: ")", shift: "]", alpha: "I" },
    { key: "/", label: "÷", shift: "CALC", alpha: "J", className: "operator" }
  ],
  [
    { key: "X^2", label: "x²", shift: "√", alpha: "K" },
    { key: "7", label: "7", shift: "MATRX", alpha: "L", className: "number" },
    { key: "8", label: "8", shift: "VECTR", alpha: "M", className: "number" },
    { key: "9", label: "9", shift: "CPLX", alpha: "N", className: "number" },
    { key: "*", label: "×", shift: "MATH", alpha: "O", className: "operator" }
  ],
  [
    { key: ",", label: ",", shift: "∠", alpha: "P" },
    { key: "4", label: "4", shift: "CONS", alpha: "Q", className: "number" },
    { key: "5", label: "5", shift: "CONV", alpha: "R", className: "number" },
    { key: "6", label: "6", shift: "STRNG", alpha: "S", className: "number" },
    { key: "-", label: "-", shift: "LIST", alpha: "T", className: "operator" }
  ],
  [
    { key: "STO", label: "STO▶", shift: "RCL" },
    { key: "1", label: "1", shift: "BASE", alpha: "U", className: "number" },
    { key: "2", label: "2", shift: "TEST", alpha: "V", className: "number" },
    { key: "3", label: "3", shift: "VARS", alpha: "W", className: "number" },
    { key: "+", label: "+", shift: "MEM", alpha: "X", className: "operator" }
  ],
  [
    { key: "ON", label: "ON", shift: "OFF", className: "on" },
    { key: "0", label: "0", shift: "CHAR", alpha: "Y", className: "number" },
    { key: ".", label: ".", shift: ":", alpha: "Z", className: "number" },
    { key: "(-)", label: "(-)", shift: "ANS", className: "operator" },
    { key: "ENTER", label: "ENTER", shift: "ENTRY", className: "enter" }
  ]
];

export const TI85_PHYSICAL_KEYS = TI85_KEY_LAYOUT.flat();
