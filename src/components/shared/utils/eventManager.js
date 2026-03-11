/**
 * EventManager - Lightweight publish/subscribe utility
 *
 * Provides a simple, dependency-free event bus for decoupling components.
 * Compatible with both browser and Node environments (for .NET MAUI WebView).
 *
 * @example
 *   const bus = new EventManager();
 *   bus.on('modal:shown', data => console.log(data));
 *   bus.emit('modal:shown', { message: 'Hello' });
 */
class EventManager {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
  }

  /**
   * Register a listener for an event.
   * @param {string}   eventName
   * @param {Function} callback
   * @returns {EventManager} this (for chaining)
   */
  on(eventName, callback) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, []);
    }
    this._listeners.get(eventName).push(callback);
    return this;
  }

  /**
   * Remove a previously registered listener.
   * @param {string}   eventName
   * @param {Function} callback
   * @returns {EventManager} this (for chaining)
   */
  off(eventName, callback) {
    if (!this._listeners.has(eventName)) return this;

    const callbacks = this._listeners.get(eventName);
    const idx = callbacks.indexOf(callback);
    if (idx > -1) {
      callbacks.splice(idx, 1);
    }
    return this;
  }

  /**
   * Emit an event, calling all registered listeners.
   * @param {string} eventName
   * @param {*}      [data=null]
   * @returns {EventManager} this (for chaining)
   */
  emit(eventName, data = null) {
    if (!this._listeners.has(eventName)) return this;

    for (const cb of this._listeners.get(eventName)) {
      try {
        cb(data);
      } catch (err) {
        console.error(`EventManager: error in listener for "${eventName}"`, err);
      }
    }
    return this;
  }

  /**
   * Remove all listeners (optionally for a specific event).
   * @param {string} [eventName]
   */
  clear(eventName) {
    if (eventName) {
      this._listeners.delete(eventName);
    } else {
      this._listeners.clear();
    }
  }
}

/* Make available globally in browser context */
if (typeof window !== 'undefined') {
  window.EventManager = EventManager;
}

/* CommonJS export for Node / bundler environments */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventManager;
}
