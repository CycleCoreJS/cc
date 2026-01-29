"use strict";
// Pattern matching for cleaner state machine code
export function match(value, patterns) {
  for (const [pattern, handler] of Object.entries(patterns)) {
    if (pattern === '_') {
      return handler(value);
    }
    
    if (typeof pattern === 'function') {
      if (pattern(value)) {
        return handler(value);
      }
    } else if (value === pattern) {
      return handler(value);
    }
  }
  
  throw new Error(`No pattern matched for value: ${value}`);
}

// Range pattern
export const range = (min, max) => (val) => val >= min && val <= max;

// Multiple values
export const oneOf = (...values) => (val) => values.includes(val);

// Bitwise pattern
export const bits = (mask, expected) => (val) => (val & mask) === expected;