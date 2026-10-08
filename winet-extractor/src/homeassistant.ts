import mqtt, {MqttClient} from 'mqtt';
import slugify from 'slugify';
import {DeviceStatus, isNumericStatus} from './types/DeviceStatus';
import {
  StateClasses,
  DeviceClasses,
  ConfigPayload,
  DeviceInfo,
  normaliseUnit,
} from './types/HaTypes';
import Winston from 'winston';

// "192.168.1.100" -> "192_168_1_100"
export function hostSlug(host: string): string {
  return slugify(host.replace(/[.:]/g, '_'), {
    lower: true,
    strict: true,
    replacement: '_',
  });
}

// Percentages that represent a battery charge level
const BatteryLevelSlug = /(^|_)(soc|battery_level)(_|$)/;

export class MqttPublisher {
  private logger: Winston.Logger;
  private client: MqttClient;
  private prefix: string;
  private connected = false;
  private statusTopic: string;
  // Retained discovery payloads, re-sent when the broker or HA restarts
  private configs = new Map<string, string>();
  // Last state payloads, re-sent after HA restarts
  private states = new Map<string, string>();
  private availability = new Map<string, string>();
  // State topics whose discovery config was just sent, HA needs a moment to
  // subscribe before the first state or it is lost
  private pendingStates = new Set<string>();

  constructor(
    logger: Winston.Logger,
    url: string,
    prefix: string,
    instanceId: string
  ) {
    this.logger = logger;
    this.prefix = prefix;
    this.statusTopic = `winet-extractor/${instanceId}/status`;

    this.client = mqtt.connect(url, {
      // Don't buffer state updates in memory while the broker is down
      queueQoSZero: false,
      will: {
        topic: this.statusTopic,
        payload: Buffer.from('offline'),
        retain: true,
        qos: 1,
      },
    });

    this.client.on('connect', () => {
      this.logger.info('Connected to MQTT broker');
      this.connected = true;
      this.publish(this.statusTopic, 'online', true);
      this.client.subscribe(`${this.prefix}/status`);
      this.republish(false);
    });

    this.client.on('close', () => {
      if (this.connected) {
        this.logger.warn('Disconnected from MQTT broker');
      }
      this.connected = false;
    });

    this.client.on('offline', () => {
      this.connected = false;
    });

    this.client.on('message', (topic, payload) => {
      if (
        topic === `${this.prefix}/status` &&
        payload.toString() === 'online'
      ) {
        this.logger.info('Home Assistant restarted, republishing discovery');
        // Give HA a moment to subscribe to the state topics
        setTimeout(() => this.republish(true), 5000);
      }
    });

    this.client.on('error', err => {
      this.logger.error(`MQTT error: ${err}`);
    });
  }

  // Mark everything unavailable straight away on a clean shutdown
  public shutdown(): Promise<void> {
    return new Promise(resolve => {
      if (!this.connected) {
        resolve();
        return;
      }
      this.client.publish(
        this.statusTopic,
        'offline',
        {retain: true, qos: 1},
        () => this.client.end(false, {}, () => resolve())
      );
    });
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private publish(topic: string, payload: string, retain: boolean) {
    if (!this.connected) return;

    this.client.publish(topic, payload, {retain, qos: retain ? 1 : 0}, err => {
      if (err) {
        this.logger.error(`Failed to publish to ${topic}: ${err}`);
      }
    });
  }

  private republish(includeStates: boolean) {
    for (const [topic, payload] of this.configs) {
      this.publish(topic, payload, true);
    }
    for (const [topic, payload] of this.availability) {
      this.publish(topic, payload, true);
    }
    if (includeStates) {
      for (const [topic, payload] of this.states) {
        this.publish(topic, payload, false);
      }
    }
  }

  public availabilityTopic(source: string): string {
    return `winet-extractor/${hostSlug(source)}/availability`;
  }

  public setAvailability(source: string, online: boolean) {
    const topic = this.availabilityTopic(source);
    const payload = online ? 'online' : 'offline';
    if (this.availability.get(topic) === payload) return;
    this.availability.set(topic, payload);
    this.publish(topic, payload, true);
  }

  private stateTopic(deviceSlug: string, slug: string): string {
    return `${this.prefix}/sensor/${deviceSlug}/${slug}/state`;
  }

  public publishState(deviceSlug: string, status: DeviceStatus): boolean {
    if (!this.connected || status.value === undefined) return false;

    let payload: string;
    if (isNumericStatus(status)) {
      const {unit, multiplier} = normaliseUnit(status.unit);
      const value =
        multiplier === 1
          ? status.value
          : Math.round(status.value * multiplier * 1000) / 1000;
      payload = JSON.stringify({value, unit_of_measurement: unit});
    } else if (!status.numeric) {
      payload = JSON.stringify({value: `${status.value}`});
    } else {
      return false;
    }

    const topic = this.stateTopic(deviceSlug, status.slug);
    this.states.set(topic, payload);
    if (!this.pendingStates.has(topic)) {
      this.publish(topic, payload, false);
    }
    return true;
  }

  // Older versions published a device level "sensor" that never had a state
  public removeLegacyDeviceConfig(deviceSlug: string) {
    this.publish(`${this.prefix}/sensor/${deviceSlug}/config`, '', true);
  }

  public publishConfig(
    deviceSlug: string,
    status: DeviceStatus,
    device: DeviceInfo,
    availabilitySource?: string,
    omitStateClass = false
  ): boolean {
    if (!this.connected) {
      return false;
    }

    const slug = status.slug;
    const configTopic = `${this.prefix}/sensor/${deviceSlug}/${slug}/config`;
    const configPayload: ConfigPayload = {
      name: status.name.trim(),
      state_topic: this.stateTopic(deviceSlug, slug),
      unique_id: `${deviceSlug}_${slug}`.toLowerCase(),
      value_template: status.numeric
        ? '{{ value_json.value | float }}'
        : '{{ value_json.value }}',
      device,
      availability: [{topic: this.statusTopic}],
    };

    if (availabilitySource) {
      configPayload.availability!.push({
        topic: this.availabilityTopic(availabilitySource),
      });
      configPayload.availability_mode = 'all';
    }

    if (!status.numeric) {
      configPayload.encoding = 'utf-8';
    } else {
      const unit = normaliseUnit(status.unit).unit;
      if (unit !== '') {
        configPayload.unit_of_measurement = unit;
      }
      if (!omitStateClass) {
        configPayload.state_class = StateClasses[unit] ?? 'measurement';
      }

      const deviceClass =
        unit === '%'
          ? BatteryLevelSlug.test(slug)
            ? 'battery'
            : undefined
          : DeviceClasses[unit];
      if (deviceClass) {
        configPayload.device_class = deviceClass;
      }
      if (slug.endsWith('power_factor') && unit === '') {
        configPayload.device_class = 'power_factor';
      }
      if (status.precision !== undefined) {
        configPayload.suggested_display_precision = status.precision;
      }
    }

    const payload = JSON.stringify(configPayload);
    this.configs.set(configTopic, payload);

    const stateTopic = configPayload.state_topic;
    if (!this.pendingStates.has(stateTopic)) {
      this.pendingStates.add(stateTopic);
      setTimeout(() => {
        this.pendingStates.delete(stateTopic);
        const state = this.states.get(stateTopic);
        if (state !== undefined) {
          this.publish(stateTopic, state, false);
        }
      }, 2000);
    }
    this.publish(configTopic, payload, true);
    return true;
  }
}
