/**
 * TilesheetModal Configuration
 *
 * Centralised settings for the TilesheetModal component.
 * Change values here instead of hunting through component code.
 */

/** @type {TilesheetModalConfig} */
const TILESHEET_MODAL_CONFIG = {
  /** CSS selectors for DOM elements */
  selectors: {
    overlay:      '#modal-ts-missing',
    message:      '#ts-missing-msg',
    cancelButton: '#ts-missing-cancel',
    selectButton: '#ts-missing-select',
  },

  /** CSS class names */
  classes: {
    hidden: 'hidden',
  },

  /** Default / template messages.
   *  Use {placeholder} syntax; call setMessageByKey() with replacements. */
  messages: {
    default:       'The tilesheet image could not be found.',
    notFound:      'Tilesheet "{filename}" could not be found.',
    invalidFormat: 'The tilesheet format is not supported.',
    loadError:     'Error loading tilesheet.',
  },

  /** Accessibility attributes applied to the overlay element */
  accessibility: {
    role:           'dialog',
    ariaModal:      'true',
    ariaLabelledBy: 'ts-missing-title',
  },
};

/* Make available globally in browser context */
if (typeof window !== 'undefined') {
  window.TILESHEET_MODAL_CONFIG = TILESHEET_MODAL_CONFIG;
}

/* CommonJS export for Node / bundler environments */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TILESHEET_MODAL_CONFIG;
}
