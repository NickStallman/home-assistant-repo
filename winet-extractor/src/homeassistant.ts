import mqtt, {MqttClient} from 'mqtt';
import {z} from 'zod';
import {DeviceSchema} from './types/MessageTypes';
import {DeviceStatus} from './types/DeviceStatus';
import {
  StateClasses,
  DeviceClasses,
  TextSensors,
  ConfigPayload,
} from './types/HaTypes';
import Winston from 'winston';

export class MqttPublisher {
  private logger: Winston.Logger;
  private client: MqttClient;

  private connected = false;

  constructor(logger: Winston.Logger, url: string) {
    this.logger = logger;
    this.client = mqtt.connect(url);
    this.client.on('connect', () => {
      this.logger.info('Connected to MQTT broker');
      this.connected = true;
    });

    this.client.on('error', err => {
      this.logger.error(`MQTT error: ${err}`);
    });
  }

  public publishData(
    deviceSlug: string,
    slug: string,
    unit: string,
    value: number | string | undefined
  ) {
    if (!this.connected) {
      return;
    }
    if (unit === 'kWp') {
      unit = 'kW';
    }
    if (unit === '℃') {
      unit = '°C';
    }
    if (unit === 'kvar' && typeof value === 'number') {
      unit = 'var';
      value = value * 1000;
    }
    if (unit === 'kVA' && typeof value === 'number') {
      unit = 'VA';
      value = value * 1000;
    }
    const topic = `homeassistant/sensor/${deviceSlug}/${slug}/state`;

    const isTextSensor = TextSensors.includes(slug);
    let payload = '';
    if (isTextSensor) {
      payload = JSON.stringify({
        value: value?.toString() ?? '',
      });
    } else {
      payload = JSON.stringify({
        value: value,
        unit_of_measurement: unit,
      });
    }

    this.client.publish(topic, payload, {retain: false}, err => {
      if (err) {
        throw new Error(`Failed to publish sensor data: ${err}`);
      }
    });
  }

  public registerDevice(
    slug: string,
    device: z.infer<typeof DeviceSchema>
  ): boolean {
    if (!this.connected) {
      return false;
    }

    const identifier = `${device.dev_model}_${device.dev_sn}`;
    const configTopic = `homeassistant/sensor/${slug}/config`;
    const configPayload = JSON.stringify({
      '~': `homeassistant/sensor/${slug}`,
      name: `${device.dev_model} ${device.dev_sn}`,
      unique_id: slug.toLowerCase(),
      state_topic: '~/state',
      device: {
        name: `${device.dev_model} ${device.dev_sn}`,
        identifiers: [identifier],
        model: device.dev_model,
        manufacturer: 'Sungrow',
      },
    });

    this.client.publish(
      configTopic,
      configPayload,
      {retain: true, qos: 1},
      err => {
        if (err) {
          throw new Error(`Failed to publish register device: ${err}`);
        }
      }
    );

    return true;
  }

  public publishConfig(
    deviceSlug: string,
    deviceStatus: DeviceStatus,
    device: z.infer<typeof DeviceSchema>
  ): boolean {
    if (!this.connected) {
      return false;
    }

    const slug = deviceStatus.slug;

    const configTopic = `homeassistant/sensor/${deviceSlug}/${slug}/config`;
    const isTextSensor = TextSensors.includes(slug);
    const isNumeric = (n: number) => !isNaN(n) && isFinite(n);
    const valueTemplate = isNumeric(
      parseFloat(deviceStatus.value?.toString() || '')
    )
      ? '{{ value_json.value | float }}'
      : '{{ value_json.value }}';
    const identifier = `${device.dev_model}_${device.dev_sn}`;
    const configPayload: ConfigPayload = {
      name: deviceStatus.name.trim(),
      state_topic: `homeassistant/sensor/${deviceSlug}/${slug}/state`,
      unique_id: `${deviceSlug}_${slug}`.toLowerCase(),
      value_template: valueTemplate,
      device: {
        name: `${device.dev_model} ${device.dev_sn}`,
        identifiers: [identifier],
        model: device.dev_model,
      },
    };

    if (isTextSensor) {
      configPayload.encoding = 'utf-8';
    } else {
      configPayload.unit_of_measurement = deviceStatus.unit;
      configPayload.state_class = 'measurement';
    }

    configPayload.device_class = '';
    switch (deviceStatus.unit) {
      case 'kWp':
        configPayload.unit_of_measurement = 'kW';
        break;
      case '℃':
        configPayload.unit_of_measurement = '°C';
        break;
      case 'kvar':
        configPayload.unit_of_measurement = 'var';
        break;
      case 'kVA':
        configPayload.unit_of_measurement = 'VA';
        break;
    }

    if (StateClasses[deviceStatus.unit]) {
      configPayload.state_class = StateClasses[deviceStatus.unit];
    }
    if (DeviceClasses[deviceStatus.unit]) {
      configPayload.device_class = DeviceClasses[deviceStatus.unit] ?? '';
    }
    if (configPayload.unit_of_measurement === 'kWh') {
      configPayload.state_class = 'total_increasing';
    }
    if (slug === 'total_power_factor') {
      configPayload.device_class = 'power_factor';
    }
    if (configPayload.device_class === '') {
      delete configPayload.device_class;
    }
    if (configPayload.state_class === '') {
      delete configPayload.state_class;
    }

    this.client.publish(
      configTopic,
      JSON.stringify(configPayload),
      {retain: true, qos: 1},
      err => {
        if (err) {
          throw new Error(`Failed to publish sensor config: ${err}`);
        }
      }
    );

    return true;
  }
}
