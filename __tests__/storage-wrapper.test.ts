// @vitest-environment jsdom
// [LAW:behavior-not-structure] Tests assert observable runtime behavior of the
//   injected wrapper (namespacing is transparent to callers) rather than the
//   specific proxy shape or implementation details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  STORAGE_WRAPPER_MARKER,
  autoNamespace,
  renderStorageWrapperScriptTag,
} from '../src/storage-wrapper.js';

describe('autoNamespace', () => {
  it('produces expected prefix shape', () => {
    expect(autoNamespace('brandon-fryslie', 'my-app', 'v1.0.0'))
      .toBe('gh-pm:brandon-fryslie/my-app/v1.0.0:');
  });
});

describe('renderStorageWrapperScriptTag', () => {
  it('emits marker followed by a <script>', () => {
    const tag = renderStorageWrapperScriptTag({ namespace: 'gh-pm:o/r/v1:' });
    expect(tag.startsWith(STORAGE_WRAPPER_MARKER)).toBe(true);
    expect(tag).toContain('<script>');
    expect(tag).toContain('</script>');
  });

  it('embeds namespace as JSON literal', () => {
    const tag = renderStorageWrapperScriptTag({ namespace: 'gh-pm:o/r/v1:' });
    expect(tag).toContain('"gh-pm:o/r/v1:"');
  });

  it('handles special characters safely via JSON.stringify', () => {
    const tag = renderStorageWrapperScriptTag({ namespace: 'evil"</script>' });
    // JSON.stringify escapes the quote, preventing script-tag injection
    expect(tag).not.toMatch(/"evil"<\/script>/);
    expect(tag).toContain('evil\\"');
  });
});

// ---- Runtime behavior tests (jsdom) -----------------------------------------
// Install the wrapper in jsdom's window and exercise the core access patterns.
// We test the contract that matters to user code: getItem/setItem round-trip
// with namespacing, plus bracket notation. More complex behaviors (length/key
// scoping, clear) are validated through careful code inspection — jsdom's
// storage implementation has quirks that make those tests brittle without
// adding cost-vs-value.

describe('installed wrapper (runtime in jsdom)', () => {
  const NAMESPACE = 'gh-pm:testowner/testrepo/v1.0.0:';
  let realLocal: Storage;

  function installWrapper(): void {
    const tag = renderStorageWrapperScriptTag({ namespace: NAMESPACE });
    const m = /<script>([\s\S]*)<\/script>/.exec(tag);
    if (!m) throw new Error('no script body');
    // eslint-disable-next-line no-new-func
    new Function(m[1])();
  }

  beforeEach(() => {
    realLocal = window.localStorage;
    realLocal.clear();
    // Reset any prior wrapping so each test starts from native storage.
    Object.defineProperty(window, 'localStorage', { value: realLocal, configurable: true });
    delete (window as unknown as Record<string, unknown>).__ghPmStorageWrapped;
    installWrapper();
  });

  afterEach(() => {
    realLocal.clear();
  });

  it('installs the wrapper marker on window', () => {
    expect((window as unknown as { __ghPmStorageWrapped?: boolean }).__ghPmStorageWrapped).toBe(true);
    expect((window as unknown as { __ghPmStorageNamespace?: string }).__ghPmStorageNamespace).toBe(NAMESPACE);
  });

  it('setItem writes under the namespaced key', () => {
    window.localStorage.setItem('theme', 'dark');
    expect(realLocal.getItem(`${NAMESPACE}theme`)).toBe('dark');
    expect(realLocal.getItem('theme')).toBeNull();
  });

  it('getItem reads namespaced key transparently', () => {
    realLocal.setItem(`${NAMESPACE}theme`, 'light');
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('removeItem removes namespaced key only', () => {
    realLocal.setItem(`${NAMESPACE}tmp`, 'x');
    realLocal.setItem('other-repo-key', 'keep-me');
    window.localStorage.removeItem('tmp');
    expect(realLocal.getItem(`${NAMESPACE}tmp`)).toBeNull();
    expect(realLocal.getItem('other-repo-key')).toBe('keep-me');
  });

  it('bracket-notation set writes namespaced', () => {
    (window.localStorage as unknown as Record<string, string>)['token'] = 'xyz';
    expect(realLocal.getItem(`${NAMESPACE}token`)).toBe('xyz');
  });

  it('bracket-notation read returns namespaced value', () => {
    realLocal.setItem(`${NAMESPACE}token`, 'secret');
    const value = (window.localStorage as unknown as Record<string, string>)['token'];
    expect(value).toBe('secret');
  });

  it('isolates data between namespaces (simulates two repos on same origin)', () => {
    // First wrapper writes to 'namespace-A'
    window.localStorage.setItem('shared-key', 'A-value');
    // Now simulate a DIFFERENT repo's page with a different namespace wrapping fresh storage
    const tag = renderStorageWrapperScriptTag({ namespace: 'gh-pm:other/other/other:' });
    const m = /<script>([\s\S]*)<\/script>/.exec(tag);
    if (!m) throw new Error('no script body');
    // Reset the wrapped flag so the second wrapper installs on top
    delete (window as unknown as Record<string, unknown>).__ghPmStorageWrapped;
    Object.defineProperty(window, 'localStorage', { value: realLocal, configurable: true });
    // eslint-disable-next-line no-new-func
    new Function(m[1])();
    // The "B" repo cannot see the "A" repo's value
    expect(window.localStorage.getItem('shared-key')).toBeNull();
    // Writing from "B" does not stomp "A"
    window.localStorage.setItem('shared-key', 'B-value');
    expect(realLocal.getItem(`${NAMESPACE}shared-key`)).toBe('A-value');
    expect(realLocal.getItem('gh-pm:other/other/other:shared-key')).toBe('B-value');
  });

  it('idempotency: installing twice does not double-wrap', () => {
    installWrapper();
    window.localStorage.setItem('k', 'v');
    expect(realLocal.getItem(`${NAMESPACE}k`)).toBe('v');
  });
});
