import net from 'net';
import { CustomMode, EffectInterface } from 'magic-home';
import { patterns, RESPONSE_TIMEOUT } from './constants';
import {
  clamp,
  delayToSpeed,
  determineMode,
  determinePattern,
  speedToDelay,
} from './helpers';
import {
  ControlOptionsInputType,
  ControlOptionsType,
  RgbColorType,
  StateType,
} from './types';

export default class Control {
  private ipAddress: string;
  private port: number;

  private options: ControlOptionsType;

  private commandQueue: any;
  private socket: any;

  private receivedData: Buffer;
  private receiveTimeout?: ReturnType<typeof setTimeout>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private commandTimeout?: ReturnType<typeof setTimeout>;
  private preventDataSending: boolean;

  private lastColor: RgbColorType;
  private lastWW: number;
  private lastCW: number;

  /**
   * Create a new Control instance. This does not connect to the controller, yet.
   */
  constructor(ipAddress, port, options?: ControlOptionsInputType) {
    this.ipAddress = ipAddress;
    this.port = port;

    this.options = {
      logAllReceived: false,
      applyMasks: false,
      commandTimeoutLength: 1000,
      connectTimeoutLength: undefined,
      coldWhiteSupport: false,
      ...options,
      ack: {
        power: true,
        color: true,
        pattern: true,
        customPattern: true,
        ...options?.ack,
      },
    };

    this.commandQueue = [];

    this.socket = null;

    this.receivedData = Buffer.alloc(0);
    this.receiveTimeout = undefined;
    this.connectTimeout = undefined;
    this.commandTimeout = undefined;
    this.preventDataSending = false;

    // store the values of the last sent/received values to enable the convenience methods
    this.lastColor = { red: 0, green: 0, blue: 0 };
    this.lastWW = 0;
    this.lastCW = 0;
  }

  static ackMask(mask) {
    return {
      power: (mask & 0x01) > 0,
      color: (mask & 0x02) > 0,
      pattern: (mask & 0x04) > 0,
      customPattern: (mask & 0x08) > 0,
    };
  }

  /**
   * @private
   */
  receiveData(empty: boolean, data?: any) {
    if (this.commandTimeout) {
      // we have received _something_ so the command cannot timeout anymore
      clearTimeout(this.commandTimeout);
      this.commandTimeout = undefined;
    }

    if (empty) {
      // no data, so request is instantly finished
      // this can happend when a command is sent without waiting for a reply or when a timeout is reached
      let finished_command = this.commandQueue[0];

      if (finished_command != undefined) {
        const resolve = finished_command.resolve;
        if (resolve != undefined) {
          resolve(this.receivedData);
        }
      }

      // clear received data
      this.receivedData = Buffer.alloc(0);

      this.commandQueue.shift();

      this.handleNextCommand();
    } else {
      this.receivedData = Buffer.concat([this.receivedData, data]);

      if (this.receiveTimeout != null) clearTimeout(this.receiveTimeout);

      // since we don't know how long the response is going to be, set a timeout after which we consider the
      // whole message to be received
      this.receiveTimeout = setTimeout(() => {
        this.receiveData(true);
      }, RESPONSE_TIMEOUT);
    }
  }

  /**
   * @private
   */
  handleCommandTimeout() {
    this.commandTimeout = undefined;

    let timedout_command = this.commandQueue[0];

    if (timedout_command !== undefined) {
      const reject = timedout_command.reject;
      if (reject != undefined) {
        reject(new Error('Command timed out'));
      }
    }

    this.receivedData = Buffer.alloc(0); // just for good measure

    this.commandQueue.shift();

    this.handleNextCommand();
  }

  /**
   * @private
   */
  handleNextCommand() {
    if (this.commandQueue.length == 0) {
      if (this.socket != null) this.socket.end();
      this.socket = null;
    } else {
      let cmd = this.commandQueue[0];

      if (!cmd.expectReply) {
        this.socket.write(cmd.command, 'binary', () => {
          this.receiveData(true);
        });
      } else {
        this.socket.write(cmd.command, 'binary', () => {
          if (this.options.commandTimeoutLength === undefined) {
            return;
          }

          this.commandTimeout = setTimeout(() => {
            this.handleCommandTimeout();
          }, this.options.commandTimeoutLength);
        });
      }
    }
  }

  /**
   * @private
   */
  sendCommand(buf: Buffer, expectReply, resolve, reject) {
    // calculate checksum
    let checksum = 0;
    for (let byte of buf.values()) {
      checksum += byte;
    }
    checksum &= 0xff;

    // append checksum to command buffer
    let command = Buffer.concat([buf, Buffer.from([checksum])]);

    if (this.commandQueue.length == 0 && this.socket == null) {
      this.commandQueue.push({ expectReply, resolve, reject, command });

      this.preventDataSending = false;

      this.socket = net.connect(this.port, this.ipAddress, () => {
        if (this.connectTimeout != null) {
          clearTimeout(this.connectTimeout);
          this.connectTimeout = undefined;
        }

        if (!this.preventDataSending) {
          // prevent "write after end" errors
          this.handleNextCommand(); // which is the "first" command in this case
        }
      });

      this.socket.on('error', (err) => {
        this.socketErrorHandler(err, reject);
      });

      this.socket.on('data', (data) => {
        if (this.options.logAllReceived) {
          console.log(
            'Received:',
            data.toString('hex').replace(/(\w{2})/g, '$1 ')
          );
        }

        this.receiveData(false, data);
      });

      if (this.options.connectTimeoutLength) {
        this.connectTimeout = setTimeout(() => {
          this.socketErrorHandler(
            new Error('Connection timeout reached'),
            reject
          );
        }, this.options.connectTimeoutLength);
      }
    } else {
      this.commandQueue.push({ expectReply, resolve, reject, command });
    }
  }

  /**
   * @private
   */
  socketErrorHandler(err, reject) {
    this.preventDataSending = true;

    reject(err);

    if (this.socket != null) this.socket.end();
    this.socket = null;

    // also reject all commands currently in the queue
    for (let c of this.commandQueue) {
      let reject = c.reject;
      if (reject != undefined) {
        reject(err);
      }
    }

    this.commandQueue = []; // reset commandqueue so commands dont get stuck if the controller becomes unavailable
  }

  /**
   * @private
   */
  sendColorChangeCommand(red, green, blue, ww, cw, mask, callback) {
    red = clamp(red, 0, 255);
    green = clamp(green, 0, 255);
    blue = clamp(blue, 0, 255);
    ww = clamp(ww, 0, 255);

    let cmd_buf;
    if (this.options.coldWhiteSupport) {
      cw = clamp(cw, 0, 255);
      cmd_buf = Buffer.from([0x31, red, green, blue, ww, cw, mask, 0x0f]);
    } else {
      cmd_buf = Buffer.from([0x31, red, green, blue, ww, mask, 0x0f]);
    }

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(cmd_buf, this.options.ack.color, resolve, reject);
    })
      .then((data: any) => {
        return data.length > 0 || !this.options.ack.color;
      })
      .then((result) => {
        if (result) {
          this.lastColor = { red, green, blue };
          this.lastWW = ww;
          this.lastCW = cw;
        }
        return result;
      });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Sets the power state either to on or off
   * @param {Boolean} on
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setPower(on, callback) {
    let cmd_buf = Buffer.from([0x71, on ? 0x23 : 0x24, 0x0f]);

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(cmd_buf, this.options.ack.power, resolve, reject);
    }).then((data: any) => {
      return data.length > 0 || !this.options.ack.power; // the responses vary from controller to controller and I don't know what they mean
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Convenience method to call setPower(true)
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  turnOn(callback) {
    return this.setPower(true, callback);
  }

  /**
   * Convenience method to call setPower(false)
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  turnOff(callback) {
    return this.setPower(false, callback);
  }

  /**
   * Sets the color and warm white values of the controller.
   * Also saves the values for further calls to setColor, setWarmWhite, etc
   * @param {Number} red
   * @param {Number} green
   * @param {Number} blue
   * @param {Number} ww
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setColorAndWarmWhite(red, green, blue, ww, callback) {
    if (this.options.applyMasks) {
      console.warn(
        'WARNING: Masks are enabled, but a method which does not use them was called.'
      );
    }

    return this.sendColorChangeCommand(
      red,
      green,
      blue,
      ww,
      this.lastCW,
      0,
      callback
    );
  }

  /**
   * Sets the color and white values of the controller.
   * Also saves the values for further calls to setColor, setWarmWhite, etc
   * @param {Number} red
   * @param {Number} green
   * @param {Number} blue
   * @param {Number} ww warm white
   * @param {Number} cw cold white
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setColorAndWhites(red, green, blue, ww, cw, callback) {
    if (this.options.applyMasks) {
      console.warn(
        'WARNING: Masks are enabled, but a method which does not use them was called.'
      );
    }

    return this.sendColorChangeCommand(red, green, blue, ww, cw, 0, callback);
  }

  /**
   * Sets the color values of the controller.
   * Depending on applyMasks, only the color values, or color values as well as previous warm white values will be sent
   * @param {Number} red
   * @param {Number} green
   * @param {Number} blue
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setColor(red, green, blue, callback) {
    if (this.options.applyMasks) {
      return this.sendColorChangeCommand(
        red,
        green,
        blue,
        0,
        0,
        0xf0,
        callback
      );
    } else {
      return this.setColorAndWhites(
        red,
        green,
        blue,
        this.lastWW,
        this.lastCW,
        callback
      );
    }
  }

  /**
   * Sets the warm white values of the controller.
   * Depending on applyMasks, only the warm white values, or warm white values as well as previous color values will be sent
   * @param {Number} ww
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setWarmWhite(ww, callback) {
    if (this.options.applyMasks) {
      return this.sendColorChangeCommand(
        0,
        0,
        0,
        ww,
        this.lastCW,
        0x0f,
        callback
      );
    } else {
      return this.setColorAndWarmWhite(
        this.lastColor.red,
        this.lastColor.green,
        this.lastColor.blue,
        ww,
        callback
      );
    }
  }

  /**
   * Sets the white values of the controller.
   * Depending on applyMasks, only the cold white values, or cold white values as well as previous color values will be sent
   * @param {Number} ww warm white
   * @param {Number} cw cold white
   * @param {function} callback called with (err, success)
   * @returns {Promise<boolean>}
   */
  setWhites(ww, cw, callback) {
    if (cw != 0 && !this.options.coldWhiteSupport) {
      console.warn(
        'WARNING: Cold white support is not enabled, but the cold white value was set to a non-zero value.'
      );
    }

    if (this.options.applyMasks) {
      return this.sendColorChangeCommand(0, 0, 0, ww, cw, 0x0f, callback);
    } else {
      return this.setColorAndWhites(
        this.lastColor.red,
        this.lastColor.green,
        this.lastColor.blue,
        ww,
        cw,
        callback
      );
    }
  }

  /**
   * Convenience method to scale down the colors with a brightness value between 0 and 100
   * If you send red, green and blue to 0, this sets the color to white with the specified brightness (but not warm white!)
   * @param {Number} red
   * @param {Number} green
   * @param {Number} blue
   * @param {Number} brightness
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  setColorWithBrightness(red, green, blue, brightness, callback) {
    brightness = clamp(brightness, 0, 100);

    let r = (255 / 100) * brightness;
    let g = (255 / 100) * brightness;
    let b = (255 / 100) * brightness;

    if (red > 0 || green > 0 || blue > 0) {
      r = Math.round((clamp(red, 0, 255) / 100) * brightness);
      g = Math.round((clamp(green, 0, 255) / 100) * brightness);
      b = Math.round((clamp(blue, 0, 255) / 100) * brightness);
    }

    return this.setColor(r, g, b, callback);
  }

  /**
   * Sets the controller to display one of the predefined patterns
   * @param {String} pattern Name of the pattern
   * @param {Number} speed between 0 and 100
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  setPattern(pattern, speed, callback) {
    const patternCode = patterns[pattern];
    if (patternCode == undefined) {
      const promise = Promise.reject(new Error('Invalid pattern'));

      if (callback && typeof callback == 'function') {
        promise.then(callback.bind(null, null), callback);
      }

      return promise;
    }

    const delay = speedToDelay(speed);

    const cmdBuf = Buffer.from([0x61, patternCode, delay, 0x0f]);

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(cmdBuf, this.options.ack.pattern, resolve, reject);
    }).then((data: any) => {
      return data.length > 0 || !this.options.ack.pattern;
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Sets the controller to display one of the predefined patterns
   * @param {Number} code Code of the pattern, between 1 and 300
   * @param {Number} speed between 0 and 100
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  setIAPattern(code, speed, callback) {
    if (code < 1 || code > 300) {
      const promise = Promise.reject(new Error('Invalid code'));

      if (callback && typeof callback === 'function') {
        promise.then(callback.bind(null, null), callback);
      }

      return promise;
    }

    code += 99;

    let bufferArray = [0x61];
    bufferArray.push(code >> 8);
    bufferArray.push(code & 0xff);
    bufferArray.push(speed);
    bufferArray.push(0x0f);

    const cmdBuf = Buffer.from(bufferArray);

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(cmdBuf, this.options.ack.pattern, resolve, reject);
    }).then((data: any) => {
      return data.length > 0 || !this.options.ack.pattern;
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Sets the controller to display a custom pattern
   * @param {CustomMode} pattern
   * @param {Number} speed
   * @param {function} callback
   * @returns {Promise<boolean>}
   */
  setCustomPattern(pattern, speed, callback) {
    if (!(pattern instanceof CustomMode)) {
      const promise = Promise.reject(new Error('Invalid pattern'));

      if (callback && typeof callback == 'function') {
        promise.then(callback.bind(null, null), callback);
      }

      return promise;
    }

    let delay = speedToDelay(speed);

    // construct command buffer
    let cmdBufValues = [0x51];

    for (let i = 0; i < 16; i++) {
      if (pattern.colors[i]) {
        cmdBufValues.push(
          pattern.colors[i].red,
          pattern.colors[i].green,
          pattern.colors[i].blue,
          0
        );
      } else {
        cmdBufValues.push(1, 2, 3, 0);
      }
    }

    cmdBufValues.push(delay);

    switch (pattern.transitionType) {
      case 'fade':
        cmdBufValues.push(0x3a);
        break;
      case 'jump':
        cmdBufValues.push(0x3b);
        break;
      case 'strobe':
        cmdBufValues.push(0x3c);
        break;
    }

    cmdBufValues.push(0xff, 0x0f);

    const cmd_buf = Buffer.from(cmdBufValues);

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(
        cmd_buf,
        this.options.ack.customPattern,
        resolve,
        reject
      );
    }).then((data: any) => {
      return data.length > 0 || !this.options.ack.customPattern;
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Creates a new EffectInterface, which establishes a persistent connection to the controller
   * @param {function} callback
   * @returns {Promise<EffectInterface>}
   */
  startEffectMode(callback) {
    const promise = new Promise((resolve, reject) => {
      new EffectInterface(
        this.ipAddress,
        this.port,
        this.options,
        (err, effect_interface) => {
          if (err) return reject(err);

          resolve(effect_interface);
        }
      );
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }

  /**
   * Queries the controller for it's current state
   * This method stores the color and ww values for future calls to setColor, setWarmWhite, etc.
   * It will also set applyMasks to true for controllers which require it.
   * @param {function} callback
   * @returns {Promise<QueryResponse>}
   */
  queryState(callback) {
    let cmd_buf = Buffer.from([0x81, 0x8a, 0x8b]);

    const promise = new Promise((resolve, reject) => {
      this.sendCommand(cmd_buf, true, resolve, reject);
    }).then((data: any) => {
      if (data.length < 14) throw new Error('Only got short reply');

      const mode = determineMode(data);

      let state: StateType = {
        type: data.readUInt8(1),
        on: data.readUInt8(2) == 0x23,
        mode: mode,
        pattern: determinePattern(data),
        speed:
          mode !== 'ia_pattern'
            ? delayToSpeed(data.readUInt8(5))
            : data.readUInt8(5),
        color: {
          red: data.readUInt8(6),
          green: data.readUInt8(7),
          blue: data.readUInt8(8),
        },
        warm_white: data.readUInt8(9),
        cold_white: data.readUInt8(11),
      };

      this.lastColor = {
        red: state.color.red,
        green: state.color.green,
        blue: state.color.blue,
      };
      this.lastWW = state.warm_white;
      this.lastCW = state.cold_white;

      switch (state.type) {
        case 0x25:
          this.options.applyMasks = true;
          break;
        case 0x35:
          this.options.applyMasks = true;
          this.options.coldWhiteSupport = true;
          break;
        case 0x44:
          this.options.applyMasks = true;
          break;
        // otherwise do not change any options
      }

      return state;
    });

    if (callback && typeof callback == 'function') {
      promise.then(callback.bind(null, null), callback);
    }

    return promise;
  }
}
