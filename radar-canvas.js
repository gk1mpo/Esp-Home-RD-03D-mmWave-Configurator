export class RadarCanvas {
    constructor(canvas, model, options = {}) {
        console.log("[RC] NEW RadarCanvas instance created", this);
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
        this.debugMode = false;


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
        this.model?.onChange?.(() => {
            this.requestDraw();
        });
    }

    isReady() {
        if (!this._ready) return false;
        if (!this.canvas || !this.ctx) return false;
        if (!isFinite(this.SCALE) || this.SCALE <= 0) return false;
        if (!isFinite(this.maxRange) || this.maxRange <= 0) return false;
        return true;
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
    setContext({ hass, deviceId }) {
        // IMPORTANT: // While the user is interacting or editing locally, 
        // // Home Assistant state must not overwrite canvas pose. 
        // // This prevents snap-back during drag.

        this._hass = hass;
        this._selectedDevice = deviceId;
        /*
                // 🔒 HARD GATE: never pull pose while editing or dragging
                const interacting = this.ui?.pointerId !== null;
                const editing = this.model?.isEditing?.();
        
                if (interacting || editing) {
                    if (this.debugMode) {
                        console.log("[setContext] SKIP pose pull", {
                            interacting,
                            editing,
                            canvasTheta: (this.theta * 180 / Math.PI).toFixed(2),
                            modelTheta: this.model?.transform?.getAngleDeg?.()?.toFixed(2)
                        });
                    }
        
                    this._ready = true;
                    this.requestDraw();
                    return;
                }
        
                const distEntity = hass?.states?.[`number.${deviceId}_distance`];
                const dirEntity = hass?.states?.[`number.${deviceId}_installation_angle`];
        
                if (distEntity) {
                    this.maxMeters = Number(distEntity.state);
                    this.maxRange = this.maxMeters;
                }
                if (dirEntity) {
                    this.theta = Number(dirEntity.state) * Math.PI / 180;
                }
        */
        this._ready = true;
        this.requestDraw();

    }
    computeGeometry() {
        // --- 1) Canvas + room geometry ---
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        const base = Math.min(w, h);
        const WIDTH_SCALE = 0.85;
        const margin = base * 0.05;
        const L = (base - margin * 2) * WIDTH_SCALE;

        const offsetX = (w - L) / 2;
        const roomY = margin;
        const room = { x: offsetX, y: roomY, size: L };
        this.room = room;

        // --- 2) Resolve pose (model vs preview) ---
        const modelTheta = this.model?.transform?.theta ?? 0;
        const modelRange = this.model?.transform?.maxRange ?? this.maxRange ?? 8;

        const resolvedTheta =
            (this.ui.activeHandle === "angle") ? this.theta : modelTheta;

        const resolvedRange =
            (this.ui.activeHandle === "range") ? this.maxRange : modelRange;

        // --- 3) Sync canvas fields when NOT dragging ---
        if (this.ui.activeHandle !== "angle") this.theta = resolvedTheta;
        if (this.ui.activeHandle !== "range") {
            this.maxRange = resolvedRange;
            this.maxMeters = resolvedRange;
        }

        // Optional clamp
        this.theta = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.theta));
        this.maxRange = Math.max(0.5, Math.min(8, this.maxRange));

        // --- 4) Origin + scale (needs L) ---
        const slide = (this.theta / (Math.PI / 4)) * (L / 2);
        const origin = {
            x: room.x + room.size / 2 + slide,
            y: room.y
        };

        const scale = L / this.maxRange;

        this.origin = origin;
        this.SCALE = scale;
        this._currentTheta = this.theta;

        // --- 5) Handles ---
        const handlePadding = 12;
        const angleX = origin.x;
        const angleY = room.y - handlePadding;

        const RANGE_MAX = 8;
        const t = Math.min(Math.max(this.maxRange / RANGE_MAX, 0), 1);

        const rangeX = room.x + room.size + handlePadding;
        const rangeY = room.y + (1 - t) * room.size;

        // --- 6) Zones (preview merge) ---
        const zones =
            (this.ui.activeZoneId && this.previewZone)
                ? { ...this.model.zones, [this.ui.activeZoneId]: this.previewZone }
                : (this.model?.zones || {});

        // --- 7) Debug ---
        if (this.debugMode) {
            console.log("[GEOM theta]", {
                previewTheta: (this.theta * 180 / Math.PI).toFixed(2),
                resolvedTheta: (resolvedTheta * 180 / Math.PI).toFixed(2),
                modelTheta: this.model?.transform?.getAngleDeg?.()?.toFixed(2),
                fromPreview: this.ui.activeHandle === "angle"
            });
        }

        return {
            canvas: { w, h },
            room,
            origin,
            scale,
            theta: resolvedTheta,
            range: this.maxRange,
            zones,
            targets: (this.model && this.model.targets) || {},
            handles: {
                angle: { x: angleX, y: angleY },
                range: { x: rangeX, y: rangeY }
            },
            toCanvas: (x, y) => this.worldToCanvas(x, y),
            toWorld: (px, py) => this.canvasToWorld(px, py),
            roomToCanvas: (x, y) => this.roomToCanvas(x, y)
        };
    }


    updateScaleGeometry() {
        // 1. Measure rendered size
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        if (!w || !h) {
            console.warn("[RadarCanvas] updateScaleGeometry: invalid canvas size");
            return;
        }

        const margin = Math.min(w, h) * 0.05;  // 5% padding
        const roomSize = Math.min(w, h) - margin * 2;

        // 2. Device Pixel Ratio
        const dpr = window.devicePixelRatio || 1;

        // 3. Compute SCALE (metres → CSS pixels, *not* device pixels)
        if (this.maxRange > 0) {
            this.SCALE = (roomSize / this.maxRange);
        } else {
            this.SCALE = 1;
        }

        // 4. Set origin (top-centre)
        this.origin = {
            x: w / 2,
            y: margin
        };

        // 5. Snapshot for downstream
        this._geometry = {
            canvas: { w, h },
            margin,
            roomSize,
            origin: this.origin,
            scale: this.SCALE,
            dpr,
            theta: this.theta,
            range: this.maxRange
        };
        if (this.debugMode) {
            console.log("[updateScaleGeometry] SCALE =", this.SCALE);
        }
    }

    resize() {
        if (!this.cssReady) {
            console.log("[RadarCanvas.resize] blocked until CSS ready");
            return;
        }

        console.groupCollapsed(
            "%c[RadarCanvas.resize]",
            "color:#fa0;font-weight:bold;"
        );

        if (!this.canvas || !this.ctx) {
            console.warn("[RadarCanvas] resize() called before canvas is ready");
            console.groupEnd();
            return;
        }

        // Canvas wrapper (the div the canvas sits in)
        const wrapper = this.canvas.parentElement;
        if (!wrapper) {
            console.warn("[RadarCanvas] resize() — no parentElement for canvas yet");
            console.groupEnd();
            return;
        }

        const rect = wrapper.getBoundingClientRect();
        if (this.debugMode) {
            console.log("[RadarCanvas.resize] wrapper rect:", rect);
        }

        if (rect.width < 50 || rect.height < 50) {
            console.warn(
                "[RadarCanvas] resize() — wrapper too small, skipping for now"
            );
            console.groupEnd();
            return;
        }

        const dpr = window.devicePixelRatio || 1;

        // ✅ Width & height come directly from wrapper.
        //    NO TOOLBAR_RESERVE, NO wrapper.style.height here.
        const cssWidth = rect.width;
        const cssHeight = rect.height;

        // CSS size
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;

        // Internal DPR-scaled buffer
        this.canvas.width = Math.round(cssWidth * dpr);
        this.canvas.height = Math.round(cssHeight * dpr);

        // 1 CSS pixel == 1 logical drawing unit; DPR handled above
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._width = cssWidth;
        this._height = cssHeight;

        this.updateScaleGeometry();
        if (this.debugMode) {
            if (this.isReady()) {
                console.log("[RadarCanvas.resize] canvas CSS size:", {
                    cssWidth,
                    cssHeight,
                    bufferWidth: this.canvas.width,
                    bufferHeight: this.canvas.height
                });

                this._updateToolbarVisibility?.();
                this.requestDraw();
            }

            console.groupEnd();
        }
    }
    roomToCanvas(x, y) {
        return {
            x: this.room.x + x * this.SCALE,
            y: this.room.y + y * this.SCALE
        };
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
        if (!this.cssReady) return;
        if (!this.isReady()) {
            console.warn("[RadarCanvas] draw() skipped — data not ready.", {
                ready: this._ready,
                origin: this.origin,
                SCALE: this.SCALE,
                maxRange: this.maxRange,
                model_has_transform: !!this.model?.transform,
                model_zones: Object.keys(this.model?.zones || {}).length
            });
            return;
        }

        if (this.debugMode) {
            console.log("[DRAW]", {
                thetaCanvas: (this.theta * 180 / Math.PI).toFixed(2),
                thetaModel:
                    this.model?.transform?.getAngleDeg?.()?.toFixed(2),
                editing: this.model?.isEditing?.(),
                dirty: this.model?.hasDirtyChanges?.()
            });
        }

        const ctx = this.ctx;
        if (!this._buttons) this._setupButtons();
        this.clear();
        try {

            const params = this.computeGeometry();

            // === Core geometry setup (inside draw) ===
            this._layoutButtons(params);

            // World layers: room → grids → fan → zones → targets
            this.drawRoomBox(ctx, params);

            this.drawRoomGrid(ctx, params);
            this.drawFanGrid(ctx, params);
            this.drawFan(ctx, params);
            this.drawZones(ctx, params);
            this.drawTargets(ctx, params);
            // UI overlay on top
            this.drawControls(ctx, params);
            this._drawToolbar(ctx);
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
        this.requestDraw();;
    }
    highlightZone(zoneNum) {
        this._highlightZone = zoneNum;
        this.requestDraw();
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
    requestDraw() {
        if (this._drawRequested) return;
        this._drawRequested = true;
        requestAnimationFrame(() => {
            this._drawRequested = false;
            //console.log("requestDraw() using instance:", this);
            this.draw();
        });
    }
    _onPointerDown(evt) {
        if (this.ui.pointerId !== null) return;

        const params = this.computeGeometry();
        if (this.debugMode) {
            console.groupCollapsed("[PD] pointerdown");
            console.log("ui.activeHandle (before):", this.ui.activeHandle);
            console.log("canvas.theta (before):", this.theta);
            console.log("model.theta (before):",
                this.model?.transform?.getAngleDeg?.()
            );
            console.log("model._editing:", this.model?.isEditing());
            console.groupEnd();
        }

        const p = this._getCanvasPoint(evt);
        const px = p.x;
        const py = p.y;

        let hitZoneId = null;
        let hitHandle = null;

        // 1) Toolbar buttons always work
        for (const btn of Object.values(this._buttons)) {
            if (btn.visible &&
                p.x >= btn.x && p.x <= btn.x + btn.w &&
                p.y >= btn.y && p.y <= btn.y + btn.h) {
                this._handleUIButton(btn.id);
                evt.preventDefault(); evt.stopPropagation();
                return;
            }
        }

        // 🔑 ENTER EDIT MODE ON FIRST USER INTERACTION
        if (!this.model.isEditing()) {
            this.model.beginEdit();
        }

        // --- ZONE HIT TEST ---
        for (const [id, z] of Object.entries(params.zones || {})) {
            const hs = this._computeHandlesForZone(z, params);
            const h = this._hitHandle(px, py, hs);
            if (h) {
                hitZoneId = id;
                hitHandle = h;
                break;
            }
            if (!hitZoneId && this._pointInZone(px, py, z, params)) {
                hitZoneId = id;
            }
        }
        const hit = (px, py, hx, hy, r = 12) => Math.hypot(px - hx, py - hy) < r;
        // --- ANGLE HANDLE ---
        if (hit(px, py, params.handles.angle.x, params.handles.angle.y, 12)) {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeHandle = 'angle';
            this.canvas.setPointerCapture(evt.pointerId);
            evt.preventDefault();
            return;
        }

        // --- RANGE HANDLE ---
        if (hit(px, py, params.handles.range.x, params.handles.range.y, 12)) {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeHandle = 'range';
            this.canvas.setPointerCapture(evt.pointerId);
            evt.preventDefault();
            return;
        }

        // --- ZONE SELECT / DRAG ---
        if (hitZoneId) {
            this.ui.pointerId = evt.pointerId;
            this.ui.activeZoneId = hitZoneId;
            this.ui.activeHandle = hitHandle || { type: 'move', which: 'c' };

            this.ui.dragStart = {
                canvas: { x: px, y: py },
                room: this._canvasToRoom(px, py, params)
            };

            const z0 = params.zones[hitZoneId];
            this.ui.originalZone = JSON.parse(JSON.stringify(this._normZone(z0)));

            this.canvas.setPointerCapture(evt.pointerId);
            this.model._dirty = true;
            this.requestDraw();
            evt.preventDefault();
            return;
        }
    }
    _clampZoneToRoom(zone, room) {
        const minX = 0;
        const minY = 0;
        const maxX = room.size;
        const maxY = room.size;

        const w = zone.end.x - zone.start.x;
        const h = zone.end.y - zone.start.y;

        zone.start.x = Math.max(minX, Math.min(zone.start.x, maxX - w));
        zone.start.y = Math.max(minY, Math.min(zone.start.y, maxY - h));
        zone.end.x = zone.start.x + w;
        zone.end.y = zone.start.y + h;

        return zone;
    }
    _onPointerMove(evt) {
        if (evt.pointerId !== this.ui.pointerId) return;

        const params = this.computeGeometry();
        const p = this._getCanvasPoint(evt);
        const px = p.x;
        const py = p.y;

        const { activeHandle, activeZoneId, originalZone, dragStart } = this.ui;

        // --- ANGLE DRAG ---

        if (this.ui.activeHandle === 'angle') {
            const half = params.room.size / 2;

            // distance from room centre, normalised to [-1, 1]
            const t = (p.x - (params.room.x + half)) / half;

            // map linearly to angle range
            const theta = t * (Math.PI / 4);

            // clamp
            this.theta = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, theta));
            if (this.debugMode) {
                console.log("[PM angle]", {
                    previewThetaDeg: (this.theta * 180 / Math.PI).toFixed(2),
                    modelThetaDeg: this.model?.transform?.getAngleDeg?.().toFixed(2)
                });
            }

            this.requestDraw();
            evt.preventDefault();
            return;
        }


        // --- RANGE DRAG ---
        if (activeHandle === 'range') {

            const t = 1 - ((py - params.room.y) / params.room.size);
            this.maxRange = Math.max(0.5, Math.min(8, t * 8));
            this.maxMeters = this.maxRange;
            this.requestDraw();
            evt.preventDefault();
            return;
        }

        // --- ZONE DRAG ---
        if (!activeZoneId || !activeHandle || !originalZone || !dragStart) return;

        const curRoom = this._canvasToRoom(px, py, params);
        const dx = curRoom.x - dragStart.room.x;
        const dy = curRoom.y - dragStart.room.y;

        const dz = JSON.parse(JSON.stringify(originalZone));

        if (activeHandle.type === 'move') {
            dz.start.x += dx; dz.end.x += dx;
            dz.start.y += dy; dz.end.y += dy;
        } else if (activeHandle.type === 'corner') {
            if (activeHandle.which.includes('t')) dz.start.y += dy;
            if (activeHandle.which.includes('b')) dz.end.y += dy;
            if (activeHandle.which.includes('l')) dz.start.x += dx;
            if (activeHandle.which.includes('r')) dz.end.x += dx;
        } else if (activeHandle.type === 'edge') {
            if (activeHandle.which === 't') dz.start.y += dy;
            if (activeHandle.which === 'b') dz.end.y += dy;
            if (activeHandle.which === 'l') dz.start.x += dx;
            if (activeHandle.which === 'r') dz.end.x += dx;
        }

        this.previewZone = this._clampZoneToRoom(dz, params.room);
        this.requestDraw();
        evt.preventDefault();
    }
    _onPointerUp(evt) {
        if (evt.pointerId !== this.ui.pointerId) return;
        console.groupEnd();
        if (this.debugMode) {
            console.groupCollapsed("[PU] pointerup");
            console.log("activeHandle:", this.ui.activeHandle);
            console.log("canvas.theta (before commit):",
                (this.theta * 180 / Math.PI).toFixed(2)
            );

            console.log("model.theta (before commit):",
                this.model?.transform?.getAngleDeg?.()
            );


            console.log("model._editing:", this.model?.isEditing());


            console.groupEnd();
        }
        this.canvas.releasePointerCapture(evt.pointerId);

        const { activeZoneId } = this.ui;

        // --- COMMIT ZONE ---
        if (activeZoneId && this.previewZone) {
            this.model.updateZones({
                ...this.model.zones,
                [activeZoneId]: this.previewZone
            });
        }
        if (this.ui.activeHandle === 'angle') {
            // Commit current theta to model
            this.model.updateRadarPose({
                angleDeg: this.theta * 180 / Math.PI,
                rangeM: this.maxRange
            });
            if (this.debugMode) {
                console.log("[PU commit angle]", {
                    modelThetaAfter: (() => {
                        const v = this.model?.transform?.getAngleDeg?.();
                        return v !== undefined ? v.toFixed(2) : "undefined";
                    })(),
                    dirty: this.model?.hasDirtyChanges?.()
                });
            }


        }
        if (this.ui.activeHandle === 'range') {
            // Commit current theta to model
            this.model.updateRadarPose({
                angleDeg: this.theta * 180 / Math.PI,
                rangeM: this.maxRange
            });
        }

        // --- CLEANUP ---
        this.ui.pointerId = null;
        this.ui.activeHandle = null;
        this.ui.dragStart = null;
        this.ui.originalZone = null;
        this.previewZone = null;

        this.requestDraw();
    }



    _handleUIButton(id) {
        switch (id) {
            case "add":
                this._addZone();
                break;
            case "edit": {
                const enteringEdit = this.ui.mode !== "edit";
                this.ui.mode = enteringEdit ? "edit" : "view";

                if (enteringEdit) {
                    //if (this.card) this.card._editMode = true;
                    this.model.beginEdit();
                } else {
                    //if (this.card) this.card._editMode = false;
                    this.model.commitEdit();
                    this.model._dirty = false;
                    this.ui.activeZoneId = null; // leaving edit clears selection
                }
                this._updateToolbarVisibility();
                this.requestDraw();
                if (this.debugMode) {
                    console.log(
                        `[EditMode] ${enteringEdit ? "Entered" : "Exited"} edit mode`
                    );
                }
                break;
            }
            case "save": {
                //this.card?.saveZonesToHA?.();
                const snapshot = this.model.exportSnapshot();
                this.card.hassAdapter.pushCommit(snapshot, this._selectedDevice);
                this.model.commitEdit();

                this.ui.mode = "view";
                //if (this.card) this.card._editMode = false;
                this.ui.activeZoneId = null;

                this._updateToolbarVisibility();
                this.requestDraw();
                break;
            }
            case "discard": {
                this.card?.loadZonesFromHA?.();
                this.model.commitEdit();
                this.ui.mode = "view";
                //if (this.card) this.card._editMode = false;

                this._updateToolbarVisibility();
                this.requestDraw();
                break;
            }
            case 'delete': {
                const zoneId = this.ui.activeZoneId;
                if (zoneId) {
                    const zones = { ...this.model?.zones };
                    delete zones[zoneId];
                    this.model?.updateZones(zones);
                    this.model.beginEdit();

                    // Tell card that deletion affects HA
                    if (this.card) {
                        this.card._deletedZone = zoneId;   // mark for HA clean-up
                        //this.card._editMode = true;
                    }

                    this.ui.activeZoneId = null;
                    this.model._dirty = true;
                }
                this._updateToolbarVisibility();
                this.requestDraw();
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
        const zoneId = nextId;
        // Commit to model (single source of truth)
        this.model?.updateZones?.(zones);
        if (this.model.zones && this.model.zones[zoneId]) {
            this.model.zones[zoneId].enabled = true;
        }
        // Make this the selected zone
        this.ui.activeZoneId = zoneId;
        // Switch canvas into edit mode
        this.ui.mode = "edit";
        this.model.beginEdit();

        if (this.card) {
            //    this.card._editMode = true;
        }
        // Switch to edit mode and mark dirty so Save/Discard/Delete appear
        this.ui.mode = 'edit';

        if (this.card) {
            //this.card._editMode = true;
            this._updateToolbarVisibility();
            // show Save/Discard/Delete buttons in the toolbar
            for (const b of Object.values(this._buttons)) {
                if (['save', 'discard', 'delete'].includes(b.id))
                    b.visible = true;
            }
        }
        this.model._dirty = true;
        this.requestDraw();
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

        // Canvas is the master: edit mode is tracked via ui.mode
        const editing = this.ui.mode === "edit";
        const zoneSel = !!this.ui.activeZoneId;

        const show = (id) => (this._buttons[id].visible = true);
        const hide = (id) => (this._buttons[id].visible = false);

        if (!editing) {
            // VIEW MODE – only Add + Edit visible
            show("add");
            show("edit");

            hide("save");
            hide("discard");
            hide("angle");
            hide("range");
            hide("delete");
            return;
        }
        // EDIT MODE – Edit is hidden, Save/Discard/Angle/Range shown
        hide("edit");
        show("save");
        show("discard");
        show("angle");
        show("range");
        // Delete only visible when a zone is selected
        if (zoneSel) {
            show("delete");
        } else {
            hide("delete");
        }
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
            //const fill = z.occupied
            //    ? base.fill.replace(/0\\.15|0\\.10|0\\.22/, '0.35')
            //   : base.fill;
            const fill = z.occupied
                ? base.fill.replace(/0\.\d+/, '0.45')
                : base.fill;
            const stroke = base.stroke;
            if (z.occupied) {
                ctx.save();
                ctx.shadowColor = base.stroke;
                ctx.shadowBlur = 12;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
            }
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
        function roomToCanvas(x, y, params, SCALE) {
            return {
                x: params.origin.x + x * SCALE,
                y: params.origin.y + y * SCALE
            };
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
            // Recompute sensor_x exactly like ESPHome (SLIDING SENSOR POSITION)
            const R = params.range_m;           // must be provided (same as epl_distance)
            const angleDeg = params.angle_deg;  // must be provided (same as epl_install_angle)
            // Map [-45,+45] → [0,1]
            let t01 = (angleDeg + 45) / 90;
            t01 = Math.max(0, Math.min(1, t01));
            const sensor_x = t01 * R;
            const sensor_y = 0;
            // Convert ROOM → RADAR (relative to sensor origin)
            const xr = t.x - sensor_x;
            const yr = t.y - sensor_y;
            // Feed radar-space into existing transform.
            // If your screen Y grows downward, keep yr as-is.
            // If it’s still flipped 180°, change yr to (-yr) here.
            //const p = params.toCanvas(xr, -yr);
            // const p = params.toCanvas(1, -0.5);
            const p = params.roomToCanvas(t.x, t.y); // no rotation for targets
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
        this.requestDraw();  // always clear + redraw full scene
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
        //console.log('[canvasToWorld] SCALE=', this.SCALE);
        return { x, y };
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
        if (this.debugMode) {
            console.log("_setupButtons " + this._buttons);
        }

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
        //ctx.stroke();

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
        // Icons designed for ~24px in reference image
        const size = btn.w * 0.99;  // consistent across all devices

        // Centre in CSS pixel space
        const ix = btn.x + (btn.w - size) / 2;
        const iy = btn.y + (btn.h - size) / 2;
        switch (btn.id) {
            case "add": return this._iconAdd(ctx, ix, iy, size);
            case "edit": return this._iconEdit(ctx, ix, iy, size);
            case "save": return this._iconSave(ctx, ix, iy, size);
            case "discard": return this._iconDelete(ctx, ix, iy, size);
            case "angle": return this._iconAngle(ctx, ix, iy, size);
            case "range": return this._iconRange(ctx, ix, iy, size);
            case "delete": return this._iconDeleteZone(ctx, ix, iy, size);
        }
    }
    _iconBase(ctx, size) {
        ctx.save();

        // Use consistent CSS-based stroke width (converted into device px automatically)
        ctx.lineWidth = 2;   // EXACTLY like the reference icons

        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#000';
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

        // Normalised coordinate system:
        // Grid was 20×20, so 1 grid unit = size/20
        const u = size / 20;

        // Helper to convert grid coords to canvas coords
        const gx = (col) => x + col * u;
        const gy = (row) => y + row * u;

        ctx.beginPath();
        //ctx.lineWidth = Math.max(1.5, size * 0.08);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        //
        // 1. OUTER FRAME (OPEN TOP-RIGHT)
        //
        ctx.beginPath();
        ctx.moveTo(gx(12), gy(3));   // L3  → C3
        ctx.lineTo(gx(3), gy(3));

        ctx.moveTo(gx(3), gy(3));    // C3  → C17
        ctx.lineTo(gx(3), gy(17));

        ctx.moveTo(gx(3), gy(17));   // C17 → O17
        ctx.lineTo(gx(15), gy(17));

        ctx.moveTo(gx(15), gy(17));  // O17 → O9
        ctx.lineTo(gx(15), gy(9));

        ctx.stroke();

        //
        // 2. PENCIL OUTLINE (P2→R4→L10→J10→J8→P2)
        //
        ctx.beginPath();
        ctx.moveTo(gx(16), gy(2));     // P2
        ctx.lineTo(gx(18), gy(4));     // R4
        ctx.lineTo(gx(12), gy(10));    // L10
        ctx.lineTo(gx(10), gy(10));    // J10
        ctx.lineTo(gx(10), gy(8));     // J8
        ctx.closePath();               // back to P2
        ctx.stroke();
        //ctx.fill();                    // tip gets filled, matching SVG

        //
        // 3. PENCIL MIDDLE LINE (N4 → P6)
        //
        ctx.beginPath();
        ctx.moveTo(gx(14), gy(4));     // N4
        ctx.lineTo(gx(16), gy(6));     // P6
        ctx.stroke();

        ctx.restore();

    }
    _iconSave(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const s = size;
        const margin = s * 0.16;
        const left = x + margin;
        const top = y + margin;
        const right = x + s - margin;
        const bottom = y + s - margin;
        const vgap = 5
        const hgap = 3;

        const bodyWidth = right - left;
        const bodyHeight = bottom - top;

        const chamfer = bodyWidth * 0.28;

        // Outer body
        ctx.beginPath();
        ctx.moveTo(left, bottom);
        ctx.lineTo(left, top);
        ctx.lineTo(right - chamfer, top);
        ctx.lineTo(right, top + chamfer);
        ctx.lineTo(right, bottom);
        ctx.closePath();
        ctx.stroke();

        // Label (U-shape)
        const labelLeft = left + bodyWidth * 0.15;
        const labelRight = right - bodyWidth * 0.5;
        const labelBottom = top + bodyHeight * 0.35;

        ctx.beginPath();
        ctx.moveTo(labelLeft, top);
        ctx.lineTo(labelRight, top);
        ctx.lineTo(labelRight, labelBottom);
        ctx.moveTo(labelLeft, top);
        ctx.lineTo(labelLeft, labelBottom);
        ctx.stroke();

        // Shelf line
        ctx.beginPath();
        ctx.moveTo(labelLeft, labelBottom);
        ctx.lineTo(right - bodyWidth * 0.5, labelBottom);
        ctx.stroke();

        // Pocket rectangle (correct)
        ctx.beginPath();
        ctx.rect(
            labelLeft + hgap,
            labelBottom + vgap,
            bodyWidth * 0.6,
            bottom - labelBottom - vgap
        );
        ctx.stroke();

        ctx.restore();
    }
    _iconDelete(ctx, x, y, size) {
        this._iconBase(ctx, size);

        // Drawn icon uses 80% of the tile
        const s = size * 0.80;

        // Center horizontally (existing logic)
        const p = (size - s) / 2;
        const bx = x + p;

        // NEW: vertical centering offset
        const offsetY = (size - s) / 2;  // same as horizontal centering
        const by = y + offsetY + 4;

        const lidH = s * 0.18;
        const bodyH = s * 0.62;
        const handleW = s * 0.22;
        const w = s * 0.52;

        // Lid
        ctx.beginPath();
        ctx.rect(bx + (s - w) / 2, by, w, lidH);
        ctx.stroke();

        // Handle
        ctx.beginPath();
        ctx.moveTo(bx + s / 2 - handleW / 2, by - s * 0.04);
        ctx.lineTo(bx + s / 2 + handleW / 2, by - s * 0.04);
        ctx.stroke();

        // Body
        const bodyY = by + lidH + s * 0.04;
        ctx.beginPath();
        ctx.rect(bx + (s - w) / 2, bodyY, w, bodyH);
        ctx.stroke();

        // Ribs
        const ribTop = bodyY + s * 0.06;
        const ribBot = bodyY + bodyH - s * 0.06;
        const r1 = bx + s / 2 - w * 0.20;
        const r2 = bx + s / 2 + w * 0.20;

        ctx.beginPath();
        ctx.moveTo(r1, ribTop); ctx.lineTo(r1, ribBot);
        ctx.moveTo(r2, ribTop); ctx.lineTo(r2, ribBot);
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

        const u = size / 20;
        const gx = (col) => x + col * u;
        const gy = (row) => y + row * u;

        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        //
        // 0. COMMON CENTER FOR ARCS = C17 = (3,17)
        //
        const cx = gx(3);
        const cy = gy(17);

        //
        // 1. BASELINE: C17 → R17
        //
        ctx.beginPath();
        ctx.moveTo(gx(3), gy(17));
        ctx.lineTo(gx(18), gy(17));
        ctx.stroke();

        //
        // 2. ANGLE LEG: C17 → O5
        //
        ctx.beginPath();
        ctx.moveTo(gx(3), gy(17));
        ctx.lineTo(gx(15), gy(5));
        ctx.stroke();

        //
        // 3. INNER ARC (K16 → K10) with dashed stroke
        //
        const innerRadius = 9 * u;
        const a_in_start = Math.atan2(16 - 17, 11 - 3); // K16
        const a_in_end = Math.atan2(10 - 17, 11 - 3); // K10

        ctx.beginPath();
        ctx.setLineDash([u * 0.8, u * 0.8]);
        ctx.arc(cx, cy, innerRadius, a_in_start, a_in_end, true); // true = clockwise sweep
        ctx.stroke();
        ctx.setLineDash([]);

        //
        // 4. OUTER ARC (N16 → N7)
        //
        const outerRadius = 12 * u;
        const a_out_start = Math.atan2(16 - 17, 14 - 3); // N16
        const a_out_end = Math.atan2(7 - 17, 14 - 3);  // N7

        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, a_out_start, a_out_end, true); // clockwise
        ctx.stroke();

        //
        // 5. ARROWHEADS — EXACTLY ALIGNED TO ARC TANGENT
        //
        const arrow = 2.2 * u;

        function arrowhead(angle, radius, direction) {
            // direction = +1 for arrow at start, -1 for arrow at end
            const px = cx + Math.cos(angle) * radius;
            const py = cy + Math.sin(angle) * radius;

            // unit tangent vector
            const tx = -Math.sin(angle);
            const ty = Math.cos(angle);

            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(
                px + direction * (-tx * arrow - ty * arrow),
                py + direction * (-ty * arrow + tx * arrow)
            );
            ctx.moveTo(px, py);
            ctx.lineTo(
                px + direction * (-tx * arrow + ty * arrow),
                py + direction * (-ty * arrow - tx * arrow)
            );
            ctx.stroke();
        }

        // Top arrow at N7 (end of arc) -> /\  (direction = -1)
        arrowhead(a_out_end, outerRadius, -1);

        // Bottom arrow at N16 (start of arc) -> \/  (direction = +1)
        arrowhead(a_out_start, outerRadius, +1);

        //
        // 6. DEGREE SYMBOL at Q11 (17,11)
        //
        ctx.beginPath();
        ctx.arc(gx(17), gy(11), u * 1, 0, Math.PI * 2);
        ctx.stroke()
        //ctx.fill();

        ctx.restore();
    }



    _iconRange(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const s = size * 0.80;
        const p = (size - s) / 2;

        const cx = x + size / 2;
        const cy = y + size / 2;

        // Arrow shaft
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.30);
        ctx.lineTo(cx, cy + s * 0.10);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.14, cy - s * 0.05);
        ctx.lineTo(cx, cy + s * 0.10);
        ctx.lineTo(cx + s * 0.14, cy - s * 0.05);
        ctx.stroke();

        // Base line (shorter width)
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.32, cy + s * 0.10);
        ctx.lineTo(cx + s * 0.32, cy + s * 0.10);
        ctx.stroke();

        ctx.restore();
    }

    _iconDeleteZone(ctx, x, y, size) {
        this._iconBase(ctx, size);

        const u = size / 20;
        const gx = c => x + c * u;
        const gy = r => y + r * u;

        //
        // 1. ZONE BOX (rounded rect)
        //
        ctx.beginPath();
        const zx = gx(3), zy = gy(3);
        const zw = 14 * u, zh = 14 * u;
        const r = 2 * u;

        ctx.moveTo(zx + r, zy);
        ctx.lineTo(zx + zw - r, zy);
        ctx.quadraticCurveTo(zx + zw, zy, zx + zw, zy + r);
        ctx.lineTo(zx + zw, zy + zh - r);
        ctx.quadraticCurveTo(zx + zw, zy + zh, zx + zw - r, zy + zh);
        ctx.lineTo(zx + r, zy + zh);
        ctx.quadraticCurveTo(zx, zy + zh, zx, zy + zh - r);
        ctx.lineTo(zx, zy + r);
        ctx.quadraticCurveTo(zx, zy, zx + r, zy);
        ctx.stroke();

        //
        // 2. MINUS SIGN
        //
        ctx.beginPath();
        ctx.moveTo(gx(7), gy(10));
        ctx.lineTo(gx(13), gy(10));
        ctx.stroke();

        //
        // 3. TRASH BIN (scaled delete icon)
        //
        const bxL = gx(13);
        const bxT = gy(13);
        const bw = 5 * u;
        const bh = 6 * u;

        // Lid
        ctx.beginPath();
        ctx.rect(bxL + u * 0.5, bxT, bw - u, u);
        ctx.stroke();

        // Bin body
        ctx.beginPath();
        ctx.rect(bxL, bxT + u, bw, bh);
        ctx.stroke();

        // Ribs
        ctx.beginPath();
        ctx.moveTo(bxL + bw * 0.35, bxT + u * 2);
        ctx.lineTo(bxL + bw * 0.35, bxT + bh);
        ctx.moveTo(bxL + bw * 0.65, bxT + u * 2);
        ctx.lineTo(bxL + bw * 0.65, bxT + bh);
        ctx.stroke();

        ctx.restore();
    }

    _drawUIButton(ctx) {
        if (!this._buttons) return;
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const btn of Object.values(this._buttons)) {
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
        } else if (this.model?.hasDirtyChanges) {
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
