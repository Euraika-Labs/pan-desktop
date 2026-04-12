## `next.config.js` should pin `outputFileTracingRoot` to `__dirname` to prevent parent-lockfile detection

**Repository:** https://github.com/fathah/hermes-office
**Labels:** bug, windows

---

### Summary

When Claw3D's Next.js dev server is launched from a host process whose working directory is *inside* the Claw3D repo but whose parent chain contains an unrelated `package-lock.json` (for example, a stray `%USERPROFILE%\package-lock.json` on Windows), Next.js walks up the filesystem looking for lockfiles, picks the **outermost** one, and uses its directory as the inferred workspace root. This causes the following warning on every dev start:

```
 ⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
 We detected multiple lockfiles and selected the directory of
 C:\Users\<username>\package-lock.json as the root directory.
 Consider adjusting `outputFileTracingRoot` or the `root` directory of your
 Turbopack config to the root of your application.
```

The inferred root is wrong: Claw3D's actual root is its own directory (where its own `package-lock.json` lives), not the user's home directory. Downstream consequences:

1. `outputFileTracingRoot` defaults to the wrong directory, which bloats tracing scope and can include arbitrary files from the user's home.
2. Turbopack's resolver walks the wrong tree, which can cause confusing module-resolution errors when the parent directory happens to contain other Node projects.
3. Embedding apps that ship Claw3D as a subprocess cannot override this from their side — **there is no env var or CLI flag for `outputFileTracingRoot`**, it is `next.config.js`-only. The fix must live in this repo.

### Steps to reproduce

1. On a Windows 11 machine, create a stray lockfile at the user's home directory (this happens naturally on many machines because some tools `npm install` into `%USERPROFILE%`):

   ```powershell
   echo '{}' > $env:USERPROFILE\package-lock.json
   ```

2. Clone this repo somewhere deeper in the filesystem, e.g. `C:\Users\<username>\AppData\Roaming\.pan-desktop\hermes-office\`.

3. Run `npm install && npm run dev` from inside the clone.

4. Observe the warning on the first render:

   ```
   ⚠ Warning: Next.js inferred your workspace root...
   ```

### Proposed fix

Pin both `outputFileTracingRoot` and `turbopack.root` to `__dirname` in `next.config.js`. This is 4 lines of config:

```js
// next.config.js
const path = require('node:path');

module.exports = {
  // Prevent Next.js from walking up the filesystem looking for lockfiles
  // and picking a wrong parent directory as the workspace root. Without
  // this pin, a stray lockfile in the user's HOME (or any parent) causes
  // outputFileTracingRoot to resolve there instead of here, which
  // bloats tracing and breaks embedders that run Claw3D as a subprocess.
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  // ...existing config...
};
```

If the existing config is ESM (`next.config.mjs`), use `import.meta.dirname` (Node 20+) or derive from `fileURLToPath(import.meta.url)`:

```js
// next.config.mjs
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  // ...
};
```

### Why this matters for downstream embedders

Some applications ship Claw3D as a spawned subprocess (`npm run dev` + `npm run hermes-adapter`). Those embedders have no way to override `outputFileTracingRoot` from the spawn environment — there is no supported env var or CLI flag, and Next.js's own source confirms this option is read from the config module only. That means every end-user on Windows who has a stray parent lockfile sees this warning on every app start, with no available workaround short of "delete your parent lockfile", which is unfriendly.

A 4-line change in this repo silently fixes it for every consumer.

### References

- Next.js issue [#81864](https://github.com/vercel/next.js/issues/81864) — "Multiple lockfiles warning when running Next.js inside a monorepo with a parent `package-lock.json`"
- Next.js issue [#82689](https://github.com/vercel/next.js/issues/82689) — Request to add env var / CLI flag for `outputFileTracingRoot` (declined; `next.config.js` is the only supported surface)
- Next.js issue [#82096](https://github.com/vercel/next.js/issues/82096) — Turbopack root inference + lockfile walking behavior
- Next.js docs: [`outputFileTracingRoot`](https://nextjs.org/docs/app/api-reference/next-config-js/output#caveats)
- Next.js docs: [`turbopack.root`](https://nextjs.org/docs/app/api-reference/next-config-js/turbopack)

### PR checklist

- [ ] Pin `outputFileTracingRoot: __dirname` in `next.config.{js,mjs}`
- [ ] Pin `turbopack.root: __dirname` in the same config
- [ ] If config is ESM, derive `__dirname` via `fileURLToPath(import.meta.url)`
- [ ] Verify `npm run dev` no longer emits the "inferred workspace root" warning when a stray `~/package-lock.json` is present
- [ ] Verify `npm run build` still produces the same output tree (no extra files under `.next/standalone/`, no missing traced files)
- [ ] Add a comment in the config explaining why the pin exists, so future readers don't remove it
