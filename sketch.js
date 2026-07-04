import { createCanvasPreview } from "./canvas.js";
import { initializeThemeToggle } from "./theme.js";

const editor = document.getElementById("editor");
const highlightLayer = document.getElementById("highlight-layer");
const canvas = document.getElementById("preview-canvas");
const themeToggle = document.getElementById("theme-toggle");

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

const canvasPreview = createCanvasPreview(canvas);

editor.on("input", updateHighlight);
editor.on("scroll", () => {
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
});

initializeThemeToggle(themeToggle, canvasPreview.redraw);
canvasPreview.redraw();
updateHighlight();