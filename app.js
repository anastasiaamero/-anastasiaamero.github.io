const canvas = document.querySelector("#editorCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const curveCanvas = document.querySelector("#curveCanvas");
const curveCtx = curveCanvas.getContext("2d");

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const emptyState = document.querySelector("#emptyState");
const brushCursor = document.querySelector("#brushCursor");
const modeTip = document.querySelector("#modeTip");
const toolHint = document.querySelector("#toolHint");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const zoomLabel = document.querySelector("#zoomLabel");

const working = document.createElement("canvas");
const wctx = working.getContext("2d", { willReadFrequently: true });
const original = document.createElement("canvas");
const octx = original.getContext("2d", { willReadFrequently: true });
const adjusted = document.createElement("canvas");
const actx = adjusted.getContext("2d", { willReadFrequently: true });

const state = {
  hasImage: false,
  previewScale: 1,
  tool: "pan",
  brush: 34,
  softness: 72,
  strength: 82,
  zoom: 1,
  fitZoom: 1,
  offsetX: 0,
  offsetY: 0,
  painting: false,
  panning: false,
  renderPending: false,
  adjustmentRenderTimer: null,
  adjustmentsDirty: true,
  stageWidth: 0,
  stageHeight: 0,
  spaceDown: false,
  altDown: false,
  panStart: null,
  cloneSource: null,
  cloneDelta: null,
  patchPath: [],
  patchSelection: null,
  patchDrag: null,
  lastPoint: null,
  undo: [],
  redo: [],
  curve: "linear",
  adjustments: {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    colorRange: "reds",
    selectiveHue: 0,
    selectiveSat: 0,
    selectiveLight: 0,
    grainLight: 35,
    grainDark: 35,
    grainSize: 2,
    grainOpacity: 0
  }
};

const toolCopy = {
  pan: ["двигай фото", "Перетаскивай фото мышью. Колесо приближает к месту под курсором."],
  heal: ["кликни по прыщику", "Волшебная кисть берет кожу вокруг пятна и мягко смешивает ее в центре."],
  patch: ["обведи зону", "Обведи участок пунктиром, затем перетащи выделение на чистое место для замены."],
  clone: ["Alt + клик: источник", "Зажми Alt/Option и кликни по чистому участку, потом рисуй штампом по нужному месту."],
  smooth: ["проведи по коже", "Смягчение аккуратно размывает мелкую текстуру внутри кисти."]
};

const ranges = {
  reds: [340, 18],
  oranges: [18, 48],
  yellows: [48, 72],
  greens: [72, 165],
  blues: [175, 255],
  magentas: [285, 340]
};

const colorRangeOptions = [
  ["reds", "Красные"],
  ["oranges", "Оранжевые"],
  ["yellows", "Желтые"],
  ["greens", "Зеленые"],
  ["blues", "Синие"],
  ["magentas", "Пурпурные"]
];

document.querySelectorAll(".tool").forEach((button) => {
  button.addEventListener("click", () => {
    state.tool = button.dataset.tool;
    state.cloneSource = null;
    state.cloneDelta = null;
    clearPatchSelection();
    document.querySelectorAll(".tool").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    updateGuidance();
    updateCursor();
  });
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`[data-panel="${button.dataset.tab}"]`).classList.add("active");
    if (button.dataset.tab === "grain") {
      modeTip.textContent = "Настраивай зерно ползунками. Оно попадет в скачанный файл.";
    } else {
      updateGuidance();
    }
  });
});

bindRange("brushSize", "brush", "brushSizeValue", false);
bindRange("softness", "softness", "softnessValue", false);
bindRange("strength", "strength", "strengthValue", false);
["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "selectiveHue", "selectiveSat", "selectiveLight", "grainLight", "grainDark", "grainSize", "grainOpacity"].forEach((key) => {
  bindRange(key, key, `${key}Value`, true);
});

document.querySelector("#colorRange").addEventListener("input", (event) => {
  const option = colorRangeOptions[Number(event.target.value)] || colorRangeOptions[0];
  state.adjustments.colorRange = option[0];
  document.querySelector("#colorRangeValue").textContent = option[1];
  state.adjustmentsDirty = true;
  requestAdjustmentRender();
});

document.querySelectorAll("[data-curve]").forEach((button) => {
  button.addEventListener("click", () => {
    state.curve = button.dataset.curve;
    drawCurve();
    state.adjustmentsDirty = true;
    requestAdjustmentRender();
  });
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) loadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) loadFile(file);
});

canvas.addEventListener("pointerdown", (event) => {
  if (!state.hasImage) return;
  canvas.setPointerCapture(event.pointerId);
  const point = eventToImage(event);
  const shouldPan = state.tool === "pan" || state.spaceDown || event.button === 1;
  if (shouldPan) {
    state.panning = true;
    state.panStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: state.offsetX,
      offsetY: state.offsetY
    };
    updateCursor();
    return;
  }
  if (!insideImage(point.x, point.y)) return;
  if (state.tool === "patch") {
    if (state.patchSelection && pointInPatchSelection(point)) {
      state.patchDrag = {
        start: point,
        dx: 0,
        dy: 0
      };
      updateGuidance("тащи на чистый участок");
      requestRender();
      return;
    }
    beginPatchSelection(point);
    return;
  }
  if (state.tool === "clone" && event.altKey) {
    setCloneSource(point);
    updateBrushCursor(event, point);
    return;
  }
  if (state.tool === "clone" && !state.cloneSource) {
    setCloneSource(point);
    return;
  }
  state.painting = true;
  state.lastPoint = point;
  pushUndo();
  useTool(point, true);
});

canvas.addEventListener("pointermove", (event) => {
  const point = eventToImage(event);
  updateBrushCursor(event, point);
  if (!state.hasImage) return;
  if (state.panning && state.panStart) {
    state.offsetX = state.panStart.offsetX + event.clientX - state.panStart.x;
    state.offsetY = state.panStart.offsetY + event.clientY - state.panStart.y;
    requestRender();
    updateBrushCursor(event, eventToImage(event));
    return;
  }
  if (state.patchDrag) {
    state.patchDrag.dx = point.x - state.patchDrag.start.x;
    state.patchDrag.dy = point.y - state.patchDrag.start.y;
    requestRender();
    return;
  }
  if (!state.painting) return;
  if (!insideImage(point.x, point.y)) return;
  if (state.tool === "patch") {
    updatePatchSelection(point);
    return;
  }
  useTool(point, false);
  state.lastPoint = point;
});

canvas.addEventListener("pointerup", () => {
  if (state.patchDrag) {
    finishPatchDrag();
  } else if (state.tool === "patch" && state.painting) {
    finishPatchSelection();
  }
  state.painting = false;
  state.panning = false;
  state.panStart = null;
  state.lastPoint = null;
  updateCursor();
});

canvas.addEventListener("pointercancel", () => {
  state.patchDrag = null;
  state.patchPath = [];
  state.painting = false;
  state.panning = false;
  state.panStart = null;
  state.lastPoint = null;
  updateCursor();
});

canvas.addEventListener("pointerleave", () => {
  brushCursor.hidden = true;
});

canvas.addEventListener("wheel", (event) => {
  if (!state.hasImage) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(state.zoom * factor, event.clientX, event.clientY);
}, { passive: false });

document.querySelector("#undoBtn").addEventListener("click", undo);
document.querySelector("#redoBtn").addEventListener("click", redo);
document.querySelector("#resetBtn").addEventListener("click", resetAll);
document.querySelector("#exportBtn").addEventListener("click", exportImage);
document.querySelector("#applyAdjustBtn").addEventListener("click", applyAdjustments);
document.querySelector("#zoomInBtn").addEventListener("click", () => setZoom(state.zoom * 1.18));
document.querySelector("#zoomOutBtn").addEventListener("click", () => setZoom(state.zoom / 1.18));
document.querySelector("#fitBtn").addEventListener("click", fitToScreen);
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, button")) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    state.spaceDown = true;
  }
  if (event.key === "Alt") {
    state.altDown = true;
  }
  updateCursor();
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    state.spaceDown = false;
    state.panning = false;
    state.panStart = null;
  }
  if (event.key === "Alt") {
    state.altDown = false;
  }
  updateCursor();
});
window.addEventListener("resize", () => {
  resizeStage();
  requestRender();
});

function bindRange(id, key, outputId, isAdjustment) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${outputId}`);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (isAdjustment) {
      state.adjustments[key] = value;
      state.adjustmentsDirty = true;
      requestAdjustmentRender();
    } else {
      state[key] = value;
      updateBrushCursor();
    }
    output.textContent = value;
  });
}

function loadFile(file) {
  const image = new Image();
  image.onload = () => {
    working.width = image.naturalWidth;
    working.height = image.naturalHeight;
    original.width = image.naturalWidth;
    original.height = image.naturalHeight;
    state.previewScale = 1;
    adjusted.width = image.naturalWidth;
    adjusted.height = image.naturalHeight;
    octx.clearRect(0, 0, original.width, original.height);
    octx.drawImage(image, 0, 0);
    wctx.clearRect(0, 0, working.width, working.height);
    wctx.drawImage(image, 0, 0);
    state.hasImage = true;
    state.adjustmentsDirty = true;
    state.undo = [];
    state.redo = [];
    resetAdjustmentsOnly();
    emptyState.hidden = true;
    statusTitle.textContent = "Фото готово";
    statusText.textContent = "Сначала двигай фото, потом выбери кисть для ретуши.";
    resizeStage();
    fitToScreen();
    updateGuidance();
    updateCursor();
  };
  image.src = URL.createObjectURL(file);
}

function resizeStage() {
  const rect = dropZone.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.floor(rect.width * ratio));
  const nextHeight = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  state.stageWidth = rect.width;
  state.stageHeight = rect.height;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function fitToScreen() {
  if (!state.hasImage) return;
  const rect = dropZone.getBoundingClientRect();
  const fit = Math.min((rect.width - 42) / working.width, (rect.height - 42) / working.height);
  state.fitZoom = Math.max(0.04, fit);
  state.zoom = state.fitZoom;
  state.offsetX = (rect.width - working.width * state.zoom) / 2;
  state.offsetY = (rect.height - working.height * state.zoom) / 2;
  render();
}

function setZoom(value, screenX, screenY) {
  if (!state.hasImage) return;
  const rect = dropZone.getBoundingClientRect();
  const next = Math.min(8, Math.max(0.05, value));
  const cx = typeof screenX === "number" ? screenX - rect.left : rect.width / 2;
  const cy = typeof screenY === "number" ? screenY - rect.top : rect.height / 2;
  const imageX = (cx - state.offsetX) / state.zoom;
  const imageY = (cy - state.offsetY) / state.zoom;
  state.zoom = next;
  state.offsetX = cx - imageX * state.zoom;
  state.offsetY = cy - imageY * state.zoom;
  requestRender();
}

function eventToImage(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.offsetX) / state.zoom,
    y: (event.clientY - rect.top - state.offsetY) / state.zoom
  };
}

function insideImage(x, y) {
  return x >= 0 && y >= 0 && x < working.width && y < working.height;
}

function useTool(point, firstTouch) {
  if (state.tool === "pan") return;
  if (state.tool === "clone") {
    if (!state.cloneSource) {
      setCloneSource(point);
      return;
    }
    cloneAt(state.cloneSource, point, firstTouch);
  } else if (state.tool === "smooth") {
    smoothAt(point);
  } else {
    healAt(point);
  }
  state.adjustmentsDirty = true;
  requestRender();
}

function setCloneSource(point) {
  state.cloneSource = point;
  state.cloneDelta = null;
  updateGuidance("источник штампа выбран");
  statusTitle.textContent = "Источник штампа выбран";
  statusText.textContent = "Теперь рисуй по месту, которое нужно перекрыть. Чтобы сменить источник, снова зажми Alt/Option и кликни по чистому участку.";
}

function beginPatchSelection(point) {
  state.painting = true;
  state.patchSelection = null;
  state.patchPath = [point];
  updateGuidance("обведи зону");
  statusTitle.textContent = "Рисуй выделение";
  statusText.textContent = "Обведи участок, который хочешь заменить. Когда отпустишь мышь, выделение станет пунктиром.";
  requestRender();
}

function updatePatchSelection(point) {
  const last = state.patchPath[state.patchPath.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
  state.patchPath.push(point);
  requestRender();
}

function finishPatchSelection() {
  if (state.patchPath.length < 6) {
    clearPatchSelection();
    updateGuidance("обведи зону");
    return;
  }
  state.patchSelection = {
    path: state.patchPath.slice(),
    bounds: getPathBounds(state.patchPath)
  };
  state.patchPath = [];
  updateGuidance("перетащи выделение");
  statusTitle.textContent = "Выделение готово";
  statusText.textContent = "Потяни пунктир на чистый участок, которым хочешь заменить выбранную область.";
  requestRender();
}

function finishPatchDrag() {
  const drag = state.patchDrag;
  state.patchDrag = null;
  if (!state.patchSelection || Math.hypot(drag.dx, drag.dy) < 2) {
    requestRender();
    return;
  }
  pushUndo();
  applyPatchSelection(state.patchSelection, drag.dx, drag.dy);
  clearPatchSelection();
  state.adjustmentsDirty = true;
  updateGuidance("обведи новую зону");
  requestRender();
}

function clearPatchSelection() {
  state.patchPath = [];
  state.patchSelection = null;
  state.patchDrag = null;
}

function getPathBounds(path) {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const padding = Math.max(2, state.brush * 0.18);
  return {
    left: clamp(Math.floor(Math.min(...xs) - padding), 0, working.width - 1),
    top: clamp(Math.floor(Math.min(...ys) - padding), 0, working.height - 1),
    right: clamp(Math.ceil(Math.max(...xs) + padding), 0, working.width - 1),
    bottom: clamp(Math.ceil(Math.max(...ys) + padding), 0, working.height - 1)
  };
}

function pointInPatchSelection(point) {
  if (!state.patchSelection) return false;
  const path = state.patchSelection.path;
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i, i += 1) {
    const xi = path[i].x;
    const yi = path[i].y;
    const xj = path[j].x;
    const yj = path[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function applyPatchSelection(selection, dx, dy) {
  const bounds = selection.bounds;
  const width = bounds.right - bounds.left + 1;
  const height = bounds.bottom - bounds.top + 1;
  const target = wctx.getImageData(bounds.left, bounds.top, width, height);
  const sourceLeft = clamp(Math.round(bounds.left + dx), 0, working.width - 1);
  const sourceTop = clamp(Math.round(bounds.top + dy), 0, working.height - 1);
  const sourceRight = clamp(sourceLeft + width - 1, 0, working.width - 1);
  const sourceBottom = clamp(sourceTop + height - 1, 0, working.height - 1);
  const source = wctx.getImageData(sourceLeft, sourceTop, sourceRight - sourceLeft + 1, sourceBottom - sourceTop + 1);
  const mask = createPatchMask(selection, bounds, width, height);
  const originalTarget = new Uint8ClampedArray(target.data);
  const strength = state.strength / 100;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = (mask.data[idx + 3] / 255) * strength;
      if (!alpha) continue;
      const sx = clamp(x, 0, source.width - 1);
      const sy = clamp(y, 0, source.height - 1);
      const sidx = (sy * source.width + sx) * 4;
      target.data[idx] = mix(originalTarget[idx], source.data[sidx], alpha);
      target.data[idx + 1] = mix(originalTarget[idx + 1], source.data[sidx + 1], alpha);
      target.data[idx + 2] = mix(originalTarget[idx + 2], source.data[sidx + 2], alpha);
    }
  }
  wctx.putImageData(target, bounds.left, bounds.top);
}

function createPatchMask(selection, bounds, width, height) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext("2d");
  maskCtx.fillStyle = "#000";
  maskCtx.beginPath();
  selection.path.forEach((point, index) => {
    const x = point.x - bounds.left;
    const y = point.y - bounds.top;
    if (index === 0) maskCtx.moveTo(x, y);
    else maskCtx.lineTo(x, y);
  });
  maskCtx.closePath();
  maskCtx.fill();
  return maskCtx.getImageData(0, 0, width, height);
}

function pushUndo() {
  if (!state.hasImage) return;
  state.undo.push(wctx.getImageData(0, 0, working.width, working.height));
  if (state.undo.length > 24) state.undo.shift();
  state.redo = [];
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(wctx.getImageData(0, 0, working.width, working.height));
  wctx.putImageData(state.undo.pop(), 0, 0);
  state.adjustmentsDirty = true;
  requestRender();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(wctx.getImageData(0, 0, working.width, working.height));
  wctx.putImageData(state.redo.pop(), 0, 0);
  state.adjustmentsDirty = true;
  requestRender();
}

function healAt(point) {
  const radius = state.brush / 2;
  const box = getBrushBox(point, radius * 1.6);
  const source = wctx.getImageData(box.left, box.top, box.width, box.height);
  const data = source.data;
  const local = { x: point.x - box.left, y: point.y - box.top };
  const avg = sampleRing(data, box.width, box.height, local.x, local.y, radius);
  paintPixels(source, local, radius, (idx, alpha) => {
    data[idx] = mix(data[idx], avg.r, alpha * 0.88);
    data[idx + 1] = mix(data[idx + 1], avg.g, alpha * 0.88);
    data[idx + 2] = mix(data[idx + 2], avg.b, alpha * 0.88);
  });
  wctx.putImageData(source, box.left, box.top);
}

function patchAt(sourcePoint, targetPoint) {
  const radius = state.brush / 2;
  const targetBox = getBrushBox(targetPoint, radius);
  const sourceBox = getTranslatedBox(targetBox, sourcePoint.x - targetPoint.x, sourcePoint.y - targetPoint.y);
  const image = wctx.getImageData(targetBox.left, targetBox.top, targetBox.width, targetBox.height);
  const source = wctx.getImageData(sourceBox.left, sourceBox.top, sourceBox.width, sourceBox.height);
  const copy = new Uint8ClampedArray(image.data);
  const local = { x: targetPoint.x - targetBox.left, y: targetPoint.y - targetBox.top };
  paintPixels(image, local, radius, (idx, alpha, x, y) => {
    const gx = targetBox.left + x;
    const gy = targetBox.top + y;
    const sx = clamp(Math.round(gx + sourcePoint.x - targetPoint.x), sourceBox.left, sourceBox.left + sourceBox.width - 1);
    const sy = clamp(Math.round(gy + sourcePoint.y - targetPoint.y), sourceBox.top, sourceBox.top + sourceBox.height - 1);
    const sidx = ((sy - sourceBox.top) * sourceBox.width + (sx - sourceBox.left)) * 4;
    image.data[idx] = mix(copy[idx], source.data[sidx], alpha);
    image.data[idx + 1] = mix(copy[idx + 1], source.data[sidx + 1], alpha);
    image.data[idx + 2] = mix(copy[idx + 2], source.data[sidx + 2], alpha);
  });
  wctx.putImageData(image, targetBox.left, targetBox.top);
}

function cloneAt(sourcePoint, targetPoint, firstTouch) {
  if (firstTouch) state.cloneDelta = { x: sourcePoint.x - targetPoint.x, y: sourcePoint.y - targetPoint.y };
  const radius = state.brush / 2;
  const delta = state.cloneDelta || { x: sourcePoint.x - targetPoint.x, y: sourcePoint.y - targetPoint.y };
  const targetBox = getBrushBox(targetPoint, radius);
  const sourceBox = getTranslatedBox(targetBox, delta.x, delta.y);
  const image = wctx.getImageData(targetBox.left, targetBox.top, targetBox.width, targetBox.height);
  const source = wctx.getImageData(sourceBox.left, sourceBox.top, sourceBox.width, sourceBox.height);
  const copy = new Uint8ClampedArray(image.data);
  const local = { x: targetPoint.x - targetBox.left, y: targetPoint.y - targetBox.top };
  paintPixels(image, local, radius, (idx, alpha, x, y) => {
    const gx = targetBox.left + x;
    const gy = targetBox.top + y;
    const sx = clamp(Math.round(gx + delta.x), sourceBox.left, sourceBox.left + sourceBox.width - 1);
    const sy = clamp(Math.round(gy + delta.y), sourceBox.top, sourceBox.top + sourceBox.height - 1);
    const sidx = ((sy - sourceBox.top) * sourceBox.width + (sx - sourceBox.left)) * 4;
    image.data[idx] = mix(copy[idx], source.data[sidx], alpha);
    image.data[idx + 1] = mix(copy[idx + 1], source.data[sidx + 1], alpha);
    image.data[idx + 2] = mix(copy[idx + 2], source.data[sidx + 2], alpha);
  });
  wctx.putImageData(image, targetBox.left, targetBox.top);
}

function smoothAt(point) {
  const radius = state.brush / 2;
  const box = getBrushBox(point, radius + 3);
  const image = wctx.getImageData(box.left, box.top, box.width, box.height);
  const copy = new Uint8ClampedArray(image.data);
  const local = { x: point.x - box.left, y: point.y - box.top };
  paintPixels(image, local, radius, (idx, alpha, x, y) => {
    const blur = averageNeighborhood(copy, box.width, box.height, x, y, 2);
    image.data[idx] = mix(copy[idx], blur.r, alpha * 0.68);
    image.data[idx + 1] = mix(copy[idx + 1], blur.g, alpha * 0.68);
    image.data[idx + 2] = mix(copy[idx + 2], blur.b, alpha * 0.68);
  });
  wctx.putImageData(image, box.left, box.top);
}

function getBrushBox(point, radius) {
  const left = clamp(Math.floor(point.x - radius), 0, working.width - 1);
  const top = clamp(Math.floor(point.y - radius), 0, working.height - 1);
  const right = clamp(Math.ceil(point.x + radius), 0, working.width - 1);
  const bottom = clamp(Math.ceil(point.y + radius), 0, working.height - 1);
  return {
    left,
    top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
}

function getTranslatedBox(box, dx, dy) {
  const left = clamp(Math.floor(box.left + dx), 0, working.width - 1);
  const top = clamp(Math.floor(box.top + dy), 0, working.height - 1);
  const right = clamp(Math.ceil(box.left + dx + box.width - 1), 0, working.width - 1);
  const bottom = clamp(Math.ceil(box.top + dy + box.height - 1), 0, working.height - 1);
  return {
    left,
    top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1)
  };
}

function paintPixels(image, center, radius, painter) {
  const left = Math.max(0, Math.floor(center.x - radius));
  const right = Math.min(image.width - 1, Math.ceil(center.x + radius));
  const top = Math.max(0, Math.floor(center.y - radius));
  const bottom = Math.min(image.height - 1, Math.ceil(center.y + radius));
  const hardEdge = 1 - state.softness / 100;
  const strength = state.strength / 100;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance > radius) continue;
      const falloff = 1 - smoothstep(hardEdge, 1, distance / radius);
      const alpha = clamp(falloff * strength, 0, 1);
      const idx = (y * image.width + x) * 4;
      painter(idx, alpha, x, y);
    }
  }
}

function sampleRing(data, width, height, cx, cy, radius) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const inner = radius * 1.05;
  const outer = radius * 1.55;
  for (let y = Math.max(0, Math.floor(cy - outer)); y <= Math.min(height - 1, Math.ceil(cy + outer)); y += 2) {
    for (let x = Math.max(0, Math.floor(cx - outer)); x <= Math.min(width - 1, Math.ceil(cx + outer)); x += 2) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance < inner || distance > outer) continue;
      const idx = (y * width + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count += 1;
    }
  }
  return count ? { r: r / count, g: g / count, b: b / count } : { r: 128, g: 128, b: 128 };
}

function averageNeighborhood(data, width, height, cx, cy, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = -size; y <= size; y += 1) {
    for (let x = -size; x <= size; x += 1) {
      const px = clamp(Math.round(cx + x), 0, width - 1);
      const py = clamp(Math.round(cy + y), 0, height - 1);
      const idx = (py * width + px) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count += 1;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
}

function render() {
  const rect = dropZone.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!state.hasImage) {
    drawCurve();
    return;
  }
  if (state.adjustmentsDirty) applyPreviewAdjustments();
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);
  ctx.drawImage(adjusted, 0, 0);
  ctx.restore();
  drawPatchOverlay();
  zoomLabel.textContent = `${Math.round((state.zoom / state.fitZoom) * 100)}%`;
  drawCurve();
  updateCursor();
}

function requestRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    render();
  });
}

function requestAdjustmentRender() {
  clearTimeout(state.adjustmentRenderTimer);
  state.adjustmentRenderTimer = setTimeout(requestRender, 120);
}

function applyPreviewAdjustments() {
  actx.drawImage(working, 0, 0, adjusted.width, adjusted.height);
  if (!hasActiveAdjustments()) {
    state.adjustmentsDirty = false;
    return;
  }
  const image = actx.getImageData(0, 0, adjusted.width, adjusted.height);
  processAdjustmentData(image.data, image.width, image.height, 1);
  actx.putImageData(image, 0, 0);
  state.adjustmentsDirty = false;
}

function applyCurve(r, g, b) {
  const curve = state.curve;
  const map = (value) => {
    const x = value / 255;
    let y = x;
    if (curve === "soft") y = Math.pow(x, 0.94) * 0.98 + 0.012;
    if (curve === "lift") y = Math.pow(x, 0.86) * 0.94 + 0.045;
    if (curve === "contrast") y = 0.5 + (x - 0.5) * 1.16;
    return clamp(y * 255, 0, 255);
  };
  return [map(r), map(g), map(b)];
}

function adjustSaturation(r, g, b, saturation, vibrance) {
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const currentSat = (max - min) / 255;
  const vib = (vibrance / 100) * (1 - currentSat) * 0.9;
  const amount = saturation / 100 + vib;
  return [
    mix(gray, r, 1 + amount),
    mix(gray, g, 1 + amount),
    mix(gray, b, 1 + amount)
  ];
}

function applySelective(r, g, b) {
  const a = state.adjustments;
  if (!a.selectiveHue && !a.selectiveSat && !a.selectiveLight) return [r, g, b];
  let hsl = rgbToHsl(r, g, b);
  const range = ranges[a.colorRange];
  const hit = hueInRange(hsl.h, range[0], range[1]);
  if (!hit) return [r, g, b];
  hsl.h = (hsl.h + a.selectiveHue + 360) % 360;
  hsl.s = clamp(hsl.s + a.selectiveSat / 100, 0, 1);
  hsl.l = clamp(hsl.l + a.selectiveLight / 180, 0, 1);
  return hslToRgb(hsl.h, hsl.s, hsl.l);
}

function applyGrain(r, g, b, x, y) {
  const a = state.adjustments;
  if (!a.grainOpacity) return [r, g, b];
  const size = Math.max(1, a.grainSize);
  const gx = Math.floor(x / size);
  const gy = Math.floor(y / size);
  const noise = hashNoise(gx, gy) - 0.5;
  const light = a.grainLight * 1.8;
  const dark = a.grainDark * 1.8;
  const amount = noise >= 0 ? noise * light : noise * dark;
  const opacity = a.grainOpacity / 100;
  return [
    r + amount * opacity,
    g + amount * opacity,
    b + amount * opacity
  ];
}

function hashNoise(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >> 13), 1274126177);
  n = n ^ (n >> 16);
  return ((n >>> 0) % 10000) / 10000;
}

function hueInRange(hue, start, end) {
  if (start <= end) return hue >= start && hue <= end;
  return hue >= start || hue <= end;
}

function drawCurve() {
  const width = curveCanvas.width;
  const height = curveCanvas.height;
  curveCtx.clearRect(0, 0, width, height);
  curveCtx.fillStyle = "#fff9ef";
  curveCtx.fillRect(0, 0, width, height);
  curveCtx.strokeStyle = "#e1d2c2";
  curveCtx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) {
    const x = (width / 5) * i;
    const y = (height / 5) * i;
    curveCtx.beginPath();
    curveCtx.moveTo(x, 0);
    curveCtx.lineTo(x, height);
    curveCtx.moveTo(0, y);
    curveCtx.lineTo(width, y);
    curveCtx.stroke();
  }
  curveCtx.strokeStyle = "#e95d3c";
  curveCtx.lineWidth = 3;
  curveCtx.beginPath();
  for (let x = 0; x <= width; x += 1) {
    const v = (x / width) * 255;
    const y = height - (applyCurve(v, v, v)[0] / 255) * height;
    if (x === 0) curveCtx.moveTo(x, y);
    else curveCtx.lineTo(x, y);
  }
  curveCtx.stroke();
}

function applyAdjustments() {
  if (!state.hasImage) return;
  if (!hasActiveColorAdjustments()) return;
  pushUndo();
  applyAdjustmentsToCanvas(working);
  resetColorAdjustmentsOnly();
  state.adjustmentsDirty = true;
  requestRender();
}

function applyAdjustmentsToCanvas(targetCanvas) {
  const targetCtx = targetCanvas.getContext("2d", { willReadFrequently: true });
  const image = targetCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  processAdjustmentData(image.data, image.width, image.height, 1, false);
  targetCtx.putImageData(image, 0, 0);
}

function createFullAdjustedCanvas() {
  const output = document.createElement("canvas");
  output.width = working.width;
  output.height = working.height;
  const outputCtx = output.getContext("2d", { willReadFrequently: true });
  outputCtx.drawImage(working, 0, 0);
  if (!hasActiveAdjustments()) return output;
  const image = outputCtx.getImageData(0, 0, output.width, output.height);
  processAdjustmentData(image.data, image.width, image.height, 1);
  outputCtx.putImageData(image, 0, 0);
  return output;
}

function processAdjustmentData(data, width, height, coordScale, includeGrain = true) {
  const a = state.adjustments;
  for (let i = 0; i < data.length; i += 4) {
    const pixel = i / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    r += a.exposure * 1.4 + a.temperature * 0.42 + a.tint * 0.12;
    g += a.exposure * 1.4 - a.tint * 0.18;
    b += a.exposure * 1.4 - a.temperature * 0.42 + a.tint * 0.26;
    const contrast = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));
    r = contrast * (r - 128) + 128;
    g = contrast * (g - 128) + 128;
    b = contrast * (b - 128) + 128;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const highMask = smoothstep(126, 255, luma);
    const shadowMask = 1 - smoothstep(0, 130, luma);
    r += a.highlights * highMask * 0.8 + a.shadows * shadowMask * 0.75;
    g += a.highlights * highMask * 0.8 + a.shadows * shadowMask * 0.75;
    b += a.highlights * highMask * 0.8 + a.shadows * shadowMask * 0.75;
    [r, g, b] = applyCurve(r, g, b);
    [r, g, b] = adjustSaturation(r, g, b, a.saturation, a.vibrance);
    [r, g, b] = applySelective(r, g, b);
    if (includeGrain) [r, g, b] = applyGrain(r, g, b, x * coordScale, y * coordScale);
    data[i] = clamp(r, 0, 255);
    data[i + 1] = clamp(g, 0, 255);
    data[i + 2] = clamp(b, 0, 255);
  }
}

function hasActiveAdjustments() {
  return hasActiveColorAdjustments() || state.adjustments.grainOpacity > 0;
}

function hasActiveColorAdjustments() {
  return state.curve !== "linear"
    || Object.entries(state.adjustments).some(([key, value]) => {
      if (key === "colorRange") return false;
      if (key.startsWith("grain")) return false;
      return value !== 0;
    });
}

function resetAdjustmentsOnly() {
  Object.keys(state.adjustments).forEach((key) => {
    state.adjustments[key] = defaultAdjustmentValue(key);
  });
  document.querySelector("#colorRange").value = 0;
  document.querySelector("#colorRangeValue").textContent = colorRangeOptions[0][1];
  document.querySelectorAll(".adjust-panel input[type='range']").forEach((input) => {
    if (input.id === "colorRange") return;
    input.value = defaultAdjustmentValue(input.id);
    const output = document.querySelector(`#${input.id}Value`);
    if (output) output.textContent = input.value;
  });
  state.curve = "linear";
}

function resetColorAdjustmentsOnly() {
  Object.keys(state.adjustments).forEach((key) => {
    if (key === "colorRange" || key.startsWith("grain")) return;
    state.adjustments[key] = 0;
    const input = document.querySelector(`#${key}`);
    const output = document.querySelector(`#${key}Value`);
    if (input) input.value = 0;
    if (output) output.textContent = "0";
  });
  state.curve = "linear";
}

function defaultAdjustmentValue(key) {
  if (key === "colorRange") return "reds";
  if (key === "grainLight") return 35;
  if (key === "grainDark") return 35;
  if (key === "grainSize") return 2;
  return 0;
}

function resetAll() {
  if (!state.hasImage) return;
  pushUndo();
  resetAdjustmentsOnly();
  wctx.clearRect(0, 0, working.width, working.height);
  wctx.drawImage(original, 0, 0);
  state.adjustmentsDirty = true;
  requestRender();
}

function exportImage() {
  if (!state.hasImage) return;
  const output = createFullAdjustedCanvas();
  const link = document.createElement("a");
  link.download = "retouch-clicky-export.png";
  link.href = output.toDataURL("image/png");
  link.click();
}

function updateGuidance(custom) {
  const copy = toolCopy[state.tool];
  toolHint.textContent = custom || copy[0];
  modeTip.textContent = copy[1];
  if (!state.hasImage) return;
  statusText.textContent = state.tool === "pan"
    ? "Перетаскивай фото. При зуме колесо приближает к курсору."
    : "Круг показывает размер кисти. Для перемещения зажми пробел.";
}

function updateCursor() {
  const patchPicking = state.hasImage && state.tool === "patch" && !state.spaceDown && !state.panning && !state.patchDrag;
  const brushing = state.hasImage && isBrushTool() && !state.spaceDown && !state.panning;
  const customCursor = brushing || patchPicking;
  canvas.classList.toggle("brushing", customCursor);
  canvas.classList.toggle("panning", state.panning);
  brushCursor.classList.toggle("source-pick", brushing && state.tool === "clone" && state.altDown);
  brushCursor.classList.toggle("patch-pen", patchPicking);
  if (!customCursor) brushCursor.hidden = true;
}

function updateBrushCursor(event, point) {
  const patchPicking = state.hasImage && state.tool === "patch" && !state.spaceDown && !state.panning && !state.patchDrag;
  const brushing = state.hasImage && isBrushTool() && !state.spaceDown && !state.panning;
  const customCursor = brushing || patchPicking;
  if (!customCursor || !event || !point || !insideImage(point.x, point.y)) {
    brushCursor.hidden = true;
    return;
  }
  const rect = dropZone.getBoundingClientRect();
  const size = patchPicking ? 34 : Math.max(8, state.brush * state.zoom);
  const sourcePick = state.tool === "clone" && (state.altDown || event.altKey);
  brushCursor.hidden = false;
  brushCursor.classList.toggle("source-pick", sourcePick);
  brushCursor.classList.toggle("patch-pen", patchPicking);
  brushCursor.style.width = `${size}px`;
  brushCursor.style.height = `${size}px`;
  brushCursor.style.transform = `translate(${event.clientX - rect.left - size / 2}px, ${event.clientY - rect.top - size / 2}px)`;
}

function isBrushTool() {
  return state.tool === "heal" || state.tool === "clone" || state.tool === "smooth";
}

function drawPatchOverlay() {
  if (state.tool !== "patch") return;
  const livePath = state.patchPath.length ? state.patchPath : null;
  const selectedPath = state.patchSelection ? state.patchSelection.path : null;
  if (!livePath && !selectedPath) return;
  ctx.save();
  if (livePath) drawImagePath(livePath, 0, 0, false, "#fffaf0", "#25221f", "rgba(233, 93, 60, 0.08)");
  if (selectedPath) {
    drawImagePath(selectedPath, 0, 0, true, "#fffaf0", "#25221f", "rgba(255, 250, 240, 0.22)");
    if (state.patchDrag) {
      drawImagePath(selectedPath, state.patchDrag.dx, state.patchDrag.dy, true, "#fffaf0", "#e95d3c", "rgba(233, 93, 60, 0.24)");
      drawPatchLink(state.patchSelection.bounds, state.patchDrag.dx, state.patchDrag.dy);
    }
  }
  ctx.restore();
}

function drawImagePath(path, dx, dy, closed, halo, stroke, fill) {
  ctx.fillStyle = fill;
  traceImagePath(path, dx, dy);
  if (closed) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = halo;
  ctx.stroke();
  ctx.setLineDash([9, 5]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  traceImagePath(path, dx, dy);
  if (closed) ctx.closePath();
  ctx.stroke();
}

function traceImagePath(path, dx, dy) {
  ctx.beginPath();
  path.forEach((point, index) => {
    const screenX = state.offsetX + (point.x + dx) * state.zoom;
    const screenY = state.offsetY + (point.y + dy) * state.zoom;
    if (index === 0) ctx.moveTo(screenX, screenY);
    else ctx.lineTo(screenX, screenY);
  });
}

function drawPatchLink(bounds, dx, dy) {
  const fromX = state.offsetX + ((bounds.left + bounds.right) / 2) * state.zoom;
  const fromY = state.offsetY + ((bounds.top + bounds.bottom) / 2) * state.zoom;
  const toX = state.offsetX + ((bounds.left + bounds.right) / 2 + dx) * state.zoom;
  const toY = state.offsetY + ((bounds.top + bounds.bottom) / 2 + dy) * state.zoom;
  ctx.setLineDash([4, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fffaf0";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.setLineDash([2, 7]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#e95d3c";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    if (max === g) h = (b - r) / d + 2;
    if (max === b) h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

resizeStage();
drawCurve();
updateGuidance();
