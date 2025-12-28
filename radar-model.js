// radar-model.js
import { RadarTransform } from "./radar-transform.js";

export class RadarModel {
  constructor() {
    this.silentUpdate = false; // if true, suppress change events
    this.transform = new RadarTransform();
    this.zones = {};     // {id: {start:{x,y}, end:{x,y}}}  (world coords)
    this.targets = [];   // [{x,y,velocity,intensity}, …]
    this._listeners = new Set();
    this._editing = false;
    this._dirty = false;
    this.debugMode = false;
    // Optional: bubble transform changes upward if RadarTransform supports it
    // this.transform.onChange?.(() => this._emitChange("transform"));
  }

  onChange(fn) {
    if (typeof fn === "function") this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emitChange(kind) {
    if (this.silentUpdate) return;
    for (const fn of this._listeners) {
      try { fn(kind); } catch (e) { console.warn("[RadarModel] listener error", e); }
    }
  }
  isEditing() {
    return this._editing;
  }


  // === State mutators ===
  updateZones(newZones) {
    // If canvas is present, let it clamp; otherwise just trust input
    this.zones = structuredClone(newZones);
    //this._emitChange("zones");
  }
  beginEdit() {
    console.warn("[Model]  beginEdit()  editing= ", this.transform);
    this._editing = true;
    this._dirty = true;

  }

  commitEdit() {
    this._editing = false;
    this._dirty = false;

  }

  hasDirtyChanges() {
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
    //this._emitChange("targets");
  }

  updateRadarPose({ angleDeg, rangeM, silent = false }) {
    //console.warn("[Model]  updateRadarPose  editing= ", this._editing);
    const t = this.transform;
    if (!t) return;

    if (angleDeg !== undefined) t.setAngleDeg(angleDeg);
    if (rangeM !== undefined) t.setMaxRange(rangeM);
    // 🔑 mark dirty so Save knows something changed
    //this._dirty = true;

    // 🔑 notify dependents (canvas redraw, etc.)
    this._emitChange?.("transform");
  }

  setCanvasSize(w, h) {
    this.transform.setCanvasSize(w, h);
  }

  acceptExternalSnapshot(snapshot) {


    if (!snapshot) return;
    if (this.debugMode) {
      console.groupCollapsed("[HA snapshot]");
      console.log("editing:", this._editing, "dirty:", this._dirty);
      console.log("incoming pose:", snapshot?.pose);
      console.log("model theta BEFORE:",
        this.transform?.getAngleDeg?.()
      );
    }
    console.groupEnd();
    // Pose gate
    if (this._editing || this._dirty) {
      if (snapshot.targets) this.updateTargets(snapshot.targets);
      return;
    }
    if (this.debugMode) {
      console.warn("[HA APPLYING POSE]", snapshot.pose);
    }
    if (snapshot.pose) this.updateRadarPose(snapshot.pose);
    if (this.debugMode) {
      console.log("model theta AFTER:",
        this.transform?.getAngleDeg?.()
      );
    }
    if (snapshot.zones) this.updateZones(snapshot.zones);
    if (snapshot.targets) this.updateTargets(snapshot.targets);
  }

}