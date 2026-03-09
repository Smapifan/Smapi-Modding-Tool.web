/*
 * Qt Compatibility Shim for standalone tbin usage in Node.js Native Addon.
 * Provides stub definitions for Qt macros used in tbin/Map.cpp without
 * requiring a full Qt installation.
 */

#pragma once

// QT_TRANSLATE_NOOP is used for i18n string marking in Qt.
// In standalone mode we just return the string literal unchanged.
#ifndef QT_TRANSLATE_NOOP
#define QT_TRANSLATE_NOOP(ctx, str) (str)
#endif

// Q_DECL_CONSTEXPR expands to constexpr in modern Qt.
#ifndef Q_DECL_CONSTEXPR
#define Q_DECL_CONSTEXPR constexpr
#endif

// Stub QDebug header - qDebug() calls are not used in tbin/Map.cpp
// but the header is included. We provide a no-op sink.
#ifndef QDEBUG_H
#define QDEBUG_H

#include <iostream>

struct QDebugSink {
    template<typename T>
    QDebugSink& operator<<(const T&) { return *this; }
};

inline QDebugSink qDebug()   { return QDebugSink{}; }
inline QDebugSink qWarning() { return QDebugSink{}; }
inline QDebugSink qCritical(){ return QDebugSink{}; }

#endif // QDEBUG_H
