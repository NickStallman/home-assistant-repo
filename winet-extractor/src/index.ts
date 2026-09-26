import {winetHandler} from './winetHandler';
import {MqttPublisher, hostSlug} from './homeassistant';
import {DeviceStatusMap} from './types/DeviceStatus';
import {Device} from './types/MessageTypes';
import {DeviceInfo} from './types/HaTypes';
import {isInverterType} from './types/Constants';
import {loadConfig} from './config';
import {
  SiteTotals,
  SiteDevice,
  SITE_DEVICE_SLUG,
  SiteSlugsWithoutStateClass,
} from './siteTotals';
import Winston from 'winston';
import util from 'util';
import {Analytics} from './analytics';

const logger = Winston.createLogger({
  level: 'info',
  format: Winston.format.combine(
    Winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    Winston.format.printf(info => {
      const {timestamp, level, message, host, ...extraData} = info;
      return (
        `${timestamp} ${level}: ${host ? `[${host}] ` : ''}${message} ` +
        `${Object.keys(extraData).length ? util.format(extraData) : ''}`
      );
    })
  ),
  transports: [new Winston.transports.Console()],
});

const config = loadConfig();

const lang = 'en_US';
const frequency = config.pollInterval;

logger.info(
  `Starting with ${config.winets.length} WiNet(s): ` +
    config.winets.map(w => w.host).join(', ')
);

const instanceId = hostSlug(config.winets[0].host);
const mqtt = new MqttPublisher(
  logger,
  config.mqttUrl,
  config.mqttPrefix,
  instanceId
);
const analytics = new Analytics(config.analytics);
const siteTotals = new SiteTotals(Math.max(frequency * 1000 * 6, 60000));

// Sensors are keyed by device slug (model + serial) which is unique across
// WiNets. dev_id is only unique within a single WiNet.
const configuredSensors = new Set<string>();
const configuredDevices = new Set<string>();
const deviceOwners = new Map<string, string>();
const inverterStatus = new Map<string, DeviceStatusMap>();
const reportedHosts = new Set<string>();

const deviceInfo = (device: Device): DeviceInfo => ({
  name: `${device.dev_model} ${device.dev_sn}`,
  identifiers: [`${device.dev_model}_${device.dev_sn}`],
  model: device.dev_model,
  manufacturer: 'Sungrow',
  serial_number: device.dev_sn,
});

function publishSiteTotals(): number {
  // Wait until every WiNet has reported, otherwise the lifetime totals would
  // jump when a late WiNet joins
  if (
    !config.siteTotals ||
    inverterStatus.size < 2 ||
    reportedHosts.size < config.winets.length
  ) {
    return 0;
  }

  let updated = 0;
  for (const status of siteTotals.update(inverterStatus)) {
    const key = `${SITE_DEVICE_SLUG}/${status.slug}`;
    if (!configuredSensors.has(key)) {
      if (
        !mqtt.publishConfig(
          SITE_DEVICE_SLUG,
          status,
          SiteDevice,
          undefined,
          SiteSlugsWithoutStateClass.includes(status.slug)
        )
      ) {
        continue;
      }
      logger.info(`Configured site sensor: ${status.slug}`);
      configuredSensors.add(key);
    }
    if (mqtt.publishState(SITE_DEVICE_SLUG, status)) {
      status.dirty = false;
      updated++;
    }
  }
  return updated;
}

function onStatus(
  handler: winetHandler,
  handlerLogger: Winston.Logger,
  devices: Device[],
  deviceStatus: Record<string, DeviceStatusMap>
) {
  let updatedSensorsConfig = 0;
  let updatedSensors = 0;

  for (const device of devices) {
    const deviceSlug = `${device.dev_model}_${device.dev_sn}`;
    const currentStatus = deviceStatus[device.dev_sn] ?? {};

    const owner = deviceOwners.get(deviceSlug);
    if (owner === undefined) {
      deviceOwners.set(deviceSlug, handler.host);
    } else if (owner !== handler.host) {
      handlerLogger.warn(
        `Device ${deviceSlug} is also reported by ${owner}, ignoring duplicate`
      );
      continue;
    }

    if (!configuredDevices.has(deviceSlug) && mqtt.isConnected()) {
      mqtt.removeLegacyDeviceConfig(deviceSlug);
      handlerLogger.info(`Registered device: ${deviceSlug}`);
      configuredDevices.add(deviceSlug);
    }

    if (isInverterType(device.dev_type)) {
      inverterStatus.set(deviceSlug, currentStatus);
    }

    for (const status of Object.values(currentStatus)) {
      const key = `${deviceSlug}/${status.slug}`;

      if (!configuredSensors.has(key) && status.value !== undefined) {
        if (
          mqtt.publishConfig(
            deviceSlug,
            status,
            deviceInfo(device),
            handler.host
          )
        ) {
          handlerLogger.info(`Configured sensor: ${deviceSlug} ${status.slug}`);
          configuredSensors.add(key);
          updatedSensorsConfig++;
        }
      }

      if (status.dirty && configuredSensors.has(key)) {
        if (status.value === undefined) {
          // Nothing to publish, e.g. unused backup port phases
          status.dirty = false;
        } else if (mqtt.publishState(deviceSlug, status)) {
          status.dirty = false;
          updatedSensors++;
        }
      }
    }
  }

  reportedHosts.add(handler.host);
  publishSiteTotals();

  if (updatedSensorsConfig > 0) {
    handlerLogger.info(`Configured ${updatedSensorsConfig} sensors`);
  }
  if (updatedSensors > 0) {
    handlerLogger.info(`Updated ${updatedSensors} sensors`);
  }
}

for (const winet of config.winets) {
  const handlerLogger = logger.child({host: winet.host});
  const handler = new winetHandler(
    handlerLogger,
    winet.host,
    lang,
    frequency,
    winet.user,
    winet.pass,
    winet.ssl,
    analytics
  );

  handler.setCallback((h, devices, deviceStatus) =>
    onStatus(h, handlerLogger, devices, deviceStatus)
  );
  handler.setConnectionCallback((h, connected) => {
    mqtt.setAvailability(h.host, connected);
  });
  handler.start();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down`);
    // Websockets and timers keep the event loop alive, so exit explicitly.
    // Don't hang around if the broker is unresponsive.
    // eslint-disable-next-line n/no-process-exit
    setTimeout(() => process.exit(0), 3000).unref();
    // eslint-disable-next-line n/no-process-exit
    mqtt.shutdown().then(() => process.exit(0));
  });
}
