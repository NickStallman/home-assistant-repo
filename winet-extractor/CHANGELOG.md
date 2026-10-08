### 0.4.0

- **Battery cell voltages and module temperatures.** SBR battery stacks now report the highest and lowest cell voltage (and which module and cell it is), the spread between them, the highest and lowest cell voltage of every module, and the highest and lowest module temperature. Every stack the WiNet lists gets its own set
- These values are read from the WiNet over HTTP every 5 minutes rather than with the live data, so they update less often than the other sensors
- Added a general way to read extra device registers through the WiNet, so more values can be added later
- Fixed the Supervisor warnings about a deprecated `config` folder mapping, deprecated `armhf`/`armv7` architectures and `build.yaml` (#88). The addon never used the Home Assistant config folder, so it is no longer mounted
- 32-bit Home Assistant installs (`armhf`, `armv7`) are no longer offered new versions, as Home Assistant itself has dropped them. Standalone Docker on 32-bit systems still builds from the last available base image
- The addon is now built on Alpine 3.22 (Node.js 22)

### 0.3.0

- **Multiple WiNet support.** Enter several hosts in `winet_host` separated by commas (they share the username/password), or add WiNets with their own credentials under `additional_winets`. Existing configurations keep working unchanged and no entities are renamed (#9)
- New "WiNet Site" device that adds PV power and yield across all inverters (can be turned off with `site_totals`)
- Entities go unavailable when the addon stops or a WiNet is disconnected
- Discovery is re-sent when Home Assistant or the MQTT broker restarts, and new sensors no longer show "unknown" until their value changes
- Fixed the MQTT prefix becoming `undefined` for installs that predate the `mqtt_prefix` option (#74)
- Fixed the analytics opt-out being ignored. Thanks @maxkpower (#84)
- Fixed devices that omit units (e.g. Sungrow EV chargers) causing a reconnect loop, a bad reply from one device no longer disconnects the others. Thanks @ihatethecloud (#78, #79)
- Fixed template warnings and `state_class` errors for text sensors and sensors reporting `--` (#73, #80, #81). These fixes were in the code previously but never released as a new version
- Sensors in `h` and `Wh` (e.g. on-grid operating time, EV charger energy) are now published
- Power factor is published as a number, `%` sensors are only tagged as battery level for SOC sensors, `VA` sensors use the apparent power device class
- Removed the empty "device" sensor that older versions created for each device
- Fixed a failed login crashing the addon, reconnect timers stacking up, and memory growth while the MQTT broker is down (#59)
- Unsupported devices are logged with their device type to help add support (#85)
- WiNet password fields are now masked in the configuration UI

### 0.2.2

- Improved SH15T support with multiple paralleled strings
- Tweak power_factor unit

### 0.2.1

- Improved retry mechanism

### 0.2.0

- Handling of new Winet-S2 firmware which forces SSL. It will autodetect however if you know you have the newer firmware it's best to tick the new SSL checkbox.

### 0.1.9

- Improved running in standalone mode

### 0.1.8

- Handle an error where the websocket connection fails to reconnect
- Add anonymous analytics to help survey device compatibility and errors

### 0.1.7

- Filter the inverter name for inverters like SH8.0RT. Full stops are not valid in MQTT for autodiscovery

### 0.1.6

- Further support for old Winet-S devices (separate from Winet-S2)
- Reduced the minimum poll frequency

### 0.1.5

- Possibly add support for older Winet dongles

### 0.1.4

- Improved detection of hanging
- Added poll interval parameter, defaulting to 10 seconds which should work well in most cases

### 0.1.3

- Handle "Internal Error" from the Winet correctly, which was causing it to hang previously.
- Set state_class to "total_increasing" for all kWh values
- Tweaked MQTT so the entitity configuration would be retained by MQTT, which helps with Home Assistant restarts.
- Improved MQTT error handling
- Improved documentation

### 0.1.2

- Newer Winet firmware enforces authentication, and this involves using a updated token after authentication is done.
- Detection for firmware differences to assist with debugging.

### 0.1.1

- Improved logging
- Added Winet user/pass parameters in case the default has been changed

### 0.1.0

- Initial Release
