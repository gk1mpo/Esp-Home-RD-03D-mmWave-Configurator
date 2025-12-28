// radar-transform.js
export class RadarTransform {
  constructor({
    origin = { x: 0, y: 0 },
    scale = 72,
    theta = 0,
    maxRange = 6,
    fanAngle = Math.PI / 3,
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
  }

  /* ========= Explicit mutators ========= */

  setOrigin(x, y) {
    this.origin = { x, y };
  }

  setScale(pxPerMeter) {
    this.scale = pxPerMeter;
  }

  setAngleDeg(deg) {
    //console.warn("RadarTransform setAngleDeg ", this.theta);
    this.theta = deg * Math.PI / 180;
  }

  setMaxRange(m) {
    this.maxRange = m;
  }

  setCanvasSize(w, h) {
    this.canvasWidth = w;
    this.canvasHeight = h;
  }

  setDpiScale(ratio) {
    this.dpiScale = ratio;
  }

  /* ========= Read-only helpers ========= */

  getAngleDeg() {
    return this.theta * 180 / Math.PI;
  }

  /* ========= Pure geometry ========= */

  toCanvas(x, y) {
    const cosT = Math.cos(this.theta);
    const sinT = Math.sin(this.theta);

    return {
      x: this.origin.x + (x * cosT - y * sinT) * this.scale,
      y: this.origin.y + (x * sinT + y * cosT) * this.scale
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
