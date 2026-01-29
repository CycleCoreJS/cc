"use strict";
// Core cycle-accurate execution engine optimized for ultimate speed
export class CycleEngine {
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

  // Schedule a callback after N cycles (now O(log n) instead of O(n log n))
  after(cycles, callback) {
    const timer = {
      triggerCycle: this.currentCycle + cycles,
      callback,
      id: Symbol('timer')
    };
    this.timerHeap.push(timer);
    return timer.id;
  }

  // Execute exactly one cycle (ultra-optimized hot path - inlined)
  tick(executor) {
    executor(this.currentCycle);
    this.currentCycle++;
    this.perfCounters.cyclesExecuted++;
    
    // Fast path: check min heap root
    while (this.timerHeap.size() > 0 && this.timerHeap.peek().triggerCycle <= this.currentCycle) {
      const timer = this.timerHeap.pop();
      timer.callback();
    }
  }

  // Run multiple cycles - unrolled and optimized for high-throughput
  run(cycles, executor) {
    const targetCycle = this.currentCycle + cycles;
    
    // High-performance cycle unrolling
    while (this.currentCycle < targetCycle) {
      // Execute 4 cycles per loop iteration if distance allows
      const remaining = targetCycle - this.currentCycle;
      const step = (remaining >= 4 && this.timerHeap.size() === 0) ? 4 : 1;
      
      for (let i = 0; i < step; i++) {
        executor(this.currentCycle);
        this.currentCycle++;
        this.perfCounters.cyclesExecuted++;
      }
      
      // Check timers only when necessary
      while (this.timerHeap.size() > 0 && this.timerHeap.peek().triggerCycle <= this.currentCycle) {
        const timer = this.timerHeap.pop();
        timer.callback();
      }
    }
  }

  // Start continuous execution with ultra-optimized frame limiting
  start(executor) {
    if (this.running) return;
    this.running = true;
    
    let lastFrameTime = performance.now();
    const targetFrameTime = 1000 / 60; // 60 FPS cap
    
    const loop = (currentTime) => {
      if (!this.running) return;
      
      // Frame limiting to prevent browser lock-up
      const elapsed = currentTime - lastFrameTime;
      if (elapsed < targetFrameTime) {
        this.frameId = requestAnimationFrame(loop);
        return;
      }
      
      lastFrameTime = currentTime;
      
      // Execute cycles
      this.run(this.cyclesPerFrame, executor);
      this.perfCounters.framesRendered++;
      
      // Update performance metrics every second
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

  // Set console emulation mode for engine; affects helpers and timing heuristics.
  // mode: { wordWidth: 4|8|16, cyclesPerFrame?: number }
  setConsoleMode(mode = {}) {
    if (mode.wordWidth) {
      this.wordWidth = mode.wordWidth;
    }
    if (mode.cyclesPerFrame) {
      this.cyclesPerFrame = mode.cyclesPerFrame;
    }
  }

  // Get performance metrics
  getPerformance() {
    return {
      cyclesPerSecond: this.cyclesPerSecond,
      framesPerSecond: this.framesPerSecond,
      totalCycles: this.currentCycle,
      wordWidth: this.wordWidth || 8
    };
  }
}

// Min-heap for O(log n) timer operations
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