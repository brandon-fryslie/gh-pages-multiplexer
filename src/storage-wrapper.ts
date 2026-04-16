// [LAW:single-enforcer] This module is the sole place that knows the storage-wrapper
//   script template, its marker, and the namespace format.
// [LAW:one-source-of-truth] STORAGE_WRAPPER_MARKER is the sole identity check for
//   "this file already has the wrapper." Same pattern as WIDGET_MARKER.
// [LAW:dataflow-not-control-flow] The generated script ALWAYS runs the same wrap
//   operation. Variability lives in the namespace string baked into the script, never
//   in whether wrapping happens at runtime.

export const STORAGE_WRAPPER_MARKER = '<!-- gh-pages-multiplexer:storage-wrapper -->';

export interface StorageWrapperOpts {
  /** Full namespace prefix applied to every key (e.g., "gh-pm:owner/repo/v1.0.0:"). */
  namespace: string;
}

/**
 * Build the standard auto-namespace prefix for a deployment:
 *   `gh-pm:<owner>/<repo>/<version>:`
 *
 * This isolates each (repo, version) combination from every other site on the same
 * origin — including other repos under the same `*.github.io` user. Intentionally
 * also isolates between versions so PR previews don't contaminate production state.
 */
export function autoNamespace(owner: string, repo: string, version: string): string {
  return `gh-pm:${owner}/${repo}/${version}:`;
}

// The runtime wrapper. Runs synchronously, before any user script.
// A Proxy around the real Storage is installed via Object.defineProperty on window.
// Named property access (localStorage.foo) flows through the Proxy traps, so all
// access patterns — method calls AND bracket notation — are namespaced transparently.
//
// Scoped operations:
// - .length returns the count of keys in OUR namespace only
// - .key(i) iterates only our keys and strips the prefix
// - .clear() removes only our keys (leaves others on the origin intact)
//
// Limitations (documented; out of scope for v1):
// - `storage` events dispatched by other tabs carry the raw namespaced key in e.key
// - Web Workers have their own global scope; this wrapper doesn't reach into workers
// - Cross-origin iframes are unaffected (they have their own origin)
function renderWrapperScriptBody(namespace: string): string {
  // NOTE: The namespace is the only user-controlled value. It's a string embedded as
  // a JSON literal to prevent any script-breaking characters.
  const NS_LITERAL = JSON.stringify(namespace);
  return `(function(){
'use strict';
if (window.__ghPmStorageWrapped) return;
var NS = ${NS_LITERAL};
function wrap(real){
  if (!real) return real;
  return new Proxy({}, {
    get: function(_, key){
      if (key === 'getItem') return function(k){ return real.getItem(NS + k); };
      if (key === 'setItem') return function(k, v){ return real.setItem(NS + k, String(v)); };
      if (key === 'removeItem') return function(k){ return real.removeItem(NS + k); };
      if (key === 'clear') return function(){
        var toRemove = [];
        for (var i = 0; i < real.length; i++){
          var rk = real.key(i);
          if (rk && rk.indexOf(NS) === 0) toRemove.push(rk);
        }
        for (var j = 0; j < toRemove.length; j++) real.removeItem(toRemove[j]);
      };
      if (key === 'key') return function(idx){
        var seen = 0;
        for (var i = 0; i < real.length; i++){
          var rk = real.key(i);
          if (rk && rk.indexOf(NS) === 0){
            if (seen === idx) return rk.slice(NS.length);
            seen++;
          }
        }
        return null;
      };
      if (key === 'length'){
        var n = 0;
        for (var i = 0; i < real.length; i++){
          var rk = real.key(i);
          if (rk && rk.indexOf(NS) === 0) n++;
        }
        return n;
      }
      if (key === Symbol.toPrimitive || key === 'toString') return function(){ return '[object Storage]'; };
      if (typeof key === 'string') return real.getItem(NS + key);
      return undefined;
    },
    set: function(_, key, value){
      if (typeof key === 'string' && key !== 'length') real.setItem(NS + key, String(value));
      return true;
    },
    deleteProperty: function(_, key){
      if (typeof key === 'string') real.removeItem(NS + key);
      return true;
    },
    has: function(_, key){
      if (typeof key === 'string') return real.getItem(NS + key) !== null;
      return false;
    },
    ownKeys: function(){
      var keys = [];
      for (var i = 0; i < real.length; i++){
        var rk = real.key(i);
        if (rk && rk.indexOf(NS) === 0) keys.push(rk.slice(NS.length));
      }
      return keys;
    },
    getOwnPropertyDescriptor: function(_, key){
      if (typeof key === 'string'){
        var v = real.getItem(NS + key);
        if (v === null) return undefined;
        return { value: v, writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    }
  });
}
try {
  var realLocal = window.localStorage;
  Object.defineProperty(window, 'localStorage', { value: wrap(realLocal), configurable: true });
} catch(e) {}
try {
  var realSession = window.sessionStorage;
  Object.defineProperty(window, 'sessionStorage', { value: wrap(realSession), configurable: true });
} catch(e) {}
window.__ghPmStorageWrapped = true;
window.__ghPmStorageNamespace = NS;
})();`;
}

/**
 * Render the full `<script>` tag to inject into the top of `<head>`. Idempotent
 * via STORAGE_WRAPPER_MARKER.
 *
 * Inline script (not `src`) so it executes synchronously before any subsequent
 * `<head>` content — including user scripts that might access localStorage.
 */
export function renderStorageWrapperScriptTag(opts: StorageWrapperOpts): string {
  const body = renderWrapperScriptBody(opts.namespace);
  return `${STORAGE_WRAPPER_MARKER}<script>${body}</script>`;
}
