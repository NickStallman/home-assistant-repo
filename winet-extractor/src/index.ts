import {getProperties} from './getProperties';
import {winetHandler} from './winetHandler';
import {MqttPublisher} from './homeassistant';
import Winston from 'winston';
import fs from 'fs';
import util from 'util';
import {Analytics} from './analytics';

const logger = Winston.createLogger({
  level: 'info',
  format: Winston.format.combine(
    Winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    Winston.format.printf(info => {
      const {timestamp, level, message, ...extraData} = info;
      return (
        `${timestamp} ${level}: ${message} ` +
        `${Object.keys(extraData).length ? util.format(extraData) : ''}`
      );
    })
  ),
  transports: [new Winston.transports.Console()],
});

const rawOptions = fs.readFileSync('/data/options.json', 'utf8');
const options = JSON.parse(rawOptions);

if (!options.winet_host) {
  throw new Error('No host provided');
}

if (!options.mqtt_url) {
  throw new Error('No mqtt provided');
}

const lang = 'en_us';
const frequency = parseInt(options.poll_interval) || 10;

const mqtt = new MqttPublisher(logger, options.mqtt_url);
const winet = new winetHandler(
  logger,
  options.winet_host,
  lang,
  frequency,
  options.winet_user || '',
  options.winet_pass || '',
  new Analytics(options.analytics || true)
);

const configuredSensors: string[] = [];
const configuredDevices: number[] = [];

winet.setCallback((devices, deviceStatus) => {
  let updatedSensorsConfig = 0;
  let updatedSensors = 0;

  for (const device of devices) {
    const deviceSlug = `${device.dev_model}_${device.dev_sn}`;
    const currentStatus = deviceStatus[device.dev_id];

    if (!configuredDevices.includes(device.dev_id)) {
      if (mqtt.registerDevice(deviceSlug, device)) {
        logger.info(`Registered device: ${deviceSlug}`);
        configuredDevices.push(device.dev_id);
      }
    }

    for (const statusKey in currentStatus) {
      const status = currentStatus[statusKey];
      const combinedSlug = `${deviceSlug}_${status.slug}`;

      if (!configuredSensors.includes(combinedSlug)) {
        if (mqtt.publishConfig(deviceSlug, status, device)) {
          logger.info(`Configured sensor: ${deviceSlug} ${status.slug}`);
          configuredSensors.push(combinedSlug);
          updatedSensorsConfig++;
        }
      }

      if (status.dirty) {
        mqtt.publishData(deviceSlug, status.slug, status.unit, status.value);
        status.dirty = false;
        updatedSensors++;
      }
    }
  }

  if (updatedSensorsConfig > 0) {
    logger.info(`Configured ${updatedSensorsConfig} sensors`);
  }
  if (updatedSensors > 0) {
    logger.info(`Updated ${updatedSensors} sensors`);
  }
});

getProperties(options.winet_host).then(properties => {
  logger.info('Fetched l18n properties.');

  winet.setProperties(properties);
  winet.connect();
});
