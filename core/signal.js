"use strict";
// Reactive signals (better than simple state, composable)
export class Signal {
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

  // Computed signal (with cleanup to prevent leaks)
  map(fn) {
    const computed = new Signal(fn(this._value));
    const unsubscribe = this.subscribe(value => computed.set(fn(value)));
    computed._cleanup = unsubscribe;
    return computed;
  }

  // Clean up signal and all dependencies
  dispose() {
    if (this._cleanup) {
      this._cleanup();
      this._cleanup = null;
    }
    this._subscribers.clear();
  }

  // Combine multiple signals
  static combine(...signals) {
    const combined = new Signal(signals.map(s => s.get()));
    signals.forEach((signal, i) => {
      signal.subscribe(value => {
        const values = signals.map(s => s.get());
        combined.set(values);
      });
    });
    return combined;
  }

  // Debounced signal
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

// Effect - run side effects when signals change
export function effect(fn, ...signals) {
  fn();
  signals.forEach(signal => signal.subscribe(() => fn()));
}