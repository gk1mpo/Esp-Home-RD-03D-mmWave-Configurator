/*////////////////////////////////////////////////////////////////////////////////////////////
“Coordinate model. The radar is directional. We place the sensor origin on a chosen canvas 
edge and render only the forward field of view as a semicircular sector spanning −90° to +90° 
relative to the sensor’s facing direction. The sector grows outward from the origin into the 
canvas; nothing is drawn ‘behind’ the sensor. Distances are rendered radially (meters → pixels), 
angles are measured clockwise from ‘forward’, and an angle offset equal to the installation 
direction is applied so the visual matches the real mounting. A dashed radial grid every 1 m 
and a bolder ring every 5 m help with calibration and testing.”*/
/////////////////////////////////////////////////////////////////////////////////////////////




import { LovelaceBridgeInterface } from '/local/everything-presence-mmwave-configurator/lovelace-bridge-interface.js';
import { RadarCanvas } from '/local/everything-presence-mmwave-configurator/radar-canvas.js';
class EPZoneConfiguratorCard extends HTMLElement {
  SCALE = 10; // 1 m = 40 px
  

  constructor() {
    super();
    this._dragging = null;   // { zoneNum, corner }
    this._zonesCache = {};   // last drawn zones for editing
    this._touchMarker = null;
    this._tileStates = this._tileStates || {};
    this._editing = false;  // currently dragging
    this._editMode = false; // unsaved local changes
  }
  set hass(hass) {
    this._hass = hass;
    // Pass HA state down to radar canvas
    // Pass HA state down to radar canvas
    if (this.radarCanvas) {
      this.radarCanvas._hass = hass;
      this.radarCanvas._selectedDevice = this._selectedDevice;
    }

    // Trigger draw only when both are ready
    if (this.isConnected && this._selectedDevice && this.radarCanvas) {
      this.radarCanvas.draw();
    }
    
    // 1️⃣ Create the bridge first
    if (!this.bridge && this._hass) {
      console.info('[Card] Initialising bridge…');
      this.bridge = new LovelaceBridgeInterface(this._hass);
    }

    // 2️⃣ Initialise the card UI only once — defer until bridge is ready
    if (!this._initialized && this.bridge && this._hass) {
      // Defer one microtask so the shadow DOM exists when initialize() runs
      Promise.resolve().then(() => this.initialize());
    }

    // 3️⃣ Keep bridge reference current
    if (this.bridge) this.bridge.hass = this._hass;

    // 4️⃣ Update HA connection state label
    if (this._hass && !this._haReady) {
      const status = this.shadowRoot?.querySelector('#status-text');
      if (status) status.textContent = 'Connected to Home Assistant ✅';
      this._haReady = true;
    }

    // 5️⃣ Regular updates (only if bridge ready)
    if (this.bridge) this.onHassUpdate();

    // 6️⃣ Attach canvas event listeners once (only after DOM is ready)
    if (!this._canvasListenersAttached) {
      const attachCanvasListeners = () => {
        const canvas = this.shadowRoot?.querySelector('#visualizationCanvas');
        if (!canvas) return; // nothing to attach yet

        // 🖱️ Mouse support
        canvas.addEventListener('mousedown', (e) => this.onCanvasDown(e));
        canvas.addEventListener('mousemove', (e) => this.onCanvasMove(e));
        canvas.addEventListener('mouseup',   (e) => this.onCanvasUp(e));

        // 🖐️ Touch support
        canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          const t = e.touches[0];
          this.onCanvasDown({
            clientX: t.clientX,
            clientY: t.clientY,
            target: canvas,
            touches: e.touches
          });
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
          e.preventDefault();
          const t = e.touches[0];
          this.onCanvasMove({
            clientX: t.clientX,
            clientY: t.clientY,
            target: canvas,
            touches: e.touches
          });
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
          e.preventDefault();
          this.onCanvasUp(e);
        });
        canvas.addEventListener('mouseleave', (e) => this.onCanvasUp(e));

        this._canvasListenersAttached = true;
        console.info('[Card] Canvas event listeners attached ✅');
      };

      // Delay attaching listeners until after initialize() has built the shadow DOM
      Promise.resolve().then(attachCanvasListeners);
    }

  }

onHassUpdate() {
    if (!this._selectedDevice || !this._hass || !this.radarCanvas) return;

    // Throttle excessive refreshes
    if (this._lastUpdate && Date.now() - this._lastUpdate < 200) return;
    this._lastUpdate = Date.now();

    const dev = this._selectedDevice;

    // 1️⃣ Direction & distance
    const dirEntity =
      this._hass.states[`number.${dev}_installation_angle`] ||
      this._hass.states[`sensor.${dev}_installation_angle`] ||
      this._hass.states[`number.${dev}_direction`];
    const distEntity =
      this._hass.states[`number.${dev}_distance`] ||
      this._hass.states[`sensor.${dev}_max_distance`];

    this._directionDeg = Number(dirEntity?.state || 0);
    this._maxMeters = Math.max(1, Number(distEntity?.state || 6));
    const theta = this._directionDeg * Math.PI / 180;

    // 2️⃣ Zones (skip overwriting if user editing)
    if (!this._editing && !this._editMode) {
      this._zones = {};
      for (let i = 1; i <= 4; i++) {
        const en = this._hass.states[`switch.${dev}_zone_${i}_enable`];
        const oc = this._hass.states[`binary_sensor.${dev}_zone_${i}_occupied`];

        // Load radar-local coordinates from HA
        const x1 = Number(this._hass.states[`number.${dev}_zone_${i}_x_begin`]?.state ?? 0);
        const y1 = Number(this._hass.states[`number.${dev}_zone_${i}_y_begin`]?.state ?? 0);
        const x2 = Number(this._hass.states[`number.${dev}_zone_${i}_x_end`]?.state   ?? x1 + 1);
        const y2 = Number(this._hass.states[`number.${dev}_zone_${i}_y_end`]?.state   ?? y1 + 1);

        // Keep radar-local coordinates (meters). Let RadarCanvas handle transforms.
        this._zones[i] = {
          id: i,
          enabled: en?.state === 'on',
          occupied: oc?.state === 'on',
          start: { x: x1, y: y1 },
          end:   { x: x2, y: y2 },
          fill: oc?.state === 'on'
            ? 'rgba(255, 0, 0, 0.25)'
            : 'rgba(13,110,253,0.2)'
        };
      }
    } else {
      console.info('[Card] Keeping local zones — skipping HA zone overwrite.');
    }

    // 3️⃣ Targets (always update live)
    this._targets = {};
    for (let i = 1; i <= 4; i++) {
      const tx = Number(this._hass.states[`sensor.${dev}_target_${i}_x`]?.state || 0);
      const ty = Number(this._hass.states[`sensor.${dev}_target_${i}_y`]?.state || 0);
      this._targets[i] = { x: tx, y: ty };
    }

    // 4️⃣ Optional bridge data
    if (!this._editing && !this._editMode && this.bridge) {
      const bridgeZones = this.bridge.getZones(dev);
      const bridgeTargets = this.bridge.getTargets(dev);
      if (bridgeZones && Object.keys(bridgeZones).length) this._zones = bridgeZones;
      if (bridgeTargets && Object.keys(bridgeTargets).length) this._targets = bridgeTargets;
    }

    // 5️⃣ Push into canvas
    this.radarCanvas.theta = theta;
    this.radarCanvas.maxRange = this._maxMeters;
    this.radarCanvas.update(this._zones, this._targets);
    

    // 6️⃣ Refresh sidebar
    this.updateSidebar?.();
  }



initialize() {
  this._initialized = true;
  this.attachShadow({ mode: 'open' });

  // === Load external CSS ===
  fetch('/local/everything-presence-mmwave-configurator/styles.css')
    .then(r => r.text())
    .then(css => {
      const style = document.createElement('style');
      style.textContent = css;
      this.shadowRoot.append(style);
    });

  // === DOM structure ===
  const container = document.createElement('div');
  container.id = 'container';
  container.innerHTML = `
    <header>
      <h1>EP Zone Configurator Bridge Mobile Test v1.7</h1>
      <div class="header-controls">
        <select id="device-select"><option>Loading…</option></select>
        <button id="import-zones">Import Zones</button>
        <button id="export-zones">Export Zones</button>
        <button id="toggle-edit">Edit Mode</button>
      </div>
      <div id="edit-banner" style="display:none; color:orange; font-weight:bold; margin-left:1em;">
        Unsaved zone changes — click Export Zones to save.
      </div>
    </header>
    <main class="main-content">
      <div class="canvas-wrapper">
        <canvas id="visualizationCanvas" width="960" height="600"></canvas>
      </div>
      <aside class="zone-sidebar">
        <h3>Zones</h3>
        <div id="zone-tiles"></div>
      </aside>
    </main>
    `;

    this.shadowRoot.append(container);

    // === Canvas setup ===
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (!canvas) {
      console.error('[Card] No canvas element found.');
      return;
    }

    // Create the RadarCanvas renderer (handles its own resizing)
    this.radarCanvas = new RadarCanvas(canvas);
    this.radarCanvas._parentCard = this;     // ✅ give editMode access
    this.radarCanvas.resize(); // ensure _width/_height are set before first draw

    // Redraw automatically on resize/orientation change
    const resizeHandler = () => this.radarCanvas.resize();
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', resizeHandler);

   
   

    // === Device selector ===

    //this.bridge = null;
    this.populateDevices();
     // === Header button actions ===
      this.shadowRoot.getElementById('import-zones')
      .addEventListener('click', () => this.loadZonesFromHA());
    this.shadowRoot.getElementById('export-zones')
      .addEventListener('click', () => this.saveZonesToHA());
    this.shadowRoot.querySelector('#toggle-edit').addEventListener('click', () => {
      this._editMode = !this._editMode;
      this._editing = false;

      const btn = this.shadowRoot.querySelector('#toggle-edit');
      btn.textContent = this._editMode ? 'Exit Edit Mode' : 'Edit Mode';
      btn.style.background = this._editMode ? 'var(--primary-color)' : '';
      this.radarCanvas.draw();
      //`[Card] Edit mode ${this._editMode ? 'enabled' : 'disabled'}`);
    });

    //document.getElementById('export-zones')?.addEventListener('click', () => this.saveZonesToHA());
    //document.getElementById('import-zones')?.addEventListener('click', () => this.loadZonesFromHA());

    console.info('[Card] Initialization complete ✅');
  }



    showTouchMarker(x, y, color = 'orange') {
      this._touchMarker = { x, y, color, timestamp: Date.now() };
  }
  showUnsavedBanner() {
    const banner = this.shadowRoot.querySelector('#edit-banner');
    if (banner) banner.style.display = 'inline';
  }
  
  onCanvasDown(e) {

    if (!this._zones) return;
    if (!this._editMode) return;  // prevents accidental drags in view-only mode

    this._editing = true; // ignore HA updates while dragging
    this._zonesCache = this._zones = this.radarCanvas.zones;

    const rect = this.radarCanvas.canvas.getBoundingClientRect();
    const isTouch = e.touches && e.touches.length;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    // CSS px → canvas buffer px (handles devicePixelRatio)
    const scaleX = this.radarCanvas.canvas.width  / rect.width;
    const scaleY = this.radarCanvas.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top)  * scaleY;

    // Convert to world (meters). Do NOT subtract origin here.
    const world = this.radarCanvas.canvasToWorld(x, y);
    console.log(
      `[Click] canvas=(${x.toFixed(1)}, ${y.toFixed(1)})  world=(${world.x.toFixed(2)}, ${world.y.toFixed(2)})  origin=(${this.radarCanvas.origin.x.toFixed(1)}, ${this.radarCanvas.origin.y.toFixed(1)})`
    );

    // 🆕 Draw a small magenta marker at click point (visual debug)
    const ctx = this.radarCanvas.ctx;
    const c = this.radarCanvas.worldToCanvas(world.x, world.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'magenta';
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Hit-test corners using the same world→canvas transform as drawing ---
    for (const [zoneNum, z] of Object.entries(this._zones)) {
      for (const corner of ['start', 'end']) {
        if (!z[corner]) continue;

        const c = this.radarCanvas.worldToCanvas(z[corner].x, z[corner].y);
        const dx = x - c.x;
        const dy = y - c.y;
        if (Math.hypot(dx, dy) < 25) {
          // 🧭 Use the actual corner’s world position, not the raw click point
          const startWorld = { 
            x: z[corner].x, 
            y: z[corner].y 
          };
          this._dragging = { zoneNum, corner, startWorld };
          console.log(`[Drag start] zone ${zoneNum} ${corner} at world=(${startWorld.x.toFixed(2)},${startWorld.y.toFixed(2)})`);

          window.addEventListener('mousemove', this.onCanvasMoveBound);
          window.addEventListener('mouseup', this.onCanvasUpBound);
          return;
        }
      }
    }
  }



 onCanvasMove(e) {

    if (!this._dragging || !this.radarCanvas) return;
    if (!this._editMode) return;

    // Ensure zones stay synced with radarCanvas
    this._zonesCache = this._zones = this.radarCanvas.zones;

    const rect = this.radarCanvas.canvas.getBoundingClientRect();

    // Handle both mouse and touch
    const isTouch = e.touches && e.touches.length;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    const scaleX = this.radarCanvas.canvas.width  / rect.width;
    const scaleY = this.radarCanvas.canvas.height / rect.height;

    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top)  * scaleY;

    // clamp inside canvas (canvas px, not CSS)
    x = Math.max(0, Math.min(this.radarCanvas.canvas.width,  x));
    y = Math.max(0, Math.min(this.radarCanvas.canvas.height, y));

    // === Convert canvas → radar-relative (meters) ===
    const worldNow = this.radarCanvas.canvasToWorld(x, y);

    // 🆕 Compute delta since last world position
    const { zoneNum, corner, startWorld } = this._dragging;
    const dx = worldNow.x - startWorld.x;
    const dy = worldNow.y - startWorld.y;

    const zoneCache = this._zonesCache?.[zoneNum];
    if (!zoneCache || !zoneCache.start || !zoneCache.end) {
      console.warn(`[Move] Zone ${zoneNum} missing data`, zoneCache);
      return;
    }

    // 🆕 Apply delta instead of absolute overwrite
    zoneCache[corner].x += dx;
    zoneCache[corner].y = Math.max(0, zoneCache[corner].y + dy); // clamp above radar line

    // 🆕 Update drag reference so it moves smoothly
    this._dragging.startWorld = worldNow;

    this.radarCanvas.clampZone(zoneCache);   // keep inside radar fan
    this._zones = this._zonesCache;

    // === Optional: enforce minimum zone size ===
    const minSpan = 0.1; // meters
    const zx = Math.abs(zoneCache.end.x - zoneCache.start.x);
    const zy = Math.abs(zoneCache.end.y - zoneCache.start.y);
    if (zx < minSpan) {
      if (corner === 'start') zoneCache.start.x = zoneCache.end.x - minSpan;
      else zoneCache.end.x = zoneCache.start.x + minSpan;
    }
    if (zy < minSpan) {
      if (corner === 'start') zoneCache.start.y = zoneCache.end.y - minSpan;
      else zoneCache.end.y = zoneCache.start.y + minSpan;
    }

    // Redraw and visual feedback
    this.radarCanvas.update(this._zonesCache, this._targets);

    if (!this._lastMarker || Date.now() - this._lastMarker > 80) {
      this.showTouchMarker(x, y, 'lime');
      this._lastMarker = Date.now();
    }

    this._editing = true;
    this._editMode = true;

    if (this.radarCanvas?.ctx) {
      console.log('[Draw request]');
      this.radarCanvas.draw();
    }
  }



  onCanvasUp() {
    if (this._dragging) {
      console.info('[Card] Finished dragging', this._dragging);
      this._dragging = null;
      this._editing = true;   // mark unsaved changes
    }
    this._touchMarker = null;
  }

  setConfig(config) {
    this._config = config || {};
    this.debug = !!this._config.debug;
  }

  
  saveZonesToHA() {
  if (!this._hass || !this._selectedDevice || !this._zones) return;
  if (this._zonesCache) this._zones = JSON.parse(JSON.stringify(this._zonesCache));
    for (const [zoneNum, z] of Object.entries(this._zones)) {
      if (!z.start || !z.end) continue;
      const prefix = `number.${this._selectedDevice}_zone_${zoneNum}`;
      const svc = (eid, value) => {
        this._hass.callService('number', 'set_value', {
          entity_id: eid,
          value: value.toFixed(3)
        });
      };
      svc(`${prefix}_x_begin`, z.start.x);
      svc(`${prefix}_x_end`, z.end.x);
      svc(`${prefix}_y_begin`, z.start.y);
      svc(`${prefix}_y_end`, z.end.y);
    }
    console.info('[Card] Zones saved to HA in radar-relative coordinates.');
    this._editMode = false;
    this._editing = false;
    const banner = this.shadowRoot.querySelector('#edit-banner');
    if (banner) banner.style.display = 'none';
    
    //console.log(`[RadarCanvas] Saved ${Object.keys(this._zones).length} zones to HA`);
  }
    

    
  

  loadZonesFromHA() {
    if (!this._hass || !this._selectedDevice) return;
    const zones = {};
    for (const [id, state] of Object.entries(this._hass.states)) {
      if (!id.startsWith(`number.${this._selectedDevice}_zone_`)) continue;
      const m = id.match(/zone_(\d+)_(x|y)_(begin|end)/);
      if (!m) continue;
      const [_, z, axis, edge] = m;
      zones[z] = zones[z] || { start: {}, end: {}, enabled: true };
      zones[z][edge === 'begin' ? 'start' : 'end'][axis] = parseFloat(state.state);
    }
    this._zones = zones;
    this.radarCanvas.draw();
    //console.log(`[RadarCanvas] Loaded ${Object.keys(zones).length} zones from HA`);
    this._editMode = false;
    this._editing = false;
    const banner = this.shadowRoot.querySelector('#edit-banner');
    if (banner) banner.style.display = 'none';
    console.info('[Card] Local edits discarded — sync restored.');
  }

  // Update Sidebar
  updateSidebar() {
    // Match your HTML ID exactly
    const container = this.shadowRoot.querySelector('#zone-tiles');
    if (!container || !this._selectedDevice) return;

    // Prefer local zones built by _onHassUpdate()
    let zones = this._zones || {};

    // If bridge data exists and has zones, use it instead
    if (this.bridge) {
      const bridgeZones = this.bridge.getZones(this._selectedDevice);
      if (bridgeZones && Object.keys(bridgeZones).length) zones = bridgeZones;
    }

    // Pull switch states directly from HA for enable/occupy status
    const zoneSwitches = Object.entries(this._hass.states)
      .filter(([id]) => id.includes(`${this._selectedDevice}_zone_`) && id.includes('_enable'));

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
      tile.style = `
        border:1px solid #888;
        border-radius:8px;
        padding:0.5em;
        margin-bottom:0.5em;
        cursor:pointer;
        background:${enabled
          ? occupied
            ? 'rgba(25,135,84,0.3)'
            : 'rgba(13,110,253,0.1)'
          : 'rgba(200,200,200,0.2)'};
      `;
      tile.innerHTML = `
        <strong>Zone ${zoneNum}</strong><br>
        Enabled: ${enabled}<br>
        Occupied: ${occupied}<br>
        X: ${(z.start?.x ?? '?')} → ${(z.end?.x ?? '?')}<br>
        Y: ${(z.start?.y ?? '?')} → ${(z.end?.y ?? '?')}
      `;

      tile.onclick = () => {
        // 🫧 Light haptic feedback for mobile
        if (navigator.vibrate) navigator.vibrate(20);
        this._activeZone = zoneNum;
        this.radarCanvas.highlightZone(zoneNum);  // ✅ call into canvas        
        this.shadowRoot.querySelectorAll('.zone-tile').forEach(t => t.classList.remove('active'));
        tile.classList.add('active');

        // Toggle the HA switch if context exists
        if (this._hass) {
          this._hass.callService('switch', 'toggle', { entity_id: id });
        }
      };

      // Small animation pulse on state change
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
  _round(x) {
    // Snap to half-pixel boundary for crisp 1px strokes
    return Math.round(x) + 0.5;
  }

  /*
  Design Concept:
  ----------------
  The radar sensor is modelled as having a forward-facing detection arc only — 
  it cannot detect objects behind it. To represent this visually, the sensor's 
  origin is positioned along one edge of the canvas (typically the top edge). 
  The detection arc then extends outward into the canvas, covering an angular 
  range of approximately –90° to +90° relative to the sensor’s forward axis.

  This approach simplifies the coordinate logic: 
  the origin remains fixed at the edge, and the arc of detection always 
  projects forward in a single direction. It provides a clear visual 
  representation of how the radar perceives its environment.
  */

  // === Coordinate transforms between radar-local and world space ===
  // === Rotate a point around the radar's actual origin ===
  // Note: 'origin' should be the same used in your draw() (top-centred).
  toWorld(x, y, theta, origin = { x: 0, y: 0 }) {
    // Translate local coords so origin is (0,0)
    const lx = x - origin.x;
    const ly = y - origin.y;

    // Rotate around radar origin
    const wx = lx * Math.cos(theta) - ly * Math.sin(theta);
    const wy = lx * Math.sin(theta) + ly * Math.cos(theta);

    // Translate back
    return { x: wx + origin.x, y: wy + origin.y };
  }

  toLocal(x, y, theta, origin = { x: 0, y: 0 }) {
    // Translate world → radar-origin coordinates
    const lx = x - origin.x;
    const ly = y - origin.y;

    // Reverse rotation (opposite of above)
    const wx = lx * Math.cos(-theta) - ly * Math.sin(-theta);
    const wy = lx * Math.sin(-theta) + ly * Math.cos(-theta);

    // Translate back to radar-local coordinates
    return { x: wx + origin.x, y: wy + origin.y };
  }

 
  populateDevices() {
    if (!this.bridge) {
      console.warn('[Card] populateDevices() called before bridge exists — skipping.');
      return;
    }

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
      this.onHassUpdate();   // kick off initial draw
    }

    select.onchange = (e) => {
      this._selectedDevice = e.target.value;
      console.info('[Card] Device changed to:', this._selectedDevice);
      this.onHassUpdate();
    };
  }


  getCardSize() { return 2; }
  setConfig(config) { this._config = config || {}; }
  
}

customElements.define('ep-zone-configurator-card', EPZoneConfiguratorCard);
