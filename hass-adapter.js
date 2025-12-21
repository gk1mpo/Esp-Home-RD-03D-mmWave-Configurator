export class HassAdapter {
    constructor(hass) {
        this.hass = hass;
    }

    // Called ONLY after model.commitEdit()
    pushCommit(snapshot, deviceId) {
        if (!this.hass || !snapshot || !deviceId) return;

        const svc = (entity_id, value) =>
            this.hass.callService("number", "set_value", {
                entity_id,
                value,
            });

        const { pose } = snapshot;

        if (pose && Number.isFinite(pose.angleDeg)) {
            svc(`number.${deviceId}_installation_angle`, pose.angleDeg);
        }

        if (pose && Number.isFinite(pose.rangeM)) {
            svc(`number.${deviceId}_distance`, pose.rangeM);
        }
    }
}

