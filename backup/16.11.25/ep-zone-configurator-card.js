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
  }

  // === Home Assistant binding ===
  set hass(hass) {
    this._hass = hass;

    // 1️⃣ Create bridge if missing
    if (!this.bridge && hass) {
      this.bridge = new LovelaceBridgeInterface(hass);
      console.info('[Card] Bridge initialized.');
    }

    // 2️⃣ First-time UI setup
    if (!this._initialized && this.bridge && hass) {
      Promise.resolve().then(() => {
        this.initialize();
        // sync model once DOM exists
        this.syncModelFromHA();
      });
    }

    // 3️⃣ Keep bridge reference up to date
    if (this.bridge) this.bridge.hass = hass;

    // 4️⃣ Subsequent updates
    if (this._initialized) this.syncModelFromHA();

    // 5️⃣ Show connection label once
    if (hass && !this._haReady && this.shadowRoot) {
      const status = this.shadowRoot.querySelector('#status-text');
      if (status) status.textContent = 'Connected to Home Assistant ✅';
      this._haReady = true;
    }
  }

  // === Synchronize model from HA ===
  syncModelFromHA() {
    if (!this._hass || !this._selectedDevice || !this.model) return;
    const dev = this._selectedDevice;

    // 1️⃣ Always sync zones unless the user is editing
    if (!this._editMode) {
      const zones = this._loadZonesFromHA?.(); // uses your existing zone loader
      if (zones) this.model.updateZones(zones);
    } else {
      console.debug('[Card] Edit mode active — skipping HA zone overwrite.');
    }

    // 2️⃣ Pose (angle/range) — skip only while dragging those handles
    const poseDragActive =
      this.radarCanvas?.ui?.activeHandle === 'angle' ||
      this.radarCanvas?.ui?.activeHandle === 'range';

    if (!poseDragActive) {
      const angleDeg = Number(
        this._hass.states[`number.${dev}_installation_angle`]?.state || 0
      );
      const rangeM = Number(
        this._hass.states[`number.${dev}_distance`]?.state || 6
      );
      this.model.updateRadarPose({ angleDeg, rangeM });
    } else {
      console.debug('[Card] Pose update from HA suppressed during handle drag.');
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
      this._hass.callService('number', 'set_value', {
        entity_id,
        value
      });

    if (Number.isFinite(angleDeg)) {
      svc(`number.${dev}_installation_angle`, angleDeg);
    }
    if (Number.isFinite(rangeM)) {
      svc(`number.${dev}_distance`, rangeM);
    }
  }
  // === Initial DOM and canvas setup ===
  initialize() {
    this._initialized = true;
    this.attachShadow({ mode: 'open' });

    // Load shared CSS
    fetch('/local/Esp-Home-RD-03D-mmWave-Configurator/styles.css')
      .then(r => r.text())
      .then(css => {
        const style = document.createElement('style');
        style.textContent = css;
        this.shadowRoot.append(style);
      });

    // DOM structure
    const container = document.createElement('div');
    container.id = 'container';
    container.innerHTML = `
      <header>
        <h1>EP Zone Configurator Bridge</h1>
        <div class="header-controls">
          <select id="device-select"><option>Loading…</option></select>
          <div id="status-text" style="margin-left:1em;color:var(--text-secondary);"></div>
        </div>
        <div id="edit-banner" style="display:none;color:orange;font-weight:bold;margin-left:1em;">
          Unsaved zone changes — click Export Zones to save.
        </div>
      </header>
      <main class="main-content">
        <div class="canvas-wrapper">
          <canvas id="visualizationCanvas" width="600" height="400"></canvas>
        </div>
        <aside class="zone-sidebar">
          <h3>Zones</h3>
          <div id="zone-tiles"></div>
        </aside>
      </main>
    `;
    this.shadowRoot.append(container);

    // Canvas + model binding
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (!canvas) {
      console.error('[Card] No canvas element found.');
      return;
    }

    this.radarCanvas = new RadarCanvas(canvas, this.model, { card: this });
    this.radarCanvas.bindModel(this.model); // model drives redraws

    this.populateDevices();
    console.info('[Card] Initialization complete ✅');
  }

  // === Device selector ===
  populateDevices() {
    if (!this.bridge) return;

    const select = this.shadowRoot.querySelector('#device-select');
    const devices = this.bridge.getDevices();

    if (!devices.length) {
      select.innerHTML = '<option>No ESPHome devices found</option>';
      this._selectedDevice = null;
      return;
    }

    select.innerHTML = devices.map(d => `<option value="${d}">${d}</option>`).join('');

    if (!this._selectedDevice) {
      this._selectedDevice = devices[0];
      select.value = this._selectedDevice;
      console.info('[Card] Auto-selected device:', this._selectedDevice);
      this.syncModelFromHA();
    }

    select.onchange = (e) => {
      this._selectedDevice = e.target.value;
      console.info('[Card] Device changed to:', this._selectedDevice);
      this.syncModelFromHA();
    };
  }

  // === Save and load ===
  saveZonesToHA() {
    if (!this._hass || !this._selectedDevice) return;
    const zones = this.model.zones || {};

    for (const [zoneNum, z] of Object.entries(zones)) {
      if (!z.start || !z.end) continue;
      const prefix = `number.${this._selectedDevice}_zone_${zoneNum}`;
      const svc = (eid, value) =>
        this._hass.callService('number', 'set_value', {
          entity_id: eid,
          value: value.toFixed(3)
        });
      svc(`${prefix}_x_begin`, z.start.x);
      svc(`${prefix}_x_end`, z.end.x);
      svc(`${prefix}_y_begin`, z.start.y);
      svc(`${prefix}_y_end`, z.end.y);
    }

    console.info('[Card] Zones saved to HA in radar-relative coordinates.');
    this._editMode = false;
    this.model.isDirty = false;

    const banner = this.shadowRoot.querySelector('#edit-banner');
    if (banner) banner.style.display = 'none';
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
      if (![x1, x2, y1, y2].every(v => Number.isFinite(v))) continue;

      const enabled = this._hass.states[`switch.${dev}_zone_${i}_enable`]?.state === 'on';
      const occupied = this._hass.states[`binary_sensor.${dev}_zone_${i}_in_zone`]?.state === 'on';

      zones[i] = {
        id: i,
        enabled,
        occupied,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 }
      };
    }

    //console.debug('[Card] Zones loaded from HA:', JSON.stringify(zones, null, 2));
    return zones;
  }

  // === Sidebar ===
  updateSidebar() {
    const container = this.shadowRoot.querySelector('#zone-tiles');
    if (!container || !this._selectedDevice) return;

    const zones = this.model.zones || {};
    const zoneSwitches = Object.entries(this._hass.states)
      .filter(([id]) =>
        id.includes(`${this._selectedDevice}_zone_`) && id.includes('_enable')
      );

    container.innerHTML = '';

    zoneSwitches.forEach(([id, entity]) => {
      const zoneNumMatch = id.match(/zone_(\d+)_/);
      if (!zoneNumMatch) return;
      const zoneNum = zoneNumMatch[1];
      const enabled = entity.state === 'on';
      const occEntity = this._hass.states[`binary_sensor.${this._selectedDevice}_zone_${zoneNum}_in_zone`];
      const occupied = occEntity?.state === 'on';
      const z = zones[zoneNum] || { start: {}, end: {} };

      const tile = document.createElement('div');
      tile.className = `zone-tile ${occupied ? 'zone-occupied' : enabled ? 'zone-enabled' : 'zone-disabled'}`;
      tile.innerHTML = `
        <strong>Zone ${zoneNum}</strong><br>
        Enabled: ${enabled}<br>
        Occupied: ${occupied}<br>
        X: ${(z.start?.x ?? '?')} → ${(z.end?.x ?? '?')}<br>
        Y: ${(z.start?.y ?? '?')} → ${(z.end?.y ?? '?')}
      `;

      tile.onclick = () => {
        if (navigator.vibrate) navigator.vibrate(20);
        this._activeZone = zoneNum;
        this.model.highlightZone?.(zoneNum); // optional hook
        this.shadowRoot.querySelectorAll('.zone-tile').forEach(t => t.classList.remove('active'));
        tile.classList.add('active');

        this._hass.callService('switch', 'toggle', { entity_id: id });
      };

      // Pulse animation on change
      const prev = this._tileStates?.[zoneNum];
      const curr = occupied ? 'occupied' : enabled ? 'enabled' : 'disabled';
      this._tileStates = this._tileStates || {};
      this._tileStates[zoneNum] = curr;
      if (prev && prev !== curr) {
        tile.classList.add('pulse');
        setTimeout(() => tile.classList.remove('pulse'), 400);
      }

      container.append(tile);
    });
  }

  setConfig(config) {
    this._config = config || {};
    this.debug = !!this._config.debug;
  }

  getCardSize() { return 2; }
}

customElements.define('ep-zone-configurator-card', EPZoneConfiguratorCard);
