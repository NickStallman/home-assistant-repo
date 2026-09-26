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

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
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
  };
}

export function loadConfig(optionsPath = '/data/options.json'): Config {
  if (fs.existsSync(optionsPath)) {
    const options: RawOptions = JSON.parse(
      fs.readFileSync(optionsPath, 'utf8')
    );
    return buildConfig(options);
  }

  dotenv.config();
  const env = process.env;
  return buildConfig({
    winet_host: env.WINET_HOST,
    mqtt_url: env.MQTT_URL,
    mqtt_prefix: env.MQTT_PREFIX,
    winet_user: env.WINET_USER,
    winet_pass: env.WINET_PASS,
    poll_interval: env.POLL_INTERVAL,
    // On by default, ANALYTICS=false opts out
    analytics: parseBool(env.ANALYTICS, true),
    ssl: parseBool(env.SSL, false),
    site_totals: parseBool(env.SITE_TOTALS, true),
  });
}
