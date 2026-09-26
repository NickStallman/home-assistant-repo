export type DeviceStatus = {
  name: string;
  slug: string;
  value: string | number | undefined;
  unit: string;
  // Numeric sensors are published with a float template and a unit
  numeric: boolean;
  // Value needs to be published to MQTT
  dirty: boolean;
  // Last time a reading was received from the WiNet (ms)
  seenAt: number;
  // Last time the value was marked dirty (ms)
  changedAt: number;
};

export type TextStatus = DeviceStatus & {
  numeric: false;
  value: string | undefined;
};

export type NumericStatus = DeviceStatus & {
  numeric: true;
  value: number;
};

export type DeviceStatusMap = {
  [key: string]: DeviceStatus;
};

export function isTextStatus(status: DeviceStatus): status is TextStatus {
  return !status.numeric;
}

export function isNumericStatus(status: DeviceStatus): status is NumericStatus {
  return status.numeric && typeof status.value === 'number';
}
