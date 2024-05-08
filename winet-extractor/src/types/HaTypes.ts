export interface SensorData {
  name: string;
  value: number | string | undefined;
  unit_of_measurement: string;
}

export const StateClasses: Record<string, string> = {
  W: 'measurement',
  V: 'measurement',
  A: 'measurement',
  '℃': 'measurement',
};
export const DeviceClasses: Record<string, string | undefined> = {
  W: 'power',
  V: 'voltage',
  A: 'current',
  kW: 'power',
  kWh: 'energy',
  '℃': 'temperature',
  kvar: 'reactive_power',
  var: 'reactive_power',
  Hz: 'frequency',
  '%': 'battery',
  kΩ: undefined,
};

export const TextSensors: string[] = [
  'battery_operation_status',
  'running_status',
];

export interface ConfigPayload {
  name: string;
  state_topic: string;
  unique_id: string;
  value_template: string;
  device: {
    name: string;
    identifiers: string[];
    model: string;
  };
  encoding?: string;
  unit_of_measurement?: string;
  state_class?: string;
  device_class?: string;
}
