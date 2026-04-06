// [LAW:dataflow-not-control-flow] Both functions always run every regex; variability is in the input string, not in whether operations execute.
// [LAW:single-enforcer] HTML base path correction lives in exactly one module (DEPL-04).

/**
 * Inject (or replace) a <base href> tag in the <head> of an HTML document.
 * Also rewrites fragment-only `href="#x"` links to `href="<filename>#x"` to
 * work around the <base> + anchor link interaction (Pitfall 2).
 */
export function injectBaseHref(html: string, basePath: string, filename: string): string {
  const existingBase = /<base\s[^>]*href="[^"]*"[^>]*>/i;
  const headOpen = /(<head[^>]*>)/i;

  let out: string;
  if (existingBase.test(html)) {
    // Pitfall 3: replace existing base tag so ours wins.
    out = html.replace(existingBase, `<base href="${basePath}">`);
  } else if (headOpen.test(html)) {
    out = html.replace(headOpen, `$1\n<base href="${basePath}">`);
  } else {
    // No <head> -- not an HTML document we can process. Return unchanged.
    return html;
  }

  // Pitfall 2: rewrite fragment-only hrefs to resolve against this file.
  return out.replace(/href="#([^"]+)"/gi, `href="${filename}#$1"`);
}

/**
 * Rewrite root-relative `src="/..."` and `href="/..."` attributes so they
 * point under the given basePath. Absolute (`https://`), protocol-relative
 * (`//`), and already-relative URLs are left untouched.
 */
export function rewriteUrls(html: string, basePath: string): string {
  const prefix = basePath.replace(/\/$/, '');
  // Match (src|href)="/something" where the first char after " is / but not //.
  return html.replace(/(src|href)="\/(?!\/)([^"]*)"/gi, (_m, attr, rest) => {
    return `${attr}="${prefix}/${rest}"`;
  });
}
