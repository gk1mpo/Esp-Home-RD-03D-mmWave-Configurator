// radar-transform.js
export class RadarTransform {
  constructor({
    origin = { x: 0, y: 0 },
    scale = 72,
    theta = 0,
    maxRange = 6,
    fanAngle = Math.PI / 3, // 60° default
    dpiScale = window.devicePixelRatio || 1,
    canvasWidth = 0,
    canvasHeight = 0
  } = {}) {
    this.origin = origin;
    this.scale = scale;
    this.theta = theta;
    this.maxRange = maxRange;
    this.fanAngle = fanAngle;
    this.dpiScale = dpiScale;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this._listeners = new Set();
  }

  // === Reactive system ===
  onChange(cb) { this._listeners.add(cb); }
  offChange(cb) { this._listeners.delete(cb); }
  _emitChange() { for (const cb of this._listeners) cb(this); }

  // === Mutators ===
  setOrigin(x, y) { this.origin = { x, y }; this._emitChange(); }
  setScale(pxPerMeter) { this.scale = pxPerMeter; this._emitChange(); }
  setAngle(deg) { this.theta = deg * Math.PI / 180; this._emitChange(); }
  setMaxRange(m) { this.maxRange = m; this._emitChange(); }
  setCanvasSize(w, h) { this.canvasWidth = w; this.canvasHeight = h; this._emitChange(); }
  setDpiScale(ratio) { this.dpiScale = ratio; this._emitChange(); }

  // === Geometry conversions ===
  toCanvas(x, y) {
    const cosT = Math.cos(this.theta);
    const sinT = Math.sin(this.theta);
    const rx = (x * cosT - y * sinT) * this.scale;
    const ry = (x * sinT + y * cosT) * this.scale;
    return {
      x: this.origin.x + rx,
      y: this.origin.y + ry
    };
  }

  toWorld(px, py) {
    const relX = px - this.origin.x;
    const relY = py - this.origin.y;
    const sx = relX / this.scale;
    const sy = relY / this.scale;
    const cosT = Math.cos(this.theta);
    const sinT = Math.sin(this.theta);
    return {
      x: sx * cosT + sy * sinT,
      y: -sx * sinT + sy * cosT
    };
  }
}