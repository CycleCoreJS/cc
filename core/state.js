"use strict";
// Immutable state management with time travel for debugging and replay systems
export class State {
  constructor(initial = {}) {
    this.current = { ...initial };
    this.history = [{ ...initial }];
    this.maxHistory = 100;
    this.subscribers = [];
  }

  // Get current state
  get(key) {
    return this.current[key];
  }

  // Update state immutably
  update(updates) {
    const newState = { ...this.current, ...updates };
    this.current = newState;
    
    // Add to history
    this.history.push({ ...newState });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Notify subscribers
    this.subscribers.forEach(cb => cb(newState));
    
    return newState;
  }

  // Batch updates
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

  // Time travel
  rewind(steps = 1) {
    if (this.history.length > steps) {
      this.history.splice(-steps);
      this.current = { ...this.history[this.history.length - 1] };
      this.subscribers.forEach(cb => cb(this.current));
    }
  }

  // Subscribe to changes
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  // Reset to initial state
  reset() {
    if (this.history.length > 0) {
      this.current = { ...this.history[0] };
      this.history = [{ ...this.history[0] }];
      this.subscribers.forEach(cb => cb(this.current));
    }
  }
}