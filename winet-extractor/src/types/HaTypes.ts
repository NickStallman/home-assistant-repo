export const StateClasses: Record<string, string> = {
  W: 'measurement',
  kW: 'measurement',
  V: 'measurement',
  A: 'measurement',
  '°C': 'measurement',
  var: 'measurement',
  VA: 'measurement',
  Hz: 'measurement',
  '%': 'measurement',
  kΩ: 'measurement',
  kWh: 'total_increasing',
  Wh: 'total_increasing',
  h: 'total_increasing',
};

// Keyed by the normalised unit (see normaliseUnit)
export const DeviceClasses: Record<string, string> = {
  W: 'power',
  kW: 'power',
  V: 'voltage',
  A: 'current',
  kWh: 'energy',
  Wh: 'energy',
  '°C': 'temperature',
  var: 'reactive_power',
  VA: 'apparent_power',
  Hz: 'frequency',
  h: 'duration',
};

// Home Assistant friendly units, with a multiplier for the value
export function normaliseUnit(unit: string): {
  unit: string;
  multiplier: number;
} {
  switch (unit) {
    case 'kWp':
      return {unit: 'kW', multiplier: 1};
    case '℃':
      return {unit: '°C', multiplier: 1};
    case 'kvar':
      return {unit: 'var', multiplier: 1000};
    case 'kVA':
      return {unit: 'VA', multiplier: 1000};
    default:
      return {unit, multiplier: 1};
  }
}

export interface DeviceInfo {
  name: string;
  identifiers: string[];
  model?: string;
  manufacturer?: string;
  serial_number?: string;
}

export interface ConfigPayload {
  name: string;
  state_topic: string;
  unique_id: string;
  object_id?: string;
  value_template: string;
  device: DeviceInfo;
  availability?: {topic: string}[];
  availability_mode?: string;
  encoding?: string;
  unit_of_measurement?: string;
  state_class?: string;
  device_class?: string;
  suggested_display_precision?: number;
}
