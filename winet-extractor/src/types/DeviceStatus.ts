export type DeviceStatus = {
  name: string;
  slug: string;
  value: string | number | undefined;
  unit: string;
  dirty: boolean;
};

export type DeviceStatusMap = {
  [key: string]: DeviceStatus;
};
