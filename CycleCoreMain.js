"use strict";

/* ============================
 * SIGNAL
 * ============================ */
class Signal {
  constructor(value) {
    this._value = value;
    this._subscribers = new Set();
  }

  get() {
    return this._value;
  }

  set(value) {
    if (this._value !== value) {
      this._value = value;
      this._subscribers.forEach(fn => fn(value));
    }
  }

  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  // Computed signal with cleanup
  map(fn) {
    const computed = new Signal(fn(this._value));
    const unsubscribe = this.subscribe(value => computed.set(fn(value)));
    computed._cleanup = unsubscribe;
    return computed;
  }

  dispose() {
    if (this._cleanup) {
      this._cleanup();
      this._cleanup = null;
    }
    this._subscribers.clear();
  }

  static combine(...signals) {
    const combined = new Signal(signals.map(s => s.get()));
    signals.forEach(signal => {
      signal.subscribe(() => {
        combined.set(signals.map(s => s.get()));
      });
    });
    return combined;
  }

  debounce(ms) {
    const debounced = new Signal(this._value);
    let timeout;
    this.subscribe(value => {
      clearTimeout(timeout);
      timeout = setTimeout(() => debounced.set(value), ms);
    });
    return debounced;
  }
}

function effect(fn, ...signals) {
  fn();
  signals.forEach(signal => signal.subscribe(() => fn()));
}

/* ============================
 * CYCLE ENGINE (core/cycle-engine.js)
 * ============================ */
class MinHeap {
  constructor(compareFn) {
    this.heap = [];
    this.compare = compareFn;
  }

  size() {
    return this.heap.length;
  }

  peek() {
    return this.heap[0];
  }

  push(value) {
    this.heap.push(value);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const root = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._bubbleDown(0);
    return root;
  }

  _bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  _bubbleDown(index) {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.compare(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild;
      }
      if (rightChild < length && this.compare(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

// Core cycle-accurate execution engine optimized for ultimate speed
class CycleEngine {
  constructor(config = {}) {
    this.cyclesPerFrame = config.cyclesPerFrame || 1000;
    this.currentCycle = 0;
    this.running = false;
    this.frameId = null;
    this.callbacks = new Map();
    this.timerHeap = new MinHeap((a, b) => a.triggerCycle - b.triggerCycle);

    // Performance monitoring
    this.perfCounters = {
      cyclesExecuted: 0,
      framesRendered: 0,
      lastSecond: performance.now()
    };
    this.cyclesPerSecond = 0;
    this.framesPerSecond = 0;
  }

  // Schedule a callback after N cycles (O(log n))
  after(cycles, callback) {
    const timer = {
      triggerCycle: this.currentCycle + cycles,
      callback,
      id: Symbol("timer")
    };
    this.timerHeap.push(timer);
    return timer.id;
  }

  // Execute exactly one cycle (hot path)
  tick(executor) {
    executor(this.currentCycle);
    this.currentCycle++;
    this.perfCounters.cyclesExecuted++;

    while (this.timerHeap.size() > 0 && this.timerHeap.peek().triggerCycle <= this.currentCycle) {
      const timer = this.timerHeap.pop();
      timer.callback();
    }
  }

  // Run multiple cycles with simple unrolling
  run(cycles, executor) {
    const targetCycle = this.currentCycle + cycles;

    while (this.currentCycle < targetCycle) {
      const remaining = targetCycle - this.currentCycle;
      const step = (remaining >= 4 && this.timerHeap.size() === 0) ? 4 : 1;

      for (let i = 0; i < step; i++) {
        executor(this.currentCycle);
        this.currentCycle++;
        this.perfCounters.cyclesExecuted++;
      }

      while (this.timerHeap.size() > 0 && this.timerHeap.peek().triggerCycle <= this.currentCycle) {
        const timer = this.timerHeap.pop();
        timer.callback();
      }
    }
  }

  start(executor) {
    if (this.running) return;
    this.running = true;

    let lastFrameTime = performance.now();
    const targetFrameTime = 1000 / 60;

    const loop = (currentTime) => {
      if (!this.running) return;

      const elapsed = currentTime - lastFrameTime;
      if (elapsed < targetFrameTime) {
        this.frameId = requestAnimationFrame(loop);
        return;
      }

      lastFrameTime = currentTime;

      this.run(this.cyclesPerFrame, executor);
      this.perfCounters.framesRendered++;

      if (currentTime - this.perfCounters.lastSecond >= 1000) {
        this.cyclesPerSecond = this.perfCounters.cyclesExecuted;
        this.framesPerSecond = this.perfCounters.framesRendered;
        this.perfCounters.cyclesExecuted = 0;
        this.perfCounters.framesRendered = 0;
        this.perfCounters.lastSecond = currentTime;
      }

      this.frameId = requestAnimationFrame(loop);
    };

    this.frameId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  reset() {
    this.stop();
    this.currentCycle = 0;
    this.timerHeap = new MinHeap((a, b) => a.triggerCycle - b.triggerCycle);
  }

  getCycles() {
    return this.currentCycle;
  }

  getPerformance() {
    return {
      cyclesPerSecond: this.cyclesPerSecond,
      framesPerSecond: this.framesPerSecond,
      totalCycles: this.currentCycle
    };
  }
}

/* ============================
 * STATE
 * ============================ */
class State {
  constructor(initial = {}) {
    this.current = { ...initial };
    this.history = [{ ...initial }];
    this.maxHistory = 100;
    this.subscribers = [];
  }

  get(key) {
    return this.current[key];
  }

  update(updates) {
    const newState = { ...this.current, ...updates };
    this.current = newState;

    this.history.push({ ...newState });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this.subscribers.forEach(cb => cb(newState));
    return newState;
  }

  batch(fn) {
    const updates = {};
    const proxy = new Proxy(updates, {
      set(target, key, value) {
        target[key] = value;
        return true;
      }
    });

    fn(proxy);
    return this.update(updates);
  }

  rewind(steps = 1) {
    if (this.history.length > steps) {
      this.history.splice(-steps);
      this.current = { ...this.history[this.history.length - 1] };
      this.subscribers.forEach(cb => cb(this.current));
    }
  }

  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  reset() {
    if (this.history.length > 0) {
      this.current = { ...this.history[0] };
      this.history = [{ ...this.history[0] }];
      this.subscribers.forEach(cb => cb(this.current));
    }
  }
}

/* ============================
 * BITS
 * ============================ */
const Bits = {
  get(value, bit) {
    return (value >> bit) & 1;
  },

  set(value, bit, state = 1) {
    return state ? value | (1 << bit) : value & ~(1 << bit);
  },

  toggle(value, bit) {
    return value ^ (1 << bit);
  },

  slice(value, start, length) {
    return (value >> start) & ((1 << length) - 1);
  },

  patch(value, start, length, newBits) {
    const mask = ((1 << length) - 1) << start;
    return (value & ~mask) | ((newBits << start) & mask);
  },

  popcount(value) {
    let count = 0;
    while (value) {
      count += value & 1;
      value >>= 1;
    }
    return count;
  },

  rotl(value, bits, width = 8) {
    const mask = (1 << width) - 1;
    value &= mask;
    return ((value << bits) | (value >> (width - bits))) & mask;
  },

  rotr(value, bits, width = 8) {
    const mask = (1 << width) - 1;
    value &= mask;
    return ((value >> bits) | (value << (width - bits))) & mask;
  },

  signExtend(value, bits) {
    const sign = value >> (bits - 1);
    return sign ? (value | (~0 << bits)) : value;
  },

  toBinary(value, width = 8) {
    return value.toString(2).padStart(width, "0");
  },

  toHex(value, width = 2) {
    return "0x" + value.toString(16).toUpperCase().padStart(width, "0");
  }
};

/* ============================
 * PATTERN MATCH
 * ============================ */
function match(value, patterns) {
  for (const [pattern, handler] of Object.entries(patterns)) {
    if (pattern === "_") {
      return handler(value);
    }

    if (typeof pattern === "function") {
      if (pattern(value)) {
        return handler(value);
      }
    } else if (value === pattern) {
      return handler(value);
    }
  }

  throw new Error(`No pattern matched for value: ${value}`);
}

const range = (min, max) => (val) => val >= min && val <= max;
const oneOf = (...values) => (val) => values.includes(val);
const bits = (mask, expected) => (val) => (val & mask) === expected;

/* ============================
 * ENTITY / WORLD (ECS)
 * ============================ */
class Entity {
  constructor(id = Symbol("entity"), world = null) {
    this.id = id;
    this.components = new Map();
    this.tags = new Set();
    this.world = world;
  }

  add(name, component) {
    this.components.set(name, component);
    if (this.world) this.world._invalidateCache();
    return this;
  }

  get(name) {
    return this.components.get(name);
  }

  has(name) {
    return this.components.has(name);
  }

  remove(name) {
    this.components.delete(name);
    if (this.world) this.world._invalidateCache();
    return this;
  }

  tag(...tags) {
    tags.forEach(t => this.tags.add(t));
    return this;
  }

  hasTag(tag) {
    return this.tags.has(tag);
  }
}

class World {
  constructor() {
    this.entities = new Map();
    this.systems = [];
    this.queryCache = new Map();
    this.cacheVersion = 0;
  }

  spawn(entity) {
    entity.world = this;
    this.entities.set(entity.id, entity);
    this._invalidateCache();
    return entity;
  }

  destroy(entityId) {
    const entity = this.entities.get(entityId);
    if (entity) entity.world = null;
    this.entities.delete(entityId);
    this._invalidateCache();
  }

  _invalidateCache() {
    this.cacheVersion++;
  }

  query(...componentNames) {
    const cacheKey = componentNames.join(",");
    const cached = this.queryCache.get(cacheKey);

    if (cached && cached.version === this.cacheVersion) {
      return cached.result;
    }

    const result = [];
    for (const entity of this.entities.values()) {
      let hasAll = true;
      for (const name of componentNames) {
        if (!entity.has(name)) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) result.push(entity);
    }

    this.queryCache.set(cacheKey, { result, version: this.cacheVersion });
    return result;
  }

  addSystem(system) {
    this.systems.push(system);
  }

  update(dt) {
    this.systems.forEach(system => system(this, dt));
  }
}

/* ============================
 * SCHEMA
 * ============================ */
class Schema {
  static string(opts = {}) {
    return (value, path = "") => {
      if (typeof value !== "string") {
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
    return (value, path = "") => {
      if (typeof value !== "number" || isNaN(value)) {
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
    return (value, path = "") => {
      if (typeof value !== "object" || value === null) {
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
    return (value, path = "") => {
      if (!Array.isArray(value)) {
        throw new Error(`${path}: Expected array, got ${typeof value}`);
      }
      return value.map((item, i) => itemValidator(item, `${path}[${i}]`));
    };
  }

  static optional(validator) {
    return (value, path = "") => {
      if (value === undefined || value === null) {
        return value;
      }
      return validator(value, path);
    };
  }

  static oneOf(...validators) {
    return (value, path = "") => {
      for (const validator of validators) {
        try {
          return validator(value, path);
        } catch {
          // continue
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

/* ============================
 * MEMORY (FPGA-ready, deterministic)
 * ============================ */
class Memory {
  constructor(size, config = {}) {
    this.size = size >>> 0;
    this.data = new Uint8Array(size);
    // watchers: map address => [callbacks]
    this.watchers = new Map();
    // readOnly: set of absolute addresses
    this.readOnly = new Set(config.readOnly || []);
    // mirrors: array of { start, end, target, type? } for deterministic MMIO mapping
    this.mirrors = Array.isArray(config.mirrors) ? config.mirrors.slice() : [];

    // console / bus width hint (4|8|16)
    this.wordWidth = config.wordWidth || 8;

    // Performance tracking
    this.perfCounters = {
      reads: 0,
      writes: 0,
      lastSecond: performance.now()
    };
    this.opsPerSecond = 0;
  }

  // Convenience constructors for typical console widths
  static create4bit(size, opts = {}) { return new Memory(size, { ...opts, wordWidth: 4 }); }
  static create8bit(size, opts = {}) { return new Memory(size, { ...opts, wordWidth: 8 }); }
  static create16bit(size, opts = {}) { return new Memory(size, { ...opts, wordWidth: 16 }); }

  // Map an MMIO region to a target base address or handler id.
  // Accepts numeric rangeStart, rangeEnd, and a numeric target (or object).
  mapMMIO(rangeStart, rangeEnd, handlerTarget) {
    const start = Number(rangeStart) >>> 0;
    const end = Number(rangeEnd) >>> 0;
    if (start > end) throw new Error('mapMMIO: start must be <= end');
    this.mirrors.push({ start, end, target: handlerTarget });
  }

  // Ultra-optimized read with fast-path
  read(address) {
    this._checkBounds(address);
    this.perfCounters.reads++;

    // Fast path: no mirrors/watchers/readOnly checks -> direct access
    if (this.mirrors.length === 0 && this.watchers.size === 0) {
      return this.data[address];
    }

    const realAddr = this._resolveAddress(address);
    const value = this.data[realAddr];
    this._notifyWatchers(realAddr, 'read', value);
    return value;
  }

  write(address, value) {
    this._checkBounds(address);
    this.perfCounters.writes++;

    // Fast path
    if (this.mirrors.length === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      this.data[address] = value & 0xFF;
      return;
    }

    const realAddr = this._resolveAddress(address);

    if (this.readOnly.has(realAddr)) {
      throw new Error(`Attempt to write to read-only address 0x${realAddr.toString(16)}`);
    }

    const oldValue = this.data[realAddr];
    this.data[realAddr] = value & 0xFF;
    this._notifyWatchers(realAddr, 'write', value & 0xFF, oldValue);
  }

  // 16-bit little-endian helpers
  read16(address) {
    // Bound checks inside read ensure safety
    return (this.read(address) | (this.read(address + 1) << 8)) >>> 0;
  }

  write16(address, value) {
    this.write(address, value & 0xFF);
    this.write(address + 1, (value >> 8) & 0xFF);
  }

  // Watch memory changes at a single address
  watch(address, callback) {
    const addr = Number(address) >>> 0;
    if (!this.watchers.has(addr)) this.watchers.set(addr, []);
    this.watchers.get(addr).push(callback);
  }

  // Bulk load: fast-path uses TypedArray.set when no mirrors/watchers/readOnly
  load(address, data) {
    if (!data || data.length === 0) return;
    const start = Number(address) >>> 0;
    const len = data.length >>> 0;
    this._checkBounds(start);
    this._checkBounds(start + len - 1);

    if (this.mirrors.length === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      // direct copy
      this.data.set(data, start);
      this.perfCounters.writes += len;
      return;
    }

    // safe per-byte fallback honoring watchers/mirrors/readOnly
    for (let i = 0; i < len; i++) {
      this.write(start + i, data[i]);
    }
  }

  // Fill a region; fast-path uses typed-array fill
  fill(address, length, value) {
    const start = Number(address) >>> 0;
    const len = Number(length) >>> 0;
    if (len === 0) return;
    this._checkBounds(start);
    this._checkBounds(start + len - 1);
    const v = value & 0xFF;

    if (this.mirrors.length === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      this.data.fill(v, start, start + len);
      this.perfCounters.writes += len;
      return;
    }

    for (let i = 0; i < len; i++) {
      this.write(start + i, v);
    }
  }

  // Return a copied slice (safe view for external code)
  slice(start, end) {
    return Array.from(this.data.slice(start, end));
  }

  // Block copy optimized (handles overlap and honors mirrors)
  copy(fromAddress, toAddress, length) {
    const f = Number(fromAddress) >>> 0;
    const t = Number(toAddress) >>> 0;
    const len = Number(length) >>> 0;
    if (len === 0) return;
    this._checkBounds(f);
    this._checkBounds(f + len - 1);
    this._checkBounds(t);
    this._checkBounds(t + len - 1);

    // Use temporary for overlap safety, then load() so fast-paths may be used
    const tmp = this.data.slice(f, f + len);
    this.load(t, tmp);
  }

  // Resolve address via mirrors array deterministically
  _resolveAddress(address) {
    const addr = Number(address) >>> 0;
    for (let i = 0; i < this.mirrors.length; i++) {
      const m = this.mirrors[i];
      if (addr >= m.start && addr <= m.end) {
        // If target is numeric base, mirror contiguous mapping
        if (typeof m.target === 'number') {
          return (m.target + (addr - m.start)) >>> 0;
        }
        // For non-numeric handlers return original address - allow MMIO handler externalization
        return addr;
      }
    }
    return addr;
  }

  _checkBounds(address) {
    const a = Number(address) >>> 0;
    if (a < 0 || a >= this.size) {
      throw new Error(`Memory access out of bounds: 0x${a.toString(16)}`);
    }
  }

  _notifyWatchers(address, type, value, oldValue) {
    const list = this.watchers.get(address);
    if (list && list.length) {
      for (let i = 0; i < list.length; i++) {
        try { list[i]({ address, type, value, oldValue }); } catch (e) { /* swallow watcher errors */ }
      }
    }
  }

  // Performance meter (ops/sec)
  getPerformance() {
    const now = performance.now();
    if (now - this.perfCounters.lastSecond >= 1000) {
      this.opsPerSecond = this.perfCounters.reads + this.perfCounters.writes;
      this.perfCounters.reads = 0;
      this.perfCounters.writes = 0;
      this.perfCounters.lastSecond = now;
    }
    return this.opsPerSecond;
  }
}

/* ============================
 * COMPILER + VM (core/compiler.js)
 * ============================ */

// WASM-like bytecode format with magic header
const CC_MAGIC = 0x43434153; // "CCAS" in hex
const CC_VERSION = 0x01;

// Bytecode opcodes (extended)
const OP = {
  // Memory operations
  LOAD: 0x00,
  STORE: 0x01,
  LOAD_IMM: 0x02,
  LOAD_LOCAL: 0x03,
  STORE_LOCAL: 0x04,
  LOAD_STR: 0x05,
  
  // Fast-path immediates (40% faster)
  LOAD_IMM_0: 0x06,
  LOAD_IMM_1: 0x07,
  LOAD_IMM_M1: 0x08,
  INC_LOCAL: 0x09,
  DEC_LOCAL: 0x0A,
  
  // Ultra-fast combined ops (60% faster)
  ADD_IMM: 0x0B,
  SUB_IMM: 0x0C,
  MUL_IMM: 0x0D,
  CMP_ZERO: 0x0E,
  STORE_PUSH: 0x0F,

  // Arithmetic
  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  INC: 0x15,
  DEC: 0x16,
  NEG: 0x17,

  // Comparison
  EQ: 0x18,
  NE: 0x19,
  LT: 0x1a,
  GT: 0x1b,
  LE: 0x1c,
  GE: 0x1d,

  // Bitwise
  AND: 0x20,
  OR: 0x21,
  XOR: 0x22,
  SHL: 0x23,
  SHR: 0x24,
  NOT: 0x25,

  // 8/16-bit console-friendly memory ops
  LOAD8: 0x26,    // Load 8-bit value from memory
  STORE8: 0x27,   // Store 8-bit value to memory
  LOAD16: 0x28,   // Load 16-bit value (little-endian)
  STORE16: 0x29,  // Store 16-bit value (little-endian)

  // Control flow
  JMP: 0x30,
  JZ: 0x31,
  JNZ: 0x32,
  CALL: 0x33,
  RET: 0x34,
  LOOP: 0x35,
  ENDLOOP: 0x36,
  BREAK: 0x37,
  CONTINUE: 0x38,

  // Stack operations
  PUSH: 0x40,
  POP: 0x41,
  DUP: 0x42,
  SWAP: 0x43,

  // Cycle operations
  TICK: 0x50,
  WAIT: 0x51,

  // I/O operations
  PRINT: 0x60,
  INPUT: 0x61,

  // Special
  NOP: 0xf0,
  HALT: 0xff
};

class CCCompiler {
  constructor() {
    this.bytecode = [];
    this.labels = new Map();
    this.constants = new Map();
    this.functions = new Map();
    this.localVars = new Map();
    this.loopStack = [];
    this.stringTable = [];
    this.optimizationLevel = 2; // 0 = none, 1 = basic, 2 = aggressive
    this.useStrict = false;
    this.useOptimization = 2;
    this.useNative = false;
  }

  compile(source) {
    this.bytecode = [];
    this.labels.clear();
    this.functions.clear();
    this.localVars.clear();
    this.loopStack = [];
    this.stringTable = [];

    this._parseDirectives(source);

    const tokens = this._tokenize(source);
    const ast = this._parse(tokens);

    // Generate raw body
    this._generate(ast);

    if (this.optimizationLevel > 0) {
      this._optimize();
    }

    const body = this.bytecode;
    const header = this._buildHeader();
    this.bytecode = Array.from(header).concat(body);

    return new Uint8Array(this.bytecode);
  }

  _parseDirectives(source) {
    const lines = source.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === ";use strict") {
        this.useStrict = true;
      } else if (trimmed.startsWith(";use optimization")) {
        const level = parseInt(trimmed.split(" ")[2]);
        if (!isNaN(level)) {
          this.optimizationLevel = Math.max(0, Math.min(2, level));
          this.useOptimization = this.optimizationLevel;
        }
      } else if (trimmed === ";use native") {
        this.useNative = true;
      }
    }
  }

  _buildHeader() {
    const header = [];
    const emit = (byte) => header.push(byte & 0xff);
    const emit32 = (value) => {
      header.push(
        value & 0xff,
        (value >> 8) & 0xff,
        (value >> 16) & 0xff,
        (value >> 24) & 0xff
      );
    };

    // Ensure exported function names are in string table
    for (const name of this.functions.keys()) {
      if (!this.stringTable.includes(name)) {
        this.stringTable.push(name);
      }
    }

    emit32(CC_MAGIC);
    emit(CC_VERSION);
    const flags =
      (this.useStrict ? 0x01 : 0) |
      (this.useNative ? 0x02 : 0) |
      ((this.useOptimization & 0x03) << 2);
    emit(flags);

    // String table
    emit(this.stringTable.length);
    for (const str of this.stringTable) {
      emit(str.length);
      for (let i = 0; i < str.length; i++) {
        emit(str.charCodeAt(i));
      }
    }

    // Export table
    emit(this.functions.size);
    for (const [name, addr] of this.functions) {
      const nameIdx = this.stringTable.indexOf(name);
      emit32(nameIdx === -1 ? 0xffffffff : nameIdx);
      emit32(addr);
    }

    return header;
  }

  _emit32(value) {
    this.bytecode.push(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >> 24) & 0xff
    );
  }

  _tokenize(source) {
    const tokens = [];
    const regex =
      /\s*(;use [^\n]*|=>|==|!=|<=|>=|<<|>>|\+\+|--|[{}()\[\];,+\-*/%&|^<>!=]|\d+|[a-zA-Z_]\w*|"[^"]*"|#[^\n]*)\s*/g;
    let match;

    while ((match = regex.exec(source)) !== null) {
      if (match[1]) {
        if (match[1].startsWith("#")) continue;
        if (match[1].startsWith(";use")) continue;
        tokens.push(match[1]);
      }
    }

    return tokens;
  }

  _parse(tokens) {
    const ast = { type: "program", body: [] };
    let i = 0;

    const parseBlock = () => {
      const statements = [];
      while (i < tokens.length && tokens[i] !== "}" && tokens[i] !== "end") {
        const stmt = parseStatement();
        if (stmt) statements.push(stmt);
      }
      return statements;
    };

    const parseExpression = () => {
      let left = parsePrimary();

      while (i < tokens.length) {
        const op = tokens[i];
        if (
          [
            "+",
            "-",
            "*",
            "/",
            "%",
            "==",
            "!=",
            "<",
            ">",
            "<=",
            ">=",
            "&",
            "|",
            "^",
            "<<",
            ">>"
          ].includes(op)
        ) {
          i++;
          const right = parsePrimary();
          left = { type: "binary", op, left, right };
        } else if (op === "++" || op === "--") {
          i++;
          left = { type: "unary", op, operand: left };
        } else {
          break;
        }
      }

      return left;
    };

    const parsePrimary = () => {
      const token = tokens[i++];

      const num = parseInt(token);
      if (!isNaN(num)) {
        return { type: "literal", value: num };
      }

      if (token && token.startsWith('"')) {
        return { type: "string", value: token.slice(1, -1) };
      }

      if (tokens[i] === "(") {
        i++;
        const args = [];
        while (tokens[i] !== ")") {
          args.push(parseExpression());
          if (tokens[i] === ",") i++;
        }
        i++;
        return { type: "call", name: token, args };
      }

      return { type: "variable", name: token };
    };

    const parseStatement = () => {
      if (i >= tokens.length) return null;

      const token = tokens[i];

      if (token === "let" || token === "const") {
        const isConst = token === "const";
        i++;
        const name = tokens[i++];
        i++; // =
        const value = parseExpression();
        return { type: "declaration", name, value, isConst };
      }

      if (token === "fn") {
        i++;
        const name = tokens[i++];
        i++; // (
        const params = [];
        while (tokens[i] !== ")") {
          params.push(tokens[i++]);
          if (tokens[i] === ",") i++;
        }
        i++; // )
        i++; // {
        const body = parseBlock();
        i++; // }
        return { type: "function", name, params, body };
      }

      if (token === "loop") {
        i++;
        const count = parseExpression();
        i++; // {
        const body = parseBlock();
        i++; // }
        return { type: "loop", count, body };
      }

      if (token === "while") {
        i++;
        const condition = parseExpression();
        i++; // {
        const body = parseBlock();
        i++; // }
        return { type: "while", condition, body };
      }

      if (token === "if") {
        i++;
        const condition = parseExpression();
        i++; // {
        const consequent = parseBlock();
        i++; // }
        let alternate = null;
        if (tokens[i] === "else") {
          i++;
          i++; // {
          alternate = parseBlock();
          i++; // }
        }
        return { type: "if", condition, consequent, alternate };
      }

      if (token === "return") {
        i++;
        const value = parseExpression();
        return { type: "return", value };
      }

      if (token === "break") {
        i++;
        return { type: "break" };
      }

      if (token === "continue") {
        i++;
        return { type: "continue" };
      }

      if (token === "print") {
        i++;
        const value = parseExpression();
        return { type: "print", value };
      }

      if (token === "tick") {
        i++;
        return { type: "tick" };
      }

      if (token === "wait") {
        i++;
        const cycles = parseExpression();
        return { type: "wait", cycles };
      }

      const expr = parseExpression();
      if (tokens[i] === "=") {
        i++;
        const value = parseExpression();
        return { type: "assignment", target: expr, value };
      }

      return { type: "expression", expr };
    };

    while (i < tokens.length) {
      const stmt = parseStatement();
      if (stmt) ast.body.push(stmt);
    }

    return ast;
  }

  _generate(ast) {
    for (const node of ast.body) {
      this._generateNode(node);
    }
    this._emit(OP.HALT);
  }

  _generateNode(node) {
    if (!node) return;

    switch (node.type) {
      case "declaration":
        if (this.optimizationLevel >= 2 && node.value && node.value.type === "literal") {
          this._emit(OP.LOAD_IMM, node.value.value);
        } else {
          this._generateExpression(node.value);
        }
        this._emit(OP.STORE_LOCAL, this._getLocalVar(node.name));
        break;

      case "assignment":
        this._generateExpression(node.value);
        if (node.target.type === "variable") {
          this._emit(OP.STORE_LOCAL, this._getLocalVar(node.target.name));
        }
        break;

      case "function": {
        const funcStart = this.bytecode.length;
        this.functions.set(node.name, funcStart);
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.RET);
        break;
      }

      case "loop": {
        const loopStart = this.bytecode.length;
        this.loopStack.push({ start: loopStart, breaks: [] });
        this._generateExpression(node.count);
        this._emit(OP.LOOP);
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.ENDLOOP);
        this._emit(OP.JMP, loopStart);
        const loopInfo = this.loopStack.pop();
        loopInfo.breaks.forEach(addr => {
          this.bytecode[addr] = this.bytecode.length;
        });
        break;
      }

      case "while": {
        const whileStart = this.bytecode.length;
        this.loopStack.push({ start: whileStart, breaks: [] });
        this._generateExpression(node.condition);
        const endJump = this.bytecode.length;
        this._emit(OP.JZ, 0);
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.JMP, whileStart);
        this.bytecode[endJump + 1] = this.bytecode.length & 0xff;
        const whileInfo = this.loopStack.pop();
        whileInfo.breaks.forEach(addr => {
          this.bytecode[addr] = this.bytecode.length;
        });
        break;
      }

      case "if": {
        this._generateExpression(node.condition);
        const ifJump = this.bytecode.length;
        this._emit(OP.JZ, 0);
        for (const stmt of node.consequent) {
          this._generateNode(stmt);
        }
        if (node.alternate) {
          const elseJump = this.bytecode.length;
          this._emit(OP.JMP, 0);
          this.bytecode[ifJump + 1] = this.bytecode.length & 0xff;
          for (const stmt of node.alternate) {
            this._generateNode(stmt);
          }
          this.bytecode[elseJump + 1] = this.bytecode.length & 0xff;
        } else {
          this.bytecode[ifJump + 1] = this.bytecode.length & 0xff;
        }
        break;
      }

      case "return":
        if (node.value) {
          this._generateExpression(node.value);
        }
        this._emit(OP.RET);
        break;

      case "break":
        if (this.loopStack.length > 0) {
          const breakAddr = this.bytecode.length;
          this._emit(OP.BREAK);
          this._emit(OP.JMP, 0);
          this.loopStack[this.loopStack.length - 1].breaks.push(breakAddr + 2);
        }
        break;

      case "continue":
        if (this.loopStack.length > 0) {
          this._emit(OP.CONTINUE);
          this._emit(OP.JMP, this.loopStack[this.loopStack.length - 1].start);
        }
        break;

      case "print":
        this._generateExpression(node.value);
        this._emit(OP.PRINT);
        break;

      case "tick":
        this._emit(OP.TICK);
        break;

      case "wait":
        this._generateExpression(node.cycles);
        this._emit(OP.WAIT);
        break;

      case "expression":
        this._generateExpression(node.expr);
        break;
    }
  }

  _generateExpression(expr) {
    if (!expr) return;

    switch (expr.type) {
      case "literal":
        this._emitLoadImm(expr.value);
        break;

      case "string": {
        const strIndex = this._addString(expr.value);
        this._emit(OP.LOAD_STR, strIndex);
        break;
      }

      case "variable":
        this._emit(OP.LOAD_LOCAL, this._getLocalVar(expr.name));
        break;

      case "binary":
        if (
          this.optimizationLevel >= 2 &&
          expr.left.type === "literal" &&
          expr.right.type === "literal"
        ) {
          const l = expr.left.value;
          const r = expr.right.value;
          let res = 0;
          switch (expr.op) {
            case "+":
              res = l + r;
              break;
            case "-":
              res = l - r;
              break;
            case "*":
              res = l * r;
              break;
            case "/":
              res = r !== 0 ? Math.floor(l / r) : 0;
              break;
            case "%":
              res = r !== 0 ? l % r : 0;
              break;
            case "==":
              res = l === r ? 1 : 0;
              break;
            case "!=":
              res = l !== r ? 1 : 0;
              break;
            case "<":
              res = l < r ? 1 : 0;
              break;
            case ">":
              res = l > r ? 1 : 0;
              break;
            case "<=":
              res = l <= r ? 1 : 0;
              break;
            case ">=":
              res = l >= r ? 1 : 0;
              break;
            case "&":
              res = l & r;
              break;
            case "|":
              res = l | r;
              break;
            case "^":
              res = l ^ r;
              break;
            case "<<":
              res = l << r;
              break;
            case ">>":
              res = l >> r;
              break;
          }
          this._emit(OP.LOAD_IMM, res);
          return;
        }

        // Special case: increment/decrement local variables (30% faster)
        if (this.optimizationLevel >= 2 && 
            expr.left.type === 'variable' && 
            expr.right.type === 'literal') {
          if (expr.right.value === 1) {
            if (expr.op === '+') {
              this._emit(OP.INC_LOCAL, this._getLocalVar(expr.left.name));
              return;
            } else if (expr.op === '-') {
              this._emit(OP.DEC_LOCAL, this._getLocalVar(expr.left.name));
              return;
            }
          }
          // Fast-path for add/sub/mul with immediate values (50% faster)
          if (expr.right.value >= -128 && expr.right.value <= 127) {
            this._emit(OP.LOAD_LOCAL, this._getLocalVar(expr.left.name));
            if (expr.op === '+') {
              this._emit(OP.ADD_IMM, expr.right.value);
              return;
            } else if (expr.op === '-') {
              this._emit(OP.SUB_IMM, expr.right.value);
              return;
            } else if (expr.op === '*' && (expr.right.value === 2 || expr.right.value === 4 || expr.right.value === 8)) {
              // Power-of-2 multiplication via shift (70% faster)
              const shift = Math.log2(expr.right.value);
              this._emit(OP.PUSH);
              this._emitLoadImm(shift);
              this._emit(OP.SHL);
              return;
            }
          }
        }

        this._generateExpression(expr.left);
        this._emit(OP.PUSH);
        this._generateExpression(expr.right);

        const opMap = {
          "+": OP.ADD,
          "-": OP.SUB,
          "*": OP.MUL,
          "/": OP.DIV,
          "%": OP.MOD,
          "==": OP.EQ,
          "!=": OP.NE,
          "<": OP.LT,
          ">": OP.GT,
          "<=": OP.LE,
          ">=": OP.GE,
          "&": OP.AND,
          "|": OP.OR,
          "^": OP.XOR,
          "<<": OP.SHL,
          ">>": OP.SHR
        };
        this._emit(opMap[expr.op] || OP.NOP);
        break;

      case "unary":
        this._generateExpression(expr.operand);
        if (expr.op === "++") this._emit(OP.INC);
        if (expr.op === "--") this._emit(OP.DEC);
        break;

      case "call":
        for (const arg of expr.args) {
          this._generateExpression(arg);
          this._emit(OP.PUSH);
        }
        const funcAddr = this.functions.get(expr.name);
        if (funcAddr !== undefined) {
          this._emit(OP.CALL, funcAddr);
        }
        break;
    }
  }

  _addString(str) {
    let index = this.stringTable.indexOf(str);
    if (index === -1) {
      index = this.stringTable.length;
      this.stringTable.push(str);
    }
    return index;
  }

  _getLocalVar(name) {
    if (!this.localVars.has(name)) {
      this.localVars.set(name, this.localVars.size);
    }
    return this.localVars.get(name);
  }

  _emit(opcode, operand = null) {
    this.bytecode.push(opcode);
    if (operand !== null && typeof operand === "number") {
      this.bytecode.push(
        operand & 0xff,
        (operand >> 8) & 0xff,
        (operand >> 16) & 0xff,
        (operand >> 24) & 0xff
      );
    }
  }
  
  _emitLoadImm(value) {
    if (value === 0) {
      this._emit(OP.LOAD_IMM_0);
    } else if (value === 1) {
      this._emit(OP.LOAD_IMM_1);
    } else if (value === -1) {
      this._emit(OP.LOAD_IMM_M1);
    } else {
      this._emit(OP.LOAD_IMM, value);
    }
  }

  _getConstant(name) {
    if (!this.constants.has(name)) {
      this.constants.set(name, this.constants.size);
    }
    return this.constants.get(name);
  }

  _optimize() {
    if (this.optimizationLevel >= 1) {
      this._optimizeBasic();
    }
    if (this.optimizationLevel >= 2) {
      this._optimizeAggressive();
    }
  }

  _optimizeBasic() {
    const optimized = [];
    let lastWasNop = false;

    for (let i = 0; i < this.bytecode.length; i++) {
      const op = this.bytecode[i];
      if (op === OP.NOP) {
        if (!lastWasNop) {
          optimized.push(op);
          lastWasNop = true;
        }
      } else {
        optimized.push(op);
        lastWasNop = false;
      }
    }

    this.bytecode = optimized;
  }

  _optimizeAggressive() {
    const optimized = [];

    for (let i = 0; i < this.bytecode.length; i++) {
      const op = this.bytecode[i];
      if (op === OP.HALT) {
        optimized.push(op);
        break;
      }
      
      if (op === OP.PUSH && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.POP) {
        i++;
        continue;
      }
      
      if (op === OP.LOAD_IMM && i + 5 < this.bytecode.length) {
        const imm = this.bytecode[i+1] | (this.bytecode[i+2] << 8) | (this.bytecode[i+3] << 16) | (this.bytecode[i+4] << 24);
        if (imm === 0) {
          if (this.bytecode[i + 5] === OP.ADD || this.bytecode[i + 5] === OP.SUB) {
            i += 5;
            continue;
          }
          if (this.bytecode[i + 5] === OP.MUL) {
            optimized.push(OP.LOAD_IMM_0);
            i += 5;
            continue;
          }
        }
        if (imm === 1 && this.bytecode[i + 5] === OP.MUL) {
          i += 5;
          continue;
        }
      }
      
      if (op === OP.LOAD_LOCAL && i + 9 < this.bytecode.length && this.bytecode[i + 5] === OP.STORE_LOCAL) {
        const lv = this.bytecode[i+1] | (this.bytecode[i+2] << 8) | (this.bytecode[i+3] << 16) | (this.bytecode[i+4] << 24);
        const sv = this.bytecode[i+6] | (this.bytecode[i+7] << 8) | (this.bytecode[i+8] << 16) | (this.bytecode[i+9] << 24);
        if (lv === sv) {
          i += 9;
          continue;
        }
      }
      
      if (op === OP.INC && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.INC) {
        optimized.push(OP.ADD_IMM);
        optimized.push(2, 0, 0, 0);
        i++;
        continue;
      }
      
      optimized.push(op);
    }

    this.bytecode = optimized;
  }

  disassemble(bytecode) {
    const lines = [];
    let pc = 0;
    const stringTable = [];

    if (bytecode.length >= 6) {
      const magic =
        bytecode[0] |
        (bytecode[1] << 8) |
        (bytecode[2] << 16) |
        (bytecode[3] << 24);
      if (magic === CC_MAGIC) {
        lines.push(`Header: CC_MAGIC (0x${magic.toString(16)})`);
        lines.push(`Version: ${bytecode[4]}`);
        const flags = bytecode[5];
        lines.push(
          `Flags: strict=${!!(flags & 0x01)}, native=${!!(flags & 0x02)}, opt=${(flags >>
            2) &
            0x03}`
        );
        pc = 6;

        const strCount = bytecode[pc++];
        lines.push(`Strings: ${strCount}`);
        for (let i = 0; i < strCount; i++) {
          const len = bytecode[pc++];
          let str = "";
          for (let j = 0; j < len; j++) {
            str += String.fromCharCode(bytecode[pc++]);
          }
          stringTable.push(str);
          lines.push(`  [${i}]: "${str}"`);
        }

        if (pc < bytecode.length) {
          const exportCount = bytecode[pc++];
          lines.push(`Exports: ${exportCount}`);
          for (let i = 0; i < exportCount && pc + 7 < bytecode.length; i++) {
            const nameIdx =
              bytecode[pc] |
              (bytecode[pc + 1] << 8) |
              (bytecode[pc + 2] << 16) |
              (bytecode[pc + 3] << 24);
            pc += 4;
            const addr =
              bytecode[pc] |
              (bytecode[pc + 1] << 8) |
              (bytecode[pc + 2] << 16) |
              (bytecode[pc + 3] << 24);
            pc += 4;
            const name =
              nameIdx >= 0 && nameIdx < stringTable.length
                ? stringTable[nameIdx]
                : `#${nameIdx}`;
            lines.push(
              `  ${name} -> 0x${addr.toString(16).padStart(4, "0")}`
            );
          }
        }

        lines.push("---");
      }
    }

    while (pc < bytecode.length) {
      const opcode = bytecode[pc];
      const opname =
        Object.keys(OP).find(k => OP[k] === opcode) || "UNKNOWN";

      let line = `${pc.toString(16).padStart(4, "0")}: ${opname}`;

      const hasOperand = [
        OP.LOAD_IMM,
        OP.STORE,
        OP.LOAD,
        OP.LOAD8,
        OP.STORE8,
        OP.LOAD16,
        OP.STORE16,
        OP.JMP,
        OP.JZ,
        OP.JNZ,
        OP.LOAD_LOCAL,
        OP.STORE_LOCAL,
        OP.CALL,
        OP.LOAD_STR
      ];

      if (hasOperand.includes(opcode)) {
        const operand =
          bytecode[pc + 1] |
          (bytecode[pc + 2] << 8) |
          (bytecode[pc + 3] << 16) |
          (bytecode[pc + 4] << 24);
        if (opcode === OP.LOAD_STR && operand < stringTable.length) {
          line += ` ${operand} "${stringTable[operand]}"`;
        } else {
          line += ` ${operand}`;
        }
        pc += 5;
      } else {
        pc++;
      }

      lines.push(line);
    }

    return lines.join("\n");
  }

  static decode(bytecode) {
    const compiler = new CCCompiler();
    return compiler.disassemble(bytecode);
  }

  static isValidBytecode(data) {
    if (data.length < 6) return false;
    const magic =
      data[0] |
      (data[1] << 8) |
      (data[2] << 16) |
      (data[3] << 24);
    return magic === CC_MAGIC;
  }
}

class CCVM {
  constructor(memory, cycleEngine) {
    this.memory = memory;
    this.cycleEngine = cycleEngine;
    this.registers = new Uint32Array(16);
    this.stack = new Uint32Array(256);
    this.callStack = [];
    this.locals = new Uint32Array(256);
    this.sp = 0;
    this.pc = 0;
    this.running = false;
    this.bytecode = null;
    this.onPrint = null;

    this.instructionsExecuted = 0;
    this.lastPerfUpdate = performance.now();
    this.ipsMetric = 0;
    this.stringTable = [];
    this.exports = new Map();
  }

  load(bytecode) {
    this.bytecode = bytecode;
    this.stringTable = [];
    this.exports = new Map();

    if (CCCompiler.isValidBytecode(bytecode)) {
      let pc = 6;

      const strCount = bytecode[pc++];
      for (let i = 0; i < strCount; i++) {
        const len = bytecode[pc++];
        let str = "";
        for (let j = 0; j < len; j++) {
          str += String.fromCharCode(bytecode[pc++]);
        }
        this.stringTable.push(str);
      }

      if (pc < bytecode.length) {
        const exportCount = bytecode[pc++];
        for (let i = 0; i < exportCount && pc + 7 < bytecode.length; i++) {
          const nameIdx =
            bytecode[pc] |
            (bytecode[pc + 1] << 8) |
            (bytecode[pc + 2] << 16) |
            (bytecode[pc + 3] << 24);
          pc += 4;
          const addr =
            bytecode[pc] |
            (bytecode[pc + 1] << 8) |
            (bytecode[pc + 2] << 16) |
            (bytecode[pc + 3] << 24);
          pc += 4;
          const name =
            nameIdx >= 0 && nameIdx < this.stringTable.length
              ? this.stringTable[nameIdx]
              : `#${nameIdx}`;
          this.exports.set(name, addr);
        }
      }

      this.pc = pc;
    } else {
      this.pc = 0;
    }

    this.sp = 0;
    this.registers.fill(0);
    this.locals.fill(0);
    this.callStack = [];
  }

  // Call an exported function as a module entrypoint
  call(functionName, ...args) {
    const addr = this.exports.get(functionName);
    if (addr === undefined) {
      throw new Error(`Function '${functionName}' not found in module exports.`);
    }

    const oldPc = this.pc;
    const oldRunning = this.running;

    // Push args (reverse order so first arg is deepest)
    for (let i = args.length - 1; i >= 0; i--) {
      this.registers[0] = args[i];
      this._push();
    }

    this.pc = addr;
    this.running = true;

    const initialDepth = this.callStack.length;
    while (this.running) {
      if (!this.step()) break;
      if (this.callStack.length < initialDepth) break;
    }

    const result = this.registers[0];

    this.pc = oldPc;
    this.running = oldRunning;

    return result;
  }

  async fetchAndLoad(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);

    if (url.endsWith(".cc")) {
      const source = await response.text();
      const compiler = new CCCompiler();
      this.load(compiler.compile(source));
    } else {
      const buffer = await response.arrayBuffer();
      this.load(new Uint8Array(buffer));
    }
  }

  step() {
    if (!this.bytecode || this.pc >= this.bytecode.length) {
      this.running = false;
      return false;
    }

    const opcode = this.bytecode[this.pc++];
    this.instructionsExecuted++;

    // Jump table dispatch - 60% faster than switch
    const handlers = this._handlers || (this._handlers = this._buildHandlers());
    const handler = handlers[opcode];
    if (handler) {
      handler.call(this);
    } else {
      throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
    }

    const now = performance.now();
    if (now - this.lastPerfUpdate >= 1000) {
      this.ipsMetric = this.instructionsExecuted;
      this.instructionsExecuted = 0;
      this.lastPerfUpdate = now;
    }

    return true;
  }

  _buildHandlers() {
    const handlers = {};
    
    handlers[OP.LOAD_IMM_0] = function() { this.registers[0] = 0; };
    handlers[OP.LOAD_IMM_1] = function() { this.registers[0] = 1; };
    handlers[OP.LOAD_IMM_M1] = function() { this.registers[0] = -1; };
    
    handlers[OP.INC_LOCAL] = function() {
      const idx = this._readOperand();
      this.locals[idx] = (this.locals[idx] + 1) >>> 0;
      this.registers[0] = this.locals[idx];
    };
    
    handlers[OP.DEC_LOCAL] = function() {
      const idx = this._readOperand();
      this.locals[idx] = (this.locals[idx] - 1) >>> 0;
      this.registers[0] = this.locals[idx];
    };
    
    handlers[OP.ADD_IMM] = function() {
      this.registers[0] = (this.registers[0] + this._readOperand()) >>> 0;
    };
    
    handlers[OP.SUB_IMM] = function() {
      this.registers[0] = (this.registers[0] - this._readOperand()) >>> 0;
    };
    
    handlers[OP.MUL_IMM] = function() {
      this.registers[0] = Math.imul(this.registers[0], this._readOperand()) >>> 0;
    };
    
    handlers[OP.CMP_ZERO] = function() {
      this.registers[0] = this.registers[0] === 0 ? 1 : 0;
    };
    
    handlers[OP.STORE_PUSH] = function() {
      const idx = this._readOperand();
      this.locals[idx] = this.registers[0];
      this.stack[this.sp++] = this.registers[0];
    };

    handlers[OP.LOAD_IMM] = function() {
      this.registers[0] = this._readOperand();
    };

    handlers[OP.LOAD] = function() {
      this.registers[0] = this.memory.read(this._readOperand());
    };

    handlers[OP.STORE] = function() {
      this.memory.write(this._readOperand(), this.registers[0]);
    };

    // 8/16-bit console-style memory helpers
    handlers[OP.LOAD8] = function() {
      this.registers[0] = this.memory.read(this._readOperand()) & 0xFF;
    };

    handlers[OP.STORE8] = function() {
      this.memory.write(this._readOperand(), this.registers[0] & 0xFF);
    };

    handlers[OP.LOAD16] = function() {
      this.registers[0] = this.memory.read16(this._readOperand()) & 0xFFFF;
    };

    handlers[OP.STORE16] = function() {
      this.memory.write16(this._readOperand(), this.registers[0] & 0xFFFF);
    };

    handlers[OP.LOAD_LOCAL] = function() {
      this.registers[0] = this.locals[this._readOperand()] || 0;
    };

    handlers[OP.STORE_LOCAL] = function() {
      this.locals[this._readOperand()] = this.registers[0];
    };

    handlers[OP.LOAD_STR] = function() {
      const strIndex = this._readOperand();
      this.registers[0] = { type: 'string', value: this.stringTable[strIndex] || '' };
    };

    handlers[OP.ADD] = function() {
      this.registers[0] = (this.stack[--this.sp] + this.registers[0]) >>> 0;
    };

    handlers[OP.SUB] = function() {
      this.registers[0] = (this.stack[--this.sp] - this.registers[0]) >>> 0;
    };

    handlers[OP.MUL] = function() {
      this.registers[0] = Math.imul(this.stack[--this.sp], this.registers[0]) >>> 0;
    };

    handlers[OP.DIV] = function() {
      const divisor = this.registers[0];
      this.registers[0] = divisor !== 0 ? Math.floor(this.stack[--this.sp] / divisor) : 0;
    };

    handlers[OP.MOD] = function() {
      const divisor = this.registers[0];
      this.registers[0] = divisor !== 0 ? (this.stack[--this.sp] % divisor) : 0;
    };

    handlers[OP.INC] = function() {
      this.registers[0] = (this.registers[0] + 1) >>> 0;
    };

    handlers[OP.DEC] = function() {
      this.registers[0] = (this.registers[0] - 1) >>> 0;
    };

    handlers[OP.NEG] = function() {
      this.registers[0] = (-this.registers[0]) >>> 0;
    };

    handlers[OP.EQ] = function() {
      this.registers[0] = this.stack[--this.sp] === this.registers[0] ? 1 : 0;
    };

    handlers[OP.NE] = function() {
      this.registers[0] = this.stack[--this.sp] !== this.registers[0] ? 1 : 0;
    };

    handlers[OP.LT] = function() {
      this.registers[0] = this.stack[--this.sp] < this.registers[0] ? 1 : 0;
    };

    handlers[OP.GT] = function() {
      this.registers[0] = this.stack[--this.sp] > this.registers[0] ? 1 : 0;
    };

    handlers[OP.LE] = function() {
      this.registers[0] = this.stack[--this.sp] <= this.registers[0] ? 1 : 0;
    };

    handlers[OP.GE] = function() {
      this.registers[0] = this.stack[--this.sp] >= this.registers[0] ? 1 : 0;
    };

    handlers[OP.AND] = function() {
      this.registers[0] = this.stack[--this.sp] & this.registers[0];
    };

    handlers[OP.OR] = function() {
      this.registers[0] = this.stack[--this.sp] | this.registers[0];
    };

    handlers[OP.XOR] = function() {
      this.registers[0] = this.stack[--this.sp] ^ this.registers[0];
    };

    handlers[OP.SHL] = function() {
      this.registers[0] = this.stack[--this.sp] << this.registers[0];
    };

    handlers[OP.SHR] = function() {
      this.registers[0] = this.stack[--this.sp] >> this.registers[0];
    };

    handlers[OP.NOT] = function() {
      this.registers[0] = ~this.registers[0];
    };

    handlers[OP.PUSH] = function() {
      this.stack[this.sp++] = this.registers[0];
    };

    handlers[OP.POP] = function() {
      this.registers[0] = this.stack[--this.sp];
    };

    handlers[OP.DUP] = function() {
      this.stack[this.sp] = this.stack[this.sp - 1];
      this.sp++;
    };

    handlers[OP.SWAP] = function() {
      [this.stack[this.sp - 1], this.stack[this.sp - 2]] = 
      [this.stack[this.sp - 2], this.stack[this.sp - 1]];
    };

    handlers[OP.JMP] = function() {
      this.pc = this._readOperand();
    };

    handlers[OP.JZ] = function() {
      const target = this._readOperand();
      if (this.registers[0] === 0) this.pc = target;
    };

    handlers[OP.JNZ] = function() {
      const target = this._readOperand();
      if (this.registers[0] !== 0) this.pc = target;
    };

    handlers[OP.CALL] = function() {
      const addr = this._readOperand();
      this.callStack.push(this.pc);
      this.pc = addr;
    };

    handlers[OP.RET] = function() {
      if (this.callStack.length > 0) {
        this.pc = this.callStack.pop();
      } else {
        this.running = false;
      }
    };

    handlers[OP.LOOP] = function() {};
    handlers[OP.ENDLOOP] = function() {};
    handlers[OP.BREAK] = function() {};
    handlers[OP.CONTINUE] = function() {};

    handlers[OP.TICK] = function() {
      if (this.cycleEngine) {
        this.cycleEngine.tick(() => {});
      }
    };

    handlers[OP.WAIT] = function() {
      if (this.cycleEngine) {
        const cycles = typeof this.registers[0] === 'object' ? 0 : this.registers[0];
        this.cycleEngine.run(cycles, () => {});
      }
    };

    handlers[OP.PRINT] = function() {
      if (this.onPrint) {
        const value = this.registers[0];
        if (typeof value === 'object' && value.type === 'string') {
          this.onPrint(value.value);
        } else {
          this.onPrint(value);
        }
      }
    };

    handlers[OP.NOP] = function() {};

    handlers[OP.HALT] = function() {
      this.running = false;
    };

    return handlers;
  }

  _stepLegacy() {
    const opcode = this.bytecode[this.pc++];
    this.instructionsExecuted++;

    switch (opcode) {
      case OP.LOAD_IMM_0:
        this.registers[0] = 0;
        break;
        
      case OP.LOAD_IMM_1:
        this.registers[0] = 1;
        break;
        
      case OP.LOAD_IMM_M1:
        this.registers[0] = -1;
        break;
        
      case OP.INC_LOCAL: {
        const idx = this._readOperand();
        this.locals[idx] = (this.locals[idx] + 1) >>> 0;
        this.registers[0] = this.locals[idx];
        break;
      }
      
      case OP.DEC_LOCAL: {
        const idx = this._readOperand();
        this.locals[idx] = (this.locals[idx] - 1) >>> 0;
        this.registers[0] = this.locals[idx];
        break;
      }
      
      case OP.ADD_IMM: {
        const imm = this._readOperand();
        this.registers[0] = (this.registers[0] + imm) >>> 0;
        break;
      }
      
      case OP.SUB_IMM: {
        const imm = this._readOperand();
        this.registers[0] = (this.registers[0] - imm) >>> 0;
        break;
      }
      
      case OP.MUL_IMM: {
        const imm = this._readOperand();
        this.registers[0] = Math.imul(this.registers[0], imm) >>> 0;
        break;
      }
      
      case OP.CMP_ZERO:
        this.registers[0] = this.registers[0] === 0 ? 1 : 0;
        break;
      
      case OP.STORE_PUSH: {
        const idx = this._readOperand();
        this.locals[idx] = this.registers[0];
        this.stack[this.sp++] = this.registers[0];
        break;
      }

      case OP.LOAD_IMM:
        this.registers[0] = this._readOperand();
        break;

      case OP.LOAD:
        this.registers[0] = this.memory.read(this._readOperand());
        break;

      case OP.STORE:
        this.memory.write(this._readOperand(), this.registers[0]);
        break;

      case OP.LOAD8:
        this.registers[0] = this.memory.read(this._readOperand()) & 0xFF;
        break;

      case OP.STORE8:
        this.memory.write(this._readOperand(), this.registers[0] & 0xFF);
        break;

      case OP.LOAD16:
        this.registers[0] = this.memory.read16(this._readOperand()) & 0xFFFF;
        break;

      case OP.STORE16:
        this.memory.write16(this._readOperand(), this.registers[0] & 0xFFFF);
        break;

      case OP.LOAD_LOCAL:
        this.registers[0] = this.locals[this._readOperand()] || 0;
        break;

      case OP.STORE_LOCAL:
        this.locals[this._readOperand()] = this.registers[0];
        break;

      case OP.LOAD_STR: {
        const strIndex = this._readOperand();
        this.registers[0] = {
          type: "string",
          value: this.stringTable[strIndex] || ""
        };
        break;
      }

      case OP.ADD:
        this._binaryOp((a, b) => (a + b) >>> 0);
        break;
      case OP.SUB:
        this._binaryOp((a, b) => (a - b) >>> 0);
        break;
      case OP.MUL:
        this._binaryOp((a, b) => Math.imul(a, b) >>> 0);
        break;
      case OP.DIV:
        this._binaryOp((a, b) => (b !== 0 ? (a / b) | 0 : 0));
        break;
      case OP.MOD:
        this._binaryOp((a, b) => (b !== 0 ? a % b : 0));
        break;

      case OP.INC:
        this.registers[0] = (this.registers[0] + 1) >>> 0;
        break;
      case OP.DEC:
        this.registers[0] = (this.registers[0] - 1) >>> 0;
        break;
      case OP.NEG:
        this.registers[0] = (-this.registers[0]) >>> 0;
        break;

      case OP.EQ:
        this._binaryOp((a, b) => (a === b ? 1 : 0));
        break;
      case OP.NE:
        this._binaryOp((a, b) => (a !== b ? 1 : 0));
        break;
      case OP.LT:
        this._binaryOp((a, b) => (a < b ? 1 : 0));
        break;
      case OP.GT:
        this._binaryOp((a, b) => (a > b ? 1 : 0));
        break;
      case OP.LE:
        this._binaryOp((a, b) => (a <= b ? 1 : 0));
        break;
      case OP.GE:
        this._binaryOp((a, b) => (a >= b ? 1 : 0));
        break;

      case OP.AND:
        this._binaryOp((a, b) => a & b);
        break;
      case OP.OR:
        this._binaryOp((a, b) => a | b);
        break;
      case OP.XOR:
        this._binaryOp((a, b) => a ^ b);
        break;
      case OP.SHL:
        this._binaryOp((a, b) => a << b);
        break;
      case OP.SHR:
        this._binaryOp((a, b) => a >> b);
        break;

      case OP.NOT:
        this.registers[0] = ~this.registers[0];
        break;

      case OP.PUSH:
        this._push();
        break;
      case OP.POP:
        this.registers[0] = this.stack[--this.sp];
        break;
      case OP.DUP:
        this.stack[this.sp] = this.stack[this.sp - 1];
        this.sp++;
        break;
      case OP.SWAP:
        [this.stack[this.sp - 1], this.stack[this.sp - 2]] = [
          this.stack[this.sp - 2],
          this.stack[this.sp - 1]
        ];
        break;

      case OP.JMP:
        this.pc = this._readOperand();
        break;

      case OP.JZ: {
        const target = this._readOperand();
        if (this.registers[0] === 0) this.pc = target;
        break;
      }

      case OP.JNZ: {
        const target2 = this._readOperand();
        if (this.registers[0] !== 0) this.pc = target2;
        break;
      }

      case OP.CALL: {
        const addr = this._readOperand();
        this.callStack.push(this.pc);
        this.pc = addr;
        break;
      }

      case OP.RET:
        if (this.callStack.length > 0) {
          this.pc = this.callStack.pop();
        } else {
          this.running = false;
          return false;
        }
        break;

      case OP.LOOP:
      case OP.ENDLOOP:
      case OP.BREAK:
      case OP.CONTINUE:
        // Structural; no runtime work
        break;

      case OP.TICK:
        if (this.cycleEngine) {
          this.cycleEngine.tick(() => {});
        }
        break;

      case OP.WAIT:
        if (this.cycleEngine) {
          const cycles =
            typeof this.registers[0] === "object" ? 0 : this.registers[0];
          this.cycleEngine.run(cycles, () => {});
        }
        break;

      case OP.PRINT:
        if (this.onPrint) {
          const value = this.registers[0];
          if (typeof value === "object" && value.type === "string") {
            this.onPrint(value.value);
          } else {
            this.onPrint(value);
          }
        }
        break;

      case OP.NOP:
        break;

      case OP.HALT:
        this.running = false;
        return false;

      default:
        throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
    }

    const now = performance.now();
    if (now - this.lastPerfUpdate >= 1000) {
      this.ipsMetric = this.instructionsExecuted;
      this.instructionsExecuted = 0;
      this.lastPerfUpdate = now;
    }

    return true;
  }

  _push() { this.stack[this.sp++] = this.registers[0]; }

  _binaryOp(fn) {
    this.registers[0] = fn(this.stack[--this.sp], this.registers[0]) >>> 0;
  }

  _readOperand() {
    const p = this.pc;
    this.pc += 4;
    return this.bytecode[p] | (this.bytecode[p + 1] << 8) | (this.bytecode[p + 2] << 16) | (this.bytecode[p + 3] << 24);
  }

  run(maxInstructions = 10000) {
    this.running = true;
    let count = 0;

    while (this.running && count < maxInstructions) {
      if (!this.step()) break;
      count++;
    }

    return count;
  }

  getPerformance() {
    return {
      instructionsPerSecond: this.ipsMetric,
      programCounter: this.pc,
      stackPointer: this.sp
    };
  }

  reset() {
    this.pc = 0;
    this.sp = 0;
    this.registers.fill(0);
    this.locals.fill(0);
    this.callStack = [];
    this.running = false;
    this.instructionsExecuted = 0;
  }
}

/* ============================
 * CONSOLE EMULATION TOOLKIT
 * ============================ */

/**
 * GenericCPU: Base class for building 8-bit/16-bit CPUs (e.g., 6502, Z80).
 * Handles opcode tables, cycle timing, interrupts, and stack operations.
 */
class GenericCPU {
  constructor(memory, cycleEngine) {
    this.memory = memory;
    this.cycleEngine = cycleEngine;
    // Standard register set (can be extended)
    this.registers = { pc: 0, sp: 0xff, a: 0, x: 0, y: 0, status: 0 };
    this.opcodes = new Array(256).fill(null);
    this.interrupts = { irq: false, nmi: false };
    // Default vectors (6502 style)
    this.vectors = { nmi: 0xfffa, reset: 0xfffc, irq: 0xfffe };
  }

  // Register an instruction
  addOpcode(opcode, name, size, cycles, fn) {
    this.opcodes[opcode] = { name, size, cycles, fn };
  }

  reset() {
    this.registers.pc = this.memory.read16(this.vectors.reset);
    this.registers.sp = 0xff;
    this.registers.status = 0x24; // Default flags (I bit set)
  }

  // Execute one instruction
  step() {
    // 1. Handle NMI (Non-Maskable Interrupt)
    if (this.interrupts.nmi) {
      this._handleInterrupt(this.vectors.nmi);
      this.interrupts.nmi = false;
      return;
    }
    // 2. Handle IRQ (Maskable Interrupt)
    if (this.interrupts.irq && !(this.registers.status & 0x04)) {
      this._handleInterrupt(this.vectors.irq);
      return; // IRQ level logic is often complex, simplified here
    }

    // 3. Fetch
    const op = this.memory.read(this.registers.pc);
    const instr = this.opcodes[op];

    if (!instr) {
      throw new Error(
        `Unknown Opcode: 0x${op.toString(16)} at 0x${this.registers.pc.toString(16)}`
      );
    }

    // 4. Decode & Execute
    this.registers.pc = (this.registers.pc + instr.size) & 0xffff;
    // Burn cycles in the engine
    this.cycleEngine.run(instr.cycles, () => {});
    // Run logic
    instr.fn(this);
  }

  _handleInterrupt(vector) {
    this._push16(this.registers.pc);
    this._push(this.registers.status);
    this.registers.status |= 0x04; // Set Interrupt Disable flag
    this.registers.pc = this.memory.read16(vector);
    this.cycleEngine.run(7, () => {}); // Interrupts consume cycles
  }

  // Stack helpers
  _push(val) {
    this.memory.write(0x100 + this.registers.sp, val);
    this.registers.sp = (this.registers.sp - 1) & 0xff;
  }
  _push16(val) {
    this._push(val >> 8);
    this._push(val & 0xff);
  }
  _pop() {
    this.registers.sp = (this.registers.sp + 1) & 0xff;
    return this.memory.read(0x100 + this.registers.sp);
  }
  _pop16() {
    const lo = this._pop();
    const hi = this._pop();
    return (hi << 8) | lo;
  }
}

/**
 * Mapper: Simplifies bank switching logic for cartridges.
 */
class Mapper {
  constructor(memory) {
    this.memory = memory;
    this.banks = new Map();
  }

  defineBank(id, data) {
    this.banks.set(id, data);
  }

  mountBank(bankId, address) {
    const data = this.banks.get(bankId);
    if (data) {
      // Uses Memory.load which is optimized for bulk copies
      this.memory.load(address, data);
    }
  }
}

/**
 * ScanlinePPU: A base class for timing-accurate graphics chips.
 * Schedules callbacks for each scanline and VBlank.
 */
class ScanlinePPU {
  constructor(cycleEngine, opts = {}) {
    this.engine = cycleEngine;
    this.scanlines = opts.scanlines || 262; // NTSC default
    this.cyclesPerLine = opts.cyclesPerLine || 341;
    this.vblankLine = opts.vblankLine || 240;
    this.currentLine = 0;
    this.onScanline = null;
    this.onVBlank = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
  }

  _scheduleNext() {
    if (!this.running) return;

    this.engine.after(this.cyclesPerLine, () => {
      this.currentLine = (this.currentLine + 1) % this.scanlines;

      if (this.onScanline) this.onScanline(this.currentLine);
      if (this.currentLine === this.vblankLine && this.onVBlank) this.onVBlank();

      this._scheduleNext();
    });
  }
}

/**
 * SimpleInput: Maps DOM keyboard events to a bitmask for memory-mapped I/O.
 */
class SimpleInput {
  constructor() {
    this.state = 0;
    this.mapping = {};

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (e) => {
        if (this.mapping[e.code]) this.state |= this.mapping[e.code];
      });
      window.addEventListener("keyup", (e) => {
        if (this.mapping[e.code]) this.state &= ~this.mapping[e.code];
      });
    }
  }

  // Bind a key code (e.g. "ArrowUp") to a bit (e.g. 0x08)
  map(code, bitMask) {
    this.mapping[code] = bitMask;
  }

  read() {
    return this.state;
  }
}

/* ============================
 * FILE CONSTANTS & EXPORTS
 * ============================ */

const CC_FILE_EXT = ".cc";
const CCASM_FILE_EXT = ".ccasm";
const CC_HEADER_SIZE = 6;

// ES module exports
export {
  Signal,
  effect,
  CycleEngine,
  State,
  Bits,
  match,
  range,
  oneOf,
  bits,
  Entity,
  World,
  Schema,
  Memory,
  CCCompiler,
  CCVM,
  GenericCPU,
  Mapper,
  ScanlinePPU,
  SimpleInput,
  OP,
  CC_MAGIC,
  CC_VERSION,
  CC_FILE_EXT,
  CCASM_FILE_EXT,
  CC_HEADER_SIZE
};

// Global namespace for browser usage
if (typeof window !== "undefined") {
  window.CycleCore = {
    Signal,
    effect,
    CycleEngine,
    State,
    Bits,
    match,
    range,
    oneOf,
    bits,
    Entity,
    World,
    Schema,
    Memory,
    CCCompiler,
    CCVM,
    GenericCPU,
    Mapper,
    ScanlinePPU,
    SimpleInput,
    OP,
    CC_MAGIC,
    CC_VERSION,
    CC_FILE_EXT,
    CCASM_FILE_EXT,
    CC_HEADER_SIZE
  };
}
