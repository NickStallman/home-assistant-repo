const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const configModule = path.resolve(__dirname, '../build/src/config.js');
const fileOptions = {
  winet_host: 'json.example',
  mqtt_url: 'mqtt://json.example',
  mqtt_prefix: 'json-prefix',
  winet_user: 'json-user',
  winet_pass: 'synthetic-json-password',
  poll_interval: 30,
  analytics: false,
  ssl: true,
  site_totals: false,
  additional_winets: [{host: 'extra.example', user: 'extra-user'}],
};

// Each invocation has its own cwd and environment, including dotenv's cache/state.
function load({json, env = {}, dotenv = ''} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winet-config-test-'));
  try {
    const options = path.join(dir, 'options.json');
    if (json !== undefined) fs.writeFileSync(options, JSON.stringify(json));
    fs.writeFileSync(path.join(dir, '.env'), dotenv);
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `try {
          const config = require(${JSON.stringify(configModule)}).loadConfig(process.argv[1]);
          process.stdout.write(JSON.stringify(config));
        } catch (error) {
          process.stderr.write(error.message);
          process.exitCode = 1;
        }`,
        options,
      ],
      {cwd: dir, env: {...env}, encoding: 'utf8', timeout: 10000}
    );
    assert.ifError(result.error);
    return result.status === 0
      ? JSON.parse(result.stdout)
      : {error: result.stderr, status: result.status};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test('JSON-only configuration retains all options and additional WiNets', () => {
  const config = load({json: fileOptions});
  assert.equal(config.mqttUrl, fileOptions.mqtt_url);
  assert.equal(config.mqttPrefix, 'json-prefix');
  assert.equal(config.pollInterval, 30);
  assert.equal(config.analytics, false);
  assert.equal(config.siteTotals, false);
  assert.deepEqual(config.winets, [
    {host: 'json.example', user: 'json-user', pass: 'synthetic-json-password', ssl: true},
    {host: 'extra.example', user: 'extra-user', pass: 'synthetic-json-password', ssl: true},
  ]);
});

test('environment-only configuration uses existing defaults', () => {
  const config = load({env: {WINET_HOST: 'env.example', MQTT_URL: 'mqtt://env.example'}});
  assert.equal(config.winets[0].host, 'env.example');
  assert.equal(config.winets[0].ssl, false);
  assert.equal(config.mqttPrefix, 'homeassistant');
  assert.equal(config.pollInterval, 10);
  assert.equal(config.analytics, true);
  assert.equal(config.siteTotals, true);
});

test('supplied environment overrides JSON without dropping additional WiNets', () => {
  const config = load({
    json: fileOptions,
    env: {
      WINET_HOST: 'env.example; second.example',
      MQTT_URL: 'mqtt://env.example',
      MQTT_PREFIX: 'env-prefix',
      WINET_USER: 'env-user',
      WINET_PASS: 'synthetic-env-password',
      POLL_INTERVAL: '45',
      ANALYTICS: 'true',
      SSL: 'false',
      SITE_TOTALS: 'true',
    },
  });
  assert.equal(config.mqttUrl, 'mqtt://env.example');
  assert.equal(config.mqttPrefix, 'env-prefix');
  assert.equal(config.pollInterval, 45);
  assert.equal(config.analytics, true);
  assert.equal(config.siteTotals, true);
  assert.deepEqual(config.winets, [
    {host: 'env.example', user: 'env-user', pass: 'synthetic-env-password', ssl: false},
    {host: 'second.example', user: 'env-user', pass: 'synthetic-env-password', ssl: false},
    {host: 'extra.example', user: 'extra-user', pass: 'synthetic-env-password', ssl: false},
  ]);
});

test('absent environment settings do not overwrite JSON with defaults', () => {
  const config = load({json: fileOptions, env: {MQTT_PREFIX: 'override'}});
  assert.equal(config.mqttPrefix, 'override');
  assert.equal(config.winets[0].ssl, true);
  assert.equal(config.analytics, false);
  assert.equal(config.siteTotals, false);
  assert.equal(config.pollInterval, 30);
  assert.equal(config.mqttUrl, 'mqtt://json.example');
});

test('dotenv works with JSON, with actual environment taking priority', () => {
  const config = load({
    json: fileOptions,
    dotenv: 'WINET_HOST=dotenv.example\nMQTT_PREFIX=dotenv-prefix\nPOLL_INTERVAL=25\n',
    env: {WINET_HOST: 'env.example'},
  });
  assert.equal(config.winets[0].host, 'env.example');
  assert.equal(config.mqttPrefix, 'dotenv-prefix');
  assert.equal(config.pollInterval, 25);
  assert.equal(config.mqttUrl, fileOptions.mqtt_url);
});

test('dotenv-only mode remains supported', () => {
  const config = load({dotenv: 'WINET_HOST=dotenv.example\nMQTT_URL=mqtt://dotenv.example\n'});
  assert.equal(config.winets[0].host, 'dotenv.example');
  assert.equal(config.mqttUrl, 'mqtt://dotenv.example');
});

for (const value of ['false', '0', 'no', 'off', ' FALSE ']) {
  test(`explicit boolean ${JSON.stringify(value)} overrides true JSON settings`, () => {
    const config = load({
      json: {...fileOptions, analytics: true, ssl: true, site_totals: true},
      env: {ANALYTICS: value, SSL: value, SITE_TOTALS: value},
    });
    assert.equal(config.analytics, false);
    assert.equal(config.winets[0].ssl, false);
    assert.equal(config.siteTotals, false);
  });
}

test('empty optional boolean environment settings leave JSON values intact', () => {
  const config = load({
    json: fileOptions,
    env: {ANALYTICS: '', SSL: '', SITE_TOTALS: ''},
  });
  assert.equal(config.analytics, false);
  assert.equal(config.winets[0].ssl, true);
  assert.equal(config.siteTotals, false);
});

test('an explicitly empty required host fails rather than silently using JSON', () => {
  const config = load({json: {...fileOptions, additional_winets: []}, env: {WINET_HOST: ''}});
  assert.match(config.error, /No WiNet host/);
});

test('invalid boolean fails without echoing its value', () => {
  const config = load({json: fileOptions, env: {SSL: 'synthetic-private-input'}});
  assert.match(config.error, /Invalid SSL/);
  assert.doesNotMatch(config.error, /synthetic-private-input/);
});
