// @dhx/react-gantt is an OPTIONAL dependency (private registry, license forbids
// redistribution — see apps/web/src/lib/dhtmlx-gantt-loader.ts). This ambient
// declaration lets `tsc --noEmit` type-check the dynamic import() in the loader
// even when the real package isn't installed (e.g. a public-repo checkout with
// no npm.dhtmlx.com credentials). When the package IS installed, TypeScript's
// module resolution prefers its real, more specific types over this fallback.
declare module '@dhx/react-gantt';
