import {z} from 'zod';

export const MessageSchema = z.object({
  result_code: z.number(),
  result_msg: z.string().optional(),
  result_data: z
    .object({
      service: z.string(),
    })
    .passthrough(),
});

export const ConnectSchema = z.object({
  service: z.literal('connect'),
  token: z.string(),
  uid: z.number().int(),
  tips_disable: z.number().int().optional(),
  ip: z.string().optional(),
  virgin_flag: z.number().int().optional(),
  isFirstLogin: z.number().int().optional(),
  forceModifyPasswd: z.number().int().optional(),
});

export const LoginSchema = z.object({
  service: z.string(),
  token: z.string(),
  // Only the token is used; some firmware sends uid as a string
  uid: z.union([z.number(), z.string()]).optional(),
});

export const DeviceSchema = z.object({
  id: z.number().int(),
  dev_id: z.number().int(),
  dev_code: z.number().int(),
  dev_type: z.number().int(),
  dev_procotol: z.number().int(),
  inv_type: z.number().int(),
  optimizer_insert: z.number().int().optional(),
  install_type: z.number().int().optional(),
  dev_opt_total_fault: z.number().int().optional(),
  dev_opt_total_alarm: z.number().int().optional(),
  dev_sn: z.string(),
  dev_name: z.string(),
  dev_model: z.string(),
  port_name: z.string(),
  phys_addr: z.string(),
  logc_addr: z.string(),
  link_status: z.number().int(),
  init_status: z.number().int(),
  dev_special: z.string(),
  list: z.array(z.unknown()).optional(),
});

export const DeviceListSchema = z.object({
  service: z.literal('devicelist'),
  list: z.array(DeviceSchema),
  count: z.number().int(),
});

export const DataSchema = z.object({
  data_name: z.string(),
  data_value: z.string(),
  // Some devices (e.g. EV chargers) omit the unit on text values
  data_unit: z.string().optional().default(''),
});

export const RealtimeSchema = z.object({
  service: z.union([z.literal('real'), z.literal('real_battery')]),
  list: z.array(DataSchema),
  count: z.number().int().optional(),
});

// Some inverters (SG15RT, SG50RT, SG10RT, SH50RT) leave out a value or unit
// for strings they don't have; "--" is what the WiNet sends for no value
export const DirectItemSchema = z.object({
  name: z.string(),
  voltage: z.string().optional().default('--'),
  voltage_unit: z.string().optional().default(''),
  current: z.string().optional().default('--'),
  current_unit: z.string().optional().default(''),
});

export const DirectSchema = z.object({
  service: z.literal('direct'),
  list: z.array(DirectItemSchema),
  count: z.number().int().optional(),
});

export type Device = z.infer<typeof DeviceSchema>;
