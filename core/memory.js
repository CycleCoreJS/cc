"use strict";
// Advanced memory management optimized for speed
export class Memory {
  constructor(size, config = {}) {
    this.size = size;
    this.data = new Uint8Array(size);
    this.watchers = new Map();
    this.readOnly = new Set(config.readOnly || []);
    this.mirrors = new Map(config.mirrors || []);
    
    // Console / bus width helper (4/8/16-bit friendly)
    // wordWidth: 4 | 8 | 16 (bits)
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
  static create4bit(size, opts = {}) {
    const mem = new Memory(size, { ...opts, wordWidth: 4 });
    return mem;
  }

  static create8bit(size, opts = {}) {
    const mem = new Memory(size, { ...opts, wordWidth: 8 });
    return mem;
  }

  static create16bit(size, opts = {}) {
    const mem = new Memory(size, { ...opts, wordWidth: 16 });
    return mem;
  }

  // Helper to map an MMIO region to a handler instead of raw storage (friendly for emulators)
  mapMMIO(rangeStart, rangeEnd, handlerTarget) {
    // store a mirror entry mapping a range key to a tuple: [type: 'mmio', target: handler]
    this.mirrors.set([rangeStart, rangeEnd], handlerTarget);
  }

  // Ultra-optimized read with aggressive fast path
  read(address) {
    this._checkBounds(address);
    this.perfCounters.reads++;
    
    // Ultra-fast path: direct typed array access (most common case)
    if (this.mirrors.size === 0 && this.watchers.size === 0) {
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
    
    // Ultra-fast path: direct typed array access
    if (this.mirrors.size === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      this.data[address] = value & 0xFF;
      return;
    }
    
    const realAddr = this._resolveAddress(address);
    
    if (this.readOnly.has(realAddr)) {
      throw new Error(`Attempt to write to read-only address 0x${realAddr.toString(16)}`);
    }

    const oldValue = this.data[realAddr];
    this.data[realAddr] = value & 0xFF;
    this._notifyWatchers(realAddr, 'write', value, oldValue);
  }

  // Read/write 16-bit values (little-endian)
  read16(address) {
    return this.read(address) | (this.read(address + 1) << 8);
  }

  write16(address, value) {
    this.write(address, value & 0xFF);
    this.write(address + 1, (value >> 8) & 0xFF);
  }

  // Watch memory changes
  watch(address, callback) {
    if (!this.watchers.has(address)) {
      this.watchers.set(address, []);
    }
    this.watchers.get(address).push(callback);
  }

  // Bulk operations (CPU-friendly, with fast paths)
  load(address, data) {
    if (!data || data.length === 0) return;

    // Bounds check once up-front
    this._checkBounds(address);
    this._checkBounds(address + data.length - 1);

    // Ultra-fast path: no mirrors, no watchers, no read-only
    if (this.mirrors.size === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      this.data.set(data, address);
      this.perfCounters.writes += data.length;
      return;
    }

    // Fallback to per-byte write (honors mirrors, read-only and watchers)
    for (let i = 0; i < data.length; i++) {
      this.write(address + i, data[i]);
    }
  }

  fill(address, length, value) {
    if (length <= 0) return;

    // Bounds check once up-front
    this._checkBounds(address);
    this._checkBounds(address + length - 1);

    const v = value & 0xFF;

    // Ultra-fast path: no mirrors, no watchers, no read-only
    if (this.mirrors.size === 0 && this.watchers.size === 0 && this.readOnly.size === 0) {
      this.data.fill(v, address, address + length);
      this.perfCounters.writes += length;
      return;
    }

    // Fallback to per-byte write (honors mirrors, read-only and watchers)
    for (let i = 0; i < length; i++) {
      this.write(address + i, v);
    }
  }

  // Get a view of memory
  slice(start, end) {
    return Array.from(this.data.slice(start, end));
  }

  // CPU/console-friendly helpers
  // Unsigned 8-bit
  read8(address) {
    return this.read(address) & 0xFF;
  }

  write8(address, value) {
    this.write(address, value & 0xFF);
  }

  // Signed 8-bit
  read8s(address) {
    const v = this.read8(address);
    return (v & 0x80) ? (v - 0x100) : v;
  }

  // Unsigned 16-bit (already exposed as read16/write16)
  read16u(address) {
    return this.read16(address) & 0xFFFF;
  }

  // Signed 16-bit
  read16s(address) {
    const v = this.read16(address) & 0xFFFF;
    return (v & 0x8000) ? (v - 0x10000) : v;
  }

  // Bulk read for DMA-style copies
  readBlock(address, length) {
    if (length <= 0) return new Uint8Array(0);
    this._checkBounds(address);
    this._checkBounds(address + length - 1);
    return this.data.slice(address, address + length);
  }

  // Block copy inside the same memory (useful for scrolling, sprite DMA, etc.)
  copy(fromAddress, toAddress, length) {
    if (length <= 0) return;
    this._checkBounds(fromAddress);
    this._checkBounds(fromAddress + length - 1);
    this._checkBounds(toAddress);
    this._checkBounds(toAddress + length - 1);

    // Use a temporary view to avoid overlap issues
    const tmp = this.data.slice(fromAddress, fromAddress + length);
    this.load(toAddress, tmp);
  }

  _resolveAddress(address) {
    // Handle memory mirrors
    for (const [range, target] of this.mirrors) {
      if (address >= range[0] && address <= range[1]) {
        return target + (address - range[0]);
      }
    }
    return address;
  }

  _checkBounds(address) {
    if (address < 0 || address >= this.size) {
      throw new Error(`Memory access out of bounds: 0x${address.toString(16)}`);
    }
  }

  _notifyWatchers(address, type, value, oldValue) {
    const watchers = this.watchers.get(address);
    if (watchers) {
      watchers.forEach(cb => cb({ address, type, value, oldValue }));
    }
  }

  // Get performance metrics
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