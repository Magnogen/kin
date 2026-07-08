function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrapToken(type, text) {
  if (!text) {
    return "";
  }

  return `<span class="token token-${type}">${escapeHtml(text)}</span>`;
}

function shouldStopAtSpace(source, index) {
  if (source[index] !== " ") {
    return false;
  }

  const next = source[index + 1];
  return next === "+" || next === "=" || next === "|" || next === "#" || next === "?" || next === "\n";
}

function readUntilBoundary(source, index, extraStops = []) {
  while (index < source.length) {
    const next = source[index];
    if (next === "#" || next === "+" || next === "=" || next === "|" || next === "\n" || extraStops.includes(next)) {
      break;
    }
    if (shouldStopAtSpace(source, index)) {
      break;
    }
    index += 1;
  }

  return index;
}

export function highlightSource(source) {
  if (!source) {
    return "\u200b";
  }

  let index = 0;
  let html = "";

  while (index < source.length) {
    const char = source[index];

    if (char === "#") {
      const start = index;
      index += 1;

      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }

      html += wrapToken("comment", source.slice(start, index));
      continue;
    }

    if (char === "+" || char === "=" || char === "|") {
      html += wrapToken("operator", char);
      index += 1;
      continue;
    }

    if (char === "?") {
      const start = index;
      index += 1;
      index = readUntilBoundary(source, index);
      html += wrapToken("unknown", source.slice(start, index));
      continue;
    }

    if (char === "\n") {
      html += "\n";
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    index = readUntilBoundary(source, index, ["?"]);

    html += wrapToken("text", source.slice(start, index));
  }

  return html;
}