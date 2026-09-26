# Troubleshooting Guide

This guide covers common issues encountered with the WiNet Extractor addon, based on patterns from community reports.

## Table of Contents

- [MQTT Connection Issues](#mqtt-connection-issues)
- [WiNet Connection Issues](#winet-connection-issues)
- [Missing or Unknown Sensor Values](#missing-or-unknown-sensor-values)
- [Home Assistant Warnings and Errors](#home-assistant-warnings-and-errors)
- [Device Compatibility](#device-compatibility)
- [Stability Issues](#stability-issues)
- [System Limitations](#system-limitations)

---

## MQTT Connection Issues

### "Connection refused: Not authorized"

**Symptoms:**
```
error: MQTT error: ErrorWithReasonCode: Connection refused: Not authorized
```

**Causes & Solutions:**

1. **Wrong MQTT URL format** - The correct format is:
   ```
   mqtt://<username>:<password>@<host>
   ```
   Example: `mqtt://mqttuser:mypassword@192.168.1.100`

2. **Special characters in password** - If your password contains symbols like `#`, `@`, `!`, URL-encode them. Use an online tool like [urlencoder.org](https://www.urlencoder.org/):
   - `#` becomes `%23`
   - `@` becomes `%40`
   - Example: `mqtt://user:pass%23word@192.168.1.100`

3. **Wrong host IP** - Don't use `127.0.0.1` or `localhost`. The addon runs in Docker with virtualized networking. Use your actual LAN IP address of the MQTT broker.

### "MQTT error: AggregateError"

**Cause:** Usually indicates the MQTT broker is unreachable or misconfigured.

**Solutions:**
- Verify Mosquitto broker is running and accessible
- Check the MQTT broker IP address is correct
- Test connection with MQTT Explorer from your PC first
- Ensure the username/password are correct for your MQTT broker

### "connect ECONNREFUSED"

**Symptoms:**
```
error: MQTT error: Error: connect ECONNREFUSED 192.168.1.x:1883
```

**Solutions:**
- Confirm Mosquitto addon is installed and running in Home Assistant
- Verify the IP address and port are correct
- If using anonymous MQTT, try `mqtt://hostname` without credentials

---

## WiNet Connection Issues

### "Unexpected server response: 400"

**Symptoms:**
```
error: Websocket error: Unexpected server response: 400
```

**Cause:** Newer WiNet-S2 firmware requires SSL/HTTPS connections.

**Solutions:**
1. Set `ssl: true` in your addon configuration
2. Update to addon version 0.2.0 or later which auto-detects SSL requirements
3. Verify you're on the latest WiNet firmware

### "read ECONNRESET" or "connect ETIMEDOUT"

**Symptoms:**
```
error: Websocket error: read ECONNRESET
error: Websocket error: connect ETIMEDOUT
```

**Causes & Solutions:**

1. **Unstable WiFi** - This addon maintains a persistent WebSocket connection. Spotty WiFi will cause disconnects. Consider using Ethernet if possible.

2. **WiNet overloaded** - The dongle is CPU-limited. If running Modbus queries simultaneously, reduce the frequency.

3. **Reboot the WiNet** - Use iSolarCloud app: Settings > Configuration Parameters > Remote Device Restart

4. **Network issues** - Try accessing `https://<winet-ip>` in your browser. If that fails, it's not the addon.

### "Watchdog triggered" / "Reconnecting in Ns"

**Symptoms:**
```
warn: [192.168.1.100] Watchdog triggered, no data received. Reconnecting in 30s
```

**Explanation:** The watchdog detects stalled connections and triggers reconnection. This is normal if it happens occasionally, but frequent triggers indicate connectivity problems. From 0.3.0 repeated failures back off exponentially (up to 5 minutes) and the WiNet's entities are marked unavailable until it reconnects. With multiple WiNets, only the affected WiNet reconnects.

**Solutions:**
- Check WiFi signal strength to the WiNet
- Addon version 0.2.1+ includes improved retry logic
- Reduce poll_interval to give the dongle more breathing room

### "I18N_COMMON_USR_ACCOUNT_LOCK"

**Symptoms:**
```
error: Invalid login message: { result_code: 114, result_msg: 'I18N_COMMON_USR_ACCOUNT_LOCK' }
```

**Cause:** Too many failed login attempts locked the account. From 0.3.0 a failed login no longer crashes the addon; it retries with an increasing delay, which also avoids hammering the lock.

**Solutions:**
1. Wait ~30 minutes for the lock to expire
2. Verify username and password are correct (default: `admin` / `pw8888`)
3. Reboot the WiNet module via iSolarCloud app

### "Skipping unsupported device"

**Symptoms:**
```
info: [192.168.1.100] Skipping unsupported device: XYZ(COM1-001) (A1234567890, dev_type 99)
```

**Cause:** The WiNet reported a device type the addon doesn't know how to query yet (e.g. some smart meters). Please open an issue with this log line and whether the device's values are visible in the WiNet web interface.

### "Invalid realtime message for <device>"

**Cause:** One device returned data the addon couldn't parse (previously this happened with Sungrow EV chargers). From 0.3.0 the addon logs the details and carries on polling the other devices instead of reconnecting. Please open an issue with the logged `errors`.

### "Invalid devicelist message" or "Invalid connect message"

**Cause:** Firmware incompatibility between the addon and your WiNet version.

**Solutions:**
- Update to the latest addon version
- Update WiNet firmware if available
- Check if you have older WiNet-S vs newer WiNet-S2

---

## Missing or Unknown Sensor Values

### Operating Status / Device Status shows "Unknown"

**Common affected sensors:**
- `operating_status`
- `device_status`
- `battery_operation_status`

**Causes & Solutions:**

1. **Text sensor classification** - Some status fields are text-based, not numeric. Recent addon versions (0.2.2+) handle these better. Update your addon.

2. **MQTT topic stuck** - Stop the addon, use MQTT Explorer to delete the affected sensor topics under `homeassistant/sensor/<device>/`, then restart the addon.

3. **Firmware renaming** - Sungrow occasionally renames fields in firmware updates. Check if a new sensor appeared with a similar name. See [Entities renamed after a WiNet firmware update](#entities-renamed-after-a-winet-firmware-update).

### Entities renamed after a WiNet firmware update

**Symptoms:** Sensors like `running_status`, `energy_purchasing_power`, `total_export_active_power` or `total_ac_output_energy` stopped updating and new ones appeared, e.g. `operating_status`, `grid_energy_purchasing_power`, `total_feed_in_active_power`, `total_yield_from_ac_output_side`.

**Cause:** Sensor names (and therefore entity IDs) come from the WiNet's own translation file. When a firmware update renames a value in the WiNet web interface, Home Assistant sees it as a new sensor.

**Fix (keeps your history):**
1. Settings > Devices & services > Entities, find the **old** entity and delete it (or rename its entity ID to something like `..._old`)
2. Open the **new** entity and change its entity ID to the old one (e.g. `sensor.sh10rs_serial_running_status`)
3. Long term statistics follow the entity ID, so your history and Energy dashboard carry on. Update any automations that relied on the old status text, as the values may have changed too.

### Discovery prefix shows as "undefined"

**Symptoms:** All entities stop updating after an update or rebuild; MQTT Explorer shows topics under `undefined/sensor/...`.

**Cause:** Installs created before the `mqtt_prefix` option existed didn't have it saved. Fixed in 0.3.0, which defaults to `homeassistant`. Clean up the stray `undefined/#` topics in MQTT Explorer.

### Grid/Meter values missing

**Symptoms:** Cannot see purchased_power, feed_in_energy, export power, etc.

**Important:** This addon can only show data that appears in the WiNet web interface.

**Diagnostic steps:**
1. Stop the addon
2. Log in to `https://<winet-ip>` directly
3. Check if the values appear under "Realtime Values" or "DC Info"
4. If not visible there, the addon cannot retrieve them

**Common sensor name mappings:**
| What you want | Actual sensor name |
|---------------|-------------------|
| Grid import power | `purchased_power` |
| Grid export power | `total_export_active_power` |
| Household usage | `total_load_active_power` |
| Daily export | `daily_feed_in_energy` or `total_feed_in_active_power` |

**Note:** Different inverter models expose different values. SG series (solar-only) may not have the same sensors as SH series (hybrid with battery).

### Calculating missing energy values

If power sensors exist but energy sensors don't, create Home Assistant helpers using the Riemann sum integral integration:

```yaml
# configuration.yaml
sensor:
  - platform: integration
    source: sensor.sh10rs_SERIAL_purchased_power
    name: "Grid Import Energy"
    unit_prefix: k
    round: 2
```

---

## Home Assistant Warnings and Errors

### "dict object has no attribute 'value'"

**Symptoms:**
```
Template variable warning: 'dict object' has no attribute 'value' when rendering '{{ value_json.value }}'
```

**Cause:** Versions before 0.3.0 published a state without a `value` for sensors the WiNet reports as `--` (e.g. unused backup port phases). Note that 0.2.2 was updated in place without a version bump, so many installs never received that fix.

**Solutions:**
- Update to 0.3.0 or later
- If warnings persist, check your own templates/automations that use these sensors

### "state_class 'measurement' with non-numeric value"

**Symptoms:**
```
Sensor has state class 'measurement' but has non-numeric value: 'Grid-connected operation'
```

**Cause:** Text status fields being classified as numeric measurements.

**Solution:** Update to addon version 0.3.0 or later which properly classifies text sensors.

### Power factor unit warning

**Symptoms:**
```
Entity is using native unit of measurement '' which is not valid for device class 'power_factor'
```

**Solution:** Update to addon version 0.3.0 which publishes power factor as a unitless number.

---

## Device Compatibility

### WiNet Firmware Versions

The addon supports three firmware generations:

| Version | Detection | Notes |
|---------|-----------|-------|
| v1 (old WiNet-S) | No IP shown on device | May have fewer features |
| v2 (WiNet-S2 older) | Standard login | HTTP usually works |
| v3 (WiNet-S2 newer) | Forces password change, `forceModifyPasswd` | Requires SSL |

**Tip:** You're on v3 firmware when going to the Winet IP forces you to change the default password and shows a login screen.

### Semi-translated entity names

**Symptoms:**
```
i18n_common_group_bunch_title_andpercent1_voltage
I18N_COMMON_GROUP_BUNCH_TITLE_AND%@1 Power
```

**Cause:** Language file issues with some inverter models (especially SH15T, SH20T).

**Solutions:**
- Update to addon version 0.2.2+ which handles these placeholders
- Check your WiNet UI language setting

### WiFi Dongle (v31) Compatibility

Older WiFi modules (v31) are not the same as WiNet-S/S2 and may not be supported.

---

## Stability Issues

### Process killed / Memory overflow

**Symptoms:** Addon stops repeatedly, logs show "Killed"

**Possible causes:**
1. Very long-running sessions accumulating memory
2. Running on resource-constrained hardware

0.3.0 fixes several contributors: stacked reconnect timers and sockets, unbounded MQTT queueing while the broker was down, and the extra `npm` process.

**Solutions:**
- Update to 0.3.0 or later
- Restart the addon periodically (can be automated)
- Increase poll_interval to reduce load
- Check system resources on your Home Assistant host

### WiNet web interface unusable while addon runs

**Expected behavior:** The WiNet only supports one active session. The addon keeps a persistent connection, which logs out other users.

**Workaround:** Stop the addon temporarily when you need to access the WiNet web interface directly.

### Site totals don't appear

The "WiNet Site" device only appears with two or more inverters (hybrid or string inverters, not batteries), and only once every configured WiNet has reported at least once. Lifetime totals keep the last known value of an inverter that goes offline so the Energy dashboard never sees a false reset; live power totals pause until all inverters report fresh data.

---

## System Limitations

These are known architectural limitations, not bugs:

1. **Read-only** - This addon uses the WebSocket protocol which only supports reading data. For control functions (changing modes, settings), use [mkaiser's Modbus integration](https://github.com/mkaiser/Sungrow-SHx-Inverter-Modbus-Home-Assistant).

2. **One connection per WiNet** - Multiple WiNets are supported from 0.3.0 (comma separate them in `winet_host`), but each WiNet still only allows one session, so don't also run a second addon instance against the same dongle.

3. **Data availability** - The addon can only show what the WiNet web interface shows. If a value isn't in the web UI, it won't appear here.

4. **Inverter variations** - Sungrow is notoriously inconsistent between models. Sensor names and availability vary.

5. **No iSolarCloud connection** - This addon is 100% local. The username/password are for your WiNet dongle, not iSolarCloud.

---

## Still stuck?

1. Collect your addon logs
2. Note your inverter model, WiNet version, and firmware
3. Check if you can see the values in the WiNet web interface
4. [Open an issue](https://github.com/NickStallman/home-assistant-repo/issues) with these details
