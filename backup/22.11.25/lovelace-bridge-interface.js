// lovelace-bridge-interface.js
export class LovelaceBridgeInterface {
  constructor(hass, deviceId = null, debug = false) {
    this.hass = hass;
    this.deviceId = deviceId;
    this.subscribers = [];
    this.debug = debug; // enable to print matches
  }

  getDevices() {
    const names = new Set();

    for (const [entity_id] of Object.entries(this.hass.states)) {
      if (!entity_id.match(/^(sensor|binary_sensor|switch|number)\./)) continue;

      // Strip domain, keep base prefix
      const id = entity_id.split('.')[1];

      // Only include ESPHome-like entities
      if (!id.startsWith('esp_') && !id.startsWith('sbhtr_') && !id.startsWith('shelly_')) continue;

      // Capture "esp_sensor_1" from "esp_sensor_1_zone_3_x_end"
      const baseMatch = id.match(/^(esp_[^_]+_[^_]+)/i);
      if (baseMatch && baseMatch[1]) names.add(baseMatch[1]);
    }

    if (this.debug) {
      console.groupCollapsed('[Bridge] Base Device Matches');
      names.forEach(n => console.log('Device:', n));
      console.groupEnd();
    }

    return Array.from(names);
  }


  // Get all states for one device
  getDeviceState(deviceId) {
    return Object.fromEntries(
      Object.entries(this.hass.states).filter(([id]) => id.includes(deviceId))
    );
  }

  // Push command to Home Assistant
  async call(command, data = {}) {
    console.info(`[Bridge] Sending command: ${command}`, data);
    await this.hass.callService('esphome', 'send_command', {
      command,
      data,
      device_id: this.deviceId,
    });
  }

  // Subscribe callback for state changes
  onStateChange(callback) {
    this.subscribers.push(callback);
  }

  notifySubscribers(changedEntity) {
    for (const cb of this.subscribers) cb(changedEntity);
  }
 
  // === Zone + Target Extractors ===
  getZones(deviceId) {
    const zones = {};

    for (const [id, state] of Object.entries(this.hass.states)) {
      if (!id.includes(`${deviceId}_zone_`)) continue;

      // 1️⃣ Rectangular coordinates (x/y)
      if (id.startsWith('number.')) {
        let m = id.match(/zone_(\d+)_(x|y)_(begin|end|1|2)/);
        if (m) {
          const [_, z, axis, edge] = m;
          const isStart = edge === 'begin' || edge === '1';
          zones[z] = zones[z] || { start: {}, end: {}, distance: {} };
          zones[z][isStart ? 'start' : 'end'][axis] = parseFloat(state.state);
          continue;
        }

        // 2️⃣ Radial distances
        m = id.match(/zone_(\d+)_(start|end)$/);
        if (m) {
          const [_, z, which] = m;
          zones[z] = zones[z] || { start: {}, end: {}, distance: {} };
          zones[z].distance[which] = parseFloat(state.state);
          continue;
        }
      }

      // 3️⃣ Enable switches
      if (id.startsWith('switch.') && id.includes('_enable')) {
        const m = id.match(/zone_(\d+)_enable/);
        if (m) {
          const [_, z] = m;
          zones[z] = zones[z] || { start: {}, end: {}, distance: {} };
          zones[z].enabled = state.state === 'on';
          continue;
        }
      }

      // 4️⃣ Occupancy sensors
      if (id.startsWith('binary_sensor.') && id.includes('_occupied')) {
        const m = id.match(/zone_(\d+)_occupied/);
        if (m) {
          const [_, z] = m;
          zones[z] = zones[z] || { start: {}, end: {}, distance: {} };
          zones[z].occupied = state.state === 'on';
          // Give it a fill color based on occupancy
          zones[z].fill = state.state === 'on'
            ? 'rgba(255, 0, 0, 0.25)'
            : 'rgba(13,110,253,0.2)';
          continue;
        }
      }
    }

    // Ensure all zones have the same shape
    for (const [num, z] of Object.entries(zones)) {
      z.enabled  ??= true;
      z.occupied ??= false;
      z.fill     ??= 'rgba(13,110,253,0.2)';
    }

    return zones;
  }



  getTargets(deviceId) {
    const targets = {};
    const seen = []; // debug info

    for (const [id, s] of Object.entries(this.hass.states)) {
      if (!id.startsWith('sensor.')) continue;
      if (!id.includes(`${deviceId}_target_`)) continue;

      // Accept any of these: distance, speed, angle, x, y
      const m = id.match(/target_(\d+)_(distance|speed|angle|x|y)$/);
      if (!m) continue;

      const [, num, key] = m;
      const raw = s.state;

      // Skip non-numeric states
      if (raw === 'unknown' || raw === 'unavailable' || raw === '') continue;

      const val = parseFloat(raw);
      if (Number.isNaN(val)) continue;

      targets[num] = targets[num] || {};
      targets[num][key] = val;
      seen.push([id, val]); // for debugging
    }

    // Derive x/y if missing and we have distance + angle
    for (const [n, t] of Object.entries(targets)) {
      if ((t.x === undefined || t.y === undefined) && t.distance !== undefined && t.angle !== undefined) {
        const rad = (t.angle * Math.PI) / 180; // degrees → radians
        // Assuming standard math axes: x to the right, y up.
        // If your sensor’s 0°/axes differ, we can swap cos/sin later.
        if (t.x === undefined) t.x = t.distance * Math.cos(rad);
        if (t.y === undefined) t.y = t.distance * Math.sin(rad);
      }
    }

    // Debug view
    if (this.debug) {
      //console.groupCollapsed('[Bridge] Target debug');
      //console.log('Seen numeric target fields:', seen);
      //console.log('Computed targets (pre-filter):', targets);
      //console.groupEnd();
    }

    // Return only targets that have usable x & y
    const filtered = {};
    for (const [n, t] of Object.entries(targets)) {
      if (t.x !== undefined && t.y !== undefined) {
        filtered[n] = { x: t.x, y: t.y };
      }
    }
    return filtered;
  }

}
