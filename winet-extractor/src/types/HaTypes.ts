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

export const TotalEnergySensors: string[] = [
  'total_battery_discharge_bms',
  'total_battery_charging_energy',
  'daily_battery_charging_energy',
  'daily_battery_charging_energy_from_pv',
  'daily_battery_discharging_energy',
  'daily_feed_in_energy',
  'daily_feed_in_energy_pv',
  'total_battery_charging_energy',
  'total_battery_charging_energy_from_pv',
  'total_battery_discharging_energy',
  'total_feed_in_energy',
  'total_feed_in_energy_pv',
  'total_load_energy_consumption_from_pv',
  'total_purchased_energy',
  'total_pv_yield',
];

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
