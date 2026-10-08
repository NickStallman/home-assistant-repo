import * as http from 'http';
import * as https from 'https';
import {z} from 'zod';
import {Device} from './types/MessageTypes';

// Raw register reads through the WiNet's "General parameters" HTTP endpoint.
// It exposes registers of attached devices (e.g. battery cell voltages) that
// the websocket services don't return, and needs the websocket session token.

export type RegisterFormat =
  | 'u16'
  | 's16'
  // Two registers, low word first
  | 'u32le'
  | 'high_byte'
  | 'low_byte';

export type RegisterField = {
  // Register offset within the block
  offset: number;
  slug: string;
  name: string;
  unit: string;
  format?: RegisterFormat;
  // Raw value is multiplied by this
  scale?: number;
  // Decimals to round to, also the display precision in Home Assistant
  precision?: number;
  // Raw values that mean the reading doesn't exist (e.g. an unused module)
  absent?: number[];
};

export type Reading = {
  name: string;
  slug: string;
  value: number;
  unit: string;
  precision?: number;
};

export type RegisterBlock = {
  // Used in logs
  id: string;
  // WiNet dev_type values the block applies to
  devTypes: number[];
  type: 'input' | 'holding';
  // Register address as documented (1-based)
  addr: number;
  count: number;
  // Milliseconds between reads
  interval: number;
  fields: RegisterField[];
  // Sensors computed from the decoded fields, keyed by slug
  derive?: (values: Map<string, number>) => Reading[];
};

export type RegisterConnection = {
  host: string;
  ssl: boolean;
  lang: string;
  token: string;
};

// The WiNet reads at most this many registers per request
export const MAX_REGISTER_COUNT = 120;

const ParamSchema = z.object({
  result_code: z.number(),
  result_msg: z.string().optional(),
  result_data: z.object({param_value: z.string()}).optional(),
});

// "0F B2 00 0B " -> [0x0FB2, 0x000B]
export function parseParamValue(value: string): number[] | undefined {
  const bytes = value.trim().split(/\s+/);
  if (bytes.length % 2 !== 0 || bytes.some(b => !/^[0-9a-fA-F]{2}$/.test(b))) {
    return undefined;
  }
  const registers: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    registers.push(parseInt(bytes[i] + bytes[i + 1], 16));
  }
  return registers;
}

export function readRegisters(
  conn: RegisterConnection,
  device: Device,
  block: Pick<RegisterBlock, 'addr' | 'count' | 'type'>,
  timeoutMs = 10000
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string | number> = {
      lang: conn.lang,
      token: conn.token,
      dev_id: device.dev_id,
      dev_type: device.dev_type,
      dev_code: device.dev_code,
      type: '3',
      param_addr: block.addr,
      param_num: block.count,
      param_type: block.type === 'input' ? '0' : '1',
      time123456: Date.now(),
    };
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const url =
      `${conn.ssl ? 'https' : 'http'}://${conn.host}` +
      `/device/getParam?${query}`;
    // Ignore self-signed certificate error
    const options = conn.ssl ? {rejectUnauthorized: false} : {};

    const request = (conn.ssl ? https : http)
      .get(url, options, res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('error', reject);
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch (err) {
            reject(new Error(`unparseable response (HTTP ${res.statusCode})`));
            return;
          }
          const result = ParamSchema.safeParse(json);
          if (!result.success) {
            reject(new Error('unexpected response'));
            return;
          }
          const {result_code, result_msg, result_data} = result.data;
          if (result_code !== 1 || result_data === undefined) {
            reject(new Error(`WiNet returned ${result_msg ?? result_code}`));
            return;
          }
          const registers = parseParamValue(result_data.param_value);
          if (registers === undefined || registers.length !== block.count) {
            reject(
              new Error(
                `expected ${block.count} registers, got ` +
                  `"${result_data.param_value.trim()}"`
              )
            );
            return;
          }
          resolve(registers);
        });
      })
      .on('error', reject);

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('request timed out'));
    });
  });
}

// Unsigned, so that `absent` can be matched before the sign is applied
function rawValue(
  registers: number[],
  field: RegisterField
): number | undefined {
  const raw = registers[field.offset];
  if (raw === undefined) return undefined;

  switch (field.format ?? 'u16') {
    case 'u16':
    case 's16':
      return raw;
    case 'u32le': {
      const high = registers[field.offset + 1];
      return high === undefined ? undefined : high * 0x10000 + raw;
    }
    case 'high_byte':
      return raw >> 8;
    case 'low_byte':
      return raw & 0xff;
  }
}

function round(value: number, precision: number | undefined): number {
  if (precision === undefined) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function decodeBlock(
  block: RegisterBlock,
  registers: number[]
): Reading[] {
  const readings: Reading[] = [];
  const values = new Map<string, number>();

  for (const field of block.fields) {
    const raw = rawValue(registers, field);
    if (raw === undefined || field.absent?.includes(raw)) continue;

    const signed = field.format === 's16' && raw > 0x7fff ? raw - 0x10000 : raw;
    const value = round(signed * (field.scale ?? 1), field.precision);
    values.set(field.slug, value);
    readings.push({
      name: field.name,
      slug: field.slug,
      value,
      unit: field.unit,
      precision: field.precision,
    });
  }

  for (const reading of block.derive?.(values) ?? []) {
    readings.push({
      ...reading,
      value: round(reading.value, reading.precision),
    });
  }

  return readings;
}
