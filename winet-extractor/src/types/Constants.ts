const NumericUnits = [
  'A',
  '%',
  'kW',
  'kWh',
  '℃',
  'V',
  'kvar',
  'var',
  'Hz',
  'kVA',
  'kΩ',
];

enum QueryStages {
  REAL,
  DIRECT,
  REAL_BATTERY,
}

type DeviceTypeStagesType = {
  [key: number]: QueryStages[];
};

const DeviceTypeStages: DeviceTypeStagesType = [];
DeviceTypeStages[0] = [QueryStages.REAL, QueryStages.DIRECT];
DeviceTypeStages[8] = [QueryStages.REAL];
DeviceTypeStages[11] = [QueryStages.REAL];
DeviceTypeStages[13] = [QueryStages.REAL];
DeviceTypeStages[14] = [QueryStages.REAL];
DeviceTypeStages[15] = [QueryStages.REAL];
DeviceTypeStages[18] = [QueryStages.REAL];
DeviceTypeStages[20] = [QueryStages.REAL];
DeviceTypeStages[21] = [QueryStages.REAL, QueryStages.DIRECT];
DeviceTypeStages[23] = [QueryStages.REAL];
DeviceTypeStages[24] = [QueryStages.REAL];
DeviceTypeStages[25] = [QueryStages.REAL];
DeviceTypeStages[34] = [QueryStages.REAL];
DeviceTypeStages[35] = [
  QueryStages.REAL,
  QueryStages.REAL_BATTERY,
  QueryStages.DIRECT,
];
DeviceTypeStages[36] = [QueryStages.REAL];
DeviceTypeStages[37] = [QueryStages.REAL];
DeviceTypeStages[44] = [QueryStages.REAL];
DeviceTypeStages[46] = [QueryStages.REAL];
DeviceTypeStages[47] = [QueryStages.REAL];
DeviceTypeStages[48] = [QueryStages.REAL];

export {NumericUnits, DeviceTypeStages, QueryStages};
