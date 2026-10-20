import fs from 'fs';
const dotenv = require('dotenv');

export type WinetConfig = {
  host: string;
  user: string;
  pass: string;
  ssl: boolean;
};

export type Config = {
  mqttUrl: string;
  mqttPrefix: string;
  pollInterval: number;
  analytics: boolean;
  siteTotals: boolean;
  winets: WinetConfig[];
  tls: {
    certificateBase64?: string;
    serverName?: string;
  };
};

type AdditionalWinet = {
  host?: string;
  user?: string;
  pass?: string;
  ssl?: boolean;
};

type RawOptions = {
  winet_host?: string;
  mqtt_url?: string;
  mqtt_prefix?: string;
  winet_user?: string;
  winet_pass?: string;
  poll_interval?: string | number;
  analytics?: boolean;
  ssl?: boolean;
  site_totals?: boolean;
  additional_winets?: AdditionalWinet[];
  tls_ca_cert_base64?: string;
  tls_server_name?: string;
};

const DEFAULT_USER = 'admin';
const DEFAULT_PASS = 'pw8888';

// Accepts "host", "host1, host2" or "host1 host2"
export function splitHosts(hosts: string | undefined): string[] {
  return (hosts || '')
    .split(/[\s,;]+/)
    .map(h => h.trim())
    .filter(h => h.length > 0);
}

function parseBool(
  name: string,
  value: string | undefined
): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid ${name}: expected a boolean`);
}

function readExplicitEnvironment(env: NodeJS.ProcessEnv): RawOptions {
  const options: RawOptions = {
    winet_host: env.WINET_HOST,
    mqtt_url: env.MQTT_URL,
    mqtt_prefix: env.MQTT_PREFIX,
    winet_user: env.WINET_USER,
    winet_pass: env.WINET_PASS,
    poll_interval: env.POLL_INTERVAL,
    analytics: parseBool('ANALYTICS', env.ANALYTICS),
    ssl: parseBool('SSL', env.SSL),
    site_totals: parseBool('SITE_TOTALS', env.SITE_TOTALS),
    tls_ca_cert_base64: env.WINET_TLS_CA_CERT_BASE64,
    tls_server_name: env.WINET_TLS_SERVER_NAME,
  };
  // Omitted values must not erase JSON settings. Defaults belong to buildConfig.
  for (const key of Object.keys(options) as Array<keyof RawOptions>) {
    if (options[key] === undefined) delete options[key];
  }
  return options;
}

export function buildConfig(options: RawOptions): Config {
  const primaryUser = options.winet_user || DEFAULT_USER;
  const primaryPass = options.winet_pass || DEFAULT_PASS;
  const primarySsl = options.ssl ?? false;

  const winets: WinetConfig[] = [];
  const addWinet = (winet: WinetConfig) => {
    if (winets.some(w => w.host.toLowerCase() === winet.host.toLowerCase())) {
      return;
    }
    winets.push(winet);
  };

  for (const host of splitHosts(options.winet_host)) {
    addWinet({host, user: primaryUser, pass: primaryPass, ssl: primarySsl});
  }

  for (const extra of options.additional_winets ?? []) {
    for (const host of splitHosts(extra.host)) {
      addWinet({
        host,
        user: extra.user || primaryUser,
        pass: extra.pass || primaryPass,
        ssl: extra.ssl ?? primarySsl,
      });
    }
  }

  if (winets.length === 0) {
    throw new Error('No WiNet host provided (winet_host)');
  }

  if (!options.mqtt_url) {
    throw new Error('No MQTT URL provided (mqtt_url)');
  }

  const pollInterval = parseInt(`${options.poll_interval ?? ''}`) || 10;

  return {
    mqttUrl: options.mqtt_url,
    mqttPrefix: options.mqtt_prefix || 'homeassistant',
    pollInterval: Math.min(Math.max(pollInterval, 1), 3600),
    analytics: options.analytics ?? true,
    siteTotals: options.site_totals ?? true,
    winets,
    tls: {
      certificateBase64: options.tls_ca_cert_base64,
      serverName: options.tls_server_name,
    },
  };
}

export function loadConfig(optionsPath = '/data/options.json'): Config {
  // dotenv leaves explicitly supplied process environment variables unchanged.
  dotenv.config();
  const fileOptions: RawOptions = fs.existsSync(optionsPath)
    ? JSON.parse(fs.readFileSync(optionsPath, 'utf8'))
    : {};
  return buildConfig({
    ...fileOptions,
    ...readExplicitEnvironment(process.env),
  });
}
