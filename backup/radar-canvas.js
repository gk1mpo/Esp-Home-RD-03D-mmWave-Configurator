export class RadarCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.SCALE = 10;
        this.origin = { x: 0, y: 0 };
        this.theta = 0;       // radians
        this.maxRange = 6;    // metres
         this.zones = {};
        this.targets = {};
    }
    update(zones = {}, targets = {}) {
        this.zones = zones || {};
        this.targets = targets || {};
        this.draw();  // always clear + redraw full scene
        //console.log('[RadarCanvas] update()', JSON.stringify(zones, null, 2));
    }

    setGeometry({ scale, origin, theta, range }) {
        if (scale) this.SCALE = scale;
        if (origin) this.origin = origin;
        if (theta !== undefined) this.theta = theta;
        if (range) this.maxRange = range;
    }

    setData({ zones, targets }) {
        this.zones = zones || {};
        this.targets = targets || {};
    }

    
   

    // Prevent any zone from going "behind" the radar
    clampZone(z) {
        if (!z.start || !z.end) return z;

        // 1️⃣ Restrict Y ≥ 0 (no “behind” the radar)
        z.start.y = Math.max(0, z.start.y);
        z.end.y   = Math.max(0, z.end.y);

        // 2️⃣ Restrict radial distance ≤ maxRange
        const r1 = Math.hypot(z.start.x, z.start.y);
        const r2 = Math.hypot(z.end.x,   z.end.y);
        const scale1 = r1 > this.maxRange ? this.maxRange / r1 : 1;
        const scale2 = r2 > this.maxRange ? this.maxRange / r2 : 1;
        if (scale1 < 1) { z.start.x *= scale1; z.start.y *= scale1; }
        if (scale2 < 1) { z.end.x   *= scale2; z.end.y   *= scale2; }

        // 3️⃣ Restrict angular position within the fan (±fanAngle/2)
        const fanAngle = Math.PI / 2; // same as draw()
        const limitAngle = fanAngle / 2;
        const limitPoint = (p) => {
            const angle = Math.atan2(p.x, p.y);  // radar "forward" along +Y
            if (angle > limitAngle) {
            const a = limitAngle;
            const r = Math.hypot(p.x, p.y);
            p.x = r * Math.sin(a);
            p.y = r * Math.cos(a);
            } else if (angle < -limitAngle) {
            const a = -limitAngle;
            const r = Math.hypot(p.x, p.y);
            p.x = r * Math.sin(a);
            p.y = r * Math.cos(a);
            }
        };
        limitPoint(z.start);
        limitPoint(z.end);

        // 4️⃣ Minimum height (still keep your 0.05 m logic)
        const minH = 0.05;
        if (z.end.y - z.start.y < minH) z.end.y = z.start.y + minH;

        return z;
        }

    
    // rotate a point (x, y) by the current installation angle
    rotatePoint(x, y) {
        // theta is saved each frame inside draw()
        const theta = this._currentTheta ?? 0;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // standard 2-D rotation (clockwise canvas frame)
        return {
            x: x * cosT - y * sinT,
            y: x * sinT + y * cosT
        };
    }

    // radar-relative (meters) → canvas pixels
    worldToCanvas(x, y) {
        const cosT = Math.cos(this.theta);
        const sinT = Math.sin(this.theta);
        const rx =  x * cosT - y * sinT;
        const ry =  x * sinT + y * cosT;
        return {
            x: this.origin.x + rx * this.SCALE,
            y: this.origin.y - ry * this.SCALE   // 🧭 flip Y back for screen draw
        };
        }

    // canvas pixels → radar-relative (meters)
    canvasToWorld(px, py) {
    // Move click into radar-local coordinates
    const relX = px - this.origin.x;
    const relY = this.origin.y - py;   // 🧭 invert Y to make upward positive

    // Undo rotation and scale
    const cosT = Math.cos(-this.theta);  // flip rotation sense
    const sinT = Math.sin(-this.theta);
    const x = ( relX * cosT - relY * sinT ) / this.SCALE;
    const y = ( relX * sinT + relY * cosT ) / this.SCALE;

    console.log(`[CTW] px=${px.toFixed(1)}, py=${py.toFixed(1)} → world=(${x.toFixed(2)},${y.toFixed(2)}) θ=${(this.theta*180/Math.PI).toFixed(1)}°`);
    return { x, y };
    }

    drawZones(ctx) {
        for (const [, z] of Object.entries(this.zones || {})) {
        if (!z.enabled) continue;
        ctx.fillStyle = z.occupied
            ? 'rgba(255, 80, 80, 0.25)'
            : 'rgba(80, 255, 80, 0.1)';
        ctx.beginPath();
        ctx.arc(
            this.origin.x + z.x * this.SCALE,
            this.origin.y + z.y * this.SCALE,
            10,
            0,
            2 * Math.PI
        );
        ctx.fill();
        }
    }

    drawTargets(ctx) {
        for (const [, t] of Object.entries(this.targets || {})) {
        ctx.fillStyle = '#2196f3';
        ctx.beginPath();
        ctx.arc(
            this.origin.x + t.x * this.SCALE,
            this.origin.y + t.y * this.SCALE,
            4,
            0,
            2 * Math.PI
        );
        ctx.fill();
        }
    }
    clear() {
        const ratio = window.devicePixelRatio || 1;
        // clear the full backing buffer
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // restore DPR scale for subsequent drawing
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    draw() {
        const ctx = this.ctx;
        this.clear();

        // === Canvas geometry ===
        const w = this._width  ?? this.canvas.clientWidth;
        const h = this._height ?? this.canvas.clientHeight;

        // === 1. Read installation angle directly from HA ===
        const dirEntity = this._hass?.states?.[`number.${this._selectedDevice}_installation_angle`];
        const directionDeg = Number(dirEntity?.state || 0);
        const theta = directionDeg * Math.PI / 180;
        this.theta = theta + Math.PI / 2;   // align coordinate math with fan rotation

        // === 2. Get distance from HA (clamped 1–8 m) ===
        const distEntity = this._hass?.states?.[`number.${this._selectedDevice}_distance`];
        let distMeters = Number(distEntity?.state || 6);
        distMeters = Math.max(1, Math.min(distMeters, 8));
        this.maxMeters = distMeters;

        // === 3. Compute dynamic scale (so full range fits canvas width nicely) ===
        this.SCALE = (w * 0.45) / this.maxMeters;
        const rangePx = this.maxMeters * this.SCALE;

        // === 4. Compute origin & centering based on installation angle ===
        const maxOffset = w * 0.65;
        const ratio = Math.sin(theta);
        const topMargin = Math.max(5, h * 0.02);
        this.origin = { x: w / 2 + ratio * maxOffset, y: topMargin };

        this._currentTheta = theta;
        this._currentRange = rangePx;

        // === Theme colours from HA ===
        const root = document.documentElement;
        const themePrimary = getComputedStyle(root).getPropertyValue('--primary-color') || '#0d6efd';
        const themeText = getComputedStyle(root).getPropertyValue('--primary-text-color') || '#111';
        const themeBg = getComputedStyle(root).getPropertyValue('--card-background-color') || '#fafafa';

        // === Subtle grid backdrop ===
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= w; gx += w / 10) {
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
        }
        for (let gy = 0; gy <= h; gy += h / 10) {
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
        }
        ctx.restore();

        // === Forward-facing detection fan ===
        ctx.save();

        ctx.translate(this.origin.x, this.origin.y);
        //console.log(`[Origin check] origin=(${this.origin.x.toFixed(1)}, ${this.origin.y.toFixed(1)})  canvas=(${this.canvas.width},${this.canvas.height})  SCALE=${this.SCALE.toFixed(2)}`);

        ctx.rotate(theta + Math.PI / 2);

        const fanAngle = Math.PI / 2; // ±45° FOV
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, rangePx, -fanAngle / 2, fanAngle / 2);
        ctx.closePath();

        const fanFill = themePrimary + '22'; // translucent
        const fanStroke = themePrimary + '80';
        ctx.fillStyle = fanFill;
        ctx.strokeStyle = fanStroke;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        // === Calibration rings ===
        const fanSweep = Math.PI / 4;
        for (let r = 1; r <= this.maxMeters; r++) {
            ctx.beginPath();
            ctx.setLineDash(r % 2 === 0 ? [5, 5] : []);
            ctx.strokeStyle = r === Math.round(this.maxMeters)
            ? 'rgba(0,0,0,0.65)'
            : 'rgba(0,0,0,0.25)';
            ctx.lineWidth = r === Math.round(this.maxMeters) ? 2 : 1;
            ctx.arc(0, 0, r * this.SCALE, -fanSweep, fanSweep);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = themeText;
            ctx.font = '10px monospace';
            ctx.fillText(`${r} m`, r * this.SCALE + 6, 0);
        }
        ctx.restore();

        // === Sensor origin marker ===
        ctx.fillStyle = '#ff9900';
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // === Zones ===
        // // Clamp all zones before rendering
        // Clamp all zones before rendering
       
        for (const z of Object.values(this.zones)) this.clampZone(z);

        // === Zones ===
        ctx.save();

        
        const drawHandle = (x, y, color) => {
            const r = 6;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.stroke();
        };
        for (const [num, z] of Object.entries(this.zones || {})) {
            if (!z.start || !z.end || !z.enabled) continue;

            const p1 = this.worldToCanvas(z.start.x, z.start.y);
            const p2 = this.worldToCanvas(z.end.x, z.end.y);
            const width  = p2.x - p1.x;
            const height = p2.y - p1.y;

            // Gradient shading
            const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
            if (z.occupied) {
            grad.addColorStop(0, 'rgba(255,80,80,0.35)');
            grad.addColorStop(1, 'rgba(255,255,255,0.05)');
            } else {
            grad.addColorStop(0, themePrimary + '40');
            grad.addColorStop(1, themeBg + '10');
            }
            ctx.fillStyle = grad;
            ctx.fillRect(p1.x, p1.y, width, height);

            // Zone outline
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(p1.x, p1.y, width, height);

            // === Handles in edit mode ===
            if (this._parentCard?._editMode) {
            // Debug crosshair for each handle (in bright magenta)
            ctx.save();
            ctx.strokeStyle = 'magenta';
            ctx.lineWidth = 2;
            for (const [zoneNum, z] of Object.entries(this.zones)) {
                for (const corner of ['start', 'end']) {
                    if (!z[corner]) continue;
                    const c = this.worldToCanvas(z[corner].x, z[corner].y);
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.font = '12px sans-serif';
                    ctx.fillStyle = 'magenta';
                    ctx.fillText(`Z${zoneNum}-${corner}`, c.x + 12, c.y);
                }
            }
            ctx.restore();
            drawHandle(p1.x, p1.y, 'lime');
            drawHandle(p2.x, p2.y, 'orange');
            }

            // Highlight selected
            if (this._highlightZone && Number(num) === Number(this._highlightZone)) {
            ctx.strokeStyle = 'rgba(255,215,0,0.9)';
            ctx.lineWidth = 3;
            ctx.strokeRect(p1.x, p1.y, width, height);
            }

            // Zone label
            ctx.fillStyle = themeText;
            ctx.font = '14px sans-serif';
            ctx.fillText(`Z${num}`, p1.x + 6, p1.y + 18);
        }
        ctx.restore(); // restore default transform for targets and labels
        // === Targets ===
        for (const [num, t] of Object.entries(this.targets || {})) {
            if (t.x === undefined || t.y === undefined) continue;
            const p = this.worldToCanvas(t.x, t.y);
            ctx.fillStyle = 'rgba(220,53,69,0.9)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = themeText;
            ctx.font = '12px sans-serif';
            ctx.fillText(`T${num}`, p.x + 8, p.y);
        }

        // === Origin glow accent ===
        ctx.beginPath();
        ctx.arc(this.origin.x, this.origin.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'lime';
        ctx.fill();
        }

  
    updateScale(rect) {
        this.SCALE = rect.width / 3.2; // adaptive scaling
    }

    

    setConfig({ theta, maxRange, zones, targets }) {

        if (theta !== undefined) this.theta = theta * (Math.PI / 180);
        if (maxRange !== undefined) this.maxRange = maxRange;
        if (zones) this.zones = zones;
        if (targets) this.targets = targets;
        this.draw();
    }
    
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;

        // Physical pixels for crispness
        this.canvas.width  = Math.max(1, Math.floor(rect.width  * ratio));
        this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));

        // Reset transform, then apply DPR scale
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        // Store *logical* size for layout math
        this._width  = rect.width;
        this._height = rect.height;

        this.updateScale(rect);
        this.draw();
    }
    highlightZone(zoneNum) {
        this._highlightZone = zoneNum;
        this.draw();
    }
}
