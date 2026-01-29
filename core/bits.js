"use strict";
// Bit manipulation utilities with type safety
export const Bits = {
  // Get specific bit
  get(value, bit) {
    return (value >> bit) & 1;
  },

  // Set specific bit
  set(value, bit, state = 1) {
    return state ? value | (1 << bit) : value & ~(1 << bit);
  },

  // Toggle bit
  toggle(value, bit) {
    return value ^ (1 << bit);
  },

  // Get range of bits
  slice(value, start, length) {
    return (value >> start) & ((1 << length) - 1);
  },

  // Set range of bits
  patch(value, start, length, newBits) {
    const mask = ((1 << length) - 1) << start;
    return (value & ~mask) | ((newBits << start) & mask);
  },

  // Count set bits
  popcount(value) {
    let count = 0;
    while (value) {
      count += value & 1;
      value >>= 1;
    }
    return count;
  },

  // Rotate left
  rotl(value, bits, width = 8) {
    const mask = (1 << width) - 1;
    value &= mask;
    return ((value << bits) | (value >> (width - bits))) & mask;
  },

  // Rotate right
  rotr(value, bits, width = 8) {
    const mask = (1 << width) - 1;
    value &= mask;
    return ((value >> bits) | (value << (width - bits))) & mask;
  },

  // Sign extend
  signExtend(value, bits) {
    const sign = value >> (bits - 1);
    if (sign) {
      return value | (~0 << bits);
    }
    return value;
  },

  // Pretty print binary
  toBinary(value, width = 8) {
    return value.toString(2).padStart(width, '0');
  },

  // Pretty print hex
  toHex(value, width = 2) {
    return '0x' + value.toString(16).toUpperCase().padStart(width, '0');
  }
};