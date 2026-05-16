// hass-adapter.js v1
export class HassAdapter {
    constructor(hass) {
        this.hass = hass;

        this._lastSnapshot = null;
        this._lastSnapshotTs = 0;

        this.SNAPSHOT_INTERVAL_MS = 500; // 4 Hz
    }

    setHass(hass) {
        this.hass = hass;
    }

    extractSnapshot(deviceId, loadZonesFn, getTargetsFn) {
        if (!this.hass || !deviceId) return null;

        const now = performance.now();

        // Reuse last snapshot if called too quickly
        if (
            this._lastSnapshot &&
            now - this._lastSnapshotTs < this.SNAPSHOT_INTERVAL_MS
        ) {
            return this._lastSnapshot;
        }

        const angleDeg = Number(
            this.hass.states[`number.${deviceId}_installation_angle`]?.state
        );

        const rangeM = Number(
            this.hass.states[`number.${deviceId}_distance`]?.state
        );

        const zones = loadZonesFn ? loadZonesFn() : {};
        const targets = getTargetsFn ? getTargetsFn(deviceId) : {};

        const snapshot = {
            pose: {
                angleDeg: Number.isFinite(angleDeg) ? angleDeg : 0,
                rangeM: Number.isFinite(rangeM) ? rangeM : 6,
            },
            zones: zones || {},
            targets: targets || {},
        };

        this._lastSnapshot = snapshot;
        this._lastSnapshotTs = now;

        return snapshot;
    }

    pushCommit(snapshot, maybeZonesOrDeviceId, maybeDeviceId) {
        if (!this.hass || !snapshot) {
            console.warn("[HassAdapter] pushCommit aborted", {
                hasHass: !!this.hass,
                hasSnapshot: !!snapshot,
            });
            return;
        }

        // Backward-compatible argument handling:
        // old: pushCommit(snapshot, zones, deviceId)
        // new: pushCommit(snapshot, deviceId)
        let deviceId;

        if (typeof maybeZonesOrDeviceId === "string") {
            deviceId = maybeZonesOrDeviceId;
        } else if (typeof maybeDeviceId === "string") {
            deviceId = maybeDeviceId;
        }

        if (!deviceId) {
            console.error("[HassAdapter] pushCommit missing valid deviceId", {
                snapshot,
                maybeZonesOrDeviceId,
                maybeDeviceId,
            });
            return;
        }

        const setNumber = (entity_id, value) => {
            if (typeof entity_id !== "string" || !entity_id.includes(".")) {
                console.error("[HassAdapter] Invalid number entity_id", {
                    entity_id,
                    value,
                });
                return;
            }

            if (!Number.isFinite(Number(value))) {
                console.warn("[HassAdapter] Refusing non-numeric value", {
                    entity_id,
                    value,
                });
                return;
            }

            console.log("[HassAdapter] number.set_value", {
                entity_id,
                value: Number(value),
            });

            return this.hass.callService("number", "set_value", {
                entity_id,
                value: Number(value),
            });
        };

        const setSwitch = (entity_id, enabled) => {
            if (typeof entity_id !== "string" || !entity_id.includes(".")) {
                console.error("[HassAdapter] Invalid switch entity_id", {
                    entity_id,
                    enabled,
                });
                return;
            }

            console.log("[HassAdapter] switch", {
                entity_id,
                service: enabled ? "turn_on" : "turn_off",
            });

            return this.hass.callService(
                "switch",
                enabled ? "turn_on" : "turn_off",
                { entity_id }
            );
        };

        const { pose, zones = {} } = snapshot;

        console.log("[HassAdapter] pushCommit resolved", {
            deviceId,
            pose,
            zones,
        });

        // 1. Push radar pose
        if (pose && Number.isFinite(Number(pose.angleDeg))) {
            setNumber(
                `number.${deviceId}_installation_angle`,
                Number(pose.angleDeg)
            );
        }

        if (pose && Number.isFinite(Number(pose.rangeM))) {
            setNumber(
                `number.${deviceId}_distance`,
                Number(pose.rangeM)
            );
        }

        // 2. Push current zone geometry
        for (const [zoneNum, z] of Object.entries(zones)) {
            if (!z || !z.start || !z.end) {
                console.warn("[HassAdapter] Skipping malformed zone", {
                    zoneNum,
                    zone: z,
                });
                continue;
            }

            const x1 = Number(z.start.x);
            const y1 = Number(z.start.y);
            const x2 = Number(z.end.x);
            const y2 = Number(z.end.y);

            if (
                !Number.isFinite(x1) ||
                !Number.isFinite(y1) ||
                !Number.isFinite(x2) ||
                !Number.isFinite(y2)
            ) {
                console.warn("[HassAdapter] Skipping zone with invalid coordinates", {
                    zoneNum,
                    zone: z,
                });
                continue;
            }

            const xBegin = Math.min(x1, x2);
            const xEnd = Math.max(x1, x2);
            const yBegin = Math.min(y1, y2);
            const yEnd = Math.max(y1, y2);

            const prefix = `number.${deviceId}_zone_${zoneNum}`;

            setSwitch(
                `switch.${deviceId}_zone_${zoneNum}_enable`,
                z.enabled !== false
            );

            setNumber(`${prefix}_x_begin`, xBegin);
            setNumber(`${prefix}_x_end`, xEnd);
            setNumber(`${prefix}_y_begin`, yBegin);
            setNumber(`${prefix}_y_end`, yEnd);
        }

        // 3. Detect deleted zones
        const existingZones = new Set();

        for (const entityId of Object.keys(this.hass.states || {})) {
            const match = entityId.match(
                new RegExp(`^(number|switch)\\.${deviceId}_zone_(\\d+)_`)
            );

            if (match) {
                existingZones.add(match[2]);
            }
        }

        const snapshotZones = new Set(Object.keys(zones));

        const deletedZones = [...existingZones].filter(
            zoneNum => !snapshotZones.has(zoneNum)
        );

        // 4. Clear deleted zones
        for (const zoneNum of deletedZones) {
            setSwitch(
                `switch.${deviceId}_zone_${zoneNum}_enable`,
                false
            );

            const prefix = `number.${deviceId}_zone_${zoneNum}`;

            setNumber(`${prefix}_x_begin`, 0);
            setNumber(`${prefix}_x_end`, 0);
            setNumber(`${prefix}_y_begin`, 0);
            setNumber(`${prefix}_y_end`, 0);

            console.warn(
                `[HassAdapter] Zone ${zoneNum} disabled and cleared from HA.`
            );
        }

        console.info("[HassAdapter] Commit pushed to Home Assistant", {
            deviceId,
            pose,
            zones,
            deletedZones,
        });
    }
}