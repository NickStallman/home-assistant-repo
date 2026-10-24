// Session handling against a simulated WiNet: the dongle logs sessions out
// after a while (notice 103) and drops other clients when a new one connects
// (notice 100). Uses the compiled handler, so `npm run compile` first (npm
// test does).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {WebSocketServer} = require('ws');
const Winston = require('winston');
const Transport = require('winston-transport');
const {winetHandler} = require('../build/src/winetHandler');
const {Analytics} = require('../build/src/analytics');

const PORT = 8082; // the handler's plain-websocket port
const POLL = 1; // seconds

class Capture extends Transport {
  constructor() {
    super();
    this.lines = [];
  }
  log(info, next) {
    this.lines.push(`${info.level}: ${info.message}`);
    next();
  }
}

// Minimal WiNet: connect/login/devicelist/real/direct, session tokens, pushes
function startMock() {
  const http = require('node:http');
  const server = http.createServer();
  const wss = new WebSocketServer({server});
  const mock = {
    wss,
    sockets: [],
    logins: 0,
    requests: [],
    token: null,
    nextToken: 1,
    // Drop every new client straight away, like a WiNet another client owns
    evictOnConnect: false,
    close: () => {
      for (const ws of mock.sockets) ws.terminate();
      wss.close();
      server.closeAllConnections();
      server.close();
      // Don't let a lingering connection hold the test process open
      server.unref();
    },
    current: () => mock.sockets[mock.sockets.length - 1],
    push: obj => mock.current().send(JSON.stringify(obj)),
    // Simulate the session timer: notice 103 and the token is gone
    expireSession() {
      mock.token = null;
      mock.push({result_code: 103, result_msg: 'login timeout', result_data: {service: 'notice'}});
    },
    // Another client connected: notice 100 and the socket is closed
    evict() {
      mock.push({result_code: 100, result_msg: 'normal user limit', result_data: {service: 'notice'}});
      mock.current().close();
    },
  };
  wss.on('connection', ws => {
    mock.sockets.push(ws);
    if (mock.evictOnConnect) {
      mock.evictOnConnect = false;
      ws.send(JSON.stringify({result_code: 100, result_msg: 'normal user limit', result_data: {service: 'notice'}}));
      ws.close();
      return;
    }
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      mock.requests.push(msg);
      const reply = (code, data, msgText) =>
        ws.send(JSON.stringify({result_code: code, result_msg: msgText ?? (code === 1 ? 'success' : 'I18N_COMMON_INTER_ABNORMAL'), result_data: {service: msg.service, ...data}}));
      switch (msg.service) {
        case 'connect':
          mock.token = `t${mock.nextToken++}`;
          return reply(1, {token: mock.token, uid: 1, ip: '127.0.0.1', forceModifyPasswd: 0});
        case 'login':
          mock.logins++;
          mock.token = `t${mock.nextToken++}`;
          return reply(1, {token: mock.token, uid: 1, role: 2});
        default:
          if (msg.token !== mock.token) return reply(120, {});
      }
      switch (msg.service) {
        case 'devicelist':
          return reply(1, {count: 1, list: [{id: 1, dev_id: 1, dev_code: 3344, dev_type: 0, dev_procotol: 1, inv_type: 0, dev_sn: 'A1234567890', dev_name: 'SG5.0RS', dev_model: 'SG5.0RS', port_name: 'COM1', phys_addr: '1', logc_addr: '1', link_status: 1, init_status: 1, dev_special: '0'}]});
        case 'real':
          return reply(1, {count: 1, list: [{data_name: 'I18N_COMMON_TOTAL_ACTIVE_POWER', data_value: '1.5', data_unit: 'kW'}]});
        case 'direct':
          return reply(1, {count: 2, list: [{name: 'MPPT1', voltage: '300.0', voltage_unit: 'V', current: '2.0', current_unit: 'A'}, {name: 'I18N_COMMON_GROUP_BUNCH_TITLE_AND%@1', voltage: '--'}]});
      }
    });
  });
  return new Promise(r => server.listen(PORT, '127.0.0.1', () => r(mock)));
}

function makeHandler(capture) {
  const logger = Winston.createLogger({level: 'info', transports: [capture]});
  const handler = new winetHandler(logger, '127.0.0.1', 'en_US', POLL, 'admin', 'pw8888', false, new Analytics(false, 'test'));
  const cycles = [];
  handler.setCallback((h, devices, status) => cycles.push(JSON.parse(JSON.stringify(status))));
  return {handler, cycles};
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};

// The handler's plain-websocket port is fixed, so skip if something else has it
async function portFree() {
  const net = require('node:net');
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(PORT, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function setup(t) {
  if (!(await portFree())) {
    t.skip(`port ${PORT} in use`);
    return undefined;
  }
  const mock = await startMock();
  const capture = new Capture();
  const {handler, cycles} = makeHandler(capture);
  t.after(() => {
    handler.reconnect = () => {};
    clearTimeout(handler.reconnectTimer);
    handler.clearTimers();
    handler.closeSocket();
    mock.close();
  });
  return {mock, capture, handler, cycles};
}

test('session timeout: logs in again on the same socket, no reconnect', async t => {
  const env = await setup(t);
  if (!env) return;
  const {mock, capture, handler, cycles} = env;

  handler.connect();
  assert.ok(await until(() => cycles.length >= 1), 'first poll cycle completed');
  assert.equal(mock.logins, 1);
  const reqsBefore = mock.requests.length;

  mock.expireSession();
  assert.ok(await until(() => mock.logins === 2), 'logged in again after notice 103');
  assert.ok(await until(() => cycles.length >= 3), 'polling continued after the new login');
  assert.equal(mock.sockets.length, 1, 'same websocket was kept');
  assert.ok(mock.requests.slice(reqsBefore).some(r => r.service === 'real' && r.token === mock.token), 'later requests use the new token');
  assert.ok(!capture.lines.some(l => /Reconnecting/.test(l)), `no reconnect: ${capture.lines.join('\n')}`);
  assert.ok(capture.lines.some(l => /session timed out, logging in again/.test(l)));
  // The direct reply had a string with no value or unit and still parsed
  const last = cycles[cycles.length - 1].A1234567890;
  assert.equal(last.mppt1_voltage.value, 300);
  assert.equal(last.mppt1_voltage.unit, 'V');
  const string1 = Object.keys(last).find(k => k.includes('bunch_title') && k.endsWith('_voltage'));
  assert.ok(string1, 'string 1 voltage entity exists');
  assert.equal(last[string1].value, undefined);
});

test('token rejected while a request is in flight: one re-login, no reconnect', async t => {
  const env = await setup(t);
  if (!env) return;
  const {mock, capture, handler, cycles} = env;

  handler.connect();
  assert.ok(await until(() => cycles.length >= 1));
  // Token silently gone (no notice): the next request is answered with 120
  mock.token = null;
  assert.ok(await until(() => mock.logins === 2), 're-login after a 120 reply');
  assert.ok(await until(() => cycles.length >= 3), 'polling continued');
  assert.equal(mock.sockets.length, 1);
  assert.equal(mock.logins, 2, 'exactly one re-login');
  assert.ok(!capture.lines.some(l => /Reconnecting/.test(l)), capture.lines.join('\n'));
});

test('evicted by another client: backoff grows until a full cycle completes', async t => {
  const env = await setup(t);
  if (!env) return;
  const {mock, capture, handler, cycles} = env;

  handler.connect();
  assert.ok(await until(() => cycles.length >= 1));
  mock.evict();
  // Evict again the moment it reconnects, before a cycle can complete
  mock.evictOnConnect = true;
  assert.ok(await until(() => mock.sockets.length === 2, 10000), 'reconnected after the first eviction');
  assert.ok(await until(() => mock.sockets.length === 3, 15000), 'reconnected after the second eviction');
  const delays = capture.lines.filter(l => /Reconnecting in/.test(l)).map(l => Number(/in (\d+)s/.exec(l)[1]));
  assert.deepEqual(delays, [POLL * 3, POLL * 6], `delays doubled: ${capture.lines.join('\n')}`);
  assert.ok(capture.lines.some(l => /Another client connected to the WiNet/.test(l)));
  // A full cycle resets the backoff
  const before = cycles.length;
  assert.ok(await until(() => cycles.length > before, 10000));
  assert.equal(handler.reconnectAttempts, 0);
});

test('analytics: a repeating error is sent once, then hourly with a count', () => {
  const analytics = new Analytics(true, 'test');
  const sent = [];
  analytics.posthog = {capture: e => sent.push(e)};
  analytics.id = 'install';
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    for (let i = 0; i < 5; i++) analytics.registerError('websocket_onError', 'connect EHOSTUNREACH');
    analytics.registerError('websocket_onError', 'other');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].properties.count, 1);
    now += 61 * 60 * 1000;
    analytics.registerError('websocket_onError', 'connect EHOSTUNREACH');
    assert.equal(sent.length, 3);
    assert.equal(sent[2].properties.count, 5, 'four suppressed plus this one');
  } finally {
    Date.now = realNow;
  }
});
