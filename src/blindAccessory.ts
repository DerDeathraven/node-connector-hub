/* eslint-disable indent */
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {ConnectorHubClient} from './connectorhub/connectorHubClient';
import {ConnectorHubPlatform} from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform
 * registers Each accessory may expose multiple services of different service
 * types.
 */
export class BlindAccessory {
  private static readonly kRefreshInterval = 5000;

  private client: ConnectorHubClient;
  // private batteryService: Service;
  private blindService: Service;

  // Cached status, updated periodically.
  private currentState: any = undefined;
  private lastState: any = undefined;

  constructor(
      private readonly platform: ConnectorHubPlatform,
      private readonly accessory: PlatformAccessory,
      private readonly hubToken: string,
  ) {
    // Create a new client connection for this device.
    this.client = new ConnectorHubClient(
        this.platform.config, this.accessory.context.device, this.hubToken,
        this.platform.log);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Dooya');
    // .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
    // .setCharacteristic(
    //     this.platform.Characteristic.SerialNumber, accessory.UUID);

    // get the service if it exists, otherwise create a new service. you can
    // create multiple services for each accessory.
    // TODO: add a service for the battery here.
    this.blindService =
        this.accessory.getService(this.platform.Service.WindowCovering) ||
        this.accessory.addService(this.platform.Service.WindowCovering);

    // set the service name, this is what is displayed as the default name on
    // the Home app in this example we are using the name we stored in the
    // `accessory.context` in the `discoverDevices` method.
    this.blindService.setCharacteristic(
        this.platform.Characteristic.Name,
        accessory.context.device.displayName);

    // Initialize the device state and set up a periodic refresh.
    this.updateDeviceStatus();
    setInterval(
        () => this.updateDeviceStatus(), BlindAccessory.kRefreshInterval);

    // each service must implement at-minimum the "required characteristics" for
    // the given service type see
    // https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the CurrentPosition Characteristic
    this.blindService
        .getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .onGet(this.getCurrentPosition.bind(this));

    // register handlers for the PositionState Characteristic
    this.blindService
        .getCharacteristic(this.platform.Characteristic.PositionState)
        .onGet(this.getPositionState.bind(this));

    // register handlers for the TargetPosition Characteristic
    this.blindService
        .getCharacteristic(this.platform.Characteristic.TargetPosition)
        .onSet(this.setTargetPosition.bind(this));
  }

  async updateDeviceStatus() {
    // Obtain the latest status from the device.
    const newState = await this.client.getDeviceState();

    // Update the cached current and last-good copies of the device status.
    this.lastState = (this.currentState || this.lastState || newState);
    this.currentState = newState;

    // If we didn't hear back from the device, exit early.
    if (!newState) {
      this.platform.log.debug('Failed to update ', this.accessory.displayName);
      return;
    }

    // Note that the hub reports 0 as fully open and 100 as closed;
    // Homekit expects the opposite.
    if (newState.data.currentPosition !== this.lastState.data.currentPosition) {
      this.platform.log.debug('Updating position ', this.accessory.displayName);
      this.blindService.updateCharacteristic(
          this.platform.Characteristic.CurrentPosition,
          100 - newState.data.currentPosition);
    }

    // The 'operation' value mirrors the PositionState enum
    // 0 = decreasing, 1 = increasing, 2 = stopped
    if (newState.data.operation !== this.lastState.data.operation) {
      this.platform.log.debug('Updating state ', this.accessory.displayName);
      this.blindService.updateCharacteristic(
          this.platform.Characteristic.PositionState, newState.data.operation);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for
   * example, turning on a Light bulb.
   */
  async setTargetPosition(value: CharacteristicValue) {
    // Homekit positions are the inverse of what the hub expects.
    const adjustedTarget = (100 - <number>value);
    const ack = await this.client.setTargetPosition(adjustedTarget);
    if (!ack) {
      this.platform.log.debug('Failed to target', this.accessory.displayName);
      throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.platform.log.debug(
        'Targeted: ', this.accessory.displayName, adjustedTarget);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the
   accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will
   result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your
   device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getCurrentPosition(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      this.platform.log.debug('Failed to get position: ', this.accessory.UUID);
      throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    // Note that the hub reports 0 as fully open and 100 as closed; Homekit
    // expects the opposite.
    return (100 - this.currentState.data.currentPosition);
  }

  async getPositionState(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      this.platform.log.debug(
          'Failed to get position state: ',
          this.accessory.UUID,
      );
      throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    // The 'operation' value mirrors the PositionState enum
    // 0 = decreasing, 1 = increasing, 2 = stopped
    return this.currentState.data.operation;
  }
}
