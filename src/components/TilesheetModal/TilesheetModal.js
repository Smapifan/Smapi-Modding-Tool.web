/**
 * TilesheetModal Component
 *
 * Class-based, reusable modal for "Tilesheet Image Missing" warnings.
 * Designed for both browser (standalone) and .NET MAUI WebView integration.
 *
 * Events emitted via EventManager:
 *   - modal:shown     {message: string}
 *   - modal:hidden    null
 *   - modal:cancelled null
 *   - modal:selected  null
 *
 * @example
 *   const modal = new TilesheetModal({
 *     onCancel: () => console.log('cancelled'),
 *     onSelect: () => console.log('selected'),
 *   });
 *   modal.show('Tilesheet "spring.png" not found.');
 */
class TilesheetModal {
  /**
   * @param {object}   [options={}]
   * @param {Function} [options.onCancel]  - Callback when Cancel is clicked
   * @param {Function} [options.onSelect]  - Callback when Select Image is clicked
   */
  constructor(options = {}) {
    this._config       = window.TILESHEET_MODAL_CONFIG;
    this._events       = new EventManager();

    /* --- DOM references -------------------------------------------------- */
    const sel = this._config.selectors;
    this._overlay      = document.querySelector(sel.overlay);
    this._messageEl    = document.querySelector(sel.message);
    this._cancelBtn    = document.querySelector(sel.cancelButton);
    this._selectBtn    = document.querySelector(sel.selectButton);

    /* --- State ------------------------------------------------------------ */
    this.isVisible      = false;
    this._currentMsg    = this._config.messages.default;

    /* --- Callbacks -------------------------------------------------------- */
    this._onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
    this._onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;

    /* --- Bound handlers (stored so they can be removed later) ------------- */
    this._boundKeyDown = (e) => {
      if (e.key === 'Escape' && this.isVisible) this._handleCancel();
    };

    this._init();
  }

  /* =========================================================================
     Private – initialisation
     ========================================================================= */

  /**
   * Attach event listeners and set accessibility attributes.
   * @private
   */
  _init() {
    if (!this._overlay) {
      console.error('TilesheetModal: overlay element not found:', this._config.selectors.overlay);
      return;
    }

    this._applyAccessibility();
    this._bindListeners();
  }

  /**
   * Set ARIA / role attributes on the overlay.
   * @private
   */
  _applyAccessibility() {
    const a = this._config.accessibility;
    this._overlay.setAttribute('role',             a.role);
    this._overlay.setAttribute('aria-modal',       a.ariaModal);
    this._overlay.setAttribute('aria-labelledby',  a.ariaLabelledBy);
  }

  /**
   * Attach DOM and keyboard listeners.
   * @private
   */
  _bindListeners() {
    if (this._cancelBtn) {
      this._cancelBtn.addEventListener('click', () => this._handleCancel());
    }
    if (this._selectBtn) {
      this._selectBtn.addEventListener('click', () => this._handleSelect());
    }
    document.addEventListener('keydown', this._boundKeyDown);
  }

  /* =========================================================================
     Private – handlers
     ========================================================================= */

  /** @private */
  _handleCancel() {
    this.hide();
    this._events.emit('modal:cancelled');
    if (this._onCancel) this._onCancel();
  }

  /** @private */
  _handleSelect() {
    this._events.emit('modal:selected');
    if (this._onSelect) this._onSelect();
  }

  /* =========================================================================
     Public API
     ========================================================================= */

  /**
   * Show the modal with an optional message.
   * @param {string} [message]
   */
  show(message = this._config.messages.default) {
    this._setMessageText(message);
    this._overlay.classList.remove(this._config.classes.hidden);
    this.isVisible = true;
    this._events.emit('modal:shown', { message });
  }

  /**
   * Hide the modal.
   */
  hide() {
    this._overlay.classList.add(this._config.classes.hidden);
    this.isVisible = false;
    this._events.emit('modal:hidden');
  }

  /**
   * Update the message text directly.
   * @param {string} message
   */
  setMessage(message) {
    this._setMessageText(message);
  }

  /**
   * Update the message using a key from config.messages, with placeholder
   * replacements.
   * @param {string} key          - Key in TILESHEET_MODAL_CONFIG.messages
   * @param {object} [replacements={}] - e.g. { filename: 'spring.png' }
   */
  setMessageByKey(key, replacements = {}) {
    let msg = this._config.messages[key] || this._config.messages.default;
    for (const [k, v] of Object.entries(replacements)) {
      msg = msg.replace(`{${k}}`, v);
    }
    this._setMessageText(msg);
  }

  /**
   * Enable or disable a button.
   * @param {'cancel'|'select'} buttonName
   * @param {boolean}           disabled
   */
  setButtonDisabled(buttonName, disabled) {
    const btn = buttonName === 'cancel' ? this._cancelBtn : this._selectBtn;
    if (btn) btn.disabled = disabled;
  }

  /**
   * Change the label of a button.
   * @param {'cancel'|'select'} buttonName
   * @param {string}            text
   */
  setButtonText(buttonName, text) {
    const btn = buttonName === 'cancel' ? this._cancelBtn : this._selectBtn;
    if (btn) btn.textContent = text;
  }

  /**
   * Subscribe to a component event.
   * @param {string}   eventName  - 'modal:shown' | 'modal:hidden' | 'modal:cancelled' | 'modal:selected'
   * @param {Function} callback
   * @returns {TilesheetModal} this (for chaining)
   */
  on(eventName, callback) {
    this._events.on(eventName, callback);
    return this;
  }

  /**
   * Unsubscribe from a component event.
   * @param {string}   eventName
   * @param {Function} callback
   * @returns {TilesheetModal} this (for chaining)
   */
  off(eventName, callback) {
    this._events.off(eventName, callback);
    return this;
  }

  /**
   * Serialise component state for .NET MAUI JavaScript interop.
   * @returns {{type: string, isVisible: boolean, currentMessage: string,
   *            cancelButtonDisabled: boolean, selectButtonDisabled: boolean}}
   */
  toJSON() {
    return {
      type:                  'TilesheetModal',
      isVisible:             this.isVisible,
      currentMessage:        this._currentMsg,
      cancelButtonDisabled:  this._cancelBtn ? this._cancelBtn.disabled : false,
      selectButtonDisabled:  this._selectBtn ? this._selectBtn.disabled : false,
    };
  }

  /**
   * Clean up all event listeners. Call before removing the component.
   */
  destroy() {
    document.removeEventListener('keydown', this._boundKeyDown);
    this._events.clear();
    this._onCancel = null;
    this._onSelect = null;
  }

  /* =========================================================================
     Private helpers
     ========================================================================= */

  /**
   * @private
   * @param {string} msg
   */
  _setMessageText(msg) {
    this._currentMsg = msg;
    if (this._messageEl) this._messageEl.textContent = msg;
  }
}

/* Make available globally in browser context */
if (typeof window !== 'undefined') {
  window.TilesheetModal = TilesheetModal;
}

/* CommonJS export for Node / bundler environments */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilesheetModal;
}
