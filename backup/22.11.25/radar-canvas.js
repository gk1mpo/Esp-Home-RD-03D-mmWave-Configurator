export class RadarCanvas {
    constructor(canvas, model, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.model = model || null;     // ✅ model is required for updateZones()
        this.card = options.card || null; // ✅ optional: parent card for push/save

        this.SCALE = 10;
        this.origin = { x: 0, y: 0 };
        this.theta = 0;       // radians
        this.maxRange = 6;    // metres
        this.zones = {};
        this.targets = {};
        this._ready = false;
        this._sizeValid = false;
        this._suppressModelSync = false;

        // === UI interaction state ===
        this.ui = {
            mode: 'view',              // possible: 'view', 'edit'
            pointerId: null,
            pressId: null,
            hoverId: null,
            activeZoneId: null,
            activeHandle: null,
            dragStart: null,
            originalZone: null
        };
        // === UI feedback for toolbar buttons ===

        this._uiFeedback = { hoverId: null, pressId: null, flash: null };
        this._setupButtons();
        this.installPointerHandlers();
    }
    bindModel(model) {
        this.model = model;
        this._ready = true; // the canvas is now tied to a data source
        this.waitForStableSize(() => {
            this.resize();
            this.draw();
        });

        // Subscribe to model updates
        model.onChange((type) => {
            if (this._suppressModelSync) {
                //console.warn('[RadarCanvas] Model sync suppressed');
                return;
            }
            //console.warn('[RadarCanvas] Model sync Not suppressed');
            const prevActive = this.ui.activeZoneId;  // 🧩 preserve active selection
            if (model.zones) this.zones = model.zones;
            if (model.targets) this.targets = model.targets;

            // Pull geometry state from model.transform if it changed
            const t = model.transform;
            if (t) {
                this.origin = t.origin;
                this.SCALE = t.scale;
                this.theta = t.theta;
                this.maxRange = t.maxRange;
            }

            // 🧠 restore zone highlight after redraw
            if (prevActive && this.zones[prevActive]) {
                this.ui.activeZoneId = prevActive;
            }

            this.draw();
        });
    }
    waitForStableSize(callback) {
        const el = this.canvas;
        if (!el) return;
        let lastW = 0, lastH = 0;
        let frames = 0;

        const check = () => {
            const rect = el.getBoundingClientRect();
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            if (w === lastW && h === lastH && w > 0 && h > 0) {
                frames++;
            } else {
                frames = 0;
                lastW = w;
                lastH = h;
            }
            // Require 3 consecutive identical measurements (~50–100 ms)
            if (frames >= 3) {
                callback();
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    }
    isReady() {
        if (!this._ready) return false;
        if (!this.canvas || !this.ctx) return false;
        if (!isFinite(this.SCALE) || this.SCALE <= 0) return false;
        if (!isFinite(this.maxRange) || this.maxRange <= 0) return false;
        return true;
    }
    _setupButtons() {
        if (this._buttons) return; // prevent reinitialisation

        const size = 52;

        this._buttons = {
            add: { id: "add", w: size, h: size, visible: true },
            edit: { id: "edit", w: size, h: size, visible: true },

            save: { id: "save", w: size, h: size, visible: false },
            discard: { id: "discard", w: size, h: size, visible: false },
            angle: { id: "angle", w: size, h: size, visible: false },
            range: { id: "range", w: size, h: size, visible: false },

            delete: { id: "delete", w: size, h: size, visible: false }
        };
    }


    _layoutButtons(params) {
        if (!this._buttons || !params) return;

        const { canvas, room } = params;
        if (!canvas || !room || !room.size) return;

        const GAP = 18;

        // toolbar order left → right
        const order = ["add", "edit", "save", "discard", "angle", "range", "delete"];

        const visible = order
            .map(id => this._buttons[id])
            .filter(btn => btn && btn.visible);

        if (!visible.length) return;

        const totalWidth =
            visible.reduce((sum, b) => sum + b.w, 0) +
            GAP * (visible.length - 1);

        let x = room.x + (room.size - totalWidth) / 2;
        const y = room.y + room.size + GAP;

        visible.forEach(b => {
            b.x = x;
            b.y = y;
            x += b.w + GAP;
        });
    }




    installPointerHandlers() {
        const el = this.canvas;
        el.style.touchAction = "none"; // prevent browser gestures

        el.addEventListener("pointerdown", this._onPointerDown.bind(this));
        el.addEventListener("pointermove", this._onPointerMove.bind(this));
        el.addEventListener("pointerup", this._onPointerUp.bind(this));
        el.addEventListener("pointercancel", this._onPointerUp.bind(this));
        el.addEventListener("lostpointercapture", this._onPointerUp.bind(this));
    }
    _handleUIButton(id) {
        switch (id) {
            case 'add':
                this._addZone();
                break;

            case 'edit': {
                const enteringEdit = this.ui.mode !== 'edit';
                this.ui.mode = enteringEdit ? 'edit' : 'view';

                if (enteringEdit) {
                    this.card && (this.card._editMode = true);
                } else {
                    this.card && (this.card._editMode = false);
                    this.model.isDirty = false;
                    this.ui.activeZoneId = null;           // leaving edit clears selection
                }

                this._updateToolbarVisibility();
                this.draw();
                console.log(`[EditMode] ${enteringEdit ? 'Entered' : 'Exited'} edit mode`);
                break;
            }

            case 'save': {
                this.card?.saveZonesToHA?.();
                this.ui.mode = 'view';
                this.card && (this.card._editMode = false);
                this.ui.activeZoneId = null;             // nothing selected after save
                this._updateToolbarVisibility();         // hides delete, shows Edit, hides Save/Discard
                this.draw();
                break;
            }

            case 'discard': {
                this.card?.loadZonesFromHA?.();
                this.ui.mode = 'view';
                this.card && (this.card._editMode = false);
                this.ui.activeZoneId = null;             // clear selection
                this._updateToolbarVisibility();
                this.draw();
                break;
            }

            case 'delete': {
                if (this.ui.activeZoneId) {
                    const zones = { ...this.model?.zones };
                    delete zones[this.ui.activeZoneId];
                    this.model?.updateZones(zones);
                    this.ui.activeZoneId = null;           // no selection after delete
                    this.model.isDirty = true;             // delete is an edit
                }
                this._updateToolbarVisibility();         // hides Delete button
                this.draw();
                break;
            }
        }
    }

    _addZone() {
        const modelZones = this.model?.zones || {};
        const nextId = this._findNextZoneId(modelZones, 4);
        if (nextId === null) {
            console.warn('[AddZone] Max zones reached (1..4).');
            return;
        }

        const maxM = this.maxRange || 6;

        // Default square: ~30% of range, centered
        const size = this._clamp(maxM * 0.30, 0.2, Math.max(0.2, maxM)); // never tiny/neg
        let cx = maxM * 0.5;
        let cy = maxM * 0.5;

        let x1 = this._clamp(cx - size / 2, 0, maxM - size);
        let y1 = this._clamp(cy - size / 2, 0, maxM - size);
        let x2 = this._clamp(x1 + size, 0, maxM);
        let y2 = this._clamp(y1 + size, 0, maxM);

        // Round to sane precision so the sidebar isn’t full of long floats
        x1 = this._round3(x1); y1 = this._round3(y1);
        x2 = this._round3(x2); y2 = this._round3(y2);

        const zones = JSON.parse(JSON.stringify(modelZones));
        zones[nextId] = this.clampZone({
            id: nextId,
            enabled: true,
            occupied: false,
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 }
        });

        // Commit to model (single source of truth)
        this.model?.updateZones?.(zones);


        // Switch to edit mode and mark dirty so Save/Discard/Delete appear
        this.ui.mode = 'edit';

        if (this.card) {
            this.card._editMode = true;
            this._updateToolbarVisibility();
            // show Save/Discard/Delete buttons in the toolbar
            for (const b of this._buttons) {
                if (['save', 'discard', 'delete'].includes(b.id))
                    b.visible = true;
            }
        }
        this.model.isDirty = true;
        this.draw();
    }


    // Canvas px → room metres (inverse of roomToCanvas)
    _canvasToRoom(px, py, params) {
        const { room, scale } = params;
        return { x: (px - room.x) / scale, y: (py - room.y) / scale };
    }

    // Get event position in canvas px
    _getCanvasPoint(evt) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (evt.clientX - rect.left);
        const y = (evt.clientY - rect.top);
        return { x, y };
    }

    // Normalize zone so start <= end
    _normZone(z) {
        const nx1 = Math.min(z.start.x, z.end.x);
        const ny1 = Math.min(z.start.y, z.end.y);
        const nx2 = Math.max(z.start.x, z.end.x);
        const ny2 = Math.max(z.start.y, z.end.y);
        return { start: { x: nx1, y: ny1 }, end: { x: nx2, y: ny2 }, enabled: z.enabled, occupied: z.occupied, executing: z.executing };
    }

    // Compute handle positions (in canvas px)
    _computeHandlesForZone(z, params) {
        const { room, scale } = params;
        const toPx = (x, y) => ({ x: room.x + x * scale, y: room.y + y * scale });

        const zN = this._normZone(z);
        const x1 = zN.start.x, y1 = zN.start.y, x2 = zN.end.x, y2 = zN.end.y;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;

        const pts = {
            tl: toPx(x1, y1), tr: toPx(x2, y1), br: toPx(x2, y2), bl: toPx(x1, y2),
            t: toPx(cx, y1), r: toPx(x2, cy), b: toPx(cx, y2), l: toPx(x1, cy),
            c: toPx(cx, cy)
        };

        const r = 10 * (window.devicePixelRatio || 1); // hit radius
        return [
            { type: "corner", which: "tl", ...pts.tl, r },
            { type: "corner", which: "tr", ...pts.tr, r },
            { type: "corner", which: "br", ...pts.br, r },
            { type: "corner", which: "bl", ...pts.bl, r },
            { type: "edge", which: "t", ...pts.t, r },
            { type: "edge", which: "r", ...pts.r, r },
            { type: "edge", which: "b", ...pts.b, r },
            { type: "edge", which: "l", ...pts.l, r },
            { type: "move", which: "c", ...pts.c, r },
        ];
    }

    _hitHandle(px, py, handles) {
        for (const h of handles) {
            const dx = px - h.x, dy = py - h.y;
            if (dx * dx + dy * dy <= h.r * h.r) return h;
        }
        return null;
    }

    _pointInZone(px, py, z, params) {
        const { room, scale } = params;
        const zN = this._normZone(z);
        const x1 = room.x + zN.start.x * scale;
        const y1 = room.y + zN.start.y * scale;
        const x2 = room.x + zN.end.x * scale;
        const y2 = room.y + zN.end.y * scale;
        return px >= x1 && px <= x2 && py >= y1 && py <= y2;
    }
    // Smallest free ID in 1..4 (change 4 if you support more)
    _findNextZoneId(zones, maxId = 4) {
        const used = new Set(
            Object.entries(zones)
                .filter(([_, z]) =>
                    z && z.enabled && z.start && z.end &&
                    (z.start.x !== z.end.x || z.start.y !== z.end.y)
                )
                .map(([k]) => Number(k))
        );
        for (let i = 1; i <= maxId; i++) if (!used.has(i)) return i;
        return null;
    }

    _round3(v) { return Math.round(v * 1000) / 1000; }

    _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    _updateToolbarVisibility() {
        if (!this._buttons) return;

        const editing = !!this.ui.editing;
        const zoneSel = !!this.ui.activeZoneId;

        const show = id => this._buttons[id].visible = true;
        const hide = id => this._buttons[id].visible = false;

        if (!editing) {
            show("add");
            show("edit");

            hide("save");
            hide("discard");
            hide("angle");
            hide("range");
            hide("delete");
            return;
        }

        // edit mode (no zone)
        show("add");
        hide("edit");
        show("save");
        show("discard");
        show("angle");
        show("range");
        hide("delete");

        if (zoneSel) show("delete");
    }



    updateScaleGeometry() {
        // === 1. Measure canvas ===
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const margin = Math.min(w, h) * 0.05;  // 5% padding all around
        const roomSize = Math.min(w, h) - margin * 2;

        // === 2. Scale derivation ===
        this.SCALE = roomSize / this.maxRange;   // uniform metres→pixels
        // (Optionally later we can add SCALE_X/Y for anisotropic control)

        // === 3. Origin placement ===
        this.origin = { x: w / 2, y: margin };   // top-centre radar mount

        // === 4. Store geometry snapshot for downstream functions ===
        this._geometry = {
            canvas: { w, h },
            margin,
            roomSize,
            origin: this.origin,
            scale: this.SCALE,
            theta: this.theta,
            range: this.maxRange
        };
    }
    setContext({ hass, deviceId }) {
        this._hass = hass;
        this._selectedDevice = deviceId;

        const distEntity = hass?.states?.[`number.${deviceId}_distance`];
        const dirEntity = hass?.states?.[`number.${deviceId}_installation_angle`];

        if (distEntity) {
            this.maxMeters = Number(distEntity.state);   // device distance entity
            this.maxRange = this.maxMeters;             // start in sync with UI range
        }
        if (dirEntity) {
            this.theta = Number(dirEntity.state) * Math.PI / 180;
        }

        this._ready = true;
        if (this._parentCard?.debugger) {
            console.info(
                `[RadarCanvas] Context ready — device=${deviceId}, ` +
                `maxMeters=${this.maxMeters}, theta=${(this.theta * 180 / Math.PI).toFixed(1)}°`
            );
        }
        this.draw();
    }
    computeGeometry() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        // 5% outer margin, square room fitted to shortest axis
        const margin = Math.min(w, h) * 0.05;
        const L = Math.min(w, h) - margin * 2;
        const offsetX = (w - L) / 2;
        const offsetY = (h - L) / 2;

        const room = { x: offsetX, y: offsetY, size: L };

        // Clamp θ to [-π/4, +π/4]
        const theta = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.theta));

        // Linear slide of the origin along the top edge
        const slide = (theta / (Math.PI / 4)) * (L / 2);
        const origin = {
            x: room.x + room.size / 2 + slide,
            y: room.y
        };

        const scale = L / this.maxRange;

        this.origin = origin;
        this.SCALE = scale;
        this._currentTheta = theta;

        const handlePadding = 12;

        // Angle handle: just above the origin
        const angleX = origin.x;
        const angleY = room.y - handlePadding;

        // Range handle: slide along vertical ruler according to range
        const RANGE_MAX = 8; // hard clamp used in range dragging
        const currentRange = this.maxRange ?? RANGE_MAX;
        const t = Math.min(Math.max(currentRange / RANGE_MAX, 0), 1); // 0..1

        const rangeX = room.x + room.size + handlePadding;
        const rangeY = room.y + (1 - t) * room.size;  // 8m = top, 0m = bottom

        return {
            canvas: { w, h },
            room,
            origin,
            scale,
            theta,
            range: this.maxRange,
            zones: this.zones || {},
            targets: this.targets || {},
            handles: {
                angle: { x: angleX, y: angleY },
                range: { x: rangeX, y: rangeY }
            },
            toCanvas: (x, y) => this.worldToCanvas(x, y),
            toWorld: (px, py) => this.canvasToWorld(px, py)
        };
    }



    drawControls(ctx, params) {
        // Only show angle + range handles while editing
        if (this.ui.mode !== 'edit') return;

        const { handles, room } = params;
        if (!handles || !room) return;

        const RANGE_MAX = 8;
        const currentRange = this.maxRange ?? RANGE_MAX;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 1. Angle handle
        const handleRadius = 8;
        ctx.fillStyle = 'rgba(255, 191, 0, 0.95)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(handles.angle.x, handles.angle.y, handleRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // 2. Vertical range ruler
        const x = handles.range.x;
        const topY = room.y;
        const bottomY = room.y + room.size;
        const capLen = 14;
        const tickLen = 10;
        const tickCount = 3;

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.stroke();

        // end caps
        ctx.beginPath();
        ctx.moveTo(x - capLen / 2, topY);
        ctx.lineTo(x + capLen / 2, topY);
        ctx.moveTo(x - capLen / 2, bottomY);
        ctx.lineTo(x + capLen / 2, bottomY);
        ctx.stroke();

        // ladder ticks
        const ladderOffset = 6;
        for (let i = 0; i < tickCount; i++) {
            const t = (i + 1) / (tickCount + 1);
            const ty = topY + (bottomY - topY) * t;
            ctx.beginPath();
            ctx.moveTo(x + ladderOffset, ty - tickLen / 2);
            ctx.lineTo(x + ladderOffset + tickLen, ty - tickLen / 2);
            ctx.stroke();
        }

        // labels
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const topLabel = `${RANGE_MAX.toFixed(0)}m`;
        const bottomLabel = `${currentRange.toFixed(0)}m`;

        ctx.fillText(topLabel, x + capLen + 6, topY);
        ctx.fillText(bottomLabel, x + capLen + 6, bottomY);

        // 3. Range handle (yellow dot on ruler – position already computed)
        ctx.fillStyle = 'rgba(255, 191, 0, 0.95)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(handles.range.x, handles.range.y, handleRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }


    drawRoomBox(ctx, params) {
        const { x, y, size } = params.room;
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeRect(x, y, size, size);

        // Radar origin marker on the top edge
        ctx.fillStyle = 'rgba(255,128,0,0.9)';
        ctx.beginPath();
        ctx.arc(params.origin.x, params.origin.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }
    drawRoomGrid(ctx, params) {
        const { room, range, scale } = params;
        const maxM = Math.floor(range);
        if (maxM <= 0) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;

        // Vertical and horizontal 1 m grid lines inside the room box
        for (let m = 1; m < maxM; m++) {
            const offset = m * scale;

            // Vertical line
            ctx.beginPath();
            ctx.moveTo(room.x + offset, room.y);
            ctx.lineTo(room.x + offset, room.y + room.size);
            ctx.stroke();

            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(room.x, room.y + offset);
            ctx.lineTo(room.x + room.size, room.y + offset);
            ctx.stroke();
        }

        ctx.restore();
    }
    drawFanGrid(ctx, params) {
        const { range, toCanvas } = params;
        const steps = 96;
        const half = Math.PI / 4; // ±45°
        const maxR = range;
        if (!isFinite(maxR) || maxR <= 0) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;

        // Concentric range rings every 1 m (world circle → canvas circle via worldToCanvas)
        const rings = Math.floor(maxR);
        for (let r = 1; r <= rings; r++) {
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const phi = -half + (i / steps) * (2 * half);
                const wx = Math.sin(phi) * r;
                const wy = -Math.cos(phi) * r;
                const p = toCanvas(wx, wy);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }

        // Radial spokes for angle reference
        const spokes = [-half, -half / 2, 0, half / 2, half];
        const p0 = toCanvas(0, 0);
        for (const phi of spokes) {
            const wx = Math.sin(phi) * maxR;
            const wy = -Math.cos(phi) * maxR;
            const p1 = toCanvas(wx, wy);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
        }

        ctx.restore();
    }



    drawFan(ctx, params) {
        const { range, toCanvas } = params;
        const steps = 96;
        const half = Math.PI / 4; // ±45°

        const p0 = toCanvas(0, 0);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);

        // Local radar frame: forward = -Y (down)
        for (let i = 0; i <= steps; i++) {
            const phi = -half + (i / steps) * (2 * half);
            const wx = Math.sin(phi) * range;   // left/right
            const wy = -Math.cos(phi) * range;  // forward (down)
            const p = toCanvas(wx, wy);
            ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();

        ctx.fillStyle = 'rgba(13,110,253,0.20)';
        ctx.strokeStyle = 'rgba(13,110,253,0.60)';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawZones(ctx, params) {
        function roomToCanvas(x_m, y_m, params) {
            const { room, scale } = params;  // scale = px per metre
            return {
                x: room.x + x_m * scale,
                y: room.y + y_m * scale
            };
        }
        const { zones } = params;
        if (!zones) return;

        // Palette per zone id (Z1 red, Z2 green, Z3 blue, Z4 yellow)
        const palette = {
            '1': { fill: 'rgba(220,53,69,0.15)', stroke: 'rgba(220,53,69,0.9)' }, // red
            '2': { fill: 'rgba(25,135,84,0.15)', stroke: 'rgba(25,135,84,0.9)' }, // green
            '3': { fill: 'rgba(13,110,253,0.15)', stroke: 'rgba(13,110,253,0.9)' }, // blue
            '4': { fill: 'rgba(255,193,7,0.22)', stroke: 'rgba(255,193,7,0.95)' }  // yellow
        };
        const defaultColours = {
            fill: 'rgba(255,0,0,0.10)',
            stroke: 'rgba(255,0,0,0.4)'
        };

        ctx.save();
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const [id, z] of Object.entries(zones)) {
            if (!z.enabled) continue;

            // === Convert room-space metres → canvas px ===
            const p1 = roomToCanvas(z.start.x, z.start.y, params);
            const p2 = roomToCanvas(z.end.x, z.end.y, params);

            const x = Math.min(p1.x, p2.x);
            const y = Math.min(p1.y, p2.y);
            const w = Math.abs(p1.x - p2.x);
            const h = Math.abs(p1.y - p2.y);

            const base = palette[id] || defaultColours;

            // Occupied just boosts the alpha slightly
            const fill = z.occupied
                ? base.fill.replace(/0\\.15|0\\.10|0\\.22/, '0.35')
                : base.fill;
            const stroke = base.stroke;

            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.5;

            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);

            // === Label ===
            ctx.fillStyle = 'black';
            ctx.fillText(`Z${id}`, x + w / 2, y + h / 2);

            // === Handles + highlight for active zone in edit mode ===
            if (this.ui.mode === "edit" && this.ui.activeZoneId === id) {
                const hs = this._computeHandlesForZone(z, params);
                for (const hnd of hs) {
                    ctx.beginPath();
                    if (hnd.type === "move") {
                        ctx.fillStyle = "rgba(255,165,0,0.8)"; // orange centre
                        ctx.arc(hnd.x, hnd.y, 6, 0, 2 * Math.PI);
                        ctx.fill();
                    } else {
                        ctx.fillStyle = hnd.type === "corner" ? "#ffa500" : "#ffd166";
                        ctx.arc(hnd.x, hnd.y, 5, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }
                // Highlight selected zone border
                ctx.lineWidth = 2;
                ctx.strokeStyle = "#0d6efd";
                ctx.strokeRect(x, y, w, h);
            }
        }

        ctx.restore();
    }


    drawTargets(ctx, params) {
        function radarToCanvas(x_m, y_m, params) {
            // Forward (front of radar) is +Y in human terms → -Y in transform
            return params.toCanvas(x_m, -y_m);
        }
        const { targets, toCanvas } = params;
        if (!targets) return;

        ctx.save();
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (const [id, t] of Object.entries(targets)) {
            if (!t) continue;

            // Expect target.x/y in metres relative to radar (fan) origin
            const { x, y, intensity = 1.0 } = t;
            const p = radarToCanvas(t.x, t.y, params);   // ⬅ same call the fan uses

            const r = 5;
            const alpha = Math.min(Math.max(intensity, 0.2), 1);
            const color = `rgba(200,10,10,${0.5 * alpha})`;

            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();

            ctx.lineWidth = 1;
            ctx.strokeStyle = `rgba(13,110,253,${0.8 * alpha})`;
            ctx.stroke();

            ctx.fillStyle = 'black';
            ctx.fillText(`T${id}`, p.x + r + 2, p.y);
        }

        ctx.restore();

    }
    draw_debug_lines(ctx) {
        // === DEBUG: reference direction lines ===
        if (!isFinite(this._currentTheta)) {
            console.warn('[RadarCanvas] debug_lines: theta invalid');
            return;
        }
        ctx.save();

        // canvas centre for all references
        const cx = this.origin.x;
        const cy = this.origin.y;
        const radius = this.maxMeters * this.SCALE * 1.1; // extend slightly beyond fan

        // 1️⃣ Fan coordinate (uses local ctx.rotate)
        //ctx.save();
        ctx.strokeStyle = 'rgba(0, 128, 255, 0.6)';  // blue
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);

        ctx.lineTo(
            cx + Math.cos(this.theta + Math.PI * 1.5) * radius,
            cy + Math.sin(this.theta + Math.PI * 1.5) * radius
        );
        ctx.stroke();

        // 2️⃣ Zone/target coordinate (uses worldToCanvas math)
        const tip = this.worldToCanvas(0, this.maxMeters);
        ctx.strokeStyle = 'rgba(255,0,0,0.6)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'black';
        ctx.font = '12px monospace';
        ctx.fillText(
            `${(this.theta * 180 / Math.PI).toFixed(1)}° / ${((this.theta + Math.PI / 2) * 180 / Math.PI).toFixed(1)}°`,
            this.origin.x + 20,
            this.origin.y - 10
        );

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
    // --- helpers: clamp a single coordinate into 0..10 m ---
    clampScalar(v) {
        return Math.min(Math.max(v, 0), 10);
    }

    // --- clamp a point in room-space metres ---
    clampPoint(p) {
        if (!p) return { x: 0, y: 0 };
        return {
            x: this.clampScalar(p.x),
            y: this.clampScalar(p.y),
        };
    }

    // --- clamp a zone in room-space metres ---
    clampZone(z) {
        if (!z || !z.start || !z.end) return z;

        let s = this.clampPoint(z.start);
        let e = this.clampPoint(z.end);

        // normalise so start <= end
        let x1 = Math.min(s.x, e.x);
        let y1 = Math.min(s.y, e.y);
        let x2 = Math.max(s.x, e.x);
        let y2 = Math.max(s.y, e.y);

        // minimum size (e.g. 0.05m so it never collapses)
        const min = 0.05;
        if (x2 - x1 < min) x2 = this.clampScalar(x1 + min);
        if (y2 - y1 < min) y2 = this.clampScalar(y1 + min);

        return {
            ...z,
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
        };
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
    /*
    rx = x cosT - y sinT   → clockwise
    ry = x sinT + y cosT   → clockwise
    rx = x cosT + y sinT   → anticlockwise
    ry = -x sinT + y cosT  → anticlockwise
    */

    worldToCanvas(x, y) {
        const t = this.theta;   // align world +Y with fan’s +X-based drawing
        //const t = this.theta - Math.PI / 2;  // align to fan’s rotation (theta + π/2)
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);

        const rx = x * cosT + y * sinT;
        const ry = -x * sinT + y * cosT;
        //console.log('[worldToCanvas] SCALE=', this.SCALE);
        return {
            x: this.origin.x + rx * this.SCALE,
            y: this.origin.y - ry * this.SCALE   // only flip Y once, here
        };
    }

    // canvas (px) -> world (metres)
    canvasToWorld(px, py) {
        const relX = px - this.origin.x;
        const relY = this.origin.y - py;
        const t = this.theta;
        //const t = this.theta - Math.PI / 2;  // same alignment used above
        const cosT = Math.cos(-t);
        const sinT = Math.sin(-t);
        const invScale = 1 / this.SCALE;

        const x = (relX * cosT + relY * sinT) * invScale;
        const y = (-relX * sinT + relY * cosT) * invScale;
        console.log('[canvasToWorld] SCALE=', this.SCALE);
        return { x, y };
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
        if (!this.isReady()) {
            console.warn('[RadarCanvas] draw() skipped — data not ready.');
            return;
        }

        const ctx = this.ctx;
        if (!this._buttons) this._setupButtons();
        this.clear();
        try {
            //console.log("DRAW CALL", performance.now().toFixed(1),
            //    "zones=", Object.keys(this.model?.zones || {}).length,
            //    "caller:", (new Error()).stack.split("\n")[2]);

            //this.updateScaleGeometry();
            const params = this.computeGeometry();
            // === Core geometry setup (inside draw) ===
            this._layoutButtons(params);

            // draw UI layer first
            this._drawToolbar(ctx);
            this.drawControls(ctx, params);

            // World layers: room → grids → fan → zones → targets
            this.drawRoomBox(ctx, params);
            this.drawRoomGrid(ctx, params);
            this.drawFanGrid(ctx, params);
            this.drawFan(ctx, params);
            this.drawZones(ctx, params);
            this.drawTargets(ctx, params);
            this._drawToolbar(ctx); // redraw controls on top


        } catch (err) {
            console.groupCollapsed('%c[RadarCanvas] draw() error', 'color:red;font-weight:bold;');
            console.error(err);
            console.table({
                origin: this.origin,
                scale: this.SCALE,
                theta: this.theta,
                zones: this.zones ? Object.keys(this.zones).length : 0,
                targets: this.targets ? Object.keys(this.targets).length : 0
            });
            console.groupEnd();
        }
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
        const rect = this.canvas.parentElement.getBoundingClientRect();

        // avoid invalid zero dimensions
        if (rect.width < 100 || rect.height < 100) {
            return; // wait for layout to stabilize
        }

        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._width = rect.width;
        this._height = rect.height;

        this.updateScaleGeometry();
        this._updateToolbarVisibility();
        this.draw();
    }
    highlightZone(zoneNum) {
        this._highlightZone = zoneNum;
        this.draw();
    }

    _drawToolbar(ctx) {
        if (!this._buttons) return;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";

        const labels = {
            add: "add",
            edit: "edit",
            save: "save",
            discard: "disregard",
            angle: "angle",
            range: "range",
            delete: "delete zone"
        };

        for (const b of this._buttons) {
            if (!b.visible) continue;

            // tile
            this._drawToolbarTile(ctx, b, b.id === "save" || b.id === "delete");

            // icon
            this._drawToolbarIcon(ctx, b);

            // label
            ctx.fillStyle = "#000";
            ctx.fillText(
                labels[b.id],
                b.x + b.w / 2,
                b.y + b.h + 18
            );
        }

        ctx.restore();
    }
    _drawToolbarTile(ctx, btn, highlight = false) {
        ctx.save();

        const r = btn.w * 0.22;   // corner radius
        const { x, y, w, h } = btn;

        // tile background
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);

        ctx.fillStyle = highlight ? "rgba(180,200,255,0.35)" : "rgba(255,255,255,0.85)";
        ctx.fill();

        // border outline
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = highlight ? "rgba(50,80,200,0.8)" : "rgba(0,0,0,0.6)";
        ctx.stroke();

        // subtle shadow
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.stroke();

        ctx.restore();
    }

    _drawToolbar(ctx) {
        if (!this._buttons) return;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";

        const labels = {
            add: "add",
            edit: "edit",
            save: "save",
            discard: "disregard",
            angle: "angle edit",
            range: "range",
            delete: "delete zone"
        };

        Object.values(this._buttons)
            .filter(b => b.visible)
            .forEach(b => {

                const highlight = (b.id === "save" || b.id === "delete");

                // draw tile
                this._drawToolbarTile(ctx, b, highlight);

                // draw icon
                this._drawToolbarIcon(ctx, b);

                // draw label
                ctx.fillStyle = "#000";
                ctx.fillText(
                    labels[b.id],
                    b.x + b.w / 2,
                    b.y + b.h + 18
                );
            });

        ctx.restore();
    }

    _drawToolbarIcon(ctx, btn) {
        const size = btn.w * 0.55;
        const ix = btn.x + (btn.w - size) / 2;
        const iy = btn.y + (btn.h - size) / 2;

        switch (btn.id) {
            case "add": return this._iconAdd(ctx, ix, iy, size);
            case "edit": return this._iconEdit(ctx, ix, iy, size);
            case "save": return this._iconSave(ctx, ix, iy, size);
            case "discard": return this._iconUndo(ctx, ix, iy, size);
            case "angle": return this._iconAngle(ctx, ix, iy, size);
            case "range": return this._iconRange(ctx, ix, iy, size);
            case "delete": return this._iconDeleteZone(ctx, ix, iy, size);
        }
    }
    _iconBase(ctx, size) {
        ctx.save();
        ctx.strokeStyle = '#111111';
        ctx.fillStyle = '#111111';
        ctx.lineWidth = Math.max(1.5, size * 0.08);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    _iconAdd(ctx, x, y, size) {
        this._iconBase(ctx, size);
        const cX = x + size / 2;
        const cY = y + size / 2;
        const m = size * 0.25;

        // vertical
        ctx.beginPath();
        ctx.moveTo(cX, y + m);
        ctx.lineTo(cX, y + size - m);
        ctx.stroke();

        // horizontal
        ctx.beginPath();
        ctx.moveTo(x + m, cY);
        ctx.lineTo(x + size - m, cY);
        ctx.stroke();

        ctx.restore();
    }
    _iconEdit(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const startX = x + size * 0.25;
        const startY = y + size * 0.70;
        const endX = x + size * 0.75;
        const endY = y + size * 0.30;

        // pencil shaft
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // tip
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX + size * 0.08, endY - size * 0.08);
        ctx.lineTo(endX + size * 0.02, endY + size * 0.10);
        ctx.closePath();
        ctx.fill();

        // butt end line
        ctx.beginPath();
        ctx.moveTo(startX + size * 0.02, startY + size * 0.02);
        ctx.lineTo(startX - size * 0.08, startY + size * 0.10);
        ctx.stroke();

        ctx.restore();
    }
    _iconSave(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const cX = x + size / 2;
        const top = y + size * 0.20;
        const bottom = y + size * 0.70;

        // vertical arrow
        ctx.beginPath();
        ctx.moveTo(cX, top);
        ctx.lineTo(cX, bottom);
        ctx.stroke();

        // arrow head
        ctx.beginPath();
        ctx.moveTo(cX - size * 0.12, bottom - size * 0.12);
        ctx.lineTo(cX, bottom + size * 0.02);
        ctx.lineTo(cX + size * 0.12, bottom - size * 0.12);
        ctx.stroke();

        // small baseline
        ctx.beginPath();
        ctx.moveTo(x + size * 0.22, y + size * 0.80);
        ctx.lineTo(x + size * 0.78, y + size * 0.80);
        ctx.stroke();

        ctx.restore();
    }
    _iconDelete(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const w = size * 0.6;
        const h = size * 0.55;
        const bx = x + (size - w) / 2;
        const by = y + (size - h) / 2 + size * 0.05;

        // lid
        ctx.beginPath();
        ctx.moveTo(bx - size * 0.05, by);
        ctx.lineTo(bx + w + size * 0.05, by);
        ctx.stroke();

        // body
        ctx.beginPath();
        ctx.rect(bx, by, w, h);
        ctx.stroke();

        // slats
        ctx.beginPath();
        ctx.moveTo(bx + w * 0.33, by + h * 0.15);
        ctx.lineTo(bx + w * 0.33, by + h * 0.85);
        ctx.moveTo(bx + w * 0.66, by + h * 0.15);
        ctx.lineTo(bx + w * 0.66, by + h * 0.85);
        ctx.stroke();

        ctx.restore();
    }
    _iconUndo(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const cX = x + size * 0.55;
        const cY = y + size * 0.55;
        const r = size * 0.35;

        // curved path
        ctx.beginPath();
        ctx.arc(cX, cY, r, Math.PI * 1.1, Math.PI * 0.2, false);
        ctx.stroke();

        // arrow head at the left end
        const ahX = cX + r * Math.cos(Math.PI * 1.1);
        const ahY = cY + r * Math.sin(Math.PI * 1.1);

        ctx.beginPath();
        ctx.moveTo(ahX, ahY);
        ctx.lineTo(ahX - size * 0.10, ahY - size * 0.10);
        ctx.lineTo(ahX + size * 0.02, ahY - size * 0.14);
        ctx.stroke();

        ctx.restore();
    }
    _iconAngle(ctx, x, y, size) {
        this._iconBase(ctx, size);
        const baseY = y + size * 0.85;
        const leftX = x + size * 0.15;
        const rightX = x + size * 0.85;
        const apexX = x + size * 0.55;
        const apexY = y + size * 0.15;

        // Base line
        ctx.beginPath();
        ctx.moveTo(leftX, baseY);
        ctx.lineTo(rightX, baseY);
        ctx.stroke();

        // Slanted line (sensor arm)
        ctx.beginPath();
        ctx.moveTo(leftX, baseY);
        ctx.lineTo(apexX, apexY);
        ctx.stroke();

        // Dashed inner arc
        const cx = leftX;
        const cy = baseY;
        const r = size * 0.35;
        const start = 0;
        const end = -Math.atan2(baseY - apexY, apexX - leftX); // little bit up/left

        ctx.setLineDash([r * 0.18, r * 0.12]);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.75, start, end, true);
        ctx.stroke();
        ctx.setLineDash([]);

        // Outer arrow arc
        const r2 = r;
        const mid = (start + end) / 2;
        const ex = cx + r2 * Math.cos(end);
        const ey = cy + r2 * Math.sin(end);

        ctx.beginPath();
        ctx.arc(cx, cy, r2, start, end, true);
        ctx.stroke();

        // Arrow head
        const ah = size * 0.15;
        const ang = end;
        const ax1 = ex + ah * Math.cos(ang + Math.PI * 0.75);
        const ay1 = ey + ah * Math.sin(ang + Math.PI * 0.75);
        const ax2 = ex + ah * Math.cos(ang - Math.PI * 0.75);
        const ay2 = ey + ah * Math.sin(ang - Math.PI * 0.75);

        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ax1, ay1);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ax2, ay2);
        ctx.stroke();

        ctx.restore();
    }

    _iconRange(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const cx = x + size / 2;
        const topY = y + size * 0.15;
        const bottomY = y + size * 0.85;
        const barY = y + size * 0.73;

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx, barY - size * 0.08);
        ctx.stroke();

        // Arrow head
        const ah = size * 0.16;
        const tipY = barY - size * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx - ah * 0.8, tipY - ah);
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx + ah * 0.8, tipY - ah);
        ctx.stroke();

        // Baseline
        const barW = size * 0.7;
        ctx.beginPath();
        ctx.moveTo(cx - barW / 2, barY);
        ctx.lineTo(cx + barW / 2, barY);
        ctx.stroke();

        ctx.restore();
    }
    _iconDeleteZone(ctx, x, y, s) {
        ctx.save();
        ctx.lineWidth = s * 0.08;
        ctx.strokeStyle = "#000";

        // outer rounded square
        ctx.beginPath();
        ctx.roundRect(x + s * 0.05, y + s * 0.05, s * 0.9, s * 0.9, s * 0.18);
        ctx.stroke();

        // minus bar
        ctx.beginPath();
        ctx.moveTo(x + s * 0.25, y + s * 0.5);
        ctx.lineTo(x + s * 0.75, y + s * 0.5);
        ctx.stroke();

        // small bin in corner
        const bx = x + s * 0.60;
        const by = y + s * 0.60;
        ctx.beginPath();
        ctx.rect(bx, by, s * 0.28, s * 0.28);
        ctx.stroke();

        ctx.restore();
    }


    _onPointerDown(evt) {
        if (this.ui.pointerId !== null) return;
        const p = this._getCanvasPoint(evt);

        // 1) Toolbar buttons always work
        for (const btn of this._buttons) {
            if (btn.visible &&
                p.x >= btn.x && p.x <= btn.x + btn.w &&
                p.y >= btn.y && p.y <= btn.y + btn.h) {
                this._handleUIButton(btn.id);
                evt.preventDefault(); evt.stopPropagation();
                return;
            }
        }

        // 2) If not editing, stop here (no zone grabs)
        if (this.ui.mode !== 'edit') return;

        // 3) Angle / Range handles (only in edit mode)
        const params = this.computeGeometry();
        const { handles } = params;
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        if (d(p, handles.angle) < 12) {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeHandle = 'angle';
            this.canvas.setPointerCapture(evt.pointerId);
            return;
        }
        if (d(p, handles.range) < 12) {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeHandle = 'range';
            this.canvas.setPointerCapture(evt.pointerId);
            return;
        }

        // 4) Zone hit-test (edit mode only)
        const { x: px, y: py } = p;
        let hitZoneId = null, hitHandle = null;
        for (const [id, z] of Object.entries(params.zones || {})) {
            const hs = this._computeHandlesForZone(z, params);
            const h = this._hitHandle(px, py, hs);
            if (h) { hitZoneId = id; hitHandle = h; break; }
            if (!hitZoneId && this._pointInZone(px, py, z, params)) hitZoneId = id;



        }
        if (!hitZoneId) return;

        // Capture zone and start drag or selection
        console.log("Before capture", evt.pointerId);
        this.canvas.setPointerCapture(evt.pointerId);
        console.log("After capture (should persist next frame)");
        this.ui.pointerId = evt.pointerId;
        this.ui.activeZoneId = hitZoneId;
        this._updateToolbarVisibility();
        this.ui.activeHandle = hitHandle || { type: "move", which: "c" };
        this.ui.dragStart = {
            canvas: { x: px, y: py },
            room: this._canvasToRoom(px, py, params)
        };
        if (this.ui.activeZoneId && this.ui.mode === 'edit') {
            const delBtn = this._buttons.find(b => b.id === 'delete');
            if (delBtn) delBtn.visible = true;
        }

        // ✅ Defer deep-copy setup to next animation frame to avoid race
        requestAnimationFrame(() => {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeZoneId = hitZoneId;
            this.ui.activeHandle = hitHandle || { type: "move", which: "c" };
            this.ui.dragStart = {
                canvas: { x: px, y: py },
                room: this._canvasToRoom(px, py, params)
            };
            const z0 = params.zones[hitZoneId];
            this.ui.originalZone = JSON.parse(JSON.stringify(this._normZone(z0)));

            if (this.card) this.card._editMode = true;
            this.model.isDirty = true;
            this.draw();

            console.log(`[ZoneSelect] Active zone ${hitZoneId} locked and drawn.`);
        });
        evt.preventDefault();
    }

    _onPointerMove(evt) {
        if (this.ui.pointerId !== evt.pointerId) return;

        // === 1️⃣ Handle ANGLE and RANGE drag immediately (before other checks)
        if (this.ui.activeHandle === 'angle') {
            const delta = evt.movementX;
            const dTheta = delta / 200;
            this.theta = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.theta + dTheta));

            // ✅ silent update: don’t trigger model.onChange yet
            this.model?.updateRadarPose?.({
                angleDeg: this.theta * 180 / Math.PI,
                rangeM: this.maxRange,
                silent: true
            });

            this.draw();
            evt.preventDefault();
            return;
        }

        if (this.ui.activeHandle === 'range') {
            const delta = -evt.movementY;
            const dRange = delta / 50;
            const newRange = Math.max(1, Math.min(8, this.maxRange + dRange));

            this.maxRange = newRange;
            this.maxMeters = newRange; // keep label in sync

            this.model?.updateRadarPose?.({
                angleDeg: this.theta * 180 / Math.PI,
                rangeM: this.maxRange,
                silent: true
            });

            this.draw();
            evt.preventDefault();
            return;
        }

        // === 2️⃣ Normal zone dragging only valid in edit mode
        if (this.ui.mode !== 'edit') return;

        console.log('MOVE', evt.pointerId);

        const params = this.computeGeometry();
        const { x: px, y: py } = this._getCanvasPoint(evt);
        const curRoom = this._canvasToRoom(px, py, params);
        const { activeZoneId, activeHandle, originalZone, dragStart } = this.ui;
        if (!activeZoneId || !activeHandle) return;

        const dz = JSON.parse(JSON.stringify(originalZone));
        const dx = curRoom.x - dragStart.room.x;
        const dy = curRoom.y - dragStart.room.y;

        // === 3️⃣ Apply edit by handle type
        if (activeHandle.type === "move") {
            dz.start.x += dx; dz.end.x += dx;
            dz.start.y += dy; dz.end.y += dy;
        } else if (activeHandle.type === "corner") {
            if (activeHandle.which.includes("t")) dz.start.y += dy;
            if (activeHandle.which.includes("b")) dz.end.y += dy;
            if (activeHandle.which.includes("l")) dz.start.x += dx;
            if (activeHandle.which.includes("r")) dz.end.x += dx;
        } else if (activeHandle.type === "edge") {
            if (activeHandle.which === "t") dz.start.y += dy;
            if (activeHandle.which === "b") dz.end.y += dy;
            if (activeHandle.which === "l") dz.start.x += dx;
            if (activeHandle.which === "r") dz.end.x += dx;
        }

        // === 4️⃣ Clamp to room bounds
        const clamped = this.clampZone(dz);

        // === 5️⃣ Commit zone change to model
        const zones = { ...(params.zones || {}) };
        zones[activeZoneId] = this._normZone(clamped);
        if (this.model && typeof this.model.updateZones === 'function') {
            this.model.updateZones(zones);
        } else {
            this.zones = zones;
        }

        // === 6️⃣ Smooth redraw
        if (!this._redrawPending) {
            this._redrawPending = true;
            requestAnimationFrame(() => {
                this.update(this.model?.zones || this.zones, this.targets);
                this._redrawPending = false;
            });
        }

        // === 7️⃣ Update hover feedback for toolbar
        const p = this._getCanvasPoint(evt);
        this._uiFeedback.hoverId = null;
        for (const btn of this._buttons) {
            if (p.x >= btn.x && p.x <= btn.x + btn.w &&
                p.y >= btn.y && p.y <= btn.y + btn.h) {
                this._uiFeedback.hoverId = btn.id;
                break;
            }
        }

        this.draw();
        evt.preventDefault();
    }


    _onPointerUp(evt) {
        // Only handle if this pointer was active
        if (this.ui.pointerId !== evt.pointerId) return;

        // Release capture immediately
        this.canvas.releasePointerCapture(evt.pointerId);

        const { activeZoneId, originalZone } = this.ui;

        // === Detect change ===
        if (activeZoneId && originalZone && this.model?.zones?.[activeZoneId]) {
            const zNew = this.model.zones[activeZoneId];
            const changed =
                Math.abs(zNew.start.x - originalZone.start.x) > 1e-4 ||
                Math.abs(zNew.start.y - originalZone.start.y) > 1e-4 ||
                Math.abs(zNew.end.x - originalZone.end.x) > 1e-4 ||
                Math.abs(zNew.end.y - originalZone.end.y) > 1e-4;

            if (changed) {
                this.model.isDirty = true; // flag unsaved changes
                if (this.card) this.card._editMode = true;
                if (this.card) this.card.showUnsavedBanner?.();
            }
        }

        // === Reset drag state ===
        this.ui.pointerId = null;
        // Only clear active zone if user was dragging a handle (not simple click)
        if (this.ui.activeHandle && this.ui.activeHandle.type !== "move") {
            this.ui.activeZoneId = null;
        }


        // === Commit edits to model before releasing suppression ===
        if (this.ui.activeHandle === 'angle' || this.ui.activeHandle === 'range') {
            const oldTheta = this.model?.transform?.theta ?? 0;
            const oldRange = this.model?.transform?.maxRange ?? 0;
            const newTheta = this.theta;
            const newRange = this.maxRange;

            const oldThetaDeg = (oldTheta * 180 / Math.PI);
            const newThetaDeg = (newTheta * 180 / Math.PI);

            console.log('[PointerUp→updateRadarPose]', {
                oldThetaDeg: oldThetaDeg.toFixed(2),
                newThetaDeg: newThetaDeg.toFixed(2),
                oldRangeM: oldRange.toFixed(2),
                newRangeM: newRange.toFixed(2)
            });

            // Update the model (local, immediate)
            if (typeof this.model?.updateRadarPose === 'function') {
                this.model.updateRadarPose({
                    angleDeg: newThetaDeg,
                    rangeM: newRange
                });
            }

            // ✅ Push to HA so HA state matches UI (prevents snap-backs on next HA sync)
            this.card?.pushPoseToHA?.({ angleDeg: newThetaDeg, rangeM: newRange });

            this.model.isDirty = true;
        }
        this.ui.activeHandle = null;
        this.ui.dragStart = null;
        this.ui.originalZone = null;

        // === Reset Suppress Model Sync ===


        this._suppressModelSync = false;
        this._updateToolbarVisibility();
        // Hide Delete button if no zone is selected
        const delBtn = this._buttons.find(b => b.id === 'delete');
        if (delBtn) delBtn.visible = !!this.ui.activeZoneId;

        // Redraw once
        this._uiFeedback.pressId = null;

        this.draw();
    }
    _drawUIButton(ctx) {
        if (!this._buttons) return;
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const btn of this._buttons) {
            ctx.fillStyle = 'rgba(13,110,253,0.2)';
            ctx.strokeStyle = 'rgba(13,110,253,0.7)';
            ctx.lineWidth = 2;
            ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'black';
            ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
        }
        ctx.restore();
    }
    _drawPushButton(ctx, params) {
        const { w, h } = params.canvas;
        const btn = {
            x: w - 120,
            y: h - 50,
            w: 100,
            h: 32,
            text: "Push Zones"
        };
        this._pushButton = btn; // store for hit-test

        // Draw
        ctx.save();

        // 🟠 highlight when dirty, 🟢 flash on press, 🔵 default
        if (this._buttonFlash && Date.now() - this._buttonFlash.t < 300) {
            ctx.fillStyle = this._buttonFlash.color;  // short green flash
        } else if (this.model?.isDirty) {
            ctx.fillStyle = "rgba(255,165,0,0.3)";    // amber = unsaved
        } else {
            ctx.fillStyle = "rgba(13,110,253,0.2)";   // normal blue tint
        }

        ctx.strokeStyle = "rgba(13,110,253,0.7)";
        ctx.lineWidth = 2;
        ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "black";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
        ctx.restore();
    }

}
