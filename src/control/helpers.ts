import { patterns } from './constants';
import { PatternNameType } from './types';

export const determineMode = (resp) => {
  if (
    resp.readUInt8(3) === 0x61 ||
    (resp.readUInt8(3) === 0 && resp.readUInt8(4) === 0x61)
  ) {
    return 'color';
  } else if (resp.readUInt8(3) === 0x62) {
    return 'special';
  } else if (resp.readUInt8(3) === 0x60) {
    return 'custom';
  } else if (resp.readUInt8(3) >= 0x25 && resp.readUInt8(3) <= 0x38) {
    // we can ignore bit 4 here, since it is always 0x21 and resp.readUInt16BE(3) is >= 9505
    return 'pattern';
  } else if (resp.readUInt16BE(3) >= 0x64 && resp.readUInt16BE(3) <= 0x018f) {
    return 'ia_pattern';
  } else {
    return null;
  }
};

export const determinePattern = (resp): PatternNameType | number | null => {
  if (resp.readUInt8(3) >= 0x25 && resp.readUInt8(3) <= 0x38) {
    for (let patternName in patterns) {
      if (patterns[patternName] === resp.readUInt8(3))
        return patternName as PatternNameType;
    }
  }

  if (resp.readUInt16BE(3) >= 0x64 && resp.readUInt16BE(3) <= 0x018f) {
    return resp.readUInt16BE(3) - 99;
  }

  return null;
};

export const delayToSpeed = (delay) => {
  delay = clamp(delay, 1, 31);
  delay -= 1; // bring into interval [0, 30]
  return 100 - (delay / 30) * 100;
};

export const speedToDelay = (speed) => {
  speed = clamp(speed, 0, 100);
  return 30 - (speed / 100) * 30 + 1;
};

export const clamp = (value, min, max) => {
  return Math.min(max, Math.max(min, value));
};
