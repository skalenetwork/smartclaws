# Shelly Plug S Gen3 Reference

This reference captures verified protocol details used by the skill.

## Verified Sources

- Shelly Plug S Gen3 device page:
  - https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen3/ShellyPlugSG3
- Shelly Switch component RPC:
  - https://shelly-api-docs.shelly.cloud/gen2/Components/FunctionalComponents/Switch/
- Shelly RPC protocol:
  - https://shelly-api-docs.shelly.cloud/gen2/General/RPCProtocol
- Shelly mDNS behavior:
  - https://shelly-api-docs.shelly.cloud/gen2/General/mDNS/
- Shelly HTTP auth support:
  - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/HTTP/

## Device Facts

- Device: Shelly Plug S Gen3 (Type F variant requested by user).
- Capability: one relay switch channel with built-in power metering.
- Core controllable component: `switch:0`.

## RPC Methods Used

- Read status:
  - `Switch.GetStatus` with `id=0`
  - Example: `GET /rpc/Switch.GetStatus?id=0`
- Set output:
  - `Switch.Set` with `id=0` and `on=true|false`
  - Optional `toggle_after` in seconds
  - Example: `GET /rpc/Switch.Set?id=0&on=true`

## Status Fields Mapped To SmartClaws

Primary fields from `Switch.GetStatus`:

- `output`
- `apower`
- `voltage`
- `current`
- `aenergy.total`
- `temperature.tC` (if available)

## Authentication Notes

- `Shelly.GetDeviceInfo` returns:
  - `auth_en` (authentication enabled)
  - `auth_domain`
- Shelly docs indicate HTTP basic/digest auth support for URL credentials.
- Example with curl digest:
  - `curl --digest -u admin:password http://<host>/rpc/Shelly.GetConfig`

## Discovery Notes

- Gen2+/Gen3 devices advertise `_http._tcp` and `_shelly._tcp` via mDNS.
- mDNS can be used to discover hostname and then call local `/rpc/...`.

## Validation Checklist

- [ ] `Shelly.GetDeviceInfo` reachable
- [ ] `Switch.GetStatus?id=0` returns JSON payload
- [ ] `Switch.Set` can switch on/off physically
- [ ] SmartClaws publish works for telemetry topic
- [ ] Incoming command channel drives `Switch.Set` correctly
