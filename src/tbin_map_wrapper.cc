/*
 * Wrapper for tbin/Map.cpp that provides Qt compatibility stubs.
 * Included before the original source so that <QDebug> resolves
 * to our stub and QT_TRANSLATE_NOOP / Q_DECL_CONSTEXPR are defined.
 */

// Include our compatibility shim first so all Qt macros are defined
#include "../qt_compat.h"

// Now include the original implementation unchanged
#include "tbin/Map.cpp"
