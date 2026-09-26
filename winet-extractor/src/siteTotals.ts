import {DeviceStatus, DeviceStatusMap} from './types/DeviceStatus';
import {DeviceInfo} from './types/HaTypes';

type SiteSensor = {
  slug: string;
  name: string;
  unit: string;
  // First matching sensor on each inverter is used
  sources: string[];
  // Lifetime counters never go backwards, so the last known value of an
  // offline inverter is still valid. Live values must be fresh.
  useLastKnown: boolean;
};

const SiteSensors: SiteSensor[] = [
  {
    slug: 'pv_power',
    name: 'PV Power',
    unit: 'W',
    sources: ['mppt_total_power'],
    useLastKnown: false,
  },
  {
    slug: 'dc_power',
    name: 'Total DC Power',
    unit: 'kW',
    sources: ['total_dc_power'],
    useLastKnown: false,
  },
  {
    slug: 'active_power',
    name: 'Total Active Power',
    unit: 'kW',
    sources: ['total_active_power'],
    useLastKnown: false,
  },
  {
    slug: 'daily_pv_yield',
    name: 'Daily PV Yield',
    unit: 'kWh',
    sources: ['daily_pv_yield', 'daily_yield'],
    useLastKnown: false,
  },
  {
    slug: 'total_pv_yield',
    name: 'Total PV Yield',
    unit: 'kWh',
    sources: ['total_pv_yield', 'total_yield'],
    useLastKnown: true,
  },
];

export const SITE_DEVICE_SLUG = 'winet_site';

export const SiteDevice: DeviceInfo = {
  name: 'WiNet Site',
  identifiers: [SITE_DEVICE_SLUG],
  model: 'Site totals',
  manufacturer: 'WiNet Extractor',
};

// Slugs whose sum can't be tracked by a total_increasing sensor, as each
// inverter resets at a slightly different time around midnight
export const SiteSlugsWithoutStateClass = ['daily_pv_yield'];

export class SiteTotals {
  private staleMs: number;
  // site slug -> inverter slug -> last known value
  private lastKnown = new Map<string, Map<string, number>>();
  private statuses: DeviceStatusMap = {};

  constructor(staleMs: number) {
    this.staleMs = staleMs;
  }

  // inverters: device slug -> that inverter's current status map
  public update(inverters: Map<string, DeviceStatusMap>): DeviceStatus[] {
    const now = Date.now();
    const changed: DeviceStatus[] = [];

    for (const sensor of SiteSensors) {
      const known = this.lastKnown.get(sensor.slug) ?? new Map();
      this.lastKnown.set(sensor.slug, known);

      let total = 0;
      let complete = true;
      let contributors = 0;

      for (const [inverterSlug, statusMap] of inverters) {
        const status = sensor.sources
          .map(s => statusMap[s])
          .find(s => s !== undefined);

        if (status === undefined) {
          // Inverter doesn't report this sensor at all
          continue;
        }
        contributors++;

        const fresh =
          typeof status.value === 'number' &&
          now - status.seenAt <= this.staleMs;
        if (fresh) {
          known.set(inverterSlug, status.value as number);
          total += status.value as number;
        } else if (sensor.useLastKnown && known.has(inverterSlug)) {
          total += known.get(inverterSlug)!;
        } else {
          complete = false;
        }
      }

      if (!complete || contributors < 2) {
        continue;
      }

      const value = Math.round(total * 1000) / 1000;
      const old = this.statuses[sensor.slug];
      if (
        old === undefined ||
        old.value !== value ||
        now - old.changedAt > 300000
      ) {
        this.statuses[sensor.slug] = {
          name: sensor.name,
          slug: sensor.slug,
          value,
          unit: sensor.unit,
          numeric: true,
          dirty: true,
          seenAt: now,
          changedAt: now,
        };
        changed.push(this.statuses[sensor.slug]);
      }
    }

    return changed;
  }
}
