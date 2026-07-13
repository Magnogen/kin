import { createCanvasPreview } from "./canvas.js";
import { highlightSource } from "./highlight.js";
import { initializeThemeToggle } from "./theme.js";
import { tokenize } from "./kin/tokenize.js";
import { parse } from "./kin/parse.js";

const editor = $("#editor");
const lineNumberGutter = $("#line-number-gutter");
const highlightLayer = $("#highlight-layer");
const canvas = $("#preview-canvas");
const themeToggle = $("#theme-toggle");
const tokenDebug = $("#token-debug");

function buildLineNumberMarkup(source) {
  const lineCount = Math.max(1, source.split("\n").length);
  return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
}

function updateLineNumbers() {
  const source = editor.value || "";
  lineNumberGutter.textContent = buildLineNumberMarkup(source);
  lineNumberGutter.scrollTop = editor.scrollTop;
}

function updateHighlight() {
  const source = editor.value || "";
  updateLineNumbers();
  highlightLayer.classList.toggle("ends-with-newline", source.endsWith("\n"));
  highlightLayer.innerHTML = highlightSource(source);
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
}

// function formatTokenLine(token, index) {
//   const indexLabel = String(index).padStart(3, "0");
//   const span = `[${String(token.start).padStart(3, "0")}, ${String(token.end).padStart(3, "0")})`;
//   const lexeme = JSON.stringify(token.lexeme);
//   return `${indexLabel}  ${token.type.padEnd(8, " ")}  ${span}  ${lexeme}`;
// }
// function updateTokenDebug() {
//   if (!tokenDebug) return;
//   const source = editor.value || "";
//   try {
//     const tokens = tokenize(source);
//     if (!tokens.length) {
//       tokenDebug.textContent = "(no tokens)";
//       return;
//     }
//     tokenDebug.textContent = tokens.map(formatTokenLine).join("\n");
//   } catch (error) {
//     tokenDebug.textContent = `Tokenizer error: ${error.message}`;
//   }
// }

// function updateAstDebug(ast) {
//   if (!tokenDebug) return;
//   tokenDebug.textContent = JSON.stringify(ast, null, 2);
// }

function syncEditorViews() {
  updateHighlight();

  const source = editor.value || "";
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    // updateAstDebug(ast);
    canvasPreview.render(ast, source);
  } catch (error) {
    tokenDebug.textContent = `Parser error: ${error.message}`;
    canvasPreview.render(null, source);
  }
}

const canvasPreview = createCanvasPreview(canvas);

editor.on("input", syncEditorViews);
editor.on("scroll", () => {
  lineNumberGutter.scrollTop = editor.scrollTop;
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
});

initializeThemeToggle(themeToggle, canvasPreview.redraw);
canvasPreview.redraw();
syncEditorViews();