/**
 * Generator HMI Card - ISA-101 High Performance Design
 * Based on ISA-101 Human Machine Interface standards
 *
 * @version 2.2.0
 * @author Claude Code
 */

const CARD_VERSION = '2.2.0';

console.info(
  `%c GENERATOR-HMI-CARD %c v${CARD_VERSION} %c ISA-101 `,
  'color: #333; font-weight: bold; background: #d0d0d0',
  'color: #d0d0d0; font-weight: bold; background: #333',
  'color: #fff; font-weight: bold; background: #0066cc'
);

class GeneratorHMICard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._initialized = false;
    this._entityStates = {};
  }

  set hass(hass) {
    this._hass = hass;
    if (this._initialized) {
      this._updateValues();
    } else {
      this._buildCard();
      this._initialized = true;
    }
  }

  setConfig(config) {
    // Build entity prefixes from device_name if provided
    let entityPrefix = 'sensor.generator_';
    let buttonPrefix = 'button.generator_';
    
    if (config.device_name) {
      const normalizedName = config.device_name.toLowerCase().replace(/\s+/g, '_');
      entityPrefix = `sensor.${normalizedName}_`;
      buttonPrefix = `button.${normalizedName}_`;
    }
    
    this._config = {
      title: 'GENERATOR',
      entity_prefix: entityPrefix,
      button_prefix: buttonPrefix,
      show_controls: true,
      show_maintenance: true,
      // Setpoints for analog indicators
      voltage_nominal: 240,
      voltage_min: 220,
      voltage_max: 260,
      frequency_nominal: 60,
      frequency_min: 59,
      frequency_max: 61,
      battery_nominal: 13.2,
      battery_min: 11.5,
      battery_max: 14.5,
      ...config,
    };
    
    // Re-apply device_name derived prefixes if not explicitly overridden
    if (config.device_name && !config.entity_prefix) {
      this._config.entity_prefix = entityPrefix;
    }
    if (config.device_name && !config.button_prefix) {
      this._config.button_prefix = buttonPrefix;
    }
    
    this._initialized = false;
  }

  getCardSize() { return 6; }

  static getStubConfig() {
    return {
      title: 'GENERATOR',
      device_name: 'generator',
    };
  }

  _getState(entitySuffix) {
    const entityId = this._config.entity_prefix + entitySuffix;
    return this._hass?.states[entityId]?.state || '--';
  }

  _getButtonEntity(buttonSuffix) {
    return this._config.button_prefix + buttonSuffix;
  }

  _handleButtonClick(buttonEntity, confirmText) {
    if (confirm(confirmText)) {
      this._hass.callService('button', 'press', { entity_id: buttonEntity });
    }
  }

  // ISA-101: Determine status level (0=normal, 1=abnormal, 2=warning, 3=alarm)
  _getEngineStatus() {
    const state = this._getState('engine_state').toLowerCase();
    if (state.includes('alarm') || state.includes('fault')) return { level: 3, text: 'ALARM' };
    if (state.includes('running')) return { level: 1, text: 'RUNNING' };
    if (state.includes('ready') || state.includes('off') || state.includes('standby')) return { level: 0, text: 'STANDBY' };
    return { level: 0, text: state.toUpperCase() };
  }

  _getOutageStatus() {
    const state = this._getState('outage_status').toLowerCase();
    if (state.includes('outage') && !state.includes('no')) return { level: 3, text: 'OUTAGE' };
    return { level: 0, text: 'NORMAL' };
  }

  _getSwitchStatus() {
    const state = this._getState('switch_state').toLowerCase();
    if (state.includes('generator')) return { level: 1, text: 'GENERATOR' };
    return { level: 0, text: 'UTILITY' };
  }

  // Calculate bar percentage and status for analog values
  _getAnalogStatus(value, min, nominal, max) {
    const num = parseFloat(value);
    if (isNaN(num)) return { percent: 0, level: 0 };
    
    const range = max - min;
    const percent = Math.max(0, Math.min(100, ((num - min) / range) * 100));
    
    // Determine status based on deviation from nominal
    const lowWarn = min + (nominal - min) * 0.3;
    const highWarn = nominal + (max - nominal) * 0.7;
    
    let level = 0; // Normal
    if (num < min || num > max) level = 3; // Alarm
    else if (num < lowWarn || num > highWarn) level = 2; // Warning
    
    return { percent, level, value: num };
  }

  _getMaintenanceStatus(value) {
    if (!value || value === '--' || value === 'unavailable' || value === 'unknown') {
      return { level: 0, text: '--' };
    }
    const lower = value.toLowerCase();
    
    // Check for explicit OK
    if (lower === 'ok' || lower.includes('ok')) return { level: 0, text: 'OK' };
    
    // Check for overdue/due now
    if (lower.includes('overdue') || lower.includes('due now')) {
      return { level: 3, text: 'OVERDUE' };
    }
    
    // Parse Genmon format: "142 hrs or 05/27/2027"
    const hrsMatch = value.match(/^(\d+)\s*hrs?\s/i);
    if (hrsMatch) {
      const hours = parseInt(hrsMatch[1], 10);
      if (hours <= 0) return { level: 3, text: 'DUE' };
      if (hours <= 20) return { level: 2, text: hours + 'h' };
      if (hours <= 50) return { level: 1, text: hours + 'h' };
      return { level: 0, text: 'OK' };
    }
    
    // Generic due check
    if (lower.includes('due')) return { level: 2, text: 'DUE' };
    
    // Unknown format - show abbreviated value
    return { level: 1, text: value.substring(0, 8) };
  }

  _updateValues() {
    if (!this._hass || !this.shadowRoot) return;

    // Status indicators
    const engineStatus = this._getEngineStatus();
    const outageStatus = this._getOutageStatus();
    const switchStatus = this._getSwitchStatus();

    this._updateStatusIndicator('engine', engineStatus);
    this._updateStatusIndicator('outage', outageStatus);
    this._updateStatusIndicator('switch', switchStatus);

    // Analog values
    const outputV = this._getState('output_voltage');
    const utilityV = this._getState('utility_voltage');
    const freq = this._getState('frequency');
    const battery = this._getState('battery_voltage');

    this._updateAnalogBar('output-voltage', outputV, 
      this._config.voltage_min, this._config.voltage_nominal, this._config.voltage_max, 'V');
    this._updateAnalogBar('utility-voltage', utilityV,
      this._config.voltage_min, this._config.voltage_nominal, this._config.voltage_max, 'V');
    this._updateAnalogBar('frequency', freq,
      this._config.frequency_min, this._config.frequency_nominal, this._config.frequency_max, 'Hz');
    this._updateAnalogBar('battery', battery,
      this._config.battery_min, this._config.battery_nominal, this._config.battery_max, 'V');

    // Simple values
    this._updateSimpleValue('rpm', this._getState('rpm'));
    this._updateSimpleValue('run-hours', this._getState('maintenance_service_total_run_hours'));

    // Maintenance indicators
    if (this._config.show_maintenance) {
      this._updateMaintenanceIndicator('oil', this._getMaintenanceStatus(this._getState('oil_service')));
      this._updateMaintenanceIndicator('air-filter', this._getMaintenanceStatus(this._getState('air_filter_service')));
      this._updateMaintenanceIndicator('spark-plug', this._getMaintenanceStatus(this._getState('spark_plug_service')));
      this._updateMaintenanceIndicator('battery-svc', this._getMaintenanceStatus(this._getState('battery_service')));
    }

    // Update button states based on running status
    this._updateButtonStates();

    // Footer
    const footer = this.shadowRoot.getElementById('footer-info');
    if (footer) {
      const exercise = this._getState('exercise_time');
      footer.textContent = `Next Exercise: ${exercise}`;
    }
  }

  _updateStatusIndicator(id, status) {
    const el = this.shadowRoot.getElementById(`${id}-status`);
    const indicator = this.shadowRoot.getElementById(`${id}-indicator`);
    if (el) el.textContent = status.text;
    if (indicator) {
      indicator.className = 'status-indicator level-' + status.level;
    }
  }

  _updateAnalogBar(id, value, min, nominal, max, unit) {
    const status = this._getAnalogStatus(value, min, nominal, max);
    const bar = this.shadowRoot.getElementById(`${id}-bar`);
    const valueEl = this.shadowRoot.getElementById(`${id}-value`);
    const container = this.shadowRoot.getElementById(`${id}-container`);
    
    if (bar) {
      bar.style.width = status.percent + '%';
      bar.className = 'analog-bar-fill level-' + status.level;
    }
    if (valueEl) {
      const displayValue = (value === '--' || value === 'unavailable' || value === 'unknown') ? '--' : `${value} ${unit}`; valueEl.textContent = displayValue;
      valueEl.className = 'analog-value level-' + status.level;
    }
    if (container) {
      container.className = 'analog-container level-' + status.level;
    }
  }

  _updateSimpleValue(id, value) {
    const el = this.shadowRoot.getElementById(id);
    if (el) el.textContent = value;
  }

  _updateMaintenanceIndicator(id, status) {
    const el = this.shadowRoot.getElementById(`${id}-status`);
    const indicator = this.shadowRoot.getElementById(`${id}-indicator`);
    if (el) el.textContent = status.text;
    if (indicator) indicator.className = 'maint-indicator level-' + status.level;
  }

  _updateButtonStates() {
    if (!this._config.show_controls) return;
    
    const state = this._getState('engine_state').toLowerCase();
    const isNotRunning = state.includes('off') || state.includes('ready') || state.includes('standby');
    
    const startBtn = this.shadowRoot.querySelector('.ctrl-btn.start');
    const stopBtn = this.shadowRoot.querySelector('.ctrl-btn.stop');
    const transferBtn = this.shadowRoot.querySelector('.ctrl-btn.transfer');
    const exerciseBtn = this.shadowRoot.querySelector('.ctrl-btn.exercise');
    
    if (startBtn) startBtn.classList.toggle('disabled', !isNotRunning);
    if (stopBtn) stopBtn.classList.toggle('disabled', isNotRunning);
    if (transferBtn) transferBtn.classList.toggle('disabled', !isNotRunning);
    if (exerciseBtn) exerciseBtn.classList.toggle('disabled', !isNotRunning);
  }

  _buildCard() {
    if (!this._hass) return;

    const styles = `
      <style>
        :host {
          /* ISA-101 Color Palette */
          --isa-bg: #d4d4d4;
          --isa-bg-panel: #e8e8e8;
          --isa-bg-dark: #b8b8b8;
          --isa-border: #999999;
          --isa-text: #1a1a1a;
          --isa-text-dim: #666666;
          
          /* Status Colors - ISA-101 compliant */
          --isa-normal: #808080;      /* Gray - normal operation */
          --isa-abnormal: #0088cc;    /* Blue - abnormal but not alarming */
          --isa-warning: #cc8800;     /* Amber - warning, attention needed */
          --isa-alarm: #cc0000;       /* Red - alarm, action required */
          
          font-family: 'Segoe UI', 'Arial', sans-serif;
          font-size: 13px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        .hmi-container {
          background: var(--isa-bg);
          border: 1px solid var(--isa-border);
          border-radius: 4px;
          padding: 8px;
        }
        
        /* Header */
        .hmi-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--isa-bg-dark);
          border: 1px solid var(--isa-border);
          margin-bottom: 8px;
        }
        .hmi-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--isa-text);
          letter-spacing: 1px;
        }
        .hmi-timestamp {
          font-size: 11px;
          color: var(--isa-text-dim);
        }
        
        /* Status Row */
        .status-row {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .status-block {
          flex: 1;
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px;
          text-align: center;
          box-sizing: border-box;
        }
        .status-label {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .status-indicator {
          display: inline-block;
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 2px;
          min-width: 80px;
        }
        
        /* ISA-101 Status Levels */
        .level-0 { background: var(--isa-normal); color: #fff; }
        .level-1 { background: var(--isa-abnormal); color: #fff; }
        .level-2 { background: var(--isa-warning); color: #fff; }
        .level-3 { background: var(--isa-alarm); color: #fff; animation: alarm-flash 1s infinite; }
        
        @keyframes alarm-flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        /* Analog Indicators */
        .analog-section {
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 10px;
          margin-bottom: 8px;
        }
        .analog-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .analog-item {
          display: flex;
          flex-direction: column;
        }
        .analog-label {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .analog-container {
          position: relative;
          height: 24px;
          background: #fff;
          border: 1px solid var(--isa-border);
          overflow: hidden;
        }
        .analog-bar-fill {
          height: 100%;
          transition: width 0.3s ease;
        }
        .analog-bar-fill.level-0 { background: var(--isa-normal); }
        .analog-bar-fill.level-1 { background: var(--isa-abnormal); }
        .analog-bar-fill.level-2 { background: var(--isa-warning); }
        .analog-bar-fill.level-3 { background: var(--isa-alarm); }
        
        .analog-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8);
        }
        .analog-scale {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: var(--isa-text-dim);
          margin-top: 1px;
        }
        
        /* Simple Values */
        .values-row {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        .value-block {
          flex: 1;
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px;
          text-align: center;
        }
        .value-label {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
        }
        .value-display {
          font-size: 18px;
          font-weight: 600;
          color: var(--isa-text);
        }
        .value-unit {
          font-size: 11px;
          color: var(--isa-text-dim);
        }
        
        /* Maintenance Section */
        .maint-section {
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px;
          margin-bottom: 8px;
        }
        .maint-title {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--isa-border);
          padding-bottom: 4px;
        }
        .maint-grid {
          display: flex;
          gap: 6px;
        }
        .maint-item {
          flex: 1;
          text-align: center;
        }
        .maint-label {
          font-size: 9px;
          color: var(--isa-text-dim);
          margin-bottom: 2px;
        }
        .maint-indicator {
          display: inline-block;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
          border-radius: 2px;
        }
        
        /* Control Buttons - ISA-101 style */
        .controls-section {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .ctrl-btn {
          flex: 1;
          padding: 10px 8px;
          border: 2px solid;
          background: var(--isa-bg-panel);
          cursor: pointer;
          text-align: center;
          transition: all 0.15s ease;
        }
        .ctrl-btn:hover {
          filter: brightness(0.95);
        }
        .ctrl-btn:active {
          transform: scale(0.98);
        }
        .ctrl-btn-icon {
          font-size: 20px;
          margin-bottom: 4px;
        }
        .ctrl-btn-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }
        
        .ctrl-btn.start {
          border-color: #228822;
          color: #228822;
        }
        .ctrl-btn.stop {
          border-color: #aa2222;
          color: #aa2222;
        }
        .ctrl-btn.transfer {
          border-color: #886600;
          color: #886600;
        }
        .ctrl-btn.exercise {
          border-color: #225588;
          color: #225588;
        }
        .ctrl-btn.disabled {
          opacity: 0.4;
          cursor: not-allowed;
          pointer-events: none;
        }
        
        /* Footer */
        .hmi-footer {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-align: center;
          padding-top: 4px;
          border-top: 1px solid var(--isa-border);
        }
      </style>
    `;

    const html = `
      <ha-card>
        <div class="hmi-container">
          <div class="hmi-header">
            <span class="hmi-title">${this._config.title}</span>
          </div>

          <!-- Primary Status -->
          <div class="status-row">
            <div class="status-block">
              <div class="status-label">Engine</div>
              <span class="status-indicator level-0" id="engine-indicator">
                <span id="engine-status">--</span>
              </span>
            </div>
            <div class="status-block">
              <div class="status-label">Utility</div>
              <span class="status-indicator level-0" id="outage-indicator">
                <span id="outage-status">--</span>
              </span>
            </div>
            <div class="status-block">
              <div class="status-label">Load Source</div>
              <span class="status-indicator level-0" id="switch-indicator">
                <span id="switch-status">--</span>
              </span>
            </div>
          </div>

          <!-- Analog Indicators -->
          <div class="analog-section">
            <div class="analog-grid">
              <div class="analog-item">
                <div class="analog-label">Output Voltage</div>
                <div class="analog-container" id="output-voltage-container">
                  <div class="analog-bar-fill level-0" id="output-voltage-bar" style="width: 0%"></div>
                  <span class="analog-value" id="output-voltage-value">--</span>
                </div>
                <div class="analog-scale">
                  <span>${this._config.voltage_min}</span>
                  <span>${this._config.voltage_nominal}</span>
                  <span>${this._config.voltage_max}</span>
                </div>
              </div>
              <div class="analog-item">
                <div class="analog-label">Utility Voltage</div>
                <div class="analog-container" id="utility-voltage-container">
                  <div class="analog-bar-fill level-0" id="utility-voltage-bar" style="width: 0%"></div>
                  <span class="analog-value" id="utility-voltage-value">--</span>
                </div>
                <div class="analog-scale">
                  <span>${this._config.voltage_min}</span>
                  <span>${this._config.voltage_nominal}</span>
                  <span>${this._config.voltage_max}</span>
                </div>
              </div>
              <div class="analog-item">
                <div class="analog-label">Frequency</div>
                <div class="analog-container" id="frequency-container">
                  <div class="analog-bar-fill level-0" id="frequency-bar" style="width: 0%"></div>
                  <span class="analog-value" id="frequency-value">--</span>
                </div>
                <div class="analog-scale">
                  <span>${this._config.frequency_min}</span>
                  <span>${this._config.frequency_nominal}</span>
                  <span>${this._config.frequency_max}</span>
                </div>
              </div>
              <div class="analog-item">
                <div class="analog-label">Battery</div>
                <div class="analog-container" id="battery-container">
                  <div class="analog-bar-fill level-0" id="battery-bar" style="width: 0%"></div>
                  <span class="analog-value" id="battery-value">--</span>
                </div>
                <div class="analog-scale">
                  <span>${this._config.battery_min}</span>
                  <span>${this._config.battery_nominal}</span>
                  <span>${this._config.battery_max}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Simple Values -->
          <div class="values-row">
            <div class="value-block">
              <div class="value-label">RPM</div>
              <div class="value-display"><span id="rpm">--</span></div>
            </div>
            <div class="value-block">
              <div class="value-label">Run Hours</div>
              <div class="value-display"><span id="run-hours">--</span></div>
            </div>
          </div>

          ${this._config.show_maintenance ? `
          <!-- Maintenance -->
          <div class="maint-section">
            <div class="maint-title">Maintenance Status</div>
            <div class="maint-grid">
              <div class="maint-item">
                <div class="maint-label">Oil</div>
                <span class="maint-indicator level-0" id="oil-indicator"><span id="oil-status">--</span></span>
              </div>
              <div class="maint-item">
                <div class="maint-label">Air Filter</div>
                <span class="maint-indicator level-0" id="air-filter-indicator"><span id="air-filter-status">--</span></span>
              </div>
              <div class="maint-item">
                <div class="maint-label">Spark Plug</div>
                <span class="maint-indicator level-0" id="spark-plug-indicator"><span id="spark-plug-status">--</span></span>
              </div>
              <div class="maint-item">
                <div class="maint-label">Battery</div>
                <span class="maint-indicator level-0" id="battery-svc-indicator"><span id="battery-svc-status">--</span></span>
              </div>
            </div>
          </div>
          ` : ''}

          ${this._config.show_controls ? `
          <!-- Controls -->
          <div class="controls-section">
            <div class="ctrl-btn start" data-action="start">
              <div class="ctrl-btn-icon"><ha-icon icon="mdi:play"></ha-icon></div>
              <div class="ctrl-btn-label">Start</div>
            </div>
            <div class="ctrl-btn stop" data-action="stop">
              <div class="ctrl-btn-icon"><ha-icon icon="mdi:stop"></ha-icon></div>
              <div class="ctrl-btn-label">Stop</div>
            </div>
            <div class="ctrl-btn transfer" data-action="start_transfer">
              <div class="ctrl-btn-icon"><ha-icon icon="mdi:swap-horizontal"></ha-icon></div>
              <div class="ctrl-btn-label">Transfer</div>
            </div>
            <div class="ctrl-btn exercise" data-action="start_exercise">
              <div class="ctrl-btn-icon"><ha-icon icon="mdi:rotate-right"></ha-icon></div>
              <div class="ctrl-btn-label">Exercise</div>
            </div>
          </div>
          ` : ''}

          <div class="hmi-footer">
            <span id="footer-info">--</span>
          </div>
        </div>
      </ha-card>
    `;

    this.shadowRoot.innerHTML = styles + html;

    // Add button handlers
    if (this._config.show_controls) {
      const confirmTexts = {
        start: 'Start the generator?',
        stop: 'Stop the generator?',
        start_transfer: 'Start and transfer load?',
        start_exercise: 'Run exercise cycle?'
      };
      this.shadowRoot.querySelectorAll('.ctrl-btn').forEach((btn) => {
        const action = btn.dataset.action;
        btn.addEventListener('click', () => {
          this._handleButtonClick(this._getButtonEntity(action), confirmTexts[action]);
        });
      });
    }

    this._updateValues();
  }
}

customElements.define('generator-hmi-card', GeneratorHMICard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'generator-hmi-card',
  name: 'Generator HMI Card',
  description: 'ISA-101 compliant high-performance HMI for Genmon',
  preview: true,
});
