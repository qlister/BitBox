// =============================================================================
// portal-shim-standalone.js  --  Standalone-mode shim for the BitBox Portal
//                                Host Contract (window.bitbox.*).
//
// CANONICAL SOURCE: BitBox/portal-shim/portal-shim-standalone.js
// VENDORED COPIES:  planner/static/portal-shim-standalone.js
//                   purchasing/static/portal-shim-standalone.js
//
// EDIT ONLY THE CANONICAL COPY. After editing, run:
//
//   .\refresh-shims.ps1
//
// from BitBox/portal-shim/ to copy this file into each sub-app's static/.
// Never edit the vendored copies directly — they will be overwritten.
//
// Spec: BitBox/PORTAL_CONTRACT.md
// =============================================================================
//
// What this file does:
//   - Builds window.bitbox synchronously at script load.
//   - Provides a hardcoded SuperAdmin "Dev User" so role-gated UI is visible.
//   - Lazily fetches /api/env in the background; env values populate as soon
//     as the response arrives (most sub-app code reads env from a constructor
//     or render() that runs much later, so by then the fetch has completed).
//   - Provides a console-based logger with a [CHANNEL] prefix.
//   - Provides a minimal barcode scanner (keystroke listener, fires callbacks
//     on Enter). Good enough for dev-mode functional testing; integrated mode
//     uses portal's full-featured BarcodeScanner for production accuracy.
//   - Provides a no-op nav.dispatch that just logs.
//
// Loading:
//   This file MUST be loaded as a plain <script> tag (not type="module") so
//   that it executes synchronously and populates window.bitbox before any
//   subsequent <script type="module"> block evaluates a sub-app's import.
// =============================================================================

(function () {
    'use strict';

    if (window !== window.parent && window.parent.bitbox) {
        window.bitbox = window.parent.bitbox;
        console.log('[bitbox-shim] Adopted window.parent.bitbox from host iframe.');
        return;
    }

    if (window.bitbox) {
        // Already populated by some other host (or this shim was loaded twice).
        // Don't clobber.
        console.log('[bitbox-shim] window.bitbox already populated; skipping.');
        return;
    }

    // -------------------------------------------------------------------------
    // session — hardcoded SuperAdmin dev user (standalone mode only)
    // -------------------------------------------------------------------------

    const session = {
        user: {
            clockNumber: 99,
            name: 'Dev User',
            roles: ['SuperAdmin', 'Admin', 'Engineer', 'Supervisor', 'Operator'],
        },
        hasRole(role) {
            return this.user.roles.includes(role);
        },
    };

    // -------------------------------------------------------------------------
    // env — defaults populated immediately, refreshed in the background from
    // /api/env. Sub-apps that read env from a constructor or render() will
    // almost always see the fetched values because those run much later than
    // shim load.
    // -------------------------------------------------------------------------

    const env = {
        database:    'UNKNOWN',
        environment: 'dev',
        version:     '?',
        isProdData:  false,
        ready:       null,   // Promise that resolves when the fetch completes
    };

    env.ready = (async () => {
        try {
            const res  = await fetch('/api/env', { credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            env.database    = data.database    ?? data.databaseName ?? 'UNKNOWN';
            env.environment = data.environment ?? 'dev';
            env.version     = data.version     ?? '?';
            env.isProdData  = env.database === 'BITBOXMRP' && env.environment !== 'dev';
        } catch (e) {
            console.warn('[bitbox-shim] /api/env fetch failed:', e.message);
        }
        return env;
    })();

    // -------------------------------------------------------------------------
    // api — thin fetch() wrapper. base is '' in standalone (same origin).
    // -------------------------------------------------------------------------

    const api = {
        base: '',
        headers() {
            return {
                'Content-Type':   'application/json',
                'X-Clock-Number': String(session.user.clockNumber),
            };
        },
        async fetch(path, opts) {
            const url = this.base + path;
            const merged = Object.assign(
                { credentials: 'same-origin' },
                opts || {}
            );
            
            // Only add Content-Type: application/json if we are not sending FormData
            // (FormData needs the browser to automatically set Content-Type with the boundary)
            const isFormData = opts && opts.body && opts.body instanceof FormData;
            
            merged.headers = Object.assign(
                {}, 
                this.headers(), 
                (opts && opts.headers) || {}
            );
            
            if (isFormData && merged.headers['Content-Type'] === 'application/json') {
                delete merged.headers['Content-Type'];
            }
            
            return fetch(url, merged);
        },
    };

    // -------------------------------------------------------------------------
    // logger — console with [CHANNEL] prefix
    // -------------------------------------------------------------------------

    const logger = {
        info(channel, message, context) {
            console.log('[' + channel + ']', message, context ?? '');
        },
        warning(channel, message, context) {
            console.warn('[' + channel + ']', message, context ?? '');
        },
        error(channel, message, detail) {
            console.error('[' + channel + ']', message, detail ?? '');
        },
    };

    // -------------------------------------------------------------------------
    // barcodeScanner — minimal Enter-terminated keystroke listener.
    // The real portal uses the full BarcodeScanner class with
    // scanner-vs-typing detection; this shim is good enough for functional
    // dev testing.
    // -------------------------------------------------------------------------

    const barcodeScanner = (function () {
        let nextId      = 1;
        const subs      = new Map();      // id -> callback
        let buffer      = '';
        let lastKeyTime = 0;
        let paused      = false;

        function onKeydown(e) {
            if (paused) return;
            // Ignore typing inside form fields — let it go to the input.
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const now = Date.now();
            // If gap is large, treat as new sequence.
            if (now - lastKeyTime > 100) buffer = '';
            lastKeyTime = now;

            if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                if (buffer.length >= 3) {
                    const scanned = buffer.toUpperCase();
                    buffer = '';
                    subs.forEach(cb => {
                        try { cb(scanned); }
                        catch (err) { console.error('[bitbox-shim] scan callback error:', err); }
                    });
                }
                return;
            }
            if (e.key.length === 1 && /[\x20-\x7E]/.test(e.key)) {
                buffer += e.key;
            }
        }

        document.addEventListener('keydown', onKeydown);

        return {
            onScan(callback) {
                const id = nextId++;
                subs.set(id, callback);
                return id;
            },
            offScan(id) {
                subs.delete(id);
            },
            pause()  { paused = true;  },
            resume() { paused = false; },
        };
    })();

    // -------------------------------------------------------------------------
    // nav — standalone has nowhere to navigate, so just log.
    // -------------------------------------------------------------------------

    const nav = {
        dispatch(name) {
            console.log('[bitbox-shim] nav.dispatch:', name);
            // Still fire the event for any local listener (e.g. a sub-app that
            // listens to its own internal nav events).
            document.dispatchEvent(new Event('nav' + name));
        },
    };

    // -------------------------------------------------------------------------
    // Assemble window.bitbox
    // -------------------------------------------------------------------------

    window.bitbox = {
        contractVersion: '2.0.1',
        session:         session,
        env:             env,
        api:             api,
        logger:          logger,
        barcodeScanner:  barcodeScanner,
        nav:             nav,
    };

    console.log('[bitbox-shim] Standalone shim installed (contract v' +
                window.bitbox.contractVersion + ').');

})();
