import Websocket from 'ws';
import {z} from 'zod';
import {
  MessageSchema,
  ConnectSchema,
  DeviceSchema,
  DeviceListSchema,
  RealtimeSchema,
  DirectSchema,
  LoginSchema,
} from './types/MessageTypes';
import slugify from 'slugify';
import {Properties} from './types/Properties';
import {DeviceStatus, DeviceStatusMap} from './types/DeviceStatus';
import {DeviceTypeStages, NumericUnits, QueryStages} from './types/Constants';
import Winston from 'winston';
import {Analytics} from './analytics';

export class winetHandler {
  private logger: Winston.Logger;
  private properties!: Properties;
  private host: string;
  private ssl: boolean;
  private lang: string;
  private frequency: number;
  private callbackUpdatedStatus!: (
    devices: z.infer<typeof DeviceSchema>[],
    deviceStatus: DeviceStatusMap[]
  ) => void;
  private ws!: Websocket;
  private analytics: Analytics;

  private winetUser = '';
  private winetPass = '';

  private token = '';
  private currentDevice: number | undefined = undefined;
  private inFlightDevice: number | undefined = undefined;
  private currentStages: QueryStages[] = [];

  private devices: z.infer<typeof DeviceSchema>[] = [];
  private deviceStatus: DeviceStatusMap[] = [];
  private lastDeviceUpdate: Record<string, Date> = {};
  private watchdogCount = 0;
  private watchdogLastData: number | undefined = undefined;
  private winetVersion: number | undefined = undefined;

  private scanInterval: NodeJS.Timeout | undefined = undefined;
  private watchdogInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    logger: Winston.Logger,
    host: string,
    lang: string,
    frequency: number,
    winetUser: string,
    winetPass: string,
    analytics: Analytics
  ) {
    this.logger = logger;
    this.host = host;
    this.ssl = false;
    this.lang = lang;
    this.frequency = frequency;
    if (winetUser) {
      this.winetUser = winetUser;
    } else {
      this.winetUser = 'admin';
    }
    if (winetPass) {
      this.winetPass = winetPass;
    } else {
      this.winetPass = 'pw8888';
    }
    this.analytics = analytics;
  }

  public setProperties(properties: Properties): void {
    this.properties = properties;
  }

  public setCallback(
    callback: (
      devices: z.infer<typeof DeviceSchema>[],
      deviceStatus: DeviceStatusMap[]
    ) => void
  ): void {
    this.callbackUpdatedStatus = callback;
  }

  public setWatchdog(): void {
    this.watchdogInterval = setInterval(() => {
      if (this.watchdogLastData === undefined) {
        return;
      }

      const diff = Date.now() - this.watchdogLastData;
      if (diff > this.frequency * 1000 * 6) {
        this.logger.error('Watchdog triggered, reconnecting');
        this.reconnect();
      }
    }, this.frequency * 1000);
  }

  public clearWatchdog(): void {
    if (this.watchdogInterval !== undefined) {
      clearInterval(this.watchdogInterval);
    }
  }

  public connect(ssl?: boolean): void {
    if (ssl !== undefined) {
      this.ssl = ssl;
    }
    this.token = '';
    this.currentDevice = undefined;
    this.inFlightDevice = undefined;
    this.currentStages = [];
    this.watchdogCount = 0;
    this.winetVersion = undefined;

    if (this.scanInterval !== undefined) {
      clearInterval(this.scanInterval);
    }
    this.watchdogLastData = Date.now();
    this.setWatchdog();

    const wsOptions = this.ssl
      ? {
          rejectUnauthorized: false, // Ignore self-signed certificate error
        }
      : {};

    this.ws = new Websocket(
      this.ssl
        ? `wss://${this.host}:443/ws/home/overview`
        : `ws://${this.host}:8082/ws/home/overview`,
      wsOptions
    );

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('error', this.onError.bind(this));
  }

  public reconnect(): void {
    this.ws.close();
    this.logger.warn('Reconnecting to Winet');

    if (this.scanInterval !== undefined) {
      clearInterval(this.scanInterval);
    }
    this.clearWatchdog();

    setTimeout(
      () => {
        this.connect();
      },
      this.frequency * 1000 * 3
    );
  }

  private sendPacket(data: Record<string, string | number>): void {
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
      if (this.currentDevice === undefined) {
        this.scanDevices();
      }
    }, this.frequency * 1000);
  }

  private onError(error: Websocket.ErrorEvent) {
    this.logger.error('Websocket error:', error);
    this.analytics.registerError('websocket_onError', error.message);

    if (this.watchdogInterval === undefined) {
      this.reconnect();
    }
  }

  private onMessage(data: Websocket.Data) {
    const message = JSON.parse(data.toString());
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
      this.logger.error('Winet disconnect: Internal Error');
      this.analytics.registerError('winetError', 'INTER_ABNORMAL');
      this.reconnect();
      return;
    }

    this.watchdogLastData = Date.now();

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

        if (connectData.token === undefined) {
          this.analytics.registerError('connectSchema', 'tokenMissing');
          this.logger.error('Token is missing');
          return;
        }

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
        this.analytics.registerVersion(this.winetVersion);

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
        const loginResult = LoginSchema.safeParse(result_data);
        if (!loginResult.success) {
          this.analytics.registerError('loginSchema', 'successFalse');
          this.logger.error('Invalid login message:', {
            data: message,
          });
          return;
        }
        const loginData = loginResult.data;

        if (loginData.token === undefined) {
          this.analytics.registerError('loginSchema', 'tokenMissing');
          this.logger.error('Authenticated Token is missing');
          return;
        }

        if (result_code === 1) {
          this.logger.info('Authenticated successfully');
        } else {
          this.analytics.registerError('loginSchema', 'resultCodeFail');
          throw new Error('Failed to authenticate');
        }

        this.token = loginData.token;

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
          return;
        }
        const deviceListData = deviceListResult.data;
        for (const device of deviceListData.list) {
          if (DeviceTypeStages[device.dev_type].length === 0) {
            this.logger.info(
              'Skipping device:',
              device.dev_name,
              device.dev_sn
            );
            continue;
          }

          // If devices are not already in the list, add them
          if (this.devices.findIndex(d => d.dev_sn === device.dev_sn) === -1) {
            this.deviceStatus[device.dev_id] = {};
            device.dev_model = device.dev_model.replace(/[^a-zA-Z0-9]/g, '');
            device.dev_sn = device.dev_sn.replace(/[^a-zA-Z0-9]/g, '');
            this.logger.info(
              `Detected device: ${device.dev_model} (${device.dev_sn})`
            );
            this.devices.push(device);
          }
        }

        this.analytics.registerDevices(this.devices);

        this.scanDevices();
        break;
      }
      case 'real':
      case 'real_battery': {
        const receivedDevice = this.inFlightDevice;
        this.inFlightDevice = undefined;

        const realtimeResult = RealtimeSchema.safeParse(result_data);
        if (!realtimeResult.success) {
          this.analytics.registerError('realtimeSchema', 'successFalse');
          this.logger.error('Invalid realtime message:', {
            data: message,
          });
          this.reconnect();
          return;
        }

        if (receivedDevice === undefined) {
          this.logger.error('Received realtime data without a current device');
          return;
        }

        for (const data of realtimeResult.data.list) {
          const name = this.properties[data.data_name] || data.data_name;
          const dataPoint: DeviceStatus = {
            name: name,
            slug: slugify(name, {lower: true, strict: true, replacement: '_'}),
            value: NumericUnits.includes(data.data_unit)
              ? data.data_value === '--'
                ? undefined
                : parseFloat(data.data_value)
              : data.data_value.startsWith('I18N_')
                ? this.properties[data.data_value]
                : data.data_value,
            unit: data.data_unit,
            dirty: true,
          };

          this.updateDeviceStatus(receivedDevice, dataPoint);
        }

        this.scanDevices();
        break;
      }
      case 'direct': {
        const receivedDevice = this.inFlightDevice;
        this.inFlightDevice = undefined;

        const directResult = DirectSchema.safeParse(result_data);
        if (!directResult.success) {
          this.analytics.registerError('directSchema', 'successFalse');
          this.logger.error('Invalid direct message:', {
            data: message,
          });
          return;
        }

        if (receivedDevice === undefined) {
          this.logger.error('Received direct data without a current device');
          return;
        }

        let mpptTotalW = 0;
        for (const data of directResult.data.list) {
          const names = data.name.split('%');
          var name = this.properties[names[0]];
          if (!name) {
            name = data.name;
          }

          var nameV = name + ' Voltage';
          var nameA = name + ' Current';
          var nameW = name + ' Power';

          if(names.length > 1) {
            nameV = nameV.replace('{0}', names[1].replace('@', ''));
            nameA = nameA.replace('{0}', names[1].replace('@', ''));
            nameW = nameW.replace('{0}', names[1].replace('@', ''));
          }
          const dataPointV: DeviceStatus = {
            name: nameV,
            slug: slugify(nameV, {lower: true, strict: true, replacement: '_'}),
            value: data.voltage === '--' ? undefined : parseFloat(data.voltage),
            unit: data.voltage_unit,
            dirty: true,
          };

          const dataPointA: DeviceStatus = {
            name: nameA,
            slug: slugify(nameA, {lower: true, strict: true, replacement: '_'}),
            value: data.current === '--' ? undefined : parseFloat(data.current),
            unit: data.current_unit,
            dirty: true,
          };

          const dataPointW: DeviceStatus = {
            name: nameW,
            slug: slugify(nameW, {lower: true, strict: true, replacement: '_'}),
            value:
              data.current === '--'
                ? undefined
                : Math.round(
                    parseFloat(data.current) * parseFloat(data.voltage) * 100
                  ) / 100,
            unit: 'W',
            dirty: true,
          };

          if (dataPointW.value !== undefined && dataPointW.name.startsWith('mppt')) {
            mpptTotalW += dataPointW.value as number;
          }

          this.updateDeviceStatus(receivedDevice, dataPointV);
          this.updateDeviceStatus(receivedDevice, dataPointA);
          this.updateDeviceStatus(receivedDevice, dataPointW);
        }

        const dataPointTotalW: DeviceStatus = {
          name: 'MPPT Total Power',
          slug: 'mppt_total_power',
          value: Math.round(mpptTotalW * 100) / 100,
          unit: 'W',
          dirty: true,
        };
        this.updateDeviceStatus(receivedDevice, dataPointTotalW);

        this.scanDevices();
        break;
      }
      case 'notice': {
        this.analytics.registerError('notice', result_code + '');
        if (result_code === 100) {
          this.logger.info('Websocket got timed out');
          this.reconnect();
        } else {
          this.logger.error('Received notice', {
            data: message,
          });
        }
        break;
      }
      default:
        this.analytics.registerError('unknownService', service);
        this.logger.error('Received unknown message:', data);
    }
  }

  private updateDeviceStatus(device: number, dataPoint: DeviceStatus) {
    const combinedName = `${device}_${dataPoint.slug}`;
    const oldDataPoint = this.deviceStatus[device][dataPoint.slug];
    if (
      oldDataPoint === undefined ||
      oldDataPoint.value !== dataPoint.value ||
      this.lastDeviceUpdate[combinedName] === undefined ||
      new Date().getTime() - this.lastDeviceUpdate[combinedName].getTime() >
        300000
    ) {
      this.deviceStatus[device][dataPoint.slug] = dataPoint;
      this.lastDeviceUpdate[combinedName] = new Date();
    }
  }

  private scanDevices() {
    if (this.inFlightDevice !== undefined) {
      this.analytics.registerError('scanDevices', 'inFlightDevice');
      this.logger.info(
        `Skipping scanDevices, in flight device: ${this.inFlightDevice}`
      );
      this.watchdogCount++;
      if (this.watchdogCount > 5) {
        this.analytics.registerError('scanDevices', 'watchdogTriggered');
        this.logger.error('Watchdog triggered, reconnecting');
        this.reconnect();
      }
      return;
    }
    if (this.currentDevice === undefined) {
      this.currentDevice = this.devices[0].dev_id;
      this.currentStages = [...DeviceTypeStages[this.devices[0].dev_type]];
    } else if (this.currentStages.length === 0) {
      const currentIndex = this.devices.findIndex(
        device => device.dev_id === this.currentDevice
      );
      const nextIndex = currentIndex + 1;
      if (nextIndex >= this.devices.length) {
        this.currentDevice = undefined;
        this.callbackUpdatedStatus(this.devices, this.deviceStatus);
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
        this.logger.error('Unknown query stage:', nextStage);
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
