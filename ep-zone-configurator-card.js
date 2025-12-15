// ep-zone-configurator-card.js
import { LovelaceBridgeInterface } from './lovelace-bridge-interface.js';
import { RadarCanvas } from './radar-canvas.js';
import { RadarModel } from './radar-model.js';

class EPZoneConfiguratorCard extends HTMLElement {
  constructor() {
    super();
    this._initialized = false;
    this._selectedDevice = null;
    this._tileStates = {};
    this._editMode = false;
    this._haReady = false;
    this.model = new RadarModel();
    this._hass = null;
    this.bridge = null;
    this.debug = false;
    this.debugMode = true; // used in hass() logging
    this._suppressModelSync = false
    this.draging = false;
  }

  // === Home Assistant binding ===
  set hass(hass) {
    // Store a stable reference
    this._hass = hass;
    if (this.draging) {
      console.log("hass update received draging");
      return;
    }
    if (!this.draging) {
      if (this.debugMode) {
        console.groupCollapsed(
          "%c[EPZ] hass update",
          "color:#09f;font-weight:bold;"
        );
        console.log("hass update received");
        console.log("selectedDevice:", this._selectedDevice);
        console.log("initialized:", this._initialized);
        console.log("canvas exists:", !!this.radarCanvas);
        console.log("canvas dpi:", window.devicePixelRatio);
        console.log("this.draging ", this.draging);
        console.log("canvas size:", {
          width: this.canvas?.width,
          height: this.canvas?.height
        });
        console.groupEnd();
      }

      // 1️⃣ Build the DOM + canvas once, the first time HA sets hass
      if (!this._initialized) {
        this.initialize();          // creates shadowRoot, canvas, sidebar, etc.
        this._initialized = true;
      }

      // 2️⃣ Create or update the bridge
      if (!this.bridge && hass) {
        this.bridge = new LovelaceBridgeInterface(hass);
        console.info("[EPZ] Bridge initialized.");
      } else if (this.bridge) {
        // keep bridge up-to-date with the latest hass object
        this.bridge.hass = hass;
      }

      // 3️⃣ If we already know which device is selected, wire the canvas to it
      if (this.radarCanvas && this._selectedDevice) {
        // Only update HA context — NO BIND, NO RESIZE
        this.radarCanvas.setContext({
          hass,
          deviceId: this._selectedDevice,
        });
      }

      // 4️⃣ Keep the model in sync with HA entities
      if (this._initialized) {

        // 🔒 Hard block: NEVER sync model from HA during drag
        if (this._suppressModelSync) {
          //console.warn("🔥  set hass(hass) inside set hass during _suppressModelSync = ", this._suppressModelSync);
          return;
        }
      }

      // Normal case: safe to sync


      if (!this._suppressModelSync) {
        if (!this.draging) {
          //console.warn("🔥 syncModelFromHA() inside set hass during draging = ", this.draging);
          this.syncModelFromHA();
          return;
        }
      }
      // 5️⃣ Show connection label once
      if (!this._haReady && this.shadowRoot) {
        const status = this.shadowRoot.querySelector(".status-text");
        if (status) {
          status.textContent = "Connected to Home Assistant ✅";
        }
        this._haReady = true;
      }
    }
  }

  // === Synchronize model from HA ===
  syncModelFromHA() {
    if (!this._hass || !this._selectedDevice || !this.model) return;
    const dev = this._selectedDevice;
    // 🔒 C-2: do nothing while the canvas is dragging
    if (this._suppressModelSync) {
      console.warn("🔥 syncModelFromHA() CALLED DURING DRAG — SUPPRESSED");
      return;
    }
    // --- C-2B: Suppress HA sync while dragging ---
    if (this._suppressModelSync) {
      console.warn("🔥 syncModelFromHA() CALLED DURING DRAG — THIS CAUSES SNAPBACK");
      //console.debug("[Card] syncModelFromHA suppressed during drag.");
      return;
    }

    // 1️⃣ Always sync zones unless the user is editing
    if (!this._editMode) {
      const zones = this._loadZonesFromHA?.();
      if (zones) this.model.updateZones(zones);
    } else {
      //console.debug("[Card] Edit mode active — skipping HA zone overwrite.");
    }

    // 2️⃣ Pose (angle/range) — skip only while dragging those handles
    const poseDragActive =
      this.radarCanvas?.ui?.activeHandle === "angle" ||
      this.radarCanvas?.ui?.activeHandle === "range";
    //console.debug(this.radarCanvas?.ui?.activeHandle);
    if (!poseDragActive) {
      const angleDeg = Number(
        this._hass.states[`number.${dev}_installation_angle`]?.state || 0
      );
      const rangeM = Number(
        this._hass.states[`number.${dev}_distance`]?.state || 6
      );
      this.model.updateRadarPose({ angleDeg, rangeM, });
    } else {
      console.debug(
        "[Card] Pose update from HA suppressed during handle drag."
      );
    }

    // 3️⃣ Targets always refresh normally
    const targets = this.bridge?.getTargets(dev) || {};
    this.model.updateTargets(targets);

    // 4️⃣ Sidebar refresh
    this.updateSidebar?.();
  }


  pushPoseToHA({ angleDeg, rangeM }) {
    if (!this._hass || !this._selectedDevice) return;
    const dev = this._selectedDevice;

    const svc = (entity_id, value) =>
      this._hass.callService("number", "set_value", {
        entity_id,
        value,
      });

    if (Number.isFinite(angleDeg)) {
      svc(`number.${dev}_installation_angle`, angleDeg);
    }
    if (Number.isFinite(rangeM)) {
      svc(`number.${dev}_distance`, rangeM);
    }
  }
  _loadStyles() {

    if (this._stylesLoaded) return;
    this._stylesLoaded = true;

    fetch('/local/Esp-Home-RD-03D-mmWave-Configurator/styles.css')
      .then(r => r.text())
      .then(css => {
        const style = document.createElement('style');
        style.textContent = css;
        this.shadowRoot.appendChild(style);

        console.log("EPZ: styles loaded successfully");

        // ⭐ NEW: Trigger resize only after CSS loads
        requestAnimationFrame(() => {
          if (this.radarCanvas) {
            console.log("EPZ: CSS ready → running first resize()");
            this.radarCanvas.cssReady = true;
            this.radarCanvas.resize();
          }
        });


      })
      .catch(err => console.error("EPZ: Failed to load CSS:", err));
  }

  connectedCallback() {
    //super.connectedCallback();
    this._loadStyles();   // <-- ADD THIS
  }

  // === Initial DOM and canvas setup ===
  initialize() {

    // Create shadow DOM once
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    // Build the full card layout
    const container = document.createElement("div");
    container.classList.add("epz-container");

    container.innerHTML = `
       <header class="header">
    <h2>Everything Presence Zone Configurator</h2>
    <button class="epz-menu-button" title="Device options">⋮</button>
  </header>

  <div class="device-line">
    <select class="device-select"></select>
    <span class="status-text"></span>
  </div>

  <div class="canvas-center">
    <div class="canvas-wrapper">
      <canvas id="visualizationCanvas"></canvas>
    </div>
  </div>

  <div class="epz-toolbar-area"></div>

  <div class="epz-dialog-backdrop" hidden>
    <div class="epz-dialog">
      <h3>Device options</h3>
      <div class="epz-dialog-row">
        <label for="epz-mode-select">Target mode</label>
        <select id="epz-mode-select">
          <option value="Multi">Multi target</option>
          <option value="Single">Single target</option>
        </select>
      </div>
      <div class="epz-dialog-row">
        <label for="epz-speed-select">Update speed</label>
        <select id="epz-speed-select">
          <option value="Slow">Slow</option>
          <option value="Medium">Medium</option>
          <option value="Fast">Fast</option>
        </select>
      </div>
      <div class="epz-dialog-row">
        <span>Exclusion zone 1</span>
        <input type="checkbox" id="epz-excl1-toggle" />
      </div>
      <div class="epz-dialog-row">
        <span>Exclusion zone 2</span>
        <input type="checkbox" id="epz-excl2-toggle" />
      </div>
      <div class="epz-dialog-buttons">
        <button class="epz-dialog-cancel">Cancel</button>
        <button class="epz-dialog-save">Apply</button>
      </div>
    </div>
  </div>
`;

    // Attach to shadow DOM
    this.shadowRoot.append(container);


    // Store references
    this.canvas = this.shadowRoot.querySelector("#visualizationCanvas");
    this.canvasWrapper = this.shadowRoot.querySelector(".canvas-wrapper");
    this.toolbarArea = this.shadowRoot.querySelector(".epz-toolbar-area");
    this.zoneList = this.shadowRoot.querySelector("#zone-tiles");
    this.menuButton = this.shadowRoot.querySelector(".epz-menu-button");
    this.dialogBackdrop = this.shadowRoot.querySelector(".epz-dialog-backdrop");
    this.dialogModeSelect = this.shadowRoot.querySelector("#epz-mode-select");
    this.dialogSpeedSelect = this.shadowRoot.querySelector("#epz-speed-select");
    this.dialogExcl1Toggle = this.shadowRoot.querySelector("#epz-excl1-toggle");
    this.dialogExcl2Toggle = this.shadowRoot.querySelector("#epz-excl2-toggle");

    if (this.menuButton && this.dialogBackdrop) {
      const cancelBtn = this.shadowRoot.querySelector(".epz-dialog-cancel");
      const saveBtn = this.shadowRoot.querySelector(".epz-dialog-save");

      this.menuButton.addEventListener("click", () => this.openDeviceOptionsDialog());
      cancelBtn?.addEventListener("click", () => this.closeDeviceOptionsDialog());
      saveBtn?.addEventListener("click", () => this.applyDeviceOptions());

      // Click on backdrop closes dialog
      this.dialogBackdrop.addEventListener("click", (ev) => {
        if (ev.target === this.dialogBackdrop) {
          this.closeDeviceOptionsDialog();
        }
      });
    }

    // Use the existing canvas cell as the wrapper
    //this.canvasWrapper = this.shadowRoot.querySelector(".epz-canvas-cell");


    //this.toolbarArea = this.shadowRoot.querySelector(".epz-toolbar-area");

    // Zones sidebar no longer exists; keep this but allow null
    //this.zoneList = this.shadowRoot.querySelector("#zone-tiles");

    // Initialize model + canvas
    this.radarCanvas = new RadarCanvas(this.canvas, this.model, { card: this });
    console.log("[CARD] Assigned radarCanvas", this.radarCanvas);
    this.radarCanvas.bindModel(this.model);

    // Resize observer (firstUpdated on HTMLElement would never fire)
    this._resizeObs = new ResizeObserver(() => {
      this.radarCanvas?.resize();
    });
    if (this.canvasWrapper) {
      this._resizeObs.observe(this.canvasWrapper);
    }

    // Populate devices using current hass (if any)
    this.populateDevices();

    // Kick first resize + draw
    requestAnimationFrame(() => this.radarCanvas.resize());
  }

  populateDevices() {
    const select = this.shadowRoot?.querySelector(".device-select");
    if (!select) return;

    const devices = this.getAvailableDevices();
    if (!devices.length) {
      // No devices yet (or hass not ready) → leave select empty
      select.innerHTML = "";
      return;
    }

    select.innerHTML = devices
      .map((d) => `<option value="${d}">${d}</option>`)
      .join("");

    select.onchange = (e) => {
      this._selectedDevice = e.target.value;

      this.radarCanvas.setContext({
        hass: this._hass,
        deviceId: this._selectedDevice,
      });

      console.info("[Card] Device changed to:", this._selectedDevice);
      this.syncModelFromHA();
    };
    // If we already have a selected device (for example from card config),
    // keep it and sync the model.
    if (this._selectedDevice && devices.includes(this._selectedDevice)) {
      select.value = this._selectedDevice;

      if (this.radarCanvas) {
        this.radarCanvas.setContext({
          hass: this._hass,
          deviceId: this._selectedDevice,
        });
      }

      this.syncModelFromHA();
      return;
    }

    // Otherwise default to the first available device.
    if (!this._selectedDevice) {
      this._selectedDevice = devices[0];
      select.value = this._selectedDevice;

      if (this.radarCanvas) {
        this.radarCanvas.setContext({
          hass: this._hass,
          deviceId: this._selectedDevice,
        });
      }

      console.info("[Card] Auto-selected device:", this._selectedDevice);
      this.syncModelFromHA();
    }


    /*
        if (!this._selectedDevice) {
          this._selectedDevice = devices[0];
          select.value = this._selectedDevice;
    
          this.radarCanvas.setContext({
            hass: this._hass,
            deviceId: this._selectedDevice,
          });
    
          console.info("[Card] Auto-selected device:", this._selectedDevice);
          this.syncModelFromHA();
        }
          */
  }

  setDevice(deviceId) {
    this._selectedDevice = deviceId;

    if (this.radarCanvas) {
      this.radarCanvas.bindModel(this.model);
      this.radarCanvas.setContext({
        hass: this._hass,
        deviceId,
      });
    }

    this.syncModelFromHA();
  }

  getAvailableDevices() {
    const hass = this._hass;
    if (!hass || !hass.states) {
      console.warn("[EPZ] getAvailableDevices called before hass is ready");
      return [];
    }
    const all = Object.keys(hass.states);
    // Example filter: number.<device>_distance
    return all
      .filter((id) => id.startsWith("number.") && id.endsWith("_distance"))
      .map((id) => id.replace("number.", "").replace("_distance", ""));
  }

  // === Save and load ===
  saveZonesToHA() {
    if (!this._hass || !this._selectedDevice) return;
    const zones = this.model.zones || {};

    for (const [zoneNum, z] of Object.entries(zones)) {
      if (!z.start || !z.end) continue;

      const prefix = `number.${this._selectedDevice}_zone_${zoneNum}`;
      const svc = (eid, value) =>
        this._hass.callService("number", "set_value", {
          entity_id: eid,
          value: value.toFixed(3),
        });

      // Save geometry
      svc(`${prefix}_x_begin`, z.start.x);
      svc(`${prefix}_x_end`, z.end.x);
      svc(`${prefix}_y_begin`, z.start.y);
      svc(`${prefix}_y_end`, z.end.y);

      // Save enabled state
      const enableEntity = `switch.${this._selectedDevice}_zone_${zoneNum}_enable`;
      this._hass.callService(
        "switch",
        z.enabled ? "turn_on" : "turn_off",
        { entity_id: enableEntity }
      );
    }

    // --- PATCH C-1.2: Clean up deleted zone in HA ---
    if (this._deletedZone) {
      const dev = this._selectedDevice;
      const i = this._deletedZone;

      // Turn off the enable switch
      this._hass.callService("switch", "turn_off", {
        entity_id: `switch.${dev}_zone_${i}_enable`
      });

      // Wipe coordinates
      const zero = (eid) =>
        this._hass.callService("number", "set_value", {
          entity_id: eid,
          value: 0
        });

      zero(`number.${dev}_zone_${i}_x_begin`);
      zero(`number.${dev}_zone_${i}_x_end`);
      zero(`number.${dev}_zone_${i}_y_begin`);
      zero(`number.${dev}_zone_${i}_y_end`);

      console.warn(`[C-1.2] Zone ${i} fully cleared from HA.`);
      this._deletedZone = null;
    }
    // --- END PATCH C-1.2 ---

    console.info("[Card] Zones saved to HA in radar-relative coordinates.");
    this._editMode = false;
    this.model.isDirty = false;

    const banner = this.shadowRoot.querySelector("#edit-banner");
    if (banner) banner.style.display = "none";
  }

  _loadZonesFromHA() {
    if (!this._hass || !this._selectedDevice) return null;
    const dev = this._selectedDevice;
    const zones = {};

    for (let i = 1; i <= 4; i++) {
      const prefix = `number.${dev}_zone_${i}`;

      const x1 = parseFloat(this._hass.states[`${prefix}_x_begin`]?.state);
      const x2 = parseFloat(this._hass.states[`${prefix}_x_end`]?.state);
      const y1 = parseFloat(this._hass.states[`${prefix}_y_begin`]?.state);
      const y2 = parseFloat(this._hass.states[`${prefix}_y_end`]?.state);

      // Skip if any coordinate is missing
      if (![x1, x2, y1, y2].every((v) => Number.isFinite(v))) continue;

      const enabled =
        this._hass.states[`switch.${dev}_zone_${i}_enable`]?.state === "on";
      const occupied =
        this._hass.states[`binary_sensor.${dev}_zone_${i}_in_zone`]?.state ===
        "on";

      zones[i] = {
        id: i,
        enabled,
        occupied,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
      };
    }

    return zones;
  }

  // === Sidebar ===
  updateSidebar() {
    const container = this.shadowRoot.querySelector("#zone-tiles");
    if (!container || !this._selectedDevice || !this._hass) return;

    const zones = this.model.zones || {};
    const zoneSwitches = Object.entries(this._hass.states).filter(([id]) =>
      id.includes(`${this._selectedDevice}_zone_`) && id.includes("_enable")
    );

    container.innerHTML = "";

    zoneSwitches.forEach(([id, entity]) => {
      const zoneNumMatch = id.match(/zone_(\d+)_/);
      if (!zoneNumMatch) return;
      const zoneNum = zoneNumMatch[1];
      const enabled = entity.state === "on";
      const occEntity =
        this._hass.states[
        `binary_sensor.${this._selectedDevice}_zone_${zoneNum}_in_zone`
        ];
      const occupied = occEntity?.state === "on";
      const z = zones[zoneNum] || { start: {}, end: {} };

      const tile = document.createElement("div");
      tile.className = `zone-tile ${occupied
        ? "zone-occupied"
        : enabled
          ? "zone-enabled"
          : "zone-disabled"
        }`;
      tile.innerHTML = `
        <strong>Zone ${zoneNum}</strong><br>
        Enabled: ${enabled}<br>
        Occupied: ${occupied}<br>
        X: ${(z.start?.x ?? "?")} → ${(z.end?.x ?? "?")}<br>
        Y: ${(z.start?.y ?? "?")} → ${(z.end?.y ?? "?")}
      `;

      tile.onclick = () => {
        if (navigator.vibrate) navigator.vibrate(20);
        this._activeZone = zoneNum;
        this.radarCanvas?.highlightZone?.(zoneNum);
        this.shadowRoot
          .querySelectorAll(".zone-tile")
          .forEach((t) => t.classList.remove("active"));
        tile.classList.add("active");

        this._hass.callService("switch", "toggle", { entity_id: id });
      };

      // Pulse animation on change
      const prev = this._tileStates?.[zoneNum];
      const curr = occupied ? "occupied" : enabled ? "enabled" : "disabled";
      this._tileStates = this._tileStates || {};
      this._tileStates[zoneNum] = curr;
      if (prev && prev !== curr) {
        tile.classList.add("pulse");
        setTimeout(() => tile.classList.remove("pulse"), 400);
      }

      container.append(tile);
    });
  }
  openDeviceOptionsDialog() {
    if (!this.dialogBackdrop) return;
    this.refreshDeviceOptionsFromHA();
    this.dialogBackdrop.hidden = false;
  }

  closeDeviceOptionsDialog() {
    if (this.dialogBackdrop) {
      this.dialogBackdrop.hidden = true;
    }
  }

  refreshDeviceOptionsFromHA() {
    if (!this._hass || !this._selectedDevice) return;
    const dev = this._selectedDevice;

    const modeEntity = `select.${dev}_rd_03d_mode`;
    const speedEntity = `select.${dev}_rd_03d_update_speed`;
    const excl1Entity = `switch.${dev}_exclusion_1_enable`;
    const excl2Entity = `switch.${dev}_exclusion_2_enable`;

    const modeState = this._hass.states[modeEntity]?.state;
    const speedState = this._hass.states[speedEntity]?.state;
    const excl1State = this._hass.states[excl1Entity]?.state === "on";
    const excl2State = this._hass.states[excl2Entity]?.state === "on";

    if (this.dialogModeSelect && modeState) {
      this.dialogModeSelect.value = modeState;
    }
    if (this.dialogSpeedSelect && speedState) {
      this.dialogSpeedSelect.value = speedState;
    }
    if (this.dialogExcl1Toggle) {
      this.dialogExcl1Toggle.checked = !!excl1State;
    }
    if (this.dialogExcl2Toggle) {
      this.dialogExcl2Toggle.checked = !!excl2State;
    }
  }

  applyDeviceOptions() {
    if (!this._hass || !this._selectedDevice) {
      this.closeDeviceOptionsDialog();
      return;
    }

    const dev = this._selectedDevice;

    const mode = this.dialogModeSelect?.value;
    const speed = this.dialogSpeedSelect?.value;
    const excl1 = this.dialogExcl1Toggle?.checked;
    const excl2 = this.dialogExcl2Toggle?.checked;

    const calls = [];

    if (mode) {
      calls.push(
        this._hass.callService("select", "select_option", {
          entity_id: `select.${dev}_rd_03d_mode`,
          option: mode,
        })
      );
    }

    if (speed) {
      calls.push(
        this._hass.callService("select", "select_option", {
          entity_id: `select.${dev}_rd_03d_update_speed`,
          option: speed,
        })
      );
    }

    if (typeof excl1 === "boolean") {
      calls.push(
        this._hass.callService("switch", excl1 ? "turn_on" : "turn_off", {
          entity_id: `switch.${dev}_exclusion_1_enable`,
        })
      );
    }

    if (typeof excl2 === "boolean") {
      calls.push(
        this._hass.callService("switch", excl2 ? "turn_on" : "turn_off", {
          entity_id: `switch.${dev}_exclusion_2_enable`,
        })
      );
    }

    Promise.allSettled(calls).finally(() => {
      this.closeDeviceOptionsDialog();
    });
  }

  setConfig(config) {
    this._config = config || {};
    this.debug = !!this._config.debug;
    this.debugMode = !!this._config.debug;

    if (this._config.device_id) {
      this._selectedDevice = this._config.device_id;
      // If the canvas is already initialised, update its context now.
      if (this.radarCanvas && this._hass) {
        this.radarCanvas.setContext({
          hass: this._hass,
          deviceId: this._selectedDevice,
        });
        this.syncModelFromHA();
      }
    }
  }

  getCardSize() {
    return 2;
  }

  static async getConfigElement() {

    await import("./ep-zone-configurator-editor.js");
    return document.createElement("ep-zone-configurator-editor");
  }

  static getStubConfig() {
    return {
      device_id: "",
      debug: false,
    };
  }

}
customElements.define("ep-zone-configurator-card", EPZoneConfiguratorCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ep-zone-configurator-card",
  name: "Everything Presence Zone Configurator",
  description: "Visual room-space editor for mmWave zones"
});


