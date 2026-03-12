'use strict';

/**
 * TouchHandler
 * Unified pointer/touch event handler for the map canvas.
 *
 * Supported gestures:
 *   - 1-finger tap        → onTap(clientX, clientY)
 *   - 1-finger drag       → onDrag(clientX, clientY)  (paint/select)
 *   - 1-finger drag (pan) → onPan(dx, dy)  (when getIsPanMode() returns true)
 *   - 2-finger pinch      → onPinchZoom(factor, pivotX, pivotY) + onPan(dx,dy)
 *   - Long press (500 ms) → onLongPress(clientX, clientY)
 *   - Finger lift         → onEnd()
 *
 * The component attaches its own event listeners via `init()` and does NOT
 * replace or remove the existing mouse wheel / mouse drag handlers on the
 * canvas.  Pointer events are preferred where available with a fallback to
 * the Touch Events API.
 */
class TouchHandler {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks - {
   *     onTap(clientX, clientY),
   *     onDrag(clientX, clientY),
   *     onPan(dx, dy),
   *     onPinchZoom(factor, pivotX, pivotY),
   *     onEnd(),
   *     onLongPress?(clientX, clientY),
   *     getIsPanMode?()   → boolean   (true when 1-finger should pan)
   *   }
   */
  constructor(canvas, callbacks) {
    this.canvas    = canvas;
    this.callbacks = callbacks;

    // Internal touch state
    this._lastDist         = null;   // last 2-finger distance (pixels)
    this._lastMid          = null;   // last 2-finger midpoint {x,y} (client coords)
    this._lastSingle       = null;   // last 1-finger position {x,y} (client coords)
    this._longTimer        = null;   // setTimeout handle for long-press
    this._LONG_MS          = 500;    // milliseconds before long-press fires
    this._MOVEMENT_THRESHOLD = 5;    // pixels of movement to cancel long-press
    this._moved            = false;  // did the single finger move enough to cancel long-press?
    this._active           = false;  // at least one touch active
  }

  /** Attach touch event listeners to the canvas. */
  init() {
    const opts = { passive: false };
    this.canvas.addEventListener('touchstart',  e => this._onStart(e),  opts);
    this.canvas.addEventListener('touchmove',   e => this._onMove(e),   opts);
    this.canvas.addEventListener('touchend',    e => this._onEnd(e),    opts);
    this.canvas.addEventListener('touchcancel', e => this._onEnd(e),    opts);
  }

  // ---------------------------------------------------------------------------
  // Internal handlers
  // ---------------------------------------------------------------------------

  _onStart(e) {
    e.preventDefault();
    this._active = true;

    if (e.touches.length >= 2) {
      // Transition to two-finger mode
      this._cancelLong();
      this._lastDist   = this._dist(e.touches[0], e.touches[1]);
      this._lastMid    = this._mid(e.touches[0], e.touches[1]);
      this._lastSingle = null;
      // Interrupt any ongoing single-finger painting
      if (typeof this.callbacks.onEnd === 'function') this.callbacks.onEnd();
      return;
    }

    // Single finger
    this._lastDist   = null;
    this._lastMid    = null;
    this._moved      = false;
    const t          = e.touches[0];
    this._lastSingle = { x: t.clientX, y: t.clientY };

    // Arm long-press timer
    this._longTimer = setTimeout(() => {
      this._longTimer = null;
      if (!this._moved && typeof this.callbacks.onLongPress === 'function') {
        this.callbacks.onLongPress(t.clientX, t.clientY);
      }
    }, this._LONG_MS);

    this.callbacks.onTap(t.clientX, t.clientY);
  }

  _onMove(e) {
    e.preventDefault();

    if (e.touches.length >= 2) {
      this._cancelLong();

      const d = this._dist(e.touches[0], e.touches[1]);
      const m = this._mid(e.touches[0], e.touches[1]);

      if (this._lastDist !== null && d > 0) {
        const factor = d / this._lastDist;
        const rect   = this.canvas.getBoundingClientRect();
        this.callbacks.onPinchZoom(factor, m.x - rect.left, m.y - rect.top);
      }

      // Pan by midpoint movement
      if (this._lastMid !== null) {
        const dx = m.x - this._lastMid.x;
        const dy = m.y - this._lastMid.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          this.callbacks.onPan(dx, dy);
        }
      }

      this._lastDist = d;
      this._lastMid  = m;
      return;
    }

    // Single finger
    if (e.touches.length !== 1) return;
    const t = e.touches[0];

    // Check if finger has moved enough to cancel long-press
    if (this._lastSingle) {
      const dx = t.clientX - this._lastSingle.x;
      const dy = t.clientY - this._lastSingle.y;
      if (Math.abs(dx) > this._MOVEMENT_THRESHOLD || Math.abs(dy) > this._MOVEMENT_THRESHOLD) {
        if (!this._moved) {
          this._moved = true;
          this._cancelLong();
        }
      }
    }

    const isPan = typeof this.callbacks.getIsPanMode === 'function'
      ? this.callbacks.getIsPanMode()
      : false;

    if (isPan && this._lastSingle) {
      const dx = t.clientX - this._lastSingle.x;
      const dy = t.clientY - this._lastSingle.y;
      this.callbacks.onPan(dx, dy);
    } else {
      this.callbacks.onDrag(t.clientX, t.clientY);
    }

    this._lastSingle = { x: t.clientX, y: t.clientY };
  }

  _onEnd(e) {
    e.preventDefault();
    this._cancelLong();
    this._lastDist   = null;
    this._lastMid    = null;
    this._lastSingle = null;
    this._moved      = false;
    this._active     = e.touches.length > 0;
    this.callbacks.onEnd();
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  _dist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _mid(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  }

  _cancelLong() {
    if (this._longTimer !== null) {
      clearTimeout(this._longTimer);
      this._longTimer = null;
    }
  }
}
