import * as https from 'https';
import * as tls from 'tls';
import {Duplex} from 'stream';
import {X509Certificate} from 'crypto';

/** An explicitly reviewed certificate, never learned automatically on failure. */
export function decodeTrustedCertificate(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  const invalid = () => new Error('Invalid WINET_TLS_CA_CERT_BASE64');
  if (typeof value !== 'string' || value.length > 32768) throw invalid();
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  ) {
    throw invalid();
  }
  const raw = Buffer.from(value, 'base64');
  if (raw.toString('base64') !== value) throw invalid();
  const pem = raw.toString('utf8').trim();
  if (
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(
      pem
    )
  ) {
    throw invalid();
  }
  try {
    return new X509Certificate(pem).toString();
  } catch {
    throw invalid();
  }
}

function normalizeServerName(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  // SNI is a DNS name. The connection address remains WINET_HOST.
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    !value
      .split('.')
      .every(label =>
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
      ) ||
    /^[0-9.]+$/.test(value)
  ) {
    throw new Error('Invalid WINET_TLS_SERVER_NAME');
  }
  return value;
}

class WinetAgent extends https.Agent {
  constructor(
    private readonly trustedCertificate: string | undefined,
    private readonly expectedName: string | undefined,
    private readonly handshakeTimeoutMs: number
  ) {
    super({
      ca: trustedCertificate,
      servername: expectedName,
      rejectUnauthorized: trustedCertificate !== undefined,
      minVersion: 'TLSv1.2',
      // WiNet closes idle connections; register reads must use fresh sockets.
      keepAlive: false,
      maxCachedSessions: 0,
    });
  }

  createConnection(
    options: tls.ConnectionOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): undefined {
    if (!callback)
      throw new Error('WiNet TLS requires asynchronous verification');
    const socket = tls.connect({
      ...options,
      ca: this.trustedCertificate,
      servername: this.expectedName ?? options.servername,
      checkServerIdentity: tls.checkServerIdentity,
      session: undefined,
      rejectUnauthorized: this.trustedCertificate !== undefined,
      minVersion: 'TLSv1.2',
    });
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('WiNet TLS handshake timeout')),
      this.handshakeTimeoutMs
    );
    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(new Error('WiNet TLS closed before verification'));
    const onSecure = () => {
      // With a supplied certificate, native trust and hostname checks must pass.
      // Without one, preserve the explicitly requested unverified TLS mode.
      finish(
        this.trustedCertificate === undefined || socket.authorized
          ? undefined
          : new Error('WiNet TLS unauthorized')
      );
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.removeListener('secureConnect', onSecure);
      if (error) socket.destroy();
      callback(error ?? null, socket);
    };
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('secureConnect', onSecure);
    // Release the socket only after the configured TLS policy has completed.
    return undefined;
  }
}

/** Shared HTTPS/WSS policy; explicit TLS configuration prohibits HTTP fallback. */
export class WinetTls {
  readonly agent: https.Agent;
  readonly required: boolean;

  constructor(
    certificateBase64?: string,
    serverName?: string,
    handshakeTimeoutMs = 10000
  ) {
    const ca = decodeTrustedCertificate(certificateBase64);
    const name = normalizeServerName(serverName);
    if (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0) {
      throw new Error('Invalid WiNet TLS handshake timeout');
    }
    this.required = ca !== undefined || name !== undefined;
    this.agent = new WinetAgent(ca, name, handshakeTimeoutMs);
  }
}
