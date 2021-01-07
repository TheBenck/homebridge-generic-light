import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { Discovery } from 'magic-home';
import ColorLightPlatformAccessory from './accessories/colorLightPlatformAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

/**
 * #### Platform Config Type ####
 * - platform: string;
 * - name: string;
 * - debug?: boolean;
 * - devices: Config Device Type [];
 */

/**
 * #### Config Device Type ####
 * - id: string;
 * - displayName: string;
 * - ipAddress: string;
 * - port: number;
 */

export default class GenericLightPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap
    .Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    if (this.config.discover === false) {
      this.log.info('Using config.json for device list');
      this.setupDevices(this.config.devices);
    } else {
      this.log.info('Scanning for devices...');
      const discovery = new Discovery();
      discovery.scan(500).then((devices) => {
        this.setupDevices(devices);
      });
    }
  }

  setupDevices(devices) {
    this.log.info(`Found ${devices.length} device(s)`);

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.id);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        // the accessory already exists
        if (device) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName
          );

          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          new ColorLightPlatformAccessory(
            this,
            existingAccessory,
            device.ipAddress,
            device.port,
            'rgb'
          );

          // update accessory cache with any changes to the accessory details and information
          this.api.updatePlatformAccessories([existingAccessory]);
        } else if (!device) {
          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
          // remove platform accessories when no longer present
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            existingAccessory,
          ]);
          this.log.info(
            'Removing existing accessory from cache:',
            existingAccessory.displayName
          );
        }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(
          device.displayName,
          uuid
        );

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new ColorLightPlatformAccessory(
          this,
          accessory,
          device.ipAddress,
          device.port,
          'rgb'
        );

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
      }
    }
  }
}
