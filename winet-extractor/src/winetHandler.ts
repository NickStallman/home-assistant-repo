import Websocket from 'ws';
import {
  MessageSchema,
  ConnectSchema,
  Device,
  DeviceListSchema,
  RealtimeSchema,
  DirectSchema,
  LoginSchema,
} from './types/MessageTypes';
import slugify from 'slugify';
import {Properties} from './types/Properties';
import {DeviceStatus, DeviceStatusMap} from './types/DeviceStatus';
import {
  DeviceTypeStages,
  QueryStages,
  UnitlessNumericSlugs,
} from './types/Constants';
import {getProperties} from './getProperties';
import Winston from 'winston';
import {Analytics} from './analytics';

// Values are republished at least this often even when unchanged
const REFRESH_INTERVAL = 300000;
const MAX_RECONNECT_DELAY = 300000;

export type StatusCallback = (
  handler: winetHandler,
  devices: Device[],
  deviceStatus: Record<string, DeviceStatusMap>
) => void;

export type ConnectionCallback = (
  handler: winetHandler,
  connected: boolean
) => void;

export class winetHandler {
  public readonly host: string;
  private logger: Winston.Logger;
  private properties: Properties = {};
  private ssl: boolean;
  private lang: string;
  private frequency: number;
  private callbackUpdatedStatus?: StatusCallback;
  private callbackConnection?: ConnectionCallback;
  private ws?: Websocket;
  private analytics: Analytics;

  private winetUser: string;
  private winetPass: string;

  private token = '';
  private currentDevice: number | undefined = undefined;
  private inFlightDevice: number | undefined = undefined;
  private currentStages: QueryStages[] = [];

  private devices: Device[] = [];
  // Keyed by device serial number, which is stable across reconnects
  private deviceStatus: Record<string, DeviceStatusMap> = {};
  private skippedDevices = new Set<string>();
  private stallCount = 0;
  private lastData: number | undefined = undefined;
  private winetVersion: number | undefined = undefined;
  private connected = false;

  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined = undefined;
  private scanInterval: NodeJS.Timeout | undefined = undefined;
  private watchdogInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    logger: Winston.Logger,
    host: string,
    lang: string,
    frequency: number,
    winetUser: string,
    winetPass: string,
    ssl: boolean,
    analytics: Analytics
  ) {
    this.logger = logger;
    this.host = host;
    this.ssl = ssl;
    this.lang = lang;
    this.frequency = frequency;
    this.winetUser = winetUser || 'admin';
    this.winetPass = winetPass || 'pw8888';
    this.analytics = analytics;
  }

  public setCallback(callback: StatusCallback): void {
    this.callbackUpdatedStatus = callback;
  }

  public setConnectionCallback(callback: ConnectionCallback): void {
    this.callbackConnection = callback;
  }

  public getDevices(): Device[] {
    return this.devices;
  }

  // Fetch the i18n labels, retrying until the WiNet is reachable, then connect
  public start(retryDelay = 10000): void {
    getProperties(this.logger, this.host, this.lang, this.ssl)
      .then(result => {
        this.logger.info('Fetched i18n properties.');
        this.properties = result.properties;
        this.ssl = result.forceSsl;
        this.connect();
      })
      .catch(err => {
        this.logger.error(`Failed to fetch i18n properties: ${err.message}`);
        this.logger.warn(
          `WiNet unreachable. Retrying in ${Math.round(retryDelay / 1000)}s...`
        );
        const nextDelay = Math.min(retryDelay * 1.5, 60000);
        setTimeout(() => this.start(nextDelay), retryDelay);
      });
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.callbackConnection?.(this, connected);
  }

  private clearTimers(): void {
    if (this.scanInterval !== undefined) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }
    if (this.watchdogInterval !== undefined) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = undefined;
    }
  }

  private closeSocket(): void {
    if (this.ws === undefined) return;
    const ws = this.ws;
    this.ws = undefined;
    ws.removeAllListeners();
    // Swallow errors from a socket we're discarding
    ws.on('error', () => {});
    ws.terminate();
  }

  private connect(): void {
    this.closeSocket();
    this.clearTimers();

    this.token = '';
    this.currentDevice = undefined;
    this.inFlightDevice = undefined;
    this.currentStages = [];
    this.stallCount = 0;
    this.winetVersion = undefined;
    this.lastData = Date.now();

    this.watchdogInterval = setInterval(() => {
      if (
        this.lastData !== undefined &&
        Date.now() - this.lastData > this.frequency * 1000 * 6
      ) {
        this.analytics.registerReconnect('watchdog');
        this.reconnect('Watchdog triggered, no data received');
      }
    }, this.frequency * 1000);

    const url = this.ssl
      ? `wss://${this.host}:443/ws/home/overview`
      : `ws://${this.host}:8082/ws/home/overview`;
    this.logger.info(`Connecting to ${url}`);

    const ws = new Websocket(
      url,
      // Ignore self-signed certificate error
      this.ssl ? {rejectUnauthorized: false} : {}
    );
    this.ws = ws;

    ws.on('open', this.onOpen.bind(this));
    ws.on('message', this.onMessage.bind(this));
    ws.on('error', this.onError.bind(this));
    ws.on('close', (code: number) => {
      if (this.ws === ws) {
        this.reconnect(`Websocket closed (${code})`);
      }
    });
  }

  // Tear down the connection and try again later. Safe to call repeatedly.
  public reconnect(reason: string): void {
    if (this.reconnectTimer !== undefined) {
      return;
    }

    this.closeSocket();
    this.clearTimers();

    const delay = Math.min(
      this.frequency * 1000 * 3 * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;
    this.logger.warn(`${reason}. Reconnecting in ${Math.round(delay / 1000)}s`);

    // Allow a quick reconnect to happen without flagging the data as stale
    if (this.reconnectAttempts > 1) {
      this.setConnected(false);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private sendPacket(data: Record<string, string | number>): void {
    if (this.ws?.readyState !== Websocket.OPEN) {
      return;
    }
    const packet = {
      lang: this.lang,
      token: this.token,
      ...data,
    };
    this.ws.send(JSON.stringify(packet));
  }

  private onOpen() {
    this.sendPacket({
      service: 'connect',
    });

    this.scanInterval = setInterval(() => {
      if (this.currentDevice === undefined && this.devices.length > 0) {
        this.scanDevices();
      }
    }, this.frequency * 1000);
  }

  private onError(error: Error) {
    this.logger.error(`Websocket error: ${error.message}`);
    this.analytics.registerError('websocket_onError', error.message);
    this.reconnect('Websocket error');
  }

  private translate(value: string): string {
    return this.properties[value] ?? value;
  }

  private parseValue(
    raw: string,
    numeric: boolean
  ): string | number | undefined {
    if (raw === '--' || raw.trim() === '') {
      return undefined;
    }
    if (numeric) {
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    return raw.startsWith('I18N_') ? this.translate(raw) : raw;
  }

  private onMessage(data: Websocket.Data) {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      this.logger.error(`Unparseable message: ${data.toString()}`);
      return;
    }
    const validationResult = MessageSchema.safeParse(message);

    if (!validationResult.success) {
      this.analytics.registerError('invalid_message', 'MessageSchema');
      this.logger.error('Invalid message:', {
        data: message,
      });
      return;
    }

    const typedMessage = validationResult.data;

    if (typedMessage.result_msg === 'I18N_COMMON_INTER_ABNORMAL') {
      this.analytics.registerError('winetError', 'INTER_ABNORMAL');
      this.reconnect('WiNet disconnect: Internal Error');
      return;
    }

    this.lastData = Date.now();

    const result_code = typedMessage.result_code;
    const result_data = typedMessage.result_data;
    const service = result_data.service;

    switch (service) {
      case 'connect': {
        const connectResult = ConnectSchema.safeParse(result_data);
        if (!connectResult.success) {
          this.analytics.registerError('connectSchema', 'successFalse');
          this.logger.error('Invalid connect message:', {
            data: message,
          });
          return;
        }
        const connectData = connectResult.data;

        if (connectData.ip === undefined) {
          this.logger.info('Connected to a older Winet-S device');
          this.winetVersion = 1;
        } else if (connectData.forceModifyPasswd !== undefined) {
          this.logger.info(
            'Connected to a Winet-S2 device with newer firmware'
          );
          this.winetVersion = 3;
        } else {
          this.logger.info(
            'Connected to a Winet-S2 device with older firmware'
          );
          this.winetVersion = 2;
        }
        this.analytics.registerVersion(this.host, this.winetVersion);

        this.token = connectData.token;

        this.logger.info('Connected to Winet, logging in');

        this.sendPacket({
          service: 'login',
          passwd: this.winetPass,
          username: this.winetUser,
        });
        break;
      }
      case 'login': {
        if (result_code !== 1) {
          this.analytics.registerError('loginSchema', 'resultCodeFail');
          this.logger.error(
            `Failed to authenticate (${typedMessage.result_msg ?? result_code}). ` +
              'Check the WiNet username and password.'
          );
          this.reconnect('Authentication failed');
          return;
        }

        const loginResult = LoginSchema.safeParse(result_data);
        if (!loginResult.success) {
          this.analytics.registerError('loginSchema', 'successFalse');
          this.logger.error('Invalid login message:', {
            data: message,
          });
          this.reconnect('Invalid login response');
          return;
        }

        this.logger.info('Authenticated successfully');
        this.token = loginResult.data.token;

        this.sendPacket({
          service: 'devicelist',
          type: '0',
          is_check_token: '0',
        });
        break;
      }
      case 'devicelist': {
        const deviceListResult = DeviceListSchema.safeParse(result_data);
        if (!deviceListResult.success) {
          this.analytics.registerError('deviceListSchema', 'successFalse');
          this.logger.error('Invalid devicelist message:', {
            data: message,
          });
          this.reconnect('Invalid device list');
          return;
        }
        this.updateDeviceList(deviceListResult.data.list);

        if (this.devices.length === 0) {
          this.reconnect('No supported devices found');
          return;
        }

        this.reconnectAttempts = 0;
        this.setConnected(true);
        this.analytics.registerDevices(this.host, this.devices);

        this.scanDevices();
        break;
      }
      case 'real':
      case 'real_battery': {
        const receivedDevice = this.inFlightDevice;
        this.inFlightDevice = undefined;

        if (receivedDevice === undefined) {
          this.logger.error('Received realtime data without a current device');
          return;
        }

        const realtimeResult = RealtimeSchema.safeParse(result_data);
        if (!realtimeResult.success) {
          this.analytics.registerError('realtimeSchema', 'successFalse');
          this.logger.error(
            `Invalid realtime message for ${this.describeDevice(receivedDevice)}`,
            {
              data: JSON.stringify(message),
              errors: JSON.stringify(realtimeResult.error.format()),
            }
          );
          this.scanDevices();
          return;
        }

        for (const data of realtimeResult.data.list) {
          const name = this.translate(data.data_name);
          const slug = slugify(name, {
            lower: true,
            strict: true,
            replacement: '_',
          });
          const numeric =
            data.data_unit !== '' || UnitlessNumericSlugs.includes(slug);

          this.updateDeviceStatus(receivedDevice, {
            name,
            slug,
            value: this.parseValue(data.data_value, numeric),
            unit: data.data_unit,
            numeric,
          });
        }

        this.scanDevices();
        break;
      }
      case 'direct': {
        const receivedDevice = this.inFlightDevice;
        this.inFlightDevice = undefined;

        if (receivedDevice === undefined) {
          this.logger.error('Received direct data without a current device');
          return;
        }

        const directResult = DirectSchema.safeParse(result_data);
        if (!directResult.success) {
          this.analytics.registerError('directSchema', 'successFalse');
          this.logger.error(
            `Invalid direct message for ${this.describeDevice(receivedDevice)}`,
            {
              data: JSON.stringify(message),
              errors: JSON.stringify(directResult.error.format()),
            }
          );
          this.scanDevices();
          return;
        }

        let mpptTotalW = 0;
        for (const data of directResult.data.list) {
          const names = data.name.split('%');
          const name = this.properties[names[0]] || data.name;

          let nameV = name + ' Voltage';
          let nameA = name + ' Current';
          let nameW = name + ' Power';

          if (names.length > 1) {
            nameV = nameV.replace('{0}', names[1].replace('@', ''));
            nameA = nameA.replace('{0}', names[1].replace('@', ''));
            nameW = nameW.replace('{0}', names[1].replace('@', ''));
          }

          const voltage = this.parseValue(data.voltage, true) as
            | number
            | undefined;
          const current = this.parseValue(data.current, true) as
            | number
            | undefined;
          const power =
            voltage === undefined || current === undefined
              ? undefined
              : Math.round(current * voltage * 100) / 100;

          const slugOf = (n: string) =>
            slugify(n, {lower: true, strict: true, replacement: '_'});

          this.updateDeviceStatus(receivedDevice, {
            name: nameV,
            slug: slugOf(nameV),
            value: voltage,
            unit: data.voltage_unit,
            numeric: true,
          });
          this.updateDeviceStatus(receivedDevice, {
            name: nameA,
            slug: slugOf(nameA),
            value: current,
            unit: data.current_unit,
            numeric: true,
          });
          this.updateDeviceStatus(receivedDevice, {
            name: nameW,
            slug: slugOf(nameW),
            value: power,
            unit: 'W',
            numeric: true,
          });

          if (power !== undefined && nameW.toLowerCase().startsWith('mppt')) {
            mpptTotalW += power;
          }
        }

        this.updateDeviceStatus(receivedDevice, {
          name: 'MPPT Total Power',
          slug: 'mppt_total_power',
          value: Math.round(mpptTotalW * 100) / 100,
          unit: 'W',
          numeric: true,
        });

        this.scanDevices();
        break;
      }
      case 'notice': {
        this.analytics.registerError('notice', result_code + '');
        if (result_code === 100) {
          this.reconnect('Websocket got timed out');
        } else {
          this.logger.error('Received notice', {
            data: message,
          });
        }
        break;
      }
      default:
        this.analytics.registerError('unknownService', service);
        this.logger.error('Received unknown message:', {data: message});
    }
  }

  private updateDeviceList(list: Device[]) {
    const devices: Device[] = [];

    for (const device of list) {
      device.dev_model = device.dev_model.replace(/[^a-zA-Z0-9]/g, '');
      device.dev_sn = device.dev_sn.replace(/[^a-zA-Z0-9]/g, '');

      if ((DeviceTypeStages[device.dev_type] ?? []).length === 0) {
        const key = `${device.dev_type}_${device.dev_sn}`;
        if (!this.skippedDevices.has(key)) {
          this.skippedDevices.add(key);
          this.logger.info(
            `Skipping unsupported device: ${device.dev_name} ` +
              `(${device.dev_sn}, dev_type ${device.dev_type})`
          );
          this.analytics.registerError(
            'unsupportedDevice',
            `${device.dev_model}:${device.dev_type}`
          );
        }
        continue;
      }

      if (this.devices.findIndex(d => d.dev_sn === device.dev_sn) === -1) {
        this.logger.info(
          `Detected device: ${device.dev_model} (${device.dev_sn})`
        );
      }
      this.deviceStatus[device.dev_sn] ??= {};
      devices.push(device);
    }

    // dev_id can change between sessions, so always use the latest list
    this.devices = devices;
  }

  private describeDevice(devId: number): string {
    const device = this.devices.find(d => d.dev_id === devId);
    return device
      ? `${device.dev_model} (${device.dev_sn})`
      : `dev_id ${devId}`;
  }

  private updateDeviceStatus(
    devId: number,
    reading: Pick<DeviceStatus, 'name' | 'slug' | 'value' | 'unit' | 'numeric'>
  ) {
    const device = this.devices.find(d => d.dev_id === devId);
    if (device === undefined) return;

    const statusMap = this.deviceStatus[device.dev_sn];
    const oldDataPoint = statusMap[reading.slug];
    const now = Date.now();

    if (
      oldDataPoint !== undefined &&
      oldDataPoint.value === reading.value &&
      now - oldDataPoint.changedAt <= REFRESH_INTERVAL
    ) {
      oldDataPoint.seenAt = now;
      return;
    }

    statusMap[reading.slug] = {
      ...reading,
      dirty: true,
      seenAt: now,
      changedAt: now,
    };
  }

  private scanDevices() {
    if (this.devices.length === 0) {
      return;
    }

    if (this.inFlightDevice !== undefined) {
      this.analytics.registerError('scanDevices', 'inFlightDevice');
      this.logger.info(
        `Skipping scanDevices, in flight device: ${this.inFlightDevice}`
      );
      this.stallCount++;
      if (this.stallCount > 5) {
        this.analytics.registerError('scanDevices', 'watchdogTriggered');
        this.reconnect('Query timed out');
      }
      return;
    }
    this.stallCount = 0;

    if (this.currentDevice === undefined) {
      this.currentDevice = this.devices[0].dev_id;
      this.currentStages = [...DeviceTypeStages[this.devices[0].dev_type]];
    } else if (this.currentStages.length === 0) {
      const currentIndex = this.devices.findIndex(
        device => device.dev_id === this.currentDevice
      );
      const nextIndex = currentIndex + 1;
      if (currentIndex === -1 || nextIndex >= this.devices.length) {
        this.currentDevice = undefined;
        this.callbackUpdatedStatus?.(this, this.devices, this.deviceStatus);
        return;
      }
      this.currentDevice = this.devices[nextIndex].dev_id;
      this.currentStages = [
        ...DeviceTypeStages[this.devices[nextIndex].dev_type],
      ];
    }

    const nextStage = this.currentStages.shift();

    let service = '';
    switch (nextStage) {
      case QueryStages.REAL:
        service = 'real';
        break;
      case QueryStages.DIRECT:
        service = 'direct';
        break;
      case QueryStages.REAL_BATTERY:
        service = 'real_battery';
        break;
      default:
        this.logger.error(`Unknown query stage: ${nextStage}`);
        return;
    }

    this.inFlightDevice = this.currentDevice;
    this.sendPacket({
      service: service,
      dev_id: this.currentDevice.toString(),
      time123456: Date.now(),
    });
  }
}
