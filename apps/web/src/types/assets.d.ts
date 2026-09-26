/**
 * Side-effect imports of stylesheets.
 *
 * TypeScript 5.7 reports TS2882 for `import "./globals.css"` unless the module
 * is declared. Next's generated `next-env.d.ts` does not cover it, and that file
 * is regenerated on every build, so the declaration lives here instead.
 */
declare module "*.css";
declare module "*.scss";
