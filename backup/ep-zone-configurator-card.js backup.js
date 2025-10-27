import { LovelaceBridgeInterface } from '/local/everything-presence-mmwave-configurator/lovelace-bridge-interface.js';

class EPZoneConfiguratorCard extends HTMLElement {
  SCALE = 10; // 1 m = 40 px
  

  constructor() {
    super();
    this._dragging = null;   // { zoneNum, corner }
    this._zonesCache = {};   // last drawn zones for editing
    this._touchMarker = null;
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) this._initialize();
  
    // Ensure connection state label updates
    if (this._hass && !this._haReady) {
      const status = this.shadowRoot.querySelector('#status-text');
      if (status) status.textContent = 'Connected to Home Assistant ✅';
      this._haReady = true;
    }

    // Keep bridge reference current
    if (this.bridge) this.bridge.hass = this._hass;

    // Create bridge if not yet done
    if (!this.bridge && this._hass) {
      console.info('[Card] Initialising bridge…');
      this.bridge = new LovelaceBridgeInterface(this._hass);
      this._populateDevices();
      this._lastUpdate = 0;
    }

    // ✅ Attach canvas event listeners once, only after shadow DOM is ready

    if (!this._canvasListenersAttached) {
      const canvas = this.shadowRoot?.querySelector('#visualizationCanvas');
      if (canvas) {
        // 🖱️ Mouse support
        canvas.addEventListener('mousedown', (e) => this._onCanvasDown(e));
        canvas.addEventListener('mousemove', (e) => this._onCanvasMove(e));
        canvas.addEventListener('mouseup',   (e) => this._onCanvasUp(e));

        // 🖐️ Touch support (mobile / tablet)
        canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          // Convert touch → synthetic mouse event for reuse
          const t = e.touches[0];
          const simulatedEvent = {
            clientX: t.clientX,
            clientY: t.clientY,
            target: canvas,
            touches: e.touches
          };
          this._onCanvasDown(simulatedEvent);
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
          e.preventDefault();
          const t = e.touches[0];
          this._onCanvasMove({
            clientX: t.clientX,
            clientY: t.clientY,
            touches: e.touches,
            target: canvas
          });
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
          e.preventDefault();
          this._onCanvasUp(e);
        });
        canvas.addEventListener('mouseleave',(e) => this._onCanvasUp(e));
        this._canvasListenersAttached = true;
        console.info('[Card] Canvas event listeners attached ✅');
      }
    }

    // Regular updates
    if (this.bridge) this._onHassUpdate();
  }


  _initialize() {
    const SCALE = this.SCALE;
    this._initialized = true;
    this.attachShadow({ mode: 'open' });

    // Load CSS
    fetch('/local/everything-presence-mmwave-configurator/styles.css')
      .then(r => r.text())
      .then(css => {
        const style = document.createElement('style');
        style.textContent = css;
        this.shadowRoot.append(style);
      });

    // DOM scaffold
    const container = document.createElement('div');
    container.id = 'container';
    container.innerHTML = `
      <header>
        <h1>EP Zone Configurator Bridge Mobile Test v1.5 </h1>
        <div class="header-controls">
          <select id="device-select"><option>Loading…</option></select>
          <button id="import-zones">Import Zones</button>
          <button id="export-zones">Export Zones</button>
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

    // Append DOM now so getBoundingClientRect() returns proper values
    this.shadowRoot.append(container);

    // --- Canvas setup ---
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    // Track if the first proper resize has completed
    this._firstResizeDone = false;
    this._suppressNextResize = true;

    // 🧭 Orientation / resize sync
    const resizeCanvas = () => {
      const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
      if (!canvas) return;

      
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width;
      canvas.height = rect.height;
      this.SCALE = rect.width / 4.8;

      if (this._lastMarker) this._lastMarker = 0;

      // Redraw zones + targets
      if (this.bridge && this._selectedDevice) {
        const zones = this.bridge.getZones(this._selectedDevice);
        const targets = this.bridge.getTargets(this._selectedDevice);
        this._drawRadar(zones, targets);
      }

      this._firstResizeDone = true; // mark initialization done
    };

    // Delayed first resize to avoid early layout zero width
    window.setTimeout(() => {
      resizeCanvas();
      this._firstResizeDone = true;
    }, 150);

    // Handle future resize/orientation events
    const handleResize = () => {
      // skip if still initializing or first resize after init
      if (!this._firstResizeDone || this._suppressNextResize) {
        this._suppressNextResize = false;
        return;
      }
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(resizeCanvas, 250);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // --- Button setup ---
    this.shadowRoot.getElementById('import-zones')
      .addEventListener('click', () => this._importZones());
    this.shadowRoot.getElementById('export-zones')
      .addEventListener('click', () => this._exportZones());

    // --- Bridge placeholder ---
    this.bridge = null;

    // 🌀 Continuous redraw loop
    const animate = () => {
      if (this.bridge && this._selectedDevice) {
        const zones = this.bridge.getZones(this._selectedDevice);
        const targets = this.bridge.getTargets(this._selectedDevice);
        this._drawRadar(zones, targets);
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }


  _showTouchMarker(x, y, color = 'orange') {
    this._touchMarker = { x, y, color, timestamp: Date.now() };
  }
  _drawCalibrationOverlay(ctx, w, h) {
    // Draw axes
    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Label the axes
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('0,0', w / 2 + 5, h / 2 - 5);
    ctx.restore();

    // If there’s an active touch marker, annotate its coordinates
    if (this._touchMarker) {
      const { x, y } = this._touchMarker;
      const SCALE = this.SCALE;
      const worldX = ((x - w / 2) / SCALE).toFixed(2);
      const worldY = ((h / 2 - y) / SCALE).toFixed(2);

      ctx.save();
      ctx.fillStyle = 'rgba(255, 140, 0, 0.8)';
      ctx.font = '14px monospace';
      ctx.fillText(`Screen: ${Math.round(x)}, ${Math.round(y)}`, 50, 20);
      ctx.fillText(`World: ${worldX}, ${worldY}`, 50, 40);
      ctx.restore();
    }
  }
  _onCanvasDown(e) {
    if (!this._zonesCache) return;
    const rect = e.target.getBoundingClientRect();
    const isTouch = e.touches && e.touches.length;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    // Convert window coordinates → canvas space
    const x = (clientX - rect.left);
    const y = (clientY - rect.top);
    const SCALE = this.SCALE;

    for (const [zoneNum, z] of Object.entries(this._zonesCache)) {
      for (const corner of ['start', 'end']) {
        const cx = e.target.width / 2 + z[corner].x * SCALE;
        const cy = e.target.height / 2 - z[corner].y * SCALE;
        if (Math.hypot(x - cx, y - cy) < 15) {
          this._dragging = { zoneNum, corner };
          console.debug('[Card] Dragging started:', this._dragging);
          return;
        }
      }
    }
  }

  _onCanvasMove(e) {
    if (!this._dragging) return;

    // Always reference the same canvas, not e.target (can change on touch)
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Handle both mouse and touch events
    const isTouch = e.touches && e.touches.length;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    // Convert window coordinates → canvas space
    let x = clientX - rect.left;
    let y = clientY - rect.top;

    // Clamp pointer inside the canvas
    x = Math.max(0, Math.min(rect.width, x));
    y = Math.max(0, Math.min(rect.height, y));

    // 💡 Visual feedback marker every 100 ms
    if (!this._lastMarker || Date.now() - this._lastMarker > 100) {
      this._showTouchMarker(x, y, 'lime');
      this._lastMarker = Date.now();
    }

    const SCALE = this.SCALE;
    const w = rect.width;
    const h = rect.height;

    // Convert screen → world coordinates (centre of canvas is 0,0)
    const worldX = (x - w / 2) / SCALE;
    const worldY = (h / 2 - y) / SCALE;

    const { zoneNum, corner } = this._dragging;
    if (!this._zonesCache[zoneNum]) return;

    // Update zone coordinates in memory
    this._zonesCache[zoneNum][corner].x = worldX;
    this._zonesCache[zoneNum][corner].y = worldY;

    // Redraw with immediate feedback
    this._drawRadar(this._zonesCache, {});
  }


  _onCanvasUp() {
    if (this._dragging) {
      console.info('[Card] Finished dragging', this._dragging);
      this._dragging = null;
    }
    this._touchMarker = null;  // <— clear the overlay marker
  }

  setConfig(config) {
    this._config = config || {};
    this.debug = !!this._config.debug;
  }
  _importZones() {
    if (!this.bridge || !this._selectedDevice) return;
    console.info('[Card] Importing zones from Home Assistant …');
    const zones = this.bridge.getZones(this._selectedDevice);
    this._drawRadar(zones, this.bridge.getTargets(this._selectedDevice));
    this._updateSidebar();
  }
  _exportZones() {
    if (!this.bridge || !this._selectedDevice || !this._hass) return;
    const zones = this._zonesCache || this.bridge.getZones(this._selectedDevice);
    console.info('[Card] Exporting zones to Home Assistant …');

    for (const [num, z] of Object.entries(zones)) {
      const coords = [
        ['x_begin', z.start.x],
        ['y_begin', z.start.y],
        ['x_end',   z.end.x],
        ['y_end',   z.end.y],
      ];

      for (const [suffix, value] of coords) {
        if (value === undefined) continue;
        const entityId = `number.${this._selectedDevice}_zone_${num}_${suffix}`;
        this._hass.callService('number', 'set_value', {
          entity_id: entityId,
          value,
        });
        console.debug(`[Card] Updated ${entityId} = ${value}`);
      }
    }
  }

  _onHassUpdate() {
    //console.debug('[Card] hass states:', Object.keys(this._hass?.states || {}).length);
    if (!this._selectedDevice) return;

    const zones   = this.bridge.getZones(this._selectedDevice);
    const targets = this.bridge.getTargets(this._selectedDevice);
    this._updateSidebar();

    this._drawRadar(zones, targets);
  }
  // Update Sidebar
  _updateSidebar() {
    const container = this.shadowRoot.querySelector('#zone-tiles');
    if (!container || !this._selectedDevice) return;

    const zones = this.bridge.getZones(this._selectedDevice);
    const zoneSwitches = Object.entries(this._hass.states)
      .filter(([id]) => id.includes(`${this._selectedDevice}_zone_`) && id.includes('_enable'));

    container.innerHTML = '';

    zoneSwitches.forEach(([id, entity]) => {
      const zoneNum = id.match(/zone_(\d+)_/)[1];
      const enabled = entity.state === 'on';
      const occEntity = this._hass.states[`binary_sensor.${this._selectedDevice}_zone_${zoneNum}_in_zone`];
      const occupied = occEntity?.state === 'on';

      const tile = document.createElement('div');
      tile.className = 'zone-tile ' +
        (enabled ? (occupied ? 'zone-occupied' : 'zone-enabled') : 'zone-disabled');
      tile.style = `
        border:1px solid #888;
        border-radius:8px;
        padding:0.5em;
        cursor:pointer;
        background:${enabled ? (occupied ? 'rgba(25,135,84,0.3)' : 'rgba(13,110,253,0.1)') : 'rgba(200,200,200,0.2)'};
      `;
      tile.innerHTML = `
        <strong>Zone ${zoneNum}</strong><br>
        Enabled: ${enabled}<br>
        Occupied: ${occupied}<br>
        X: ${(zones[zoneNum]?.start?.x ?? '?')} → ${(zones[zoneNum]?.end?.x ?? '?')}<br>
        Y: ${(zones[zoneNum]?.start?.y ?? '?')} → ${(zones[zoneNum]?.end?.y ?? '?')}
      `;

      tile.onclick = () => {
        this._activeZone = zoneNum;
        this._highlightZone(zoneNum);
        // Update tile highlighting
        this.shadowRoot.querySelectorAll('.zone-tile').forEach(t => t.classList.remove('active'));
        tile.classList.add('active');

        // ✅ only toggle if we actually have HA context
        if (this._hass) {
          this._hass.callService('switch', 'toggle', { entity_id: id });
        } else {
          console.warn('[Card] No _hass context for toggle');
        }
      };

      container.append(tile);
    });
  }

  _drawRadar(zones, targets) {
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (!canvas) {
      console.warn('[Card] No canvas found');
      return;
    }
    if (this._suspendDraw) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw X/Y axes (red = vertical center, blue = horizontal center)
    ctx.strokeStyle = 'rgba(255,0,0,0.4)';
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,255,0.4)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    //console.debug('[Card] Redrawing zones →', Object.keys(this._zonesCache || zones));

    // Radar grid
    ctx.strokeStyle = '#ccc';
    for (let r = 100; r < 500; r += 100) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Zones
    // Store zones for drag editing
    if (!this._zonesCache || Object.keys(this._zonesCache).length === 0) {
      this._zonesCache = JSON.parse(JSON.stringify(zones));
    }
    // Choose a multiplier to scale metres → pixels
    const SCALE = this.SCALE; // 1 m = 200 px roughly; adjust to fit your canvas
    const activeZones = this._zonesCache || zones;
    Object.entries(activeZones).forEach(([zoneNum, z]) => {

      const deviceId = this._selectedDevice;
      const switchEntity = this._hass.states[`switch.${deviceId}_zone_${zoneNum}_enable`];
      const enabled = switchEntity?.state === 'on';

      // Skip drawing entirely if the zone is disabled
      if (!enabled) return;

      // Determine occupancy color
      const occEntity = this._hass.states[`binary_sensor.${deviceId}_zone_${zoneNum}_in_zone`];
      const occupied = occEntity?.state === 'on';

      const fillColor = occupied
        ? 'rgba(25,135,84,0.3)'    // green tint for active presence
        : 'rgba(13,110,253,0.2)';  // blue tint for idle zone

      // Draw the enabled zone rectangle
      if (z.start.x !== undefined && z.start.y !== undefined &&
          z.end.x !== undefined && z.end.y !== undefined) {

        const SCALE = this.SCALE;
        const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;

        const startX = w / 2 + z.start.x * SCALE;
        const startY = h / 2 - z.start.y * SCALE;
        const endX   = w / 2 + z.end.x * SCALE;
        const endY   = h / 2 - z.end.y * SCALE;

        ctx.fillStyle = fillColor;
        ctx.fillRect(startX, startY, endX - startX, endY - startY);

        // Outline for visibility
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, startY, endX - startX, endY - startY);

        // Zone label
        ctx.fillStyle = '#000';
        ctx.font = '16px sans-serif';
        ctx.fillText(`Zone ${zoneNum}`, startX + 6, startY + 18);
        // Draw draggable handles at start and end points
        ctx.fillStyle = '#ffc107';  // yellow
        for (const point of [
          [startX, startY],
          [endX, endY]
        ]) {
          ctx.beginPath();
          ctx.arc(point[0], point[1], 6, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

    });
    // --- Draw touch calibration marker if active ---
    if (this._touchMarker && Date.now() - this._touchMarker.timestamp < 1500) {
      const { x, y, color } = this._touchMarker;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over'; // ensure overlay doesn’t block hit zones
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.strokeStyle = 'red';
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y + 10);
      ctx.stroke();
      ctx.restore();
    }
    //console.debug('[Card] Drawing targets with data:', targets);

    Object.entries(targets).forEach(([num, t]) => {
      if (t.x === undefined || t.y === undefined) return;
      const SCALE = this.SCALE; // 1 m ≈ 200 px; tweak as needed
      const cx = w/2 + t.x * SCALE;
      const cy = h/2 - t.y * SCALE;

      ctx.fillStyle = 'rgba(220,53,69,0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, 2*Math.PI);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.font = '14px sans-serif';
      ctx.fillText(`T${num}`, cx + 8, cy);
    });
    ctx.fillText(`Last update: ${new Date().toLocaleTimeString()}`, 50, 80);
    this._drawCalibrationOverlay(ctx, w, h);
  }
  _highlightZone(zoneNum) {
    const canvas = this.shadowRoot.querySelector('#visualizationCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const z = this.bridge.getZones(this._selectedDevice)[zoneNum];
    if (!z) return;

    const SCALE = this.SCALE;
    const x1 = w/2 + z.start.x*SCALE;
    const y1 = h/2 - z.start.y*SCALE;
    const x2 = w/2 + z.end.x*SCALE;
    const y2 = h/2 - z.end.y*SCALE;

    ctx.strokeStyle = 'rgba(255,193,7,0.9)'; // yellow highlight
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  _populateDevices() {
    const select = this.shadowRoot.querySelector('#device-select');
    const devices = this.bridge.getDevices();

    // Bail if there are no devices
    if (!devices.length) {
      select.innerHTML = '<option>No ESPHome devices found</option>';
      this._selectedDevice = null;
      return;
    }

    // Build option list
    select.innerHTML = devices.map(d => `<option value="${d}">${d}</option>`).join('');

    // Auto-select first device on first load
    if (!this._selectedDevice) {
      this._selectedDevice = devices[0];
      select.value = this._selectedDevice;
      console.info('[Card] Auto-selected device:', this._selectedDevice);
      this._onHassUpdate();   // kick off initial draw
    }

    // Handle manual selection changes
    select.onchange = (e) => {
      this._selectedDevice = e.target.value;
      console.info('[Card] Device changed to:', this._selectedDevice);
      this._onHassUpdate();
    };
  }


  getCardSize() { return 2; }
  setConfig(config) { this._config = config || {}; }
  
}

customElements.define('ep-zone-configurator-card', EPZoneConfiguratorCard);
