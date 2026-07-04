import { createCanvasPreview } from "./canvas.js";
import { initializeThemeToggle } from "./theme.js";
import { tokenize } from "./kin/tokenize.js";
import { parse } from "./kin/parse.js";

const editor = $("#editor");
const highlightLayer = $("#highlight-layer");
const canvas = $("#preview-canvas");
const themeToggle = $("#theme-toggle");
// const tokenDebug = $("#token-debug");

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function updateHighlight() {
  const source = editor.value || "";
  // This layer mirrors editor content and can later be replaced with tokenized HTML.
  highlightLayer.innerHTML = escapeHtml(source) || "\u200b";
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
}

/*
function formatTokenLine(token, index) {
  const indexLabel = String(index).padStart(3, "0");
  const span = `[${String(token.start).padStart(3, "0")}, ${String(token.end).padStart(3, "0")})`;
  const lexeme = JSON.stringify(token.lexeme);
  return `${indexLabel}  ${token.type.padEnd(8, " ")}  ${span}  ${lexeme}`;
}

function updateTokenDebug() {
  if (!tokenDebug) return;

  const source = editor.value || "";

  try {
    const tokens = tokenize(source);
    if (!tokens.length) {
      tokenDebug.textContent = "(no tokens)";
      return;
    }

    tokenDebug.textContent = tokens.map(formatTokenLine).join("\n");
  } catch (error) {
    tokenDebug.textContent = `Tokenizer error: ${error.message}`;
  }
}
*/

/*
function updateAstDebug(ast) {
  if (!tokenDebug) return;
  tokenDebug.textContent = JSON.stringify(ast, null, 2);
}
*/

function syncEditorViews() {
  updateHighlight();

  const source = editor.value || "";
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    // updateAstDebug(ast);
    canvasPreview.render(ast);
  } catch (error) {
    // tokenDebug.textContent = `Parser error: ${error.message}`;
    canvasPreview.render(null);
  }
}

const canvasPreview = createCanvasPreview(canvas);

editor.on("input", syncEditorViews);
editor.on("scroll", () => {
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
});

initializeThemeToggle(themeToggle, canvasPreview.redraw);
canvasPreview.redraw();
syncEditorViews();