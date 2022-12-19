/* eslint-disable indent */
import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {ReadDeviceAck, WriteDeviceAck} from './connectorhub/connector-hub-api';
import * as helpers from './connectorhub/connector-hub-helpers';
import {ConnectorHubClient} from './connectorhub/connectorHubClient';
import {ConnectorHubPlatform} from './platform';
import {Log} from './util/log';

// Response types we expect for device status. Undefined if no response.
type ReadDeviceResponse = ReadDeviceAck|undefined;
type WriteDeviceResponse = WriteDeviceAck|undefined;

/**
 * An instance of this class is created for each accessory. Exposes both the
 * WindowCovering and Battery services for the device.
 */
export class ConnectorAccessory {
  private static readonly kRefreshInterval = 5000;

  private client: ConnectorHubClient;
  private batteryService: Service;
  private wcService: Service;

  // Cached device status, updated periodically.
  private currentState: ReadDeviceResponse;
  private lastState: ReadDeviceResponse;

  // Does the device only support binary open / close?
  private usesBinaryState = false;

  constructor(
      private readonly platform: ConnectorHubPlatform,
      private readonly accessory: PlatformAccessory,
      private readonly hubToken: string,
  ) {
    // Create a new client connection for this device.
    this.client = new ConnectorHubClient(
        this.platform.config, this.accessory.context.device, this.hubToken);

    // Set the accessory information to be displayed in Homekit.
    this.setAccessoryInformation();

    // Get the WindowCovering service if it exists, otherwise create one.
    this.wcService =
        this.accessory.getService(this.platform.Service.WindowCovering) ||
        this.accessory.addService(this.platform.Service.WindowCovering);

    // Add a service to report the battery level.
    this.batteryService =
        this.accessory.getService(this.platform.Service.Battery) ||
        this.accessory.addService(this.platform.Service.Battery);

    // Set the service name. This is the default name displayed by Homekit.
    this.wcService.setCharacteristic(
        this.platform.Characteristic.Name, accessory.displayName);
    this.batteryService.setCharacteristic(
        this.platform.Characteristic.Name, `${accessory.displayName} Battery`);

    // Initialize the device state and set up a periodic refresh.
    this.updateDeviceStatus();
    setInterval(
        () => this.updateDeviceStatus(), ConnectorAccessory.kRefreshInterval);

    // Register handlers for the CurrentPosition Characteristic.
    this.wcService
        .getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .onGet(this.getCurrentPosition.bind(this));

    // Register handlers for the TargetPosition Characteristic
    this.wcService
        .getCharacteristic(this.platform.Characteristic.TargetPosition)
        .onSet(this.setTargetPosition.bind(this));
  }

  // Update the device information displayed in Homekit.
  setAccessoryInformation(modelNum = 0, manufacturer = 'Dooya') {
    const Characteristic = this.platform.Characteristic;
    const deviceInfo = this.accessory.context.device;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.SerialNumber, deviceInfo.mac)
        .setCharacteristic(
            Characteristic.FirmwareRevision, deviceInfo.fwVersion)
        .setCharacteristic(
            Characteristic.Model, helpers.getDeviceModel(modelNum));
  }

  /**
   * This function is the main driver of the plugin. It periodically reads the
   * current device state from the hub and, if relevant values have changed,
   * pushes the new state to Homekit. This approach is taken because pulling the
   * status from the hub whenever Homekit requests it is too slow.
   */
  async updateDeviceStatus() {
    // Obtain the latest status from the device.
    const newState = <ReadDeviceResponse>(await this.client.getDeviceState());

    // Update the cached current and last-good copies of the device status.
    this.lastState = (this.currentState || this.lastState);
    this.currentState = newState;

    // If we didn't hear back from the device, exit early.
    if (!newState) {
      Log.warn('Periodic refresh failed:', this.accessory.displayName);
      return;
    }

    // Determine whether the device only reports binary open / closed state,
    // then sanitize the status object to conform to the expected format.
    this.usesBinaryState = (newState.data.currentPosition === undefined);
    this.currentState = helpers.sanitizeDeviceState(newState);

    // If this is the first time we've read the device, update the model type.
    if (!this.lastState) {
      this.setAccessoryInformation(newState.data.type);
    }

    // We extract 'lastPos' as below because lastState will be undefined on the
    // first iteration, so we wish to force an update.
    const lastPos = (this.lastState && this.lastState.data.currentPosition);
    if (newState.data.currentPosition !== lastPos) {
      // Log the message received from the hub if we are in debug mode.
      Log.debug(`Updated ${this.accessory.displayName} state:`, newState);
      // Note that the hub reports 0 as fully open and 100 as closed, but
      // Homekit expects the opposite. Correct the value before reporting.
      const newPos = (100 - newState.data.currentPosition);
      Log.info('Updating position ', [this.accessory.displayName, newPos]);
      // Update the TargetPosition, since we've just reached it, and the actual
      // CurrentPosition. Syncs Homekit if devices are moved by another app.
      this.wcService.updateCharacteristic(
          this.platform.Characteristic.TargetPosition, newPos);
      this.wcService.updateCharacteristic(
          this.platform.Characteristic.CurrentPosition, newPos);
    }

    // Update the battery level if it has changed since the last refresh.
    const lastBattery = (this.lastState && this.lastState.data.batteryLevel);
    if (newState.data.batteryLevel !== lastBattery) {
      const batteryPercent =
          helpers.getBatteryPercent(newState.data.batteryLevel);
      Log.info(
          'Updating battery ', [this.accessory.displayName, batteryPercent]);
      // Push the new battery percentage level to Homekit.
      this.batteryService.updateCharacteristic(
          this.platform.Characteristic.BatteryLevel, batteryPercent);
      this.batteryService.updateCharacteristic(
          this.platform.Characteristic.StatusLowBattery,
          helpers.isLowBattery(newState.data.batteryLevel));
      this.batteryService.updateCharacteristic(
          this.platform.Characteristic.ChargingState,
          newState.data.chargingState ||
              this.platform.Characteristic.ChargingState.NOT_CHARGING);
    }

    // The 'data.operation' value mirrors the Characteristic.PositionState enum:
    //
    // PositionState extends Characteristic {
    //   static readonly DECREASING = 0;
    //   static readonly INCREASING = 1;
    //   static readonly STOPPED = 2;
    // }
    //
    // However, real-time polling of the devices causes severe degradation of
    // responsiveness over time; we therefore use passive read requests, which
    // only update the state after each movement is complete. This means that
    // only the position ever changes; the PositionState is always STOPPED. For
    // this reason, we don't bother reporting it. It is sufficient to report the
    // TargetPosition and CurrentPosition, and this also makes it simple to keep
    // Homekit in sync with external movement of the devices.
  }

  /**
   * Handle "set TargetPosition" requests from HomeKit. These are sent when the
   * user changes the state of the device. Throws SERVICE_COMMUNICATION_FAILURE
   * if the hub cannot be contacted.
   */
  async setTargetPosition(targetVal: CharacteristicValue) {
    // Homekit positions are the inverse of what the hub expects.
    let adjustedTarget = (100 - <number>targetVal);

    // Make sure the target value is supported for this device.
    if (this.usesBinaryState) {
      adjustedTarget = helpers.binarizeTargetPosition(
          adjustedTarget, <ReadDeviceAck>(this.currentState || this.lastState));
    }

    // Send the request to the hub and wait for a response.
    const ack = <WriteDeviceResponse>(
        await this.client.setTargetPosition(adjustedTarget));

    // Check whether the ack we received is valid for the request we sent.
    const invalidAck = ack &&
        (!this.usesBinaryState && ack.data.currentPosition === undefined);

    // If we didn't receive an ack, or if the ack reports an exception from the
    // hub, or if the ack is invalid, throw a communications error to Homekit.
    if (!ack || ack.actionResult || invalidAck) {
      Log.error(
          `Failed to set ${this.accessory.displayName} to ${targetVal}:`,
          (ack || 'No response from hub'));
      throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    Log.info('Targeted:', [this.accessory.displayName, targetVal]);
    Log.debug('Target response:', (ack || 'None'));
  }

  /**
   * Handle "get CurrentPosition" requests from HomeKit. Returns the most recent
   * value cached by the periodic updater; throws SERVICE_COMMUNICATION_FAILURE
   * if the most recent attempt to contact the hub failed.
   */
  async getCurrentPosition(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      Log.error('Failed to get position: ', this.accessory.displayName);
      throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    // Log the current state of the device if we are in debug mode.
    Log.debug(`${this.accessory.displayName} state:`, this.currentState);
    // Note that the hub reports 0 as fully open and 100 as closed, but
    // Homekit expects the opposite. Correct the value before reporting.
    const currentPos = (100 - this.currentState.data.currentPosition);
    Log.info('Returning position: ', [this.accessory.displayName, currentPos]);
    return currentPos;
  }
}