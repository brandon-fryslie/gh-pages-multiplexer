// [LAW:one-source-of-truth] Every entry the action owns at the gh-pages root, named once. The writers and
//   readers of each entry join its name from here, and sanitizeRef keeps every slot name off all of them.
export const ROOT_ENTRIES = {
  manifest: 'versions.json',
  versionIndex: '_versions',
  redirect: 'index.html',
  robots: 'robots.txt',
  sitemap: 'sitemap.xml',
  health: '_health.json',
  cname: 'CNAME',
  nojekyll: '.nojekyll',
} as const;
