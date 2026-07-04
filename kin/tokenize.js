export function tokenize(source) {
  const tokens = [];

  let index = 0;
  let start = 0;

  const peek = (offset = 0) => index + offset < source.length ? source[index + offset] : "\0";
  const advance = () => source[index++];
  const eof = () => index >= source.length;

  const push = (type) => {
    tokens.push({
      type,
      start,
      end: index,
      lexeme: source.slice(start, index),
    });

    start = index;
  };
  
  const skip = () => (start = index);

  const isDigit = (c) => c >= "0" && c <= "9";

  const isAlpha = (c) =>
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    c === "_";

  const isAlphaNum = (c) => isAlpha(c) || isDigit(c);

  while (!eof()) {
    start = index;
    const c = advance();

    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      skip();
      continue;
    }

    if (c === "#") {
      while (!eof() && peek() !== "\n") {
        advance();
      }
      skip();
      continue;
    }

    if (c === "+") {
      push("PLUS");
      continue;
    }

    if (c === "=") {
      push("EQUAL");
      continue;
    }

    if (c === "|") {
      push("PIPE");
      continue;
    }

    if (c === "?") {
      while (!eof()) {
        const next = peek();
        if (next === "\n" || next === "+" || next === "=" || next === "|" || next === "#") {
          break;
        }
        if (next === " ") {
          const afterSpace = peek(1);
          if (afterSpace === "+" || afterSpace === "=" || afterSpace === "|" || afterSpace === "\n" || afterSpace === "#") {
            break;
          }
        }
        advance();
      }
      push("UNKNOWN");
      continue;
    }

    if (isAlphaNum(c)) {
      while (!eof()) {
        const next = peek();
        if (next === "\n" || next === "+" || next === "=" || next === "|" || next === "#" || next === "?") {
          break;
        }
        if (next === " ") {
          const afterSpace = peek(1);
          if (afterSpace === "+" || afterSpace === "=" || afterSpace === "|" || afterSpace === "\n" || afterSpace === "#" || afterSpace === "?") {
            break;
          }
        }
        advance();
      }
      push("TEXT");
      continue;
    }

    while (!eof()) {
      const next = peek();
      if (next === "\n" || next === "+" || next === "=" || next === "|" || next === "#" || next === "?" || next === "\t" || next === "\r") {
        break;
      }
      if (next === " ") {
        const afterSpace = peek(1);
        if (afterSpace === "+" || afterSpace === "=" || afterSpace === "|" || afterSpace === "\n" || afterSpace === "#" || afterSpace === "?") {
          break;
        }
      }
      advance();
    }
    push("TEXT");
  }

  tokens.push({
    type: "EOF",
    start: index,
    end: index,
    lexeme: "",
  });

  return tokens;
}
