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
    // If canvas is present, let it clamp; otherwise just trust input
    this.zones = structuredClone(newZones);
    this._emitChange("zones");
  }

  updateTargets(newTargets) {
    this.targets = structuredClone(newTargets);
    this._emitChange("targets");
  }
  updateRadarPose({ angleDeg, rangeM, silent = false }) {
    const t = this.transform;
    if (!t) return;

    if (angleDeg !== undefined)
      t.setAngle(angleDeg, silent);

    if (rangeM !== undefined)
      t.setMaxRange(rangeM, silent);

    if (!silent) this._emitChange("transform");
  }/*
  updateRadarPose({ angleDeg, rangeM, silent = false }) {
    const t = this.transform;

    if (!t) return;

    if (silent) {
      if (angleDeg !== undefined) {
        t.theta = angleDeg * Math.PI / 180;
      }

      if (rangeM !== undefined) t.maxRange = rangeM;

    } else {
      if (angleDeg !== undefined) t.setAngle(angleDeg);
      if (rangeM !== undefined) t.setMaxRange(rangeM);
    }

    if (!silent) this._emitChange("transform");
  }*/

  setCanvasSize(w, h) { this.transform.setCanvasSize(w, h); }
}