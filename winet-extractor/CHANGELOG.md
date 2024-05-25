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
