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

export class winetHandler {
  private logger: Winston.Logger;
  private properties!: Properties;
  private host: string;
  private lang: string;
  private frequency: number;
  private callbackUpdatedStatus!: (
    devices: z.infer<typeof DeviceSchema>[],
    deviceStatus: DeviceStatusMap[]
  ) => void;
  private ws!: Websocket;

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
  private winetVersion: number | undefined = undefined;

  private scanInterval: NodeJS.Timeout | undefined = undefined;

  constructor(
    logger: Winston.Logger,
    host: string,
    lang: string,
    frequency: number,
    winetUser: string,
    winetPass: string
  ) {
    this.logger = logger;
    this.host = host;
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

  public connect(): void {
    this.token = '';
    this.currentDevice = undefined;
    this.inFlightDevice = undefined;
    this.currentStages = [];
    this.watchdogCount = 0;
    this.winetVersion = undefined;

    if (this.scanInterval !== undefined) {
      clearInterval(this.scanInterval);
    }

    this.ws = new Websocket(`ws://${this.host}:8082/ws/home/overview`);

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
  }

  public reconnect(): void {
    this.ws.close();
    this.logger.warn('Reconnecting to Winet');
    setTimeout(() => {
      this.connect();
    }, 5000);
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

  private onMessage(data: Websocket.Data) {
    const message = JSON.parse(data.toString());
    const validationResult = MessageSchema.safeParse(message);

    if (!validationResult.success) {
      this.logger.error('Invalid message:', {
        data: message,
      });
      return;
    }

    const typedMessage = validationResult.data;

    if (typedMessage.result_msg === 'I18N_COMMON_INTER_ABNORMAL') {
      this.logger.error('Winet disconnect: Internal Error');
      this.reconnect();
      return;
    }

    const result_code = typedMessage.result_code;
    const result_data = typedMessage.result_data;
    const service = result_data.service;

    switch (service) {
      case 'connect': {
        const connectResult = ConnectSchema.safeParse(result_data);
        if (!connectResult.success) {
          this.logger.error('Invalid connect message:', {
            data: message,
          });
          return;
        }
        const connectData = connectResult.data;

        if (connectData.token === undefined) {
          this.logger.error('Token is missing');
          return;
        }

        if (connectData.forceModifyPasswd !== undefined) {
          this.logger.info('Running a newer firmware version');
          this.winetVersion = 2;
        } else {
          this.logger.info('Running an older firmware version');
          this.winetVersion = 1;
        }

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
          this.logger.error('Invalid login message:', {
            data: message,
          });
          return;
        }
        const loginData = loginResult.data;

        if (loginData.token === undefined) {
          this.logger.error('Authenticated Token is missing');
          return;
        }

        if (result_code === 1) {
          this.logger.info('Authenticated successfully');
        } else {
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
            this.logger.info(
              `Detected device: ${device.dev_model} (${device.dev_sn})`
            );
            this.devices.push(device);
          }
        }

        this.scanDevices();
        break;
      }
      case 'real':
      case 'real_battery': {
        const receivedDevice = this.inFlightDevice;
        this.inFlightDevice = undefined;

        const realtimeResult = RealtimeSchema.safeParse(result_data);
        if (!realtimeResult.success) {
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
          const nameV = data.name + ' Voltage';
          const nameA = data.name + ' Current';
          const nameW = data.name + ' Power';

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

          mpptTotalW += dataPointW.value as number;

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
        if (result_code === 100) {
          this.logger.info('Websocket got timed out');
          this.reconnect();
        } else {
          this.logger.error('Received notice:', result_code, {
            data: message,
          });
        }
        break;
      }
      default:
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
      this.logger.info(
        `Skipping scanDevices, in flight device: ${this.inFlightDevice}`
      );
      this.watchdogCount++;
      if (this.watchdogCount > 5) {
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
