export class HassAdapter {
    constructor(hass) {
        this.hass = hass;
    }

    extractSnapshot(deviceId, loadZonesFn, getTargetsFn) {
        if (!this.hass || !deviceId) return null;

        const angleDeg = Number(
            this.hass.states[`number.${deviceId}_installation_angle`]?.state
        );

        const rangeM = Number(
            this.hass.states[`number.${deviceId}_distance`]?.state
        );

        const zones = loadZonesFn ? loadZonesFn() : null;
        const targets = getTargetsFn ? getTargetsFn(deviceId) : null;

        return {
            pose: { angleDeg, rangeM },
            zones,
            targets,
        };
    }

    pushCommit(snapshot, deviceId) {
        if (!this.hass || !snapshot || !deviceId) return;

        const svc = (entity_id, value) =>
            this.hass.callService("number", "set_value", {
                entity_id,
                value,
            });

        const { pose, zones } = snapshot;

        if (pose && Number.isFinite(pose.angleDeg)) {
            svc(`number.${deviceId}_installation_angle`, pose.angleDeg);
        }
        if (pose && Number.isFinite(pose.rangeM)) {
            svc(`number.${deviceId}_distance`, pose.rangeM);
        }




        if (zones) {
            for (const [zoneNum, z] of Object.entries(zones)) {
                if (!z.start || !z.end) continue;

                const prefix = `number.${deviceId}_zone_${zoneNum}`;

                const svc = (eid, value) =>
                    this.hass.callService("number", "set_value", {
                        entity_id: eid,
                        value: Number(value.toFixed(3)),
                    });

                svc(`${prefix}_x_begin`, z.start.x);
                svc(`${prefix}_x_end`, z.end.x);
                svc(`${prefix}_y_begin`, z.start.y);
                svc(`${prefix}_y_end`, z.end.y);

                // Optional enable switch if you use it
                if (typeof z.enabled === "boolean") {
                    this.hass.callService(
                        "switch",
                        z.enabled ? "turn_on" : "turn_off",
                        {
                            entity_id: `switch.${deviceId}_zone_${zoneNum}_enable`,
                        }
                    );
                }
            }
        }





    }
}