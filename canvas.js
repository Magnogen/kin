export function createCanvasPreview(canvas) {
  const ctx = canvas?.getContext("2d");

  if (!canvas || !ctx) {
    return {
      redraw() {},
    };
  }

  function resizeCanvasToDisplaySize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.floor(canvas.clientWidth * ratio);
    const height = Math.floor(canvas.clientHeight * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawCanvasPlaceholder() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const darkMode = document.documentElement.dataset.theme === "dark";
    const fill = darkMode ? "#0f1827" : "#eef4ff";
    const grid = darkMode ? "#223349" : "#d8e4f7";
    const label = darkMode ? "#c8d7ea" : "#334155";

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = label;
    ctx.font = "600 16px IBM Plex Sans, Segoe UI, sans-serif";
    ctx.fillText("Canvas ready", 20, 30);
  }

  function redraw() {
    resizeCanvasToDisplaySize();
    drawCanvasPlaceholder();
  }

  window.addEventListener("resize", redraw);

  return {
    redraw,
  };
}