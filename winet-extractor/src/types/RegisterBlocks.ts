import {RegisterBlock, RegisterField} from '../registers';

// Slugs here become Home Assistant entity ids, don't rename them.

// Sungrow SBR battery stacks report up to 8 modules
const SBR_MAX_MODULES = 8;
const SBR_UNUSED = [0, 0xffff];

const cellVoltage = (
  offset: number,
  slug: string,
  name: string
): RegisterField => ({
  offset,
  slug,
  name,
  unit: 'V',
  scale: 0.0001,
  precision: 4,
  absent: SBR_UNUSED,
});

const moduleTemperature = (
  offset: number,
  slug: string,
  name: string
): RegisterField => ({
  offset,
  slug,
  name,
  unit: '°C',
  format: 's16',
  scale: 0.1,
  precision: 1,
  absent: [0xffff],
});

const position = (
  offset: number,
  format: 'high_byte' | 'low_byte',
  slug: string,
  name: string
): RegisterField => ({
  offset,
  slug,
  name,
  unit: '',
  format,
  // Shown as "6" rather than "6.0"
  precision: 0,
  absent: [0, 0xff],
});

const sbrModuleFields: RegisterField[] = [];
for (let module = 1; module <= SBR_MAX_MODULES; module++) {
  sbrModuleFields.push(
    cellVoltage(
      7 + module,
      `module_${module}_cell_voltage_max`,
      `Module ${module} cell voltage max`
    ),
    cellVoltage(
      15 + module,
      `module_${module}_cell_voltage_min`,
      `Module ${module} cell voltage min`
    )
  );
}

// Registers 10757-10780 of an SBR battery stack
const SbrCells: RegisterBlock = {
  id: 'sbr_cells',
  devTypes: [44],
  type: 'input',
  addr: 10757,
  count: 24,
  interval: 300000,
  fields: [
    cellVoltage(0, 'cell_voltage_max', 'Cell voltage max'),
    position(
      1,
      'high_byte',
      'cell_voltage_max_module',
      'Cell voltage max module'
    ),
    position(1, 'low_byte', 'cell_voltage_max_cell', 'Cell voltage max cell'),
    cellVoltage(2, 'cell_voltage_min', 'Cell voltage min'),
    position(
      3,
      'high_byte',
      'cell_voltage_min_module',
      'Cell voltage min module'
    ),
    position(3, 'low_byte', 'cell_voltage_min_cell', 'Cell voltage min cell'),
    moduleTemperature(4, 'module_temperature_max', 'Module temperature max'),
    position(
      5,
      'high_byte',
      'module_temperature_max_module',
      'Module temperature max module'
    ),
    moduleTemperature(6, 'module_temperature_min', 'Module temperature min'),
    position(
      7,
      'high_byte',
      'module_temperature_min_module',
      'Module temperature min module'
    ),
    ...sbrModuleFields,
  ],
  derive: values => {
    const max = values.get('cell_voltage_max');
    const min = values.get('cell_voltage_min');
    if (max === undefined || min === undefined) return [];
    return [
      {
        name: 'Cell voltage spread',
        slug: 'cell_voltage_spread',
        value: max - min,
        unit: 'V',
        precision: 4,
      },
    ];
  },
};

export const RegisterBlocks: RegisterBlock[] = [SbrCells];
