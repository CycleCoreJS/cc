"use strict";
// Runtime type validation system (TypeScript-like at runtime)
export class Schema {
  static string(opts = {}) {
    return (value, path = '') => {
      if (typeof value !== 'string') {
        throw new Error(`${path}: Expected string, got ${typeof value}`);
      }
      if (opts.min && value.length < opts.min) {
        throw new Error(`${path}: String too short (min: ${opts.min})`);
      }
      if (opts.max && value.length > opts.max) {
        throw new Error(`${path}: String too long (max: ${opts.max})`);
      }
      if (opts.pattern && !opts.pattern.test(value)) {
        throw new Error(`${path}: String doesn't match pattern`);
      }
      return value;
    };
  }

  static number(opts = {}) {
    return (value, path = '') => {
      if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(`${path}: Expected number, got ${typeof value}`);
      }
      if (opts.min !== undefined && value < opts.min) {
        throw new Error(`${path}: Number too small (min: ${opts.min})`);
      }
      if (opts.max !== undefined && value > opts.max) {
        throw new Error(`${path}: Number too large (max: ${opts.max})`);
      }
      if (opts.integer && !Number.isInteger(value)) {
        throw new Error(`${path}: Expected integer`);
      }
      return value;
    };
  }

  static object(shape) {
    return (value, path = '') => {
      if (typeof value !== 'object' || value === null) {
        throw new Error(`${path}: Expected object, got ${typeof value}`);
      }
      const validated = {};
      for (const [key, validator] of Object.entries(shape)) {
        const fieldPath = path ? `${path}.${key}` : key;
        validated[key] = validator(value[key], fieldPath);
      }
      return validated;
    };
  }

  static array(itemValidator) {
    return (value, path = '') => {
      if (!Array.isArray(value)) {
        throw new Error(`${path}: Expected array, got ${typeof value}`);
      }
      return value.map((item, i) => itemValidator(item, `${path}[${i}]`));
    };
  }

  static optional(validator) {
    return (value, path = '') => {
      if (value === undefined || value === null) {
        return value;
      }
      return validator(value, path);
    };
  }

  static oneOf(...validators) {
    return (value, path = '') => {
      for (const validator of validators) {
        try {
          return validator(value, path);
        } catch (e) {
          continue;
        }
      }
      throw new Error(`${path}: Value didn't match any schema`);
    };
  }

  static validate(schema, value) {
    try {
      return { valid: true, data: schema(value) };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}