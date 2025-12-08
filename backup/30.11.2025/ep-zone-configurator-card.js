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
    this.debugMode = false; // used in hass() logging
  }

  // === Home Assistant binding ===
  set hass(hass) {
    // Store a stable reference
    this._hass = hass;

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
      this.syncModelFromHA();
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

  // === Synchronize model from HA ===
  syncModelFromHA() {
    if (!this._hass || !this._selectedDevice || !this.model) return;
    const dev = this._selectedDevice;

    // 1️⃣ Always sync zones unless the user is editing
    if (!this._editMode) {
      const zones = this._loadZonesFromHA?.();
      if (zones) this.model.updateZones(zones);
    } else {
      console.debug("[Card] Edit mode active — skipping HA zone overwrite.");
    }

    // 2️⃣ Pose (angle/range) — skip only while dragging those handles
    const poseDragActive =
      this.radarCanvas?.ui?.activeHandle === "angle" ||
      this.radarCanvas?.ui?.activeHandle === "range";

    if (!poseDragActive) {
      const angleDeg = Number(
        this._hass.states[`number.${dev}_installation_angle`]?.state || 0
      );
      const rangeM = Number(
        this._hass.states[`number.${dev}_distance`]?.state || 6
      );
      this.model.updateRadarPose({ angleDeg, rangeM });
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
    // Only load once
    if (this._stylesLoaded) return;
    this._stylesLoaded = true;

    fetch('/local/Esp-Home-RD-03D-mmWave-Configurator/styles.css')
      .then(r => r.text())
      .then(css => {
        if (!this.shadowRoot) {
          console.error("EPZ: shadowRoot missing when loading styles");
          return;
        }

        const style = document.createElement('style');
        style.textContent = css;
        this.shadowRoot.appendChild(style);

        console.log("EPZ: styles loaded successfully");
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
      <div class="epz-container">
      <h2 class="epz-title">Everything Presence Zone Configurator</h2>

      <div class="epz-canvas-cell">
        <canvas id="visualizationCanvas"></canvas>
      </div>

      <div class="epz-toolbar-area">
        <select class="device-select"></select>
        <span class="status-text"></span>
      </div>

     </div>
     `;

    // Attach to shadow DOM
    this.shadowRoot.append(container);

    // Store references
    this.canvas = this.shadowRoot.querySelector("#visualizationCanvas");

    // Use the existing canvas cell as the wrapper
    this.canvasWrapper = this.shadowRoot.querySelector(".epz-canvas-cell");


    this.toolbarArea = this.shadowRoot.querySelector(".epz-toolbar-area");

    // Zones sidebar no longer exists; keep this but allow null
    this.zoneList = this.shadowRoot.querySelector("#zone-tiles");

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

  setConfig(config) {
    this._config = config || {};
    this.debug = !!this._config.debug;
    this.debugMode = !!this._config.debug;

    this._loadStyles();   // <-- ADD THIS
  }

  getCardSize() {
    return 2;
  }
}

customElements.define("ep-zone-configurator-card", EPZoneConfiguratorCard);
