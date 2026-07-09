export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getPersonLabel(person) {
  if (!person) return "?";
  if (person.value && person.value.trim()) return person.value.trim();
  return "?";
}

export function normalizeAnnotations(annotations) {
  return (annotations || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function createTextWidthMeasurer(options) {
  let ctx = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    ctx = canvas.getContext("2d");
  } else if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }

  const cache = new Map();
  const family = options.personFontFamily;

  const fallbackWidth = (text, fontSize) => {
    const value = String(text || "");
    if (!value.length) return fontSize * 0.3;

    // Approximate glyph widths by category for non-browser runtimes.
    let units = 0;
    for (const ch of value) {
      if ("il.:,|'`!".includes(ch)) {
        units += 0.32;
      } else if ("mwMW@#%&".includes(ch)) {
        units += 0.92;
      } else if (ch === " ") {
        units += 0.33;
      } else {
        units += 0.58;
      }
    }

    return units * fontSize;
  };

  return (text, fontSize, fontWeight) => {
    const value = String(text || "");
    const key = `${fontWeight}|${fontSize}|${value}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    let width;
    if (ctx) {
      ctx.font = `${fontWeight} ${fontSize}px ${family}`;
      width = ctx.measureText(value).width;
    } else {
      width = fallbackWidth(value, fontSize);
    }

    cache.set(key, width);
    return width;
  };
}
