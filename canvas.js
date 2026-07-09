import { layoutFamilyTree } from "./layout/index.js";
  
export function createCanvasPreview(canvas) {
  const ctx = canvas?.getContext("2d");
  let currentAst = null;
  let currentViewport = null;

  const viewState = {
    zoom: 1,
    minZoom: 0.25,
    maxZoom: 5.00,
    panX: 0,
    panY: 0,
    isPanning: false,
    isPinching: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchLastMidpoint: null,
    activePointers: new Map(),
  };

  if (!canvas || !ctx) {
    return {
      redraw() {},
      render() {},
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

  function getThemeColors() {
    const darkMode = document.documentElement.dataset.theme === "dark";
    return {
      fill: darkMode ? "#141920" : "#eef4ff",
      grid: darkMode ? "#2d3640" : "#d9e6fa",
      label: darkMode ? "#d7dee7" : "#2e415a",
      annotation: darkMode ? "rgba(215, 222, 231, 0.74)" : "rgba(46, 65, 90, 0.72)",
      connector: darkMode ? "#8d9eb4" : "#6e87ab",
      personFill: darkMode ? "#1c222a" : "#ffffff",
      personStroke: darkMode ? "#46515e" : "#b9cde8",
      personUnknownFill: darkMode ? "#262124" : "#fff0f2",
      personUnknownStroke: darkMode ? "#8a6f78" : "#d8949e",
      unionFill: darkMode ? "#85b8ff" : "#3d7cc7",
      error: darkMode ? "#ff9f9f" : "#bf2f2f",
      warning: darkMode ? "#ffd48a" : "#a06200",
    };
  }

  function drawBackground(colors) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.fill;
    ctx.fillRect(0, 0, width, height);
  }

  function drawStaticGrid(colors) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
  }

  function drawWorldGrid(colors, transform) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const { minX, minY, offsetX, offsetY, scale } = transform;

    const worldStep = 28;

    const worldMinX = minX + (0 - offsetX) / scale;
    const worldMaxX = minX + (width - offsetX) / scale;
    const worldMinY = minY + (0 - offsetY) / scale;
    const worldMaxY = minY + (height - offsetY) / scale;

    const startX = Math.floor(worldMinX / worldStep) * worldStep;
    const endX = Math.ceil(worldMaxX / worldStep) * worldStep;
    const startY = Math.floor(worldMinY / worldStep) * worldStep;
    const endY = Math.ceil(worldMaxY / worldStep) * worldStep;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    for (let x = startX; x <= endX; x += worldStep) {
      const sx = offsetX + (x - minX) * scale;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, height);
      ctx.stroke();
    }

    for (let y = startY; y <= endY; y += worldStep) {
      const sy = offsetY + (y - minY) * scale;
      ctx.beginPath();
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(width, sy + 0.5);
      ctx.stroke();
    }
  }

  function drawNoData(colors, message) {
    ctx.fillStyle = colors.label;
    ctx.font = "600 16px IBM Plex Sans, Segoe UI, sans-serif";
    ctx.fillText(message, 20, 30);
  }

  function roundedRectPath(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pointerDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx, dy);
  }

  function pointerMidpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  function applyZoomAtPoint(point, nextZoom) {
    if (!currentViewport) return false;

    const oldZoom = viewState.zoom;
    if (nextZoom === oldZoom) return false;

    const oldScale = currentViewport.baseScale * oldZoom;
    const nextScale = currentViewport.baseScale * nextZoom;

    const worldX =
      currentViewport.minX +
      (point.x - currentViewport.baseOffsetX - viewState.panX) / oldScale;
    const worldY =
      currentViewport.minY +
      (point.y - currentViewport.baseOffsetY - viewState.panY) / oldScale;

    viewState.zoom = nextZoom;
    viewState.panX =
      point.x -
      currentViewport.baseOffsetX -
      (worldX - currentViewport.minX) * nextScale;
    viewState.panY =
      point.y -
      currentViewport.baseOffsetY -
      (worldY - currentViewport.minY) * nextScale;

    return true;
  }

  function beginPinch() {
    const pointers = [...viewState.activePointers.values()];
    if (pointers.length < 2) return;

    const distance = Math.max(1, pointerDistance(pointers[0], pointers[1]));
    const midpoint = pointerMidpoint(pointers[0], pointers[1]);
    viewState.isPinching = true;
    viewState.isPanning = false;
    viewState.pointerId = null;
    viewState.pinchStartDistance = distance;
    viewState.pinchStartZoom = viewState.zoom;
    viewState.pinchLastMidpoint = midpoint;
  }

  function startPanning(pointerId, point) {
    viewState.pointerId = pointerId;
    viewState.lastX = point.x;
    viewState.lastY = point.y;
  }

  function setInteractionFlags(state) {
    viewState.isPanning = state === "panning";
    viewState.isPinching = state === "pinching";
    updateCursor();
  }

  function teardownPointer(event) {
    if (!event) return;

    viewState.activePointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function canHandlePointer(event) {
    if (!currentViewport) return false;
    if (event.pointerType === "mouse" && event.button !== 0) return false;
    return true;
  }

  function applyPinchTransform(previousMidpoint, currentMidpoint, nextZoom) {
    if (!currentViewport) return false;

    const oldZoom = viewState.zoom;
    const oldScale = currentViewport.baseScale * oldZoom;
    const clampedZoom = clamp(nextZoom, viewState.minZoom, viewState.maxZoom);
    const nextScale = currentViewport.baseScale * clampedZoom;

    const worldX =
      currentViewport.minX +
      (previousMidpoint.x - currentViewport.baseOffsetX - viewState.panX) / oldScale;
    const worldY =
      currentViewport.minY +
      (previousMidpoint.y - currentViewport.baseOffsetY - viewState.panY) / oldScale;

    const nextPanX =
      currentMidpoint.x -
      currentViewport.baseOffsetX -
      (worldX - currentViewport.minX) * nextScale;
    const nextPanY =
      currentMidpoint.y -
      currentViewport.baseOffsetY -
      (worldY - currentViewport.minY) * nextScale;

    const changed =
      clampedZoom !== viewState.zoom ||
      Math.abs(nextPanX - viewState.panX) > 1e-6 ||
      Math.abs(nextPanY - viewState.panY) > 1e-6;

    viewState.zoom = clampedZoom;
    viewState.panX = nextPanX;
    viewState.panY = nextPanY;

    return changed;
  }

  function resetView() {
    viewState.zoom = 1;
    viewState.panX = 0;
    viewState.panY = 0;
  }

  function canvasPointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function updateCursor() {
    if (!currentViewport) {
      canvas.style.cursor = "default";
      return;
    }
    canvas.style.cursor = viewState.isPanning ? "grabbing" : "grab";
  }

  function truncateLabel(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let label = text;
    while (label.length > 1 && ctx.measureText(`${label}...`).width > maxWidth) {
      label = label.slice(0, -1);
    }
    return `${label}...`;
  }

  function annotationLines(annotations) {
    if (!annotations?.length) return [];
    return annotations.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  function drawTree(ast, colors) {
    const layout = layoutFamilyTree(ast);

    const viewportWidth = canvas.clientWidth;
    const viewportHeight = canvas.clientHeight;
    const outerPadding = 24;

    const availableWidth = Math.max(1, viewportWidth - outerPadding * 2);
    const availableHeight = Math.max(1, viewportHeight - outerPadding * 2);
    const scaleX = availableWidth / Math.max(1, layout.bounds.width);
    const scaleY = availableHeight / Math.max(1, layout.bounds.height);
    const fitScale = clamp(Math.min(scaleX, scaleY), 0.35, 1.7);

    const scale = fitScale * viewState.zoom;

    const baseContentWidth = layout.bounds.width * fitScale;
    const baseContentHeight = layout.bounds.height * fitScale;
    const baseOffsetX = outerPadding + (availableWidth - baseContentWidth) / 2;
    const baseOffsetY = outerPadding + (availableHeight - baseContentHeight) / 2;

    const offsetX = baseOffsetX + viewState.panX;
    const offsetY = baseOffsetY + viewState.panY;

    currentViewport = {
      minX: layout.bounds.minX,
      minY: layout.bounds.minY,
      baseScale: fitScale,
      baseOffsetX,
      baseOffsetY,
    };
    updateCursor();

    const mapX = (x) => offsetX + (x - layout.bounds.minX) * scale;
    const mapY = (y) => offsetY + (y - layout.bounds.minY) * scale;

    drawWorldGrid(colors, {
      minX: layout.bounds.minX,
      minY: layout.bounds.minY,
      offsetX,
      offsetY,
      scale,
    });
    
    if (!layout.nodes.length) {
      currentViewport = null;
      updateCursor();
      drawNoData(colors, "No people to layout yet");
      return;
    }

    const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));

    ctx.strokeStyle = colors.connector;
    ctx.lineWidth = 1.8 * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    layout.edges.forEach((edge) => {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      if (!from || !to) return;

      const fromCenterX = mapX(from.x + from.width / 2);
      const toCenterX = mapX(to.x + to.width / 2);

      let fromX = fromCenterX;
      let toX = toCenterX;

      let fromY;
      let toY;
      if (edge.type === "member") {
        fromX = fromCenterX < toCenterX ? mapX(from.x + from.width) : mapX(from.x);
        fromY = mapY(from.y + from.height / 2);
        toY = mapY(to.y + to.height / 2);
      } else if (edge.type === "singleParent") {
        fromY = mapY(from.y + from.height);
        toY = mapY(to.y);
      } else {
        fromY = mapY(from.y + from.height / 2);
        toY = mapY(to.y);
      }

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      if (edge.type === "member") {
        const controlX = (fromX + toX) / 2;
        ctx.bezierCurveTo(controlX, fromY, controlX, toY, toX, toY);
      } else {
        const controlY = (fromY + toY) / 2;
        ctx.bezierCurveTo(fromX, controlY, toX, controlY, toX, toY);
      }
      ctx.stroke();
    });

    layout.nodes
      .filter((node) => node.type === "person")
      .forEach((node) => {
        const x = mapX(node.x);
        const y = mapY(node.y);
        const width = node.width * scale;
        const height = node.height * scale;
        const radius = 11 * scale;

        ctx.beginPath();
        roundedRectPath(x, y, width, height, radius);
        ctx.fillStyle = node.kind === "unknown" ? colors.personUnknownFill : colors.personFill;
        ctx.strokeStyle = node.kind === "unknown" ? colors.personUnknownStroke : colors.personStroke;
        ctx.lineWidth = 1.4 * scale;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = colors.label;
        const nameSize = 14 * scale;
        const noteSize = 11 * scale;
        const notes = annotationLines(node.annotations);
        const lineGap = 2 * scale;
        const lineCount = 1 + notes.length;
        const textBlockHeight =
          nameSize + notes.length * noteSize + Math.max(0, lineCount - 1) * lineGap;

        ctx.font = `${nameSize}px IBM Plex Sans, Segoe UI, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = truncateLabel(node.label || "?", width - 20 * scale);
        let lineY = y + (height - textBlockHeight) / 2;
        ctx.fillText(label, x + width / 2, lineY);
        lineY += nameSize + lineGap;

        if (notes.length) {
          ctx.fillStyle = colors.annotation;
          ctx.font = `${noteSize}px IBM Plex Sans, Segoe UI, sans-serif`;
          notes.forEach((note) => {
            const text = truncateLabel(note, width - 20 * scale);
            ctx.fillText(text, x + width / 2, lineY);
            lineY += noteSize + lineGap;
          });
        }
      });

    layout.nodes
      .filter((node) => node.type === "union")
      .forEach((node) => {
        const centerX = mapX(node.x + node.width / 2);
        const centerY = mapY(node.y + node.height / 2);
        const radius = (node.width * scale) / 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = colors.unionFill;
        ctx.fill();

        const notes = annotationLines(node.annotationLines);
        if (notes.length) {
          ctx.fillStyle = colors.annotation;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const noteSize = 11 * scale;
          const lineGap = 2 * scale;
          const lineHeight = noteSize + lineGap;
          const topPadding = 18 * scale;
          const labelY = centerY - radius - topPadding - notes.length * lineHeight;
          ctx.font = `${noteSize}px IBM Plex Sans, Segoe UI, sans-serif`;
          notes.forEach((note, index) => {
            const text = truncateLabel(note, 220 * scale);
            ctx.fillText(text, centerX, labelY + index * lineHeight);
          });
        }
      });

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = colors.annotation;
    ctx.font = "500 12px IBM Plex Sans, Segoe UI, sans-serif";
    ctx.fillText(
      `Generations: ${layout.generationCount}  People: ${layout.nodes.filter((node) => node.type === "person").length}  Unions: ${layout.nodes.filter((node) => node.type === "union").length}  Zoom: ${Math.round(viewState.zoom * 100)}%`,
      16,
      canvas.clientHeight - 14
    );
  }

  function drawAst(ast, colors) {
    if (!ast) {
      currentViewport = null;
      updateCursor();
      drawStaticGrid(colors);
      drawNoData(colors, "Type Kin script to preview family tree");
      return;
    }

    if (ast.errors?.length) {
      currentViewport = null;
      updateCursor();
      drawStaticGrid(colors);
      drawNoData(colors, "Parse errors found");
      ctx.fillStyle = colors.error;
      ctx.font = "500 13px IBM Plex Sans, Segoe UI, sans-serif";
      ctx.fillText(ast.errors[0].message, 20, 52);
      return;
    }

    drawTree(ast, colors);

    if (ast.warnings?.length) {
      ctx.fillStyle = colors.warning;
      ctx.font = "500 13px IBM Plex Sans, Segoe UI, sans-serif";
      const warning = ast.warnings[0];
      ctx.fillText(warning.message, 20, 24);

      const repeatedDescendantsByPath = warning?.details?.repeatedDescendantsByPath || [];
      const mergedDescendants = warning?.details?.mergedDescendants || [];
      const duplicateLabels = warning?.details?.duplicateLabels || [];
      let rootCauseLine = "";

      if (mergedDescendants.length) {
        const mergedSummary = mergedDescendants
          .map((entry) => `${entry.label} has multiple parents (${entry.parentLabels.join(", ")})`)
          .join("; ");
        rootCauseLine = `Root cause: possible duplicate identity merge -> ${mergedSummary}`;
      } else if (repeatedDescendantsByPath.length) {
        const repeatedSummary = repeatedDescendantsByPath
          .map((entry) => `${entry.label} (id ${entry.id}) via ${entry.pathCount} paths`)
          .join("; ");
        rootCauseLine = `Root cause: repeated descendants via multiple paths -> ${repeatedSummary}`;
      } else if (duplicateLabels.length) {
        const duplicateSummary = duplicateLabels
          .map((entry) => `${entry.label} x${entry.ids.length} (ids: ${entry.ids.join(",")})`)
          .join("; ");
        rootCauseLine = `Root cause: duplicate descendant labels -> ${duplicateSummary}`;
      }

      if (rootCauseLine) {
        ctx.font = "500 12px IBM Plex Sans, Segoe UI, sans-serif";
        ctx.fillText(rootCauseLine, 20, 40);
      }
    }
  }

  function redraw() {
    resizeCanvasToDisplaySize();
    const colors = getThemeColors();
    drawBackground(colors);
    drawAst(currentAst, colors);
  }

  function render(ast) {
    currentAst = ast;
    redraw();
  }

  function releaseToNextState() {
    if (viewState.activePointers.size >= 2) {
      beginPinch();
      return "pinching";
    }

    viewState.pinchLastMidpoint = null;
    if (viewState.activePointers.size === 1) {
      const [pointerId, point] = [...viewState.activePointers.entries()][0];
      startPanning(pointerId, point);
      return "panning";
    }

    viewState.pointerId = null;
    return "idle";
  }

  const interactionFSM = FSM({
    "idle:POINTER_DOWN": (event) => {
      if (!canHandlePointer(event)) return "idle";

      const point = canvasPointFromEvent(event);
      viewState.activePointers.set(event.pointerId, point);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();

      if (viewState.activePointers.size >= 2) {
        beginPinch();
        return "pinching";
      }

      startPanning(event.pointerId, point);
      return "panning";
    },
    "idle:POINTER_MOVE": () => "idle",
    "idle:POINTER_UP": () => "idle",
    "idle:POINTER_CANCEL": () => "idle",

    "panning:POINTER_DOWN": (event) => {
      if (!canHandlePointer(event)) return "panning";

      const point = canvasPointFromEvent(event);
      viewState.activePointers.set(event.pointerId, point);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();

      if (viewState.activePointers.size >= 2) {
        beginPinch();
        return "pinching";
      }

      return "panning";
    },
    "panning:POINTER_MOVE": (event) => {
      if (!viewState.activePointers.has(event.pointerId)) return "panning";
      if (event.pointerId !== viewState.pointerId) return "panning";

      const point = canvasPointFromEvent(event);
      viewState.activePointers.set(event.pointerId, point);

      const dx = point.x - viewState.lastX;
      const dy = point.y - viewState.lastY;

      viewState.panX += dx;
      viewState.panY += dy;
      viewState.lastX = point.x;
      viewState.lastY = point.y;
      redraw();

      return "panning";
    },
    "panning:POINTER_UP": (event) => {
      teardownPointer(event);
      return releaseToNextState();
    },
    "panning:POINTER_CANCEL": (event) => {
      teardownPointer(event);
      return releaseToNextState();
    },

    "pinching:POINTER_DOWN": (event) => {
      if (!canHandlePointer(event)) return "pinching";

      const point = canvasPointFromEvent(event);
      viewState.activePointers.set(event.pointerId, point);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      beginPinch();
      return "pinching";
    },
    "pinching:POINTER_MOVE": (event) => {
      if (!viewState.activePointers.has(event.pointerId)) return "pinching";

      const point = canvasPointFromEvent(event);
      viewState.activePointers.set(event.pointerId, point);
      if (viewState.activePointers.size < 2) return "pinching";

      const pointers = [...viewState.activePointers.values()];
      const distance = Math.max(1, pointerDistance(pointers[0], pointers[1]));
      const midpoint = pointerMidpoint(pointers[0], pointers[1]);
      const previousMidpoint = viewState.pinchLastMidpoint || midpoint;

      const zoomFactor = distance / Math.max(1, viewState.pinchStartDistance);
      const nextZoom = viewState.pinchStartZoom * zoomFactor;

      if (applyPinchTransform(previousMidpoint, midpoint, nextZoom)) {
        redraw();
      }

      viewState.pinchLastMidpoint = midpoint;
      event.preventDefault();
      return "pinching";
    },
    "pinching:POINTER_UP": (event) => {
      teardownPointer(event);
      return releaseToNextState();
    },
    "pinching:POINTER_CANCEL": (event) => {
      teardownPointer(event);
      return releaseToNextState();
    },
  }, "idle");

  function dispatchPointerEvent(eventName, event) {
    const nextState = interactionFSM.call(eventName, event);
    setInteractionFlags(nextState);
  }

  function handleWheel(event) {
    if (!currentViewport) return;
    event.preventDefault();

    const point = canvasPointFromEvent(event);
    const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = clamp(viewState.zoom * zoomFactor, viewState.minZoom, viewState.maxZoom);
    if (applyZoomAtPoint(point, nextZoom)) {
      redraw();
    }
  }

  function handleDoubleClick(event) {
    if (!currentViewport) return;
    if (event.button !== 0) return;
    resetView();
    redraw();
  }

  window.addEventListener("resize", redraw);
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (event) => dispatchPointerEvent("POINTER_DOWN", event));
  window.addEventListener("pointermove", (event) => dispatchPointerEvent("POINTER_MOVE", event));
  window.addEventListener("pointerup", (event) => dispatchPointerEvent("POINTER_UP", event));
  window.addEventListener("pointercancel", (event) => dispatchPointerEvent("POINTER_CANCEL", event));
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("dblclick", handleDoubleClick);

  return {
    redraw,
    render,
  };
}