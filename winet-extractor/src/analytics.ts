import {PostHog} from 'posthog-node';
import crypto from 'crypto';
import {Device} from './types/MessageTypes';

export class Analytics {
  private id = '';
  private enabled: boolean;
  private version: string;
  private posthog: PostHog | undefined;
  // Keyed by WiNet host so multiple dongles don't overwrite each other
  private winetVersions = new Map<string, number>();
  private devices = new Map<string, Device[]>();
  private devicePingInterval: NodeJS.Timeout | undefined = undefined;

  constructor(enabled: boolean, version: string) {
    this.enabled = enabled;
    this.version = version;

    if (this.enabled) {
      this.posthog = new PostHog(
        'phc_Xl9GlMHjhpVc9pGwR2U1Qga4e1pUaRPD2IrLGMy11eY',
        {host: 'https://posthog.nickstallman.net'}
      );
      setInterval(this.ping.bind(this), 1000 * 60 * 60);
    }
  }

  private get winetVersion(): number {
    return Math.max(0, ...this.winetVersions.values());
  }

  private allDevices(): Device[] {
    return [...this.devices.values()].flat();
  }

  public registerDevices(host: string, devices: Device[]) {
    const previous = this.devices.get(host);
    const same =
      previous !== undefined &&
      previous.map(d => d.dev_sn).join() === devices.map(d => d.dev_sn).join();
    this.devices.set(host, [...devices]);
    if (same) {
      return;
    }

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
    for (const device of this.allDevices()) {
      deviceString += device.dev_model + ':' + device.dev_sn + ';';
    }

    if (deviceString.length > 0) {
      const hash = crypto.createHash('sha256');
      hash.update(deviceString);
      this.id = hash.digest('base64');
    }

    if (this.posthog && this.id.length > 0) {
      this.ping();

      for (const device of this.allDevices()) {
        this.posthog.capture({
          distinctId: this.id,
          event: 'device_registered',
          properties: {
            device: device.dev_model,
            version: this.version,
            winetVersion: this.winetVersion,
            winetCount: this.devices.size,
          },
        });
      }
    }
  }

  public registerVersion(host: string, version: number) {
    this.winetVersions.set(host, version);
  }

  public registerError(type: string, error: string) {
    if (this.posthog && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'error',
        properties: {
          type: type,
          error: error,
          version: this.version,
          winetVersion: this.winetVersion,
        },
      });
    }
  }

  // Outcome of a register block for one device: sent once when it first reads
  // successfully, and once if it gets disabled
  public registerBlockResult(
    block: string,
    device: string,
    failure?: {reason: string; detail: string}
  ) {
    if (!this.posthog || this.id.length === 0) {
      return;
    }
    if (failure === undefined) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'register_block',
        properties: {
          status: 'ok',
          block,
          device,
          version: this.version,
          winetVersion: this.winetVersion,
        },
      });
    } else {
      this.posthog.capture({
        distinctId: this.id,
        event: 'error',
        properties: {
          type: 'registerBlock',
          error: failure.reason,
          detail: failure.detail.slice(0, 200),
          block,
          device,
          version: this.version,
          winetVersion: this.winetVersion,
        },
      });
    }
  }

  public registerReconnect(type: string) {
    if (this.posthog && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'reconnect',
        properties: {
          type: type,
          version: this.version,
          winetVersion: this.winetVersion,
        },
      });
    }
  }

  public ping() {
    if (this.posthog && this.id.length > 0) {
      this.posthog.capture({
        distinctId: this.id,
        event: 'ping',
        properties: {
          version: this.version,
          winetVersion: this.winetVersion,
          winetCount: this.devices.size,
        },
      });
    }
  }
}
