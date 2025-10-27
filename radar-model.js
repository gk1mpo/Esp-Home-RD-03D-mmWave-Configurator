// radar-model.js
import { RadarTransform } from "./radar-transform.js";

export class RadarModel {
  constructor() {
    this.transform = new RadarTransform();
    this.zones = {};     // {id: {start:{x,y}, end:{x,y}}}  (world coords)
    this.targets = [];   // [{x,y,velocity,intensity}, …]
    this._listeners = new Set();

    // Bubble transform changes up to model observers
    this.transform.onChange(() => this._emitChange("transform"));
  }

  // === Observer pattern ===
  onChange(cb) { this._listeners.add(cb); }
  offChange(cb) { this._listeners.delete(cb); }
  _emitChange(type) { for (const cb of this._listeners) cb(type, this); }

  // === State mutators ===
  updateZones(newZones) {
    this.zones = structuredClone(newZones);
    this._emitChange("zones");
  }

  updateTargets(newTargets) {
    this.targets = structuredClone(newTargets);
    this._emitChange("targets");
  }

  updateRadarPose({ angleDeg, rangeM }) {
    if (angleDeg !== undefined) this.transform.setAngle(angleDeg);
    if (rangeM !== undefined) this.transform.setMaxRange(rangeM);
  }

  setCanvasSize(w, h) { this.transform.setCanvasSize(w, h); }
}