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
  token: z.string().uuid(),
  uid: z.number().int(),
  tips_disable: z.number().int().optional(),
  ip: z.string().ip().optional(),
  forceModifyPasswd: z.number().int().optional(),
});

export const LoginSchema = z.object({
  service: z.string(),
  token: z.string().uuid(),
  uid: z.number().int(),
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
  data_unit: z.string(),
});

export const RealtimeSchema = z.object({
  service: z.union([z.literal('real'), z.literal('real_battery')]),
  list: z.array(DataSchema),
  count: z.number().int(),
});

export const DirectItemSchema = z.object({
  name: z.string(),
  voltage: z.string(),
  voltage_unit: z.string(),
  current: z.string(),
  current_unit: z.string(),
});

export const DirectSchema = z.object({
  service: z.literal('direct'),
  list: z.array(DirectItemSchema),
  count: z.number().int(),
});
