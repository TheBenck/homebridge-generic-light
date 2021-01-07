// @ts-nocheck
import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import convert from 'color-convert';
import GenericLightPlatform from '../platform';
import Control from '../control/control';

export type ColorLightPlatformAccessoryStateType = {
  On: boolean;
  Hue: number;
  Brightness: number;
  Saturation: number;
};

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export default class ColorLightPlatformAccessory {
  private light: Control;
  private service: Service;
  private state: ColorLightPlatformAccessoryStateType = {
    On: false,
    Hue: 0,
    Brightness: 100,
    Saturation: 0,
  };

  constructor(
    private readonly platform: GenericLightPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly ipAddress: string,
    private readonly port: number,
    private readonly type: 'rgb'
  ) {
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Default-Manufacturer'
      )
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        'Default-Serial'
      );

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device.displayName
    );

    this.light = new Control(this.ipAddress, this.port, {
      logAllReceived: accessory.context.device.debug,
    });

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('set', this.setOn.bind(this)) // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this)); // GET - bind to the `getOn` method below

    // register handlers for the Brightness Characteristic
    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .on('set', this.setBrightness.bind(this)); // SET - bind to the 'setBrightness` method below

    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .on('set', this.setBrightness.bind(this)) // SET - bind to the 'setBrightness` method below
      .on('get', this.getBrightness.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Hue)
      .on('set', this.setHue.bind(this))
      .on('get', this.getHue.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .on('set', this.setSaturation.bind(this))
      .on('get', this.getSaturaton.bind(this));
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    // implement your own code to turn your device on/off
    if (this.states.On !== (value as boolean)) {
      this.light.setPower(value);
      if (value) {
        const rgb = convert.hsv.rgb(
          this.states.Hue,
          this.states.Saturation,
          this.states.Brightness
        );
        this.light.setColor(rgb[0], rgb[1], rgb[2]);
      }
    }

    this.states.On = value as boolean;

    this.platform.log.debug('Set Characteristic On ->', value);

    // you must call the callback function
    callback(null);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.
   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {
    // implement your own code to check if the device is on
    this.queryState();

    const isOn = this.states.On;
    this.platform.log.debug('Get Characteristic On ->', isOn);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  setBrightness(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ) {
    // implement your own code to set the brightness
    this.states.Brightness = value as number;

    this.platform.log.debug('Set Characteristic Brightness -> ', value);

    if (this.states.On) {
      const rgb = convert.hsv.rgb(
        this.states.Hue,
        this.states.Saturation,
        value
      );

      this.light
        .setColor(rgb[0], rgb[1], rgb[2])
        .then(() => {
          this.platform.log.debug('Successfully set the brightness');
        })
        .catch((err) => {
          this.platform.log.debug(
            'Error setting the brightness: ' + err.message
          );
        })
        .finally(() => {
          callback(null);
        });
    } else {
      callback(null);
    }
  }

  getBrightness(callback: CharacteristicSetCallback) {
    if (!this.polling) {
      this.queryState();
    }

    this.platform.log.debug(
      'Get Characteristic Brightness ->',
      this.states.Brightness
    );

    callback(null, this.states.Brightness);
  }

  setHue(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    // implement your own code to set the brightness
    this.states.Hue = value as number;

    this.platform.log.debug('Set Characteristic Hue -> ', value);

    if (this.states.On) {
      const rgb = convert.hsv.rgb(
        value,
        this.states.Saturation,
        this.states.Brightness
      );

      this.light
        .setColor(rgb[0], rgb[1], rgb[2])
        .then(() => {
          this.platform.log.debug('Successfully set the hue');
        })
        .catch((err) => {
          this.platform.log.debug(
            'Error setting the brightness: ' + err.message
          );
        })
        .finally(() => {
          callback(null);
        });
    } else {
      callback(null);
    }
  }

  getHue(callback: CharacteristicSetCallback) {
    if (!this.polling) {
      this.queryState();
    }

    this.platform.log.debug('Get Characteristic Hue ->', this.states.Hue);
    callback(null, this.states.Hue);
  }

  setSaturation(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ) {
    // implement your own code to set the brightness
    this.states.Saturation = value as number;

    this.platform.log.debug('Set Characteristic Saturation -> ', value);

    if (this.states.On) {
      const rgb = convert.hsv.rgb(
        this.states.Hue,
        value,
        this.states.Brightness
      );

      this.light
        .setColor(rgb[0], rgb[1], rgb[2])
        .then(() => {
          this.platform.log.debug('Successfully set the saturation');
        })
        .catch((err) => {
          this.platform.log.debug(
            'Error setting the brightness: ' + err.message
          );
        })
        .finally(() => {
          callback(null);
        });
    } else {
      callback(null);
    }
  }

  getSaturaton(callback: CharacteristicSetCallback) {
    if (!this.polling) {
      this.queryState();
    }

    this.platform.log.debug(
      'Get Characteristic Saturation ->',
      this.states.Saturation
    );
    callback(null, this.states.Saturation);
  }

  queryState() {
    this.platform.log.debug('Polling accessory...');
    this.polling = true;
    this.light
      .queryState()
      .then((state) => {
        this.platform.log.debug('Retrived States!');
        this.states.On = state.on;
        const hsv = convert.rgb.hsv(
          state.color.red,
          state.color.green,
          state.color.blue
        );
        this.states.Brightness = hsv[2];
        this.states.Hue = hsv[0];
        this.states.Saturation = hsv[1];
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          this.states.On
        );
        this.service.updateCharacteristic(
          this.platform.Characteristic.Brightness,
          this.states.Brightness
        );
        this.service.updateCharacteristic(
          this.platform.Characteristic.Saturation,
          this.states.Saturation
        );
        this.service.updateCharacteristic(
          this.platform.Characteristic.Hue,
          this.states.Hue
        );
        this.polling = false;
      })
      .catch((err) => {
        return this.platform.log.error('Error:', err.message);
      });
  }
}
