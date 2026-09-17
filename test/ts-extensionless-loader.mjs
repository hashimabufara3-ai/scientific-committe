/* Test-only ESM resolve hook.

   The app's TypeScript modules use extensionless relative imports
   (e.g. import { logger } from "../logger"). Node's native type stripping
   requires an explicit extension, so importing those modules with the built-in
   node --test fails lookup. This hook appends .ts/.mjs/.js (in that order) for
   relative specifiers that have no extension and where a matching file exists.

   Used ONLY via `node --import ./test/ts-extensionless-loader.mjs` in the test
   script; never loaded by the application itself. No dependencies. */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const EXTS = [".ts", ".mjs", ".js"];

function hasExtension(specifier) {
  return /\.[a-zA-Z0-9]+$/.test(specifier);
}

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !hasExtension(specifier) &&
    context.parentURL
  ) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    for (const ext of EXTS) {
      if (existsSync(base + ext)) {
        return {
          url: pathToFileURL(base + ext).href,
          shortCircuit: true,
        };
      }
    }
    for (const ext of EXTS) {
      if (existsSync(join(base, `index${ext}`))) {
        return {
          url: pathToFileURL(join(base, `index${ext}`)).href,
          shortCircuit: true,
        };
      }
    }
  }
  return nextResolve(specifier, context);
}