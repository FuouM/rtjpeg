/**
 * flowCanvas.ts — Custom flow direction drawing pad for LK Mosh override.
 *
 * The user draws any stroke (straight or curved) on a square canvas.
 * The net displacement from stroke-start → stroke-end is normalised to −1…+1
 * on each axis and fed into the shader as a per-frame custom flow vector,
 * bypassing the per-block Lucas-Kanade solve.
 */

export interface FlowState {
  /** When false, the shader uses its own LK-computed flow (default). */
  useCustomFlow: boolean;
  /** Normalised horizontal displacement −1 (left) … +1 (right). */
  flowX: number;
  /** Normalised vertical displacement −1 (up) … +1 (down). */
  flowY: number;
}

// ─── colours ────────────────────────────────────────────────────────────────
const C_BG = "#0a0a0a";
const C_GRID = "rgba(255,255,255,0.07)";
const C_CROSSHAIR = "rgba(255,255,255,0.18)";
const C_STROKE = "#2eff46";
const C_ARROW = "#ffffff";
const C_DOT = "#ff2e46";
const C_LABEL_ON = "#2eff46";
const C_LABEL_OFF = "rgba(255,255,255,0.35)";

// ─── state ───────────────────────────────────────────────────────────────────
let _canvas: HTMLCanvasElement;
let _ctx: CanvasRenderingContext2D;
let _toggle: HTMLButtonElement;
let _clearBtn: HTMLButtonElement;
let _labelEl: HTMLElement;
let _onChangeCb: (s: FlowState) => void;

let _useCustom = false;
let _flowX = 0;
let _flowY = 0;

/** Raw stroke points in CSS-pixel space (before DPR scaling). */
let _stroke: { x: number; y: number }[] = [];
let _pointerDown = false;

// ─── public API ──────────────────────────────────────────────────────────────

export function initFlowCanvas(
  canvasEl: HTMLCanvasElement,
  toggleBtn: HTMLButtonElement,
  clearBtn: HTMLButtonElement,
  labelEl: HTMLElement,
  onChange: (state: FlowState) => void,
): void {
  _canvas = canvasEl;
  _ctx = canvasEl.getContext("2d")!;
  _toggle = toggleBtn;
  _clearBtn = clearBtn;
  _labelEl = labelEl;
  _onChangeCb = onChange;

  _syncToggleUI();
  _redraw();
  _updateLabel();

  // Resize observer keeps the canvas buffer crisp on DPR change / layout change.
  const ro = new ResizeObserver(() => _redraw());
  ro.observe(_canvas);

  // ── pointer events ───────────────────────────────────────────────────────
  _canvas.addEventListener("pointerdown", (e) => {
    if (!_useCustom) return;
    e.preventDefault();
    _canvas.setPointerCapture(e.pointerId);
    _pointerDown = true;
    _stroke = [_cssPos(e)];
    _redraw();
  });

  _canvas.addEventListener("pointermove", (e) => {
    if (!_pointerDown) return;
    e.preventDefault();
    _stroke.push(_cssPos(e));
    _redraw();
  });

  const endStroke = (e: PointerEvent) => {
    if (!_pointerDown) return;
    e.preventDefault();
    _pointerDown = false;
    if (_stroke.length >= 2) {
      _computeFlow();
    }
    _redraw();
    _updateLabel();
    _emit();
  };
  _canvas.addEventListener("pointerup", endStroke);
  _canvas.addEventListener("pointercancel", endStroke);

  // ── buttons ──────────────────────────────────────────────────────────────
  _toggle.addEventListener("click", () => {
    _useCustom = !_useCustom;
    _syncToggleUI();
    _redraw();
    _updateLabel();
    _emit();
  });

  _clearBtn.addEventListener("click", () => {
    _stroke = [];
    _flowX = 0;
    _flowY = 0;
    _redraw();
    _updateLabel();
    if (_useCustom) _emit();
  });
}

/**
 * Returns a snapshot of the current flow state — safe to call every frame.
 */
export function getFlowState(): FlowState {
  return { useCustomFlow: _useCustom, flowX: _flowX, flowY: _flowY };
}

// ─── internals ───────────────────────────────────────────────────────────────

function _cssPos(e: PointerEvent): { x: number; y: number } {
  const r = _canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Compute net flow from current stroke (first→last, normalised to canvas). */
function _computeFlow() {
  if (_stroke.length < 2) {
    _flowX = 0;
    _flowY = 0;
    return;
  }
  const first = _stroke[0];
  const last = _stroke[_stroke.length - 1];
  const r = _canvas.getBoundingClientRect();
  const w = r.width || _canvas.clientWidth || 1;
  const h = r.height || _canvas.clientHeight || 1;
  // Raw linear normalised: +1 = full width right, −1 = left.
  const rawX = Math.max(-1, Math.min(1, ((last.x - first.x) / w) * 2));
  const rawY = Math.max(-1, Math.min(1, ((last.y - first.y) / h) * 2));

  // Apply a magnitude curve: fine control near center, fast near edges.
  // flow = raw * min(1, |raw|) — quadratic in |raw| for |raw|≤1, linear past the unit circle.
  const mag = Math.sqrt(rawX * rawX + rawY * rawY);
  if (mag > 0) {
    const curve = Math.min(1.0, mag); // 0..1
    _flowX = rawX * curve;
    _flowY = rawY * curve;
  } else {
    _flowX = 0;
    _flowY = 0;
  }
}

function _emit() {
  _onChangeCb({ useCustomFlow: _useCustom, flowX: _flowX, flowY: _flowY });
}

/**
 * For output flow magnitude F = |flow|, returns normalized radius R where
 * u²+v²=R² (u=2Δx/w, v=2Δy/h) so that |flow| is constant on that contour:
 * F=R² when R≤1, F=R when R>1 (max F=√2 at square corners).
 */
function _normRadiusForOutputMag(F: number): number {
  if (F <= 0) return 0;
  if (F <= 1) return Math.sqrt(F);
  return Math.min(F, Math.SQRT2);
}

function _syncToggleUI() {
  if (_useCustom) {
    _toggle.textContent = "Draw Flow";
    _toggle.style.backgroundColor = "#2eff46";
    _toggle.style.color = "#000";
    _canvas.style.cursor = "crosshair";
    _canvas.style.pointerEvents = "auto";
  } else {
    _toggle.textContent = "Auto Flow";
    _toggle.style.backgroundColor = "";
    _toggle.style.color = "";
    _canvas.style.cursor = "default";
    _canvas.style.pointerEvents = "none";
  }
}

function _updateLabel() {
  if (!_useCustom || (_flowX === 0 && _flowY === 0)) {
    _labelEl.textContent = "— — —";
    _labelEl.style.color = C_LABEL_OFF;
    return;
  }
  const fx =
    _flowX >= 0 ? `→ ${_flowX.toFixed(2)}` : `← ${(-_flowX).toFixed(2)}`;
  const fy =
    _flowY >= 0 ? `↓ ${_flowY.toFixed(2)}` : `↑ ${(-_flowY).toFixed(2)}`;
  _labelEl.textContent = `${fx}  ${fy}`;
  _labelEl.style.color = C_LABEL_ON;
}

// ─── drawing ─────────────────────────────────────────────────────────────────

function _redraw() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = _canvas.clientWidth || 100;
  const cssH = _canvas.clientHeight || 100;
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);

  if (_canvas.width !== pw || _canvas.height !== ph) {
    _canvas.width = pw;
    _canvas.height = ph;
  }

  const ctx = _ctx;
  ctx.save();
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, cssW, cssH);

  // Radial grid lines
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 0.5;
  const cx = cssW / 2;
  const cy = cssH / 2;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 8) {
    ctx.beginPath();
    const dx = Math.cos(angle) * Math.max(cssW, cssH);
    const dy = Math.sin(angle) * Math.max(cssW, cssH);
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }

  // Concentric iso-|flow| contours (inverse of flow = raw * min(1, |raw|)).
  const isoLevels = [0.25, 0.5, 0.75, 1, 1.2, Math.SQRT2];
  for (let i = 0; i < isoLevels.length; i++) {
    const F = isoLevels[i];
    const Rn = _normRadiusForOutputMag(F);
    if (Rn <= 0) continue;
    ctx.beginPath();
    ctx.ellipse(cx, cy, (Rn * cssW) / 2, (Rn * cssH) / 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = F === 1 ? "rgba(255,255,255,0.11)" : C_GRID;
    ctx.stroke();
  }
  ctx.strokeStyle = C_GRID;

  // Crosshair
  ctx.strokeStyle = C_CROSSHAIR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, cssH);
  ctx.moveTo(0, cy);
  ctx.lineTo(cssW, cy);
  ctx.stroke();

  // Outer border ring (inner edge glow)
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, cssW - 2, cssH - 2);

  // Inactive dim overlay
  if (!_useCustom) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("AUTO MODE", cx, cy - 5);
    ctx.font = "8px monospace";
    ctx.fillText("click DRAW to paint", cx, cy + 8);
    ctx.restore();
    return;
  }

  // Draw stroke
  if (_stroke.length >= 2) {
    ctx.strokeStyle = C_STROKE;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(_stroke[0].x, _stroke[0].y);
    for (const p of _stroke) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Start dot
    ctx.fillStyle = C_STROKE;
    ctx.beginPath();
    ctx.arc(_stroke[0].x, _stroke[0].y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // End dot
    ctx.fillStyle = C_DOT;
    ctx.beginPath();
    ctx.arc(
      _stroke[_stroke.length - 1].x,
      _stroke[_stroke.length - 1].y,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Net flow arrow from centre
  if (_flowX !== 0 || _flowY !== 0) {
    const arrowLen = Math.min(cssW, cssH) * 0.38;
    const ex = cx + _flowX * arrowLen;
    const ey = cy + _flowY * arrowLen;
    const angle = Math.atan2(_flowY, _flowX);
    const headLen = 10;

    ctx.strokeStyle = C_ARROW;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // arrowhead
    ctx.fillStyle = C_ARROW;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(
      ex - headLen * Math.cos(angle - 0.45),
      ey - headLen * Math.sin(angle - 0.45),
    );
    ctx.lineTo(
      ex - headLen * Math.cos(angle + 0.45),
      ey - headLen * Math.sin(angle + 0.45),
    );
    ctx.closePath();
    ctx.fill();

    // centre circle
    ctx.strokeStyle = C_ARROW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // "draw here" cue
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("draw a direction", cx, cy + cssH * 0.36);
  }

  ctx.restore();
}
