// ep-zone-configurator-editor.js
import { LovelaceBridgeInterface } from "./lovelace-bridge-interface.js";

class EPZoneConfiguratorEditor extends HTMLElement {
    constructor() {
        super();
        this._config = {};
        this._hass = null;
        this.bridge = null;
        this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
        this._config = config || {};
        this._render();
    }

    set hass(hass) {
        this._hass = hass;
        if (this.bridge) {
            this.bridge.hass = hass;
        } else if (hass) {
            this.bridge = new LovelaceBridgeInterface(hass);
        }
        this._render();
    }

    _render() {
        if (!this.shadowRoot || !this._hass) return;

        const cfg = this._config || {};
        const devices = this.bridge ? this.bridge.getDevices() : [];
        const currentDevice = cfg.device_id || devices[0] || "";

        this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .editor-root {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 8px 4px 4px;
        }

        .row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .row label {
          font-size: 0.9rem;
          color: var(--secondary-text-color, #666);
        }

        select,
        input[type="checkbox"] {
          font: inherit;
        }

        .checkbox-row {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
      </style>

      <div class="editor-root">
        <div class="row">
          <label for="epz-device-select">Device</label>
          <select id="epz-device-select">
            <option value="">-- Select device --</option>
            ${devices
                .map(
                    (d) =>
                        `<option value="${d}" ${d === currentDevice ? "selected" : ""
                        }>${d}</option>`
                )
                .join("")}
          </select>
        </div>

        <div class="row checkbox-row">
          <label for="epz-debug-toggle">Debug mode</label>
          <input id="epz-debug-toggle" type="checkbox" ${cfg.debug ? "checked" : ""
            } />
        </div>
      </div>
    `;

        const deviceSelect = this.shadowRoot.getElementById("epz-device-select");
        const debugToggle = this.shadowRoot.getElementById("epz-debug-toggle");

        if (deviceSelect) {
            deviceSelect.addEventListener("change", () => this._valueChanged());
        }
        if (debugToggle) {
            debugToggle.addEventListener("change", () => this._valueChanged());
        }
    }

    _valueChanged() {
        if (!this.shadowRoot) return;

        const deviceSelect = this.shadowRoot.getElementById("epz-device-select");
        const debugToggle = this.shadowRoot.getElementById("epz-debug-toggle");

        const newConfig = {
            ...this._config,
            device_id: deviceSelect ? deviceSelect.value : "",
            debug: !!(debugToggle && debugToggle.checked),
        };

        this._config = newConfig;

        this.dispatchEvent(
            new CustomEvent("config-changed", {
                detail: { config: newConfig },
                bubbles: true,
                composed: true,
            })
        );
    }
}

customElements.define("ep-zone-configurator-editor", EPZoneConfiguratorEditor);
