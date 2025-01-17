/*
 * Various helper functions for the plugin, to facilitate communication with the
 * hub and to aid in interpreting its responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable indent */
import * as aesjs from "aes-js";

import * as hubapi from "./connector-hub-api";
import * as consts from "./connector-hub-constants";
import { kMacAddrLength } from "./connector-hub-constants";

//
// Special types used internally by the plugin.
//

// This augmented type is not part of the Hub API.
export interface ExtendedDeviceInfo extends hubapi.DeviceInfo {
  fwVersion: string;
}

//
// Helpers which facilitate communication with the hub.
//
type accesTokenComputeParams = {
  connectorKey: string;
  hubToken: string;
};

export function computeAccessToken({
  connectorKey,
  hubToken,
}: accesTokenComputeParams): string {
  const aesEcb = new aesjs.ModeOfOperation.ecb(
    aesjs.utils.utf8.toBytes(connectorKey)
  );
  const tokenEnc = aesEcb.encrypt(aesjs.utils.utf8.toBytes(hubToken));
  return aesjs.utils.hex.fromBytes(tokenEnc).toUpperCase();
}

export function makeMsgId(): string {
  // The ID is the current timestamp with all non-numeric chars removed.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
  return new Date().toJSON().replaceAll(/\D/g, "");
}

export function makeGetDeviceListRequest(): hubapi.GetDeviceListReq {
  return { msgType: "GetDeviceList", msgID: makeMsgId() };
}

// A ReadDevice request only updates the position after each movement of the
// device is complete. In order to obtain the real-time state, we must issue a
// WriteDevice request for a 'status' operation. However, polling with this
// method causes the responsiveness of the devices to degrade over time; there
// may be some kind of rate-limiting mechanism in the hub. ReadDevice has no
// such issues, possibly because it reads a cached value from the hub itself.
export function makeReadDeviceRequest(
  deviceInfo: hubapi.DeviceInfo
): hubapi.ReadDeviceReq {
  return {
    msgType: "ReadDevice",
    mac: deviceInfo.mac,
    deviceType: deviceInfo.deviceType,
    msgID: makeMsgId(),
  };
}

export function makeWriteDeviceRequest(
  deviceInfo: hubapi.DeviceInfo,
  accessToken: string,
  command: hubapi.DeviceCmd
): hubapi.WriteDeviceReq {
  return {
    msgType: "WriteDevice",
    mac: deviceInfo.mac,
    deviceType: deviceInfo.deviceType,
    accessToken: accessToken,
    msgID: makeMsgId(),
    data: command,
  };
}

//
// Helpers which assist in interpreting the responses from the hub.
//

// Helper function to safely parse a possibly-invalid JSON response.
export function tryParse(jsonStr: string) {
  try {
    return JSON.parse(jsonStr);
  } catch (ex: any) {
    return undefined;
  }
}

// The 'type' is the 'deviceType' field from the ReadDeviceAck response.
// The 'subType' is the 'data.type' field from the ReadDeviceAck response.
export function getDeviceModel(type: string, subType?: number): string {
  // For some devices, such as a Wifi curtain motor, there is no device subtype
  // and the model is determined by the type. For other devices, generally RF
  // motors connected to a hub, look up the device subtype.

  return subType
    ? consts.deviceModels[subType] || "Unidentified Device"
    : consts.deviceTypes[type as keyof typeof consts.deviceTypes];
}

export function makeDeviceName(
  mac: string,
  type: string,
  subType?: number
): string {
  // The format of a device's MAC is [hub_mac][device_num] where the former is a
  // 12-character hex string and the latter is a 4-digit numeric string. If this
  // is a WiFi motor which does not have a hub, device_num can be empty.
  const [macAddr, devNum] = [
    mac.slice(0, kMacAddrLength),
    mac.slice(kMacAddrLength + 2),
  ];
  // Get the device model based on its type and sub-type.
  const deviceModel = getDeviceModel(type, subType);
  // Construct and return the final device name as '[model] [device_num]:[mac]'
  return `${deviceModel} ${devNum.length ? devNum : "01"}:${macAddr}`;
}

// Estimate battery charge percentage from reported voltage.
// Calculation uses thresholds defined by the Connector app.
export function getBatteryPercent(batteryLevel: number): number {
  const voltageLevel = batteryLevel / 100.0;
  if (
    voltageLevel >= 15.9 ||
    (voltageLevel >= 11.9 && voltageLevel < 13.2) ||
    (voltageLevel >= 7.9 && voltageLevel < 8.8)
  ) {
    return 100;
  }
  if (
    (voltageLevel >= 14.5 && voltageLevel < 15.9) ||
    (voltageLevel >= 10.9 && voltageLevel < 11.9) ||
    (voltageLevel >= 7.3 && voltageLevel < 7.9)
  ) {
    return 50;
  }
  if (
    (voltageLevel >= 14.2 && voltageLevel < 14.5) ||
    (voltageLevel >= 10.6 && voltageLevel < 10.9) ||
    (voltageLevel >= 7.1 && voltageLevel < 7.3)
  ) {
    return 20;
  }
  if (
    (voltageLevel >= 14.0 && voltageLevel < 14.2) ||
    (voltageLevel >= 10.5 && voltageLevel < 10.6) ||
    (voltageLevel >= 7.0 && voltageLevel < 7.1)
  ) {
    return 10;
  }
  if (
    (voltageLevel >= 13.2 && voltageLevel < 14.0) ||
    (voltageLevel >= 8.8 && voltageLevel < 10.5) ||
    (voltageLevel >= 6.8 && voltageLevel < 7.0)
  ) {
    return 0;
  }
  return 100;
}

export function isLowBattery(batteryLevel: number): boolean {
  return getBatteryPercent(batteryLevel) <= consts.kLowBatteryPercent;
}
