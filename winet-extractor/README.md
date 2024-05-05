# Sungrow WiNet S2 Extration Tool

## What is this tool

Some Sungrow inverters such as the SH10RS do not expose their metrics in a clean way. They do support Modbus but various values are missing making that integration unusable. It's also possible to access the metrics via cloud, however this results in 5 minute delayed data and requires internet access.

This project connects to the Sungrow WiNet-S2 wifi dongle and communicates with it's Websocket API. This allows access to all metrics updated every 10 seconds.

## Compatibility

This list is the confirmed working with the following hardware.

### Inverters

- Sungrow SH10RS - 10kw Single Phase with 4 MPPT

### Batteries

- SBR064/SBR096/SBR128/SBR160/SBR192/SBR224/SBR256

Other devices connected to a Sungrow Winet S2 adapter may also work but have not been confirmed.

## Configuration

Before starting, you will need to know the hostname or IP address of your WiNet dongle.

You will also have to have your MQTT broker configured and know your credentials. This addon has been tested with Mosquito broker and Home Assistant MQTT autodiscovery.

1. Add the repository

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FNickStallman%2Fhome-assistant-repo)

2. Install the WiNet Extractor addon
3. Configure your Winet Host, and MQTT URL.

- The Winet Host is simply the IP address or hostname of your Winet-S2 adapter e.g. "192.168.1.100"
- The MQTT URL is in the format of mqtt://<username>:<password>@<host>
- (optional) If you have changed the default Winet username and password, you may specify the new password. If these fields are left blank then the default will be used.

4. Start the addon, and observe your detected devices in the addon log or via Integrations -> MQTT

### Optional additional sensors

In order to expose the MPPT inputs to the Energy dashboard you need to integrate them to energy.

```yaml
sensor:
  - platform: integration
    unique_id: sh10rs_serialnumber_mppt1_energy
    source: sensor.sh10rs_serialnumber_mppt1_power
    name: SH10RS MPPT1 Energy
    method: left
    round: 4
  - platform: integration
    unique_id: sh10rs_serialnumber_mppt2_energy
    source: sensor.sh10rs_serialnumber_mppt2_power
    name: SH10RS MPPT2 Energy
    method: left
    round: 4
  - platform: integration
    unique_id: sh10rs_serialnumber_mppt3_energy
    source: sensor.sh10rs_serialnumber_mppt3_power
    name: SH10RS MPPT3 Energy
    method: left
    round: 4
  - platform: integration
    unique_id: sh10rs_serialnumber_mppt4_energy
    source: sensor.sh10rs_serialnumber_mppt4_power
    name: SH10RS MPPT4 Energy
    method: left
    round: 4
```

## Todo

- Add support for writing to registers to control the inverter.

## Related Projects

- [GoSungrow](https://github.com/MickMake/GoSungrow)
- [SunGather](https://github.com/bohdan-s/SunGather)
- [Sungrow SHx Inverter Modbus Home Assistant](https://github.com/mkaiser/Sungrow-SHx-Inverter-Modbus-Home-Assistant)

## Feedback

Feedback is appreciated so please drop me a line or file an issue.
