const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const WebSocket = require('ws');
const {WinetTls, decodeTrustedCertificate} = require('../build/src/winetTls');
const {getProperties} = require('../build/src/getProperties');
let temp, key, cert, other, expired, encoded;
const logger = {warn() {}};
before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'winet-tls-test-'));
  const make = name => {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        `${temp}/${name}.key`,
        '-out',
        `${temp}/${name}.crt`,
        '-days',
        '1',
        '-subj',
        '/CN=synthetic-winet-test',
        '-addext',
        'subjectAltName=DNS:localhost',
      ],
      {stdio: 'ignore'}
    );
    return fs.readFileSync(`${temp}/${name}.crt`);
  };
  cert = make('server');
  other = make('other');
  key = fs.readFileSync(`${temp}/server.key`);
  encoded = cert.toString('base64');
  // Use the CA command for explicit dates; supported by OpenSSL 3.0 as well as 3.5+.
  fs.writeFileSync(`${temp}/index`, '');
  fs.writeFileSync(`${temp}/serial`, '01\n');
  fs.writeFileSync(
    `${temp}/ca.cnf`,
    `[ca]
default_ca=local
[local]
database=${temp}/index
serial=${temp}/serial
new_certs_dir=${temp}
default_md=sha256
policy=subject
x509_extensions=extensions
[subject]
commonName=supplied
[extensions]
subjectAltName=DNS:localhost
basicConstraints=critical,CA:TRUE
`
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-key',
      `${temp}/server.key`,
      '-subj',
      '/CN=synthetic-winet-test',
      '-out',
      `${temp}/server.csr`,
    ],
    {stdio: 'ignore'}
  );
  execFileSync(
    'openssl',
    [
      'ca',
      '-batch',
      '-selfsign',
      '-config',
      `${temp}/ca.cnf`,
      '-keyfile',
      `${temp}/server.key`,
      '-in',
      `${temp}/server.csr`,
      '-notext',
      '-startdate',
      '20000101000000Z',
      '-enddate',
      '20000102000000Z',
      '-out',
      `${temp}/expired.crt`,
    ],
    {stdio: 'ignore'}
  );
  expired = fs.readFileSync(`${temp}/expired.crt`);
  assert.ok(
    Date.parse(new (require('node:crypto').X509Certificate)(expired).validTo) <
      Date.now(),
    'fixture must actually be expired'
  );
});
after(() => fs.rmSync(temp, {recursive: true, force: true}));
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function get(port, policy, extra = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(`https://127.0.0.1:${port}/`, {...extra, agent: policy.agent}, r => {
        if (policy.agent.options.rejectUnauthorized)
          assert.equal(
            r.socket.authorized,
            true,
            'Node must authorize certificate-supplied connections'
          );
        r.resume();
        r.on('end', () => resolve(r.statusCode));
      })
      .on('error', reject);
  });
}
function loadModule(file, overrides = {}, env = process.env) {
  const filename = path.join(__dirname, '../build/src/', file),
    localRequire = require('node:module').createRequire(filename),
    exports = {};
  require('node:vm').runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      exports,
      require: name =>
        Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
      process: {env, on() {}},
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
    {filename}
  );
  return exports;
}
function startWithSettings(json, env, dotenvText) {
  const observed = {mqtt: 0, analytics: 0, dotenvLoads: 0};
  fs.writeFileSync(`${temp}/input.env`, dotenvText);
  const overrides = {
    fs: {
      existsSync: () => json !== undefined,
      readFileSync: () => JSON.stringify(json),
    },
    dotenv: {
      config: () => {
        observed.dotenvLoads++;
        return require('dotenv').config({
          path: `${temp}/input.env`,
          processEnv: env,
        });
      },
    },
    './homeassistant': {
      hostSlug: h => h.replaceAll('.', '_'),
      MqttPublisher: class {
        constructor(logger, url) {
          observed.mqtt++;
          observed.url = url;
        }
      },
    },
    './analytics': {
      Analytics: class {
        constructor() {
          observed.analytics++;
        }
      },
    },
    './winetHandler': {
      winetHandler: class {
        constructor(...args) {
          observed.handlerPolicy = args[8];
          observed.host = args[1];
        }
        setCallback() {}
        setConnectionCallback() {}
        start() {}
      },
    },
    './getProperties': {
      getProperties(...args) {
        observed.propertiesPolicy = args[4];
        return new Promise(() => {});
      },
    },
  };
  overrides['./config'] = loadModule(
    'config.js',
    {fs: overrides.fs, dotenv: overrides.dotenv},
    env
  );
  try {
    loadModule('index.js', overrides, env);
  } catch (error) {
    observed.error = error;
  }
  return observed;
}
test('trusted certificate parsing accepts exactly one PEM certificate and no private key or malformed data', () => {
  assert.equal(decodeTrustedCertificate(undefined), undefined);
  assert.equal(decodeTrustedCertificate(''), undefined);
  assert.match(
    decodeTrustedCertificate(encoded),
    /^-----BEGIN CERTIFICATE-----/
  );
  for (const value of [
    'synthetic-private-input',
    '!!!!',
    encoded + '!',
    Buffer.concat([cert, other]).toString('base64'),
    key.toString('base64'),
    'A'.repeat(32772),
    42,
  ]) {
    assert.throws(
      () => decodeTrustedCertificate(value),
      e => e.message === 'Invalid WINET_TLS_CA_CERT_BASE64'
    );
  }
});
test('native validation is enabled only when a certificate is supplied', () => {
  for (const [ca, expected] of [
    [undefined, false],
    ['', false],
    [encoded, true],
  ]) {
    const p = new WinetTls(ca, 'localhost');
    assert.equal(p.agent.options.rejectUnauthorized, expected);
    p.agent.destroy();
  }
});
test('HTTPS accepts trusted certificate and matching name with Node authorized true', async () => {
  let requests = 0,
    serverName,
    hostHeader;
  const server = https.createServer({key, cert}, (q, r) => {
    requests++;
    serverName = q.socket.servername;
    hostHeader = q.headers.host;
    r.end('ok');
  });
  const port = await listen(server),
    policy = new WinetTls(encoded, 'localhost');
  try {
    assert.equal(await get(port, policy), 200);
    assert.equal(serverName, 'localhost');
    assert.equal(hostHeader, `127.0.0.1:${port}`);
    assert.equal(requests, 1);
  } finally {
    policy.agent.destroy();
    await close(server);
  }
});
test('missing or empty certificate permits self-signed HTTPS even with an unmatched name', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server);
  try {
    for (const ca of [undefined, '']) {
      const p = new WinetTls(ca, 'wrong.example');
      try {
        assert.equal(await get(port, p), 200);
      } finally {
        p.agent.destroy();
      }
    }
    assert.equal(requests, 2);
  } finally {
    await close(server);
  }
});
test('supplied certificate still rejects a different issuer when global validation is disabled', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server),
    p = new WinetTls(other.toString('base64'), 'localhost'),
    old = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    await assert.rejects(get(port, p));
    assert.equal(requests, 0);
  } finally {
    if (old === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = old;
    p.agent.destroy();
    await close(server);
  }
});
test('wrong trust anchor rejects the server before any HTTP request', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server),
    p = new WinetTls(other.toString('base64'), 'localhost');
  try {
    await assert.rejects(get(port, p));
    assert.equal(requests, 0);
  } finally {
    p.agent.destroy();
    await close(server);
  }
});
test('trusted certificate with wrong DNS name or unmatched connection IP is rejected', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server);
  try {
    for (const name of ['wrong.example', undefined]) {
      const p = new WinetTls(encoded, name);
      try {
        await assert.rejects(
          get(port, p),
          e => e.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
        );
      } finally {
        p.agent.destroy();
      }
    }
    assert.equal(requests, 0);
  } finally {
    await close(server);
  }
});
test('request options cannot disable native trust or hostname verification', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server),
    p = new WinetTls(encoded, 'wrong.example');
  try {
    await assert.rejects(
      get(port, p, {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      }),
      e => e.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
    );
    assert.equal(requests, 0);
  } finally {
    p.agent.destroy();
    await close(server);
  }
});
test('expired trusted certificate is rejected by native validation before HTTP', async () => {
  let requests = 0;
  const server = https.createServer({key, cert: expired}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server),
    p = new WinetTls(expired.toString('base64'), 'localhost');
  try {
    await assert.rejects(get(port, p), e => e.code === 'CERT_HAS_EXPIRED');
    assert.equal(requests, 0);
  } finally {
    p.agent.destroy();
    await close(server);
  }
});
test('getProperties forces HTTPS with explicit trust and refuses incorrect name without fallback', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end('label=example\n');
  });
  const port = await listen(server),
    good = new WinetTls(encoded, 'localhost'),
    bad = new WinetTls(encoded, 'wrong.example');
  try {
    assert.deepEqual(
      await getProperties(logger, `127.0.0.1:${port}`, 'en_US', false, good),
      {properties: {label: 'example'}, forceSsl: true}
    );
    await assert.rejects(
      getProperties(logger, `127.0.0.1:${port}`, 'en_US', false, bad),
      e => e.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
    );
    assert.equal(requests, 1);
  } finally {
    good.agent.destroy();
    bad.agent.destroy();
    await close(server);
  }
});
test('actual handler enforces configured validation and permits WSS without a certificate', async () => {
  let upgrades = 0,
    messages = 0;
  const server = https.createServer({key, cert}),
    wss = new WebSocket.Server({noServer: true});
  server.on('upgrade', (q, s, h) => {
    upgrades++;
    wss.handleUpgrade(q, s, h, ws => wss.emit('connection', ws, q));
  });
  wss.on('connection', ws =>
    ws.on('message', () => {
      messages++;
      ws.close();
    })
  );
  const port = await listen(server),
    urls = [];
  class LoopbackWebSocket {
    static OPEN = WebSocket.OPEN;
    constructor(url, options) {
      urls.push(url);
      return new WebSocket(`wss://127.0.0.1:${port}/`, options);
    }
  }
  const {winetHandler} = loadModule('winetHandler.js', {ws: LoopbackWebSocket});
  async function attempt(ca, name) {
    const p = new WinetTls(ca, name),
      handler = new winetHandler(
        {info() {}, warn() {}, error() {}},
        'synthetic.invalid',
        'en_US',
        60,
        'synthetic-user',
        'synthetic-password',
        false,
        {registerError() {}, registerReconnect() {}},
        p
      );
    try {
      handler.connect();
      await new Promise((resolve, reject) => {
        handler.ws.on('error', reject);
        handler.ws.on('close', resolve);
      });
    } finally {
      handler.clearTimers();
      clearTimeout(handler.reconnectTimer);
      handler.closeSocket();
      p.agent.destroy();
    }
  }
  try {
    await attempt(encoded, 'localhost');
    await assert.rejects(attempt(encoded, 'wrong.example'));
    await attempt(undefined, 'wrong.example');
    assert.equal(upgrades, 2);
    assert.equal(messages, 2);
    assert.deepEqual(
      urls,
      Array(3).fill('wss://synthetic.invalid:443/ws/home/overview')
    );
  } finally {
    wss.close();
    await close(server);
  }
});
test('handshake timeout fails without sending application bytes', async () => {
  const sockets = new Set(),
    server = require('node:net').createServer(s => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
  const port = await listen(server),
    p = new WinetTls(encoded, 'localhost', 50);
  try {
    await assert.rejects(get(port, p), /timeout/i);
  } finally {
    p.agent.destroy();
    for (const s of sockets) s.destroy();
    await close(server);
  }
});
test('.env trust works alongside upstream JSON configuration', () => {
  const r = startWithSettings(
    {winet_host: 'json.example', mqtt_url: 'mqtt://synthetic.invalid'},
    {WINET_HOST: 'env.example'},
    `WINET_TLS_CA_CERT_BASE64=${encoded}\nWINET_TLS_SERVER_NAME=localhost\n`
  );
  assert.ifError(r.error);
  assert.equal(r.host, 'env.example');
  assert.equal(r.url, 'mqtt://synthetic.invalid');
  assert.equal(r.dotenvLoads, 1);
  assert.equal(r.handlerPolicy.required, true);
  assert.equal(r.handlerPolicy.agent.options.rejectUnauthorized, true);
  assert.match(r.handlerPolicy.agent.options.ca, /BEGIN CERTIFICATE/);
  r.handlerPolicy.agent.destroy();
});
test('.env-only settings work and explicit environment takes precedence', () => {
  const r = startWithSettings(
    undefined,
    {WINET_TLS_CA_CERT_BASE64: encoded},
    'WINET_HOST=env.example\nMQTT_URL=mqtt://synthetic.invalid\nWINET_TLS_CA_CERT_BASE64=malformed\n'
  );
  assert.ifError(r.error);
  assert.equal(r.host, 'env.example');
  assert.equal(r.handlerPolicy.required, true);
  r.handlerPolicy.agent.destroy();
});
test('malformed trust fails before MQTT or analytics and does not echo configuration', () => {
  const r = startWithSettings(
    {winet_host: 'json.example', mqtt_url: 'mqtt://synthetic.invalid'},
    {WINET_TLS_CA_CERT_BASE64: 'synthetic-private-input'},
    ''
  );
  assert.match(r.error.message, /WINET_TLS_CA_CERT_BASE64/);
  assert.doesNotMatch(r.error.message, /synthetic-private-input/);
  assert.equal(r.mqtt, 0);
  assert.equal(r.analytics, 0);
});
test('invalid server names are rejected before network collaborators', () => {
  for (const name of [
    '127.0.0.1',
    'https://example.test',
    'bad name',
    '*.example.test',
    '-bad.test',
    'a'.repeat(254),
  ]) {
    const r = startWithSettings(
      {winet_host: 'json.example', mqtt_url: 'mqtt://synthetic.invalid'},
      {WINET_TLS_SERVER_NAME: name},
      ''
    );
    assert.match(r.error.message, /WINET_TLS_SERVER_NAME/);
    assert.equal(r.mqtt, 0);
    assert.equal(r.analytics, 0);
  }
});
test('JSON certificate settings reach the shared TLS policy before networking', () => {
  const r = startWithSettings(
    {
      winet_host: 'json.example',
      mqtt_url: 'mqtt://synthetic.invalid',
      tls_ca_cert_base64: encoded,
      tls_server_name: 'localhost',
    },
    {},
    ''
  );
  assert.ifError(r.error);
  assert.equal(r.handlerPolicy.agent.options.rejectUnauthorized, true);
  assert.equal(r.handlerPolicy.agent.options.servername, 'localhost');
  assert.equal(r.dotenvLoads, 1);
  r.handlerPolicy.agent.destroy();
});
test('malformed JSON certificate fails before creating network collaborators', () => {
  const r = startWithSettings(
    {
      winet_host: 'json.example',
      mqtt_url: 'mqtt://synthetic.invalid',
      tls_ca_cert_base64: 'synthetic-private-input',
    },
    {},
    ''
  );
  assert.match(r.error.message, /WINET_TLS_CA_CERT_BASE64/);
  assert.doesNotMatch(r.error.message, /synthetic-private-input/);
  assert.equal(r.mqtt, 0);
  assert.equal(r.analytics, 0);
});
test('TLS 1.3 is negotiated with native authorization when supported by the server', async () => {
  let protocol;
  const server = https.createServer(
    {key, cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3'},
    (q, r) => {
      protocol = q.socket.getProtocol();
      r.end('ok');
    }
  );
  const port = await listen(server),
    p = new WinetTls(encoded, 'localhost');
  try {
    assert.equal(await get(port, p), 200);
    assert.equal(protocol, 'TLSv1.3');
  } finally {
    p.agent.destroy();
    await close(server);
  }
});

const {readRegisters, RegisterReadError} = require('../build/src/registers');
const device = {dev_id: 1, dev_type: 44, dev_code: 1, dev_sn: 'SYNTHETIC'};
test('register HTTPS uses native trust and fresh sockets for each read', async () => {
  const sockets = new Set();
  let requests = 0;
  const server = https.createServer({key, cert}, (q, r) => {
    requests++;
    sockets.add(q.socket);
    assert.equal(q.headers.connection, 'close');
    assert.equal(q.socket.servername, 'localhost');
    const u = new URL(q.url, 'https://localhost');
    assert.equal(u.pathname, '/device/getParam');
    assert.equal(u.searchParams.get('token'), 'synthetic-token');
    assert.equal(u.searchParams.get('param_type'), '0');
    r.end(
      JSON.stringify({
        result_code: 1,
        result_data: {param_value: '00 01 00 02'},
      })
    );
  });
  const port = await listen(server),
    p = new WinetTls(encoded, 'localhost');
  try {
    const conn = {
      host: `127.0.0.1:${port}`,
      ssl: false,
      lang: 'en_US',
      token: 'synthetic-token',
      tlsPolicy: p,
    };
    for (let i = 0; i < 2; i++)
      assert.deepEqual(
        await readRegisters(conn, device, {
          addr: 10757,
          count: 2,
          type: 'input',
        }),
        [1, 2]
      );
    assert.equal(requests, 2);
    assert.equal(sockets.size, 2);
    assert.equal(p.agent.options.keepAlive, false);
  } finally {
    p.agent.destroy();
    await close(server);
  }
});
test('register HTTPS rejects wrong certificate and hostname before exposing the session token', async () => {
  let requests = 0;
  const server = https.createServer({key, cert}, (_, r) => {
    requests++;
    r.end();
  });
  const port = await listen(server);
  try {
    for (const [ca, name] of [
      [other.toString('base64'), 'localhost'],
      [encoded, 'wrong.example'],
    ]) {
      const p = new WinetTls(ca, name);
      try {
        await assert.rejects(
          readRegisters(
            {
              host: `127.0.0.1:${port}`,
              ssl: false,
              lang: 'en_US',
              token: 'synthetic-token',
              tlsPolicy: p,
            },
            device,
            {addr: 1, count: 1, type: 'input'}
          ),
          e => e instanceof RegisterReadError && e.reason.startsWith('network:')
        );
      } finally {
        p.agent.destroy();
      }
    }
    assert.equal(requests, 0);
  } finally {
    await close(server);
  }
});
test('register HTTPS remains compatible without a supplied certificate', async () => {
  const server = https.createServer({key, cert}, (_, r) =>
    r.end(JSON.stringify({result_code: 1, result_data: {param_value: '00 00'}}))
  );
  const port = await listen(server),
    p = new WinetTls(undefined, 'wrong.example');
  try {
    assert.deepEqual(
      await readRegisters(
        {
          host: `127.0.0.1:${port}`,
          ssl: true,
          lang: 'en_US',
          token: 'synthetic-token',
          tlsPolicy: p,
        },
        device,
        {addr: 1, count: 1, type: 'input'}
      ),
      [0]
    );
  } finally {
    p.agent.destroy();
    await close(server);
  }
});
test('actual register polling passes the shared TLS policy and retains failure lockout', async () => {
  const real = require('../build/src/registers'),
    {RegisterBlocks} = require('../build/src/types/RegisterBlocks');
  const p = new WinetTls(encoded, 'localhost');
  let calls = 0;
  const {winetHandler} = loadModule('winetHandler.js', {
    './registers': {
      ...real,
      readRegisters: async conn => {
        calls++;
        assert.equal(conn.tlsPolicy, p);
        throw new real.RegisterReadError('winet:0', 'synthetic refusal');
      },
    },
  });
  const handler = new winetHandler(
    {info() {}, warn() {}, error() {}},
    'synthetic.invalid',
    'en_US',
    60,
    'synthetic-user',
    'synthetic-password',
    false,
    {registerBlockResult() {}},
    p
  );
  const poll = {device, block: RegisterBlocks[0]};
  try {
    await handler.pollRegisterBlocks([poll]);
    assert.equal(calls, 1);
    assert.equal(handler.blockLockout.get('sbr_cells:SYNTHETIC'), 'winet:0');
    assert.equal(handler.registerPollActive, false);
  } finally {
    handler.clearTimers();
    p.agent.destroy();
  }
});
test('actual handler startup uses the same policy for properties and WSS', async () => {
  const p = new WinetTls(encoded, 'localhost');
  let propertyPolicy,
    connected = false;
  const {winetHandler} = loadModule('winetHandler.js', {
    './getProperties': {
      getProperties: async (...args) => {
        propertyPolicy = args[4];
        return {properties: {}, forceSsl: true};
      },
    },
  });
  const handler = new winetHandler(
    {info() {}, warn() {}, error() {}},
    'synthetic.invalid',
    'en_US',
    60,
    'synthetic-user',
    'synthetic-password',
    false,
    {},
    p
  );
  handler.connect = () => {
    connected = true;
    assert.equal(handler.tlsPolicy, p);
    assert.equal(handler.ssl, true);
  };
  try {
    handler.start();
    await new Promise(r => setImmediate(r));
    assert.equal(propertyPolicy, p);
    assert.equal(connected, true);
  } finally {
    handler.clearTimers();
    p.agent.destroy();
  }
});

test('HTTP-to-HTTPS discovery retains the same TLS policy', async () => {
  const {EventEmitter} = require('node:events'),
    p = new WinetTls();
  let usedAgent;
  const {getProperties: discover} = loadModule('getProperties.js', {
    http: {
      get() {
        const q = new EventEmitter();
        queueMicrotask(() => q.emit('error', Error('TLS required')));
        return q;
      },
    },
    https: {
      get(url, options, callback) {
        usedAgent = options.agent;
        const q = new EventEmitter(),
          r = new EventEmitter();
        queueMicrotask(() => {
          callback(r);
          r.emit('data', 'key=value\n');
          r.emit('end');
        });
        return q;
      },
    },
  });
  try {
    const result = await discover(
      {warn() {}},
      'synthetic.invalid',
      'en_US',
      false,
      p
    );
    assert.equal(usedAgent, p.agent);
    assert.equal(result.forceSsl, true);
    assert.equal(result.properties.key, 'value');
  } finally {
    p.agent.destroy();
  }
});
