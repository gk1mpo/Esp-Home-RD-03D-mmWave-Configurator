export class HassAdapter {
    constructor(hass) {
        this.hass = hass;
        this._lastSnapshot = null;
        this._lastEmit = 0;
        this.SNAPSHOT_INTERVAL_MS = 500; // 4 Hz (plenty)

    }

    extractSnapshot(deviceId, loadZonesFn, getTargetsFn) {
        if (!this.hass || !deviceId) return null;
        const now = performance.now();

        // ⛔ Throttle: reuse last snapshot if too soon
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

        const zones = loadZonesFn ? loadZonesFn() : null;
        const targets = getTargetsFn ? getTargetsFn(deviceId) : null;
        //console.count('[extractSnapshot]');

        return {
            pose: { angleDeg, rangeM },
            zones,
            targets,
        };
    }

    pushCommit(snapshot, zones, deviceId) {
        if (!this.hass || !snapshot || !deviceId) return;

        const svc = (entity_id, value) =>
            this.hass.callService("number", "set_value", {
                entity_id,
                value,
            });

        const { pose, snap_zones } = snapshot;

        if (pose && Number.isFinite(pose.angleDeg)) {
            svc(`number.${deviceId}_installation_angle`, pose.angleDeg);
        }
        if (pose && Number.isFinite(pose.rangeM)) {
            svc(`number.${deviceId}_distance`, pose.rangeM);
        }


        const existingZones = new Set();

        for (const id of Object.keys(this.hass.states)) {
            const m = id.match(
                new RegExp(`^(number|switch)\\.${deviceId}_zone_(\\d+)_`)
            );
            if (m) existingZones.add(m[2]);
        }
        const snapshotZones = new Set(
        snapshot.zones ? Object.keys(snapshot.zones) : []
        );
        const deletedZones = [...existingZones].filter( z => !snapshotZones.has(z));
        for (const i of deletedZones) {
        // Disable zone
        this.hass.callService("switch", "turn_off", {
            entity_id: `switch.${deviceId}_zone_${i}_enable`,
        });
    
        // Zero geometry
        const zero = (eid) =>
            this.hass.callService("number", "set_value", {
                entity_id: eid,
                value: 0,
            });
    
        zero(`number.${deviceId}_zone_${i}_x_begin`);
        zero(`number.${deviceId}_zone_${i}_x_end`);
        zero(`number.${deviceId}_zone_${i}_y_begin`);
        zero(`number.${deviceId}_zone_${i}_y_end`);
    
        console.warn(`[C-1.2] Zone ${i} fully cleared from HA.`);
        }
    }
       
}