/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable indent */
import { DgramAsPromised } from "dgram-as-promised";

import * as hubapi from "./connector-hub-api";
import * as consts from "./connector-hub-constants";
import * as helpers from "./connector-hub-helpers";

const kSocketTimeoutMs = 250;
const kMaxRetries = 3;

// Types we expect for connector hub requests and responses.
type DeviceRequest =
  | hubapi.GetDeviceListReq
  | hubapi.WriteDeviceReq
  | hubapi.ReadDeviceReq;
type DeviceResponse =
  | hubapi.GetDeviceListAck
  | hubapi.WriteDeviceAck
  | hubapi.ReadDeviceAck;

// Function to send a request to the hub and receive a sequence of responses.
async function sendCommandMultiResponse(
  cmdObj: DeviceRequest,
  ip: string,
  expectSingleResponse = false
): Promise<DeviceResponse[]> {
  // Array of responses received from the hub(s).
  const responses: DeviceResponse[] = [];

  // Retry up to kMaxRetries times to overcome any transient network issues.
  for (let attempt = 0; attempt < kMaxRetries && !responses.length; ++attempt) {
    // Create a socket to service this request.
    const socket = DgramAsPromised.createSocket("udp4");

    // Convert the command to a byte buffer of the string representation.
    const sendMsg = Buffer.from(JSON.stringify(cmdObj));

    try {
      // Send the message and wait for confirmation that it was sent.
      const sendResult = socket.send(sendMsg, consts.kSendPort, ip);

      // Holds the message parsed from the hub response.
      let parsedMsg: DeviceResponse;

      do {
        // Set a maximum timeout for the request. If we get a response within
        // the timeout, clear the timeout for the next iteration.
        const timer = setTimeout(() => socket.close(), kSocketTimeoutMs);
        const response = (await sendResult) && (await socket.recv());
        clearTimeout(timer);

        // Try to parse the response and add it to the list of responses.
        parsedMsg = response && helpers.tryParse(response.msg.toString());
        if (parsedMsg) {
          responses.push(parsedMsg);
        }
      } while (parsedMsg && !expectSingleResponse);
    } catch (ex: any) {}
  }

  // Return a sequence of parsed response, if the operation was successful.
  return responses.length > 0 ? responses : Promise.reject();
}

// Function to send a request to the hub and receive a single response.
async function sendCommand(
  cmdObj: DeviceRequest,
  ip: string
): Promise<DeviceResponse> {
  // Delegate to the generic function with the expectation of a single response.
  const response = await sendCommandMultiResponse(cmdObj, ip, true);
  return response ? response[0] : response;
}

export class ConnectorHubClient {
  private accessToken: string;

  constructor(
    private readonly accessKey: string,
    private readonly deviceInfo: hubapi.DeviceInfo,
    private readonly hubIp: string,
    private readonly hubToken: string
  ) {
    this.accessToken = helpers.computeAccessToken({
      connectorKey: this.accessKey,
      hubToken: this.hubToken,
    });
  }

  public static getDeviceList(hubIp: string): Promise<DeviceResponse[]> {
    return sendCommandMultiResponse(helpers.makeGetDeviceListRequest(), hubIp);
  }

  public getDeviceState(): Promise<DeviceResponse> {
    return sendCommand(
      helpers.makeReadDeviceRequest(this.deviceInfo),
      this.hubIp
    );
  }

  public setOpenCloseState(op: hubapi.DeviceOpCode): Promise<DeviceResponse> {
    return this.setDeviceState({ operation: op });
  }

  public setTargetPosition(position: number): Promise<DeviceResponse> {
    return this.setDeviceState({ targetPosition: position });
  }

  public setTargetAngle(angle: number): Promise<DeviceResponse> {
    return this.setDeviceState({ targetAngle: angle });
  }

  private setDeviceState(command: hubapi.DeviceCmd): Promise<DeviceResponse> {
    const request = helpers.makeWriteDeviceRequest(
      this.deviceInfo,
      this.accessToken,
      command
    );
    return sendCommand(request, this.hubIp);
  }
}
