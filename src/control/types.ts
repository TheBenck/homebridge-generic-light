import { patterns } from './constants';

export type RgbColorType = {
  red: number;
  green: number;
  blue: number;
};

export type PatternNameType = keyof typeof patterns;

export type StateType = {
  cold_white: number;
  color: RgbColorType;
  mode: string | null;
  on: boolean;
  pattern: PatternNameType | number | null;
  speed: number;
  type: number;
  warm_white: number;
};

export type ControlOptionsAckType = {
  // Wait for controller to send data to achnowledge color change commands (Default: true)
  color?: boolean;
  // Wait for controller to send data to achnowledge custom pattern change commands (Default: true)
  customPattern?: boolean;
  // Wait for controller to send data to achnowledge built-in pattern change commands (Default: true)
  pattern?: boolean;
  // Wait for controller to send data to achnowledge power change commands (Default: true)
  power?: boolean;
};

export type ControlOptionsInputType = {
  ack: ControlOptionsAckType;
  // Set the mask bit in setColor and setWarmWhite (Default: false)
  applyMasks?: boolean;
  // Send a different version of the color change packets, which also set the cold white values (Default: false)
  coldWhiteSupport?: boolean;
  // Duration in milliseconds after which an acknowledged command will be regarded as failed. Set to null to disable. (Default: 1000)
  commandTimeoutLength?: number;
  // Duration in milliseconds after which the connection attempt will be cancelled if the connection can not be established (Default: null [No timeout])
  connectTimeoutLength?: number;
  // Print all received bytes into stdout for debug purposes (Default: false)
  logAllReceived?: boolean;
};

export type ControlOptionsType = {
  ack: ControlOptionsAckType;
  applyMasks?: boolean;
  coldWhiteSupport?: boolean;
  commandTimeoutLength: number;
  connectTimeoutLength?: number;
  logAllReceived?: boolean;
};
