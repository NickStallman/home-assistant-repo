### 0.5.0

- **Far fewer reconnects.** The WiNet logs every session out about 10 minutes after login no matter how busy it is, which showed up as "WiNet disconnect: Internal Error" and a reconnect roughly every 11 minutes on most WiNet-S2s. The addon now logs in again on the same connection ("WiNet session timed out, logging in again"), so data keeps flowing and entities never blip
- When another client takes over the WiNet (its web interface, the iSolarCloud app on your network, another integration or a second copy of this addon) the log now says so, and the addon waits longer between attempts rather than fighting over the connection every 30 seconds. The WiNet only allows one client at a time, and that includes the addon itself: its reconnects log out the web interface too
- WiNets that only accept secure connections are detected reliably. Some installs looped on "connect ECONNREFUSED ...:8082" because the WiNet answered the plain HTTP check but only serves the websocket over SSL. If one scheme doesn't connect the addon now tries the other
- A device that can't answer one type of query no longer disconnects everything; the addon logs it once per cycle and carries on with the other values
- MPPT string data from inverters that leave out a value or unit for unused strings (seen on SG15RT, SG50RT, SG10RT and SH50RT) is accepted instead of being logged as invalid every 10 seconds
- The WiNet's own status broadcasts are no longer logged as unknown messages, and a device-list broadcast no longer interrupts a running poll cycle
- Battery cell reads that the WiNet refuses with "Readback failed" (code 301) are retried a few times before the sensors are turned off, as the cause is usually a stack that's temporarily off line
- Settings can be overridden with environment variables (`WINET_HOST`, `MQTT_URL`, ...), handy for standalone Docker. Thanks @theaussiepom (#93)
- Updated dependencies, and a smaller image that no longer ships the build tools (#95, #97). Thanks @theaussiepom
- Session tokens are never written to the log
- Anonymous analytics report a repeating error once, then at most once an hour with a count, and every reconnect now carries its cause
- A small test suite with a simulated WiNet covers session timeouts, reconnect backoff and the new schemas (`npm test`)

### 0.4.1

- Fixed battery cell reads failing every other time on some WiNets ("socket hang up"). The addon reused a connection the WiNet had already closed, it now opens a new one for each read
- A failed battery cell read no longer causes reconnects. If the WiNet refuses the read or returns something unusable for a battery, the cell sensors for that battery are turned off until the addon restarts and the log says why. A network glitch is retried at the next reading and turns them off after three in a row. The other sensors are not affected
- Reconnecting no longer triggers an extra battery read, and a slow read can no longer trip the "no data received" watchdog
- Cell readings that don't look like cell voltages are not published, in case a battery model uses a different layout
- The addon version is shown in the log at startup and included in the anonymous analytics, along with the reason when a battery read fails

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
