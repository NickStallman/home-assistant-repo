import {PostHog} from 'posthog-node';
import crypto from 'crypto';
import {DeviceSchema} from './types/MessageTypes';
import z from 'zod';

export class Analytics {
  private id = '';
  private enabled: boolean;
  private posthog;
  private winetVersion = 0;
  private devices: z.infer<typeof DeviceSchema>[] = [];
  private devicePingInterval: NodeJS.Timeout | undefined = undefined;

  constructor(enabled: boolean) {
    this.enabled = enabled;

    this.posthog = new PostHog(
      'phc_Xl9GlMHjhpVc9pGwR2U1Qga4e1pUaRPD2IrLGMy11eY',
      {host: 'https://posthog.nickstallman.net'}
    );

    if (this.enabled) {
      setInterval(this.ping.bind(this), 1000 * 60 * 60);
    }
  }

  public registerDevices(devices: z.infer<typeof DeviceSchema>[]) {
    this.devices = devices;
    this.pingDevices();

    if (this.devicePingInterval) {
      clearInterval(this.devicePingInterval);
    }
    this.devicePingInterval = setInterval(
      this.pingDevices.bind(this),
      3600 * 1000 * 6
    );
  }

  private pingDevices() {
    let deviceString = '';
    for (const device of this.devices) {
      deviceString += device.dev_model + ':' + device.dev_sn + ';';
    }

    if (deviceString.length > 0) {
      const hash = crypto.createHash('sha256');
      hash.update(deviceString);
      this.id = hash.digest('base64');
    }

    if (this.enabled && this.id.length > 0) {
      this.ping();

      for (const device of this.devices) {
        this.posthog.capture({
          distinctId: this.id,
          event: 'device_registered',
          properties: {
            device: device.dev_model,
            winetVersion: this.winetVersion,
          },
        });
      }
    }
  }

  public registerVersion(version: number) {
    this.winetVersion = version;
  }

  public registerError(type: string, error: string) {
    if (this.enabled && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'error',
        properties: {
          type: type,
          error: error,
          winetVersion: this.winetVersion,
        },
      });
    }
  }

  public registerReconnect(type: string) {
    if (this.enabled && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'reconnect',
        properties: {
          type: type,
          winetVersion: this.winetVersion,
        },
      });
    }
  }

  public ping() {
    if (this.enabled && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id || '',
        event: 'ping',
        properties: {
          winetVersion: this.winetVersion,
        },
      });
    }
  }
}
