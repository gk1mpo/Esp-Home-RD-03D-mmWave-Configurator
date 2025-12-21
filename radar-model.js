// radar-model.js
import { RadarTransform } from "./radar-transform.js";

export class RadarModel {
  constructor() {
    this.silentUpdate = false; // if true, suppress change events
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
  beginEdit() {
    this._editing = true;
    this._dirty = true;
  }

  commitEdit() {
    this._editing = false;
    this._dirty = false;
  }

  isDirty() {
    return !!this._dirty;
  }
  exportSnapshot() {
    const t = this.transform;
    if (!t) return null;

    return {
      pose: {
        angleDeg: t.theta * 180 / Math.PI,
        rangeM: t.maxRange,
      },
      zones: this.zones,
    };
  }
  updateTargets(newTargets) {
    this.targets = structuredClone(newTargets);
    this._emitChange("targets");
  }
  updateRadarPose({ angleDeg, rangeM, silent = false }) {
    if (this.silentUpdate) return;
    //console.warn("🔥 updateRadarPose ,this.silentUpdate", this.silentUpdate, "silent ", silent);
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