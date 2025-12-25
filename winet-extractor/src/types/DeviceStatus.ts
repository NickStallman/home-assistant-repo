export type DeviceStatus = {
  name: string;
  slug: string;
  value: string | number | undefined;
  unit: string;
  dirty: boolean;
};

export type TextStatus = DeviceStatus & {
  unit: '';
  value: string | undefined;
};

export type NumericStatus = DeviceStatus & {
  unit: string;
  value: number;
};

export type DeviceStatusMap = {
  [key: string]: DeviceStatus;
};

export function isTextStatus(status: DeviceStatus): status is TextStatus {
  return status.unit === '';
};

export function isNumericStatus(status: DeviceStatus): status is NumericStatus {
  return status.unit !== '' && typeof status.value === 'number';
};
