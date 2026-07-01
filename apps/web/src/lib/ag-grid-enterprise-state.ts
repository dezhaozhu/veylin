/**
 * Tracks whether AG-Grid Enterprise has finished loading + registering its modules
 * at startup (see main.tsx). Pro features that depend on Enterprise modules
 * (e.g. the 二三级 master-detail schedule view) must only switch on once this is
 * true — passing masterDetail props before the module is registered throws.
 *
 * main.tsx awaits `whenEnterpriseSettled()` before the app renders, so by the time
 * any grid mounts `isAgGridEnterpriseReady()` is deterministic.
 */

let ready = false;
let bootstrap: Promise<void> = Promise.resolve();

/** Called by the bootstrap once Enterprise modules are registered + license set. */
export function markAgGridEnterpriseReady(): void {
  ready = true;
}

/** Whether Enterprise modules are registered and usable. */
export function isAgGridEnterpriseReady(): boolean {
  return ready;
}

/** Record the in-flight Enterprise bootstrap promise so the startup gate can await it. */
export function setEnterpriseBootstrap(p: Promise<void>): void {
  bootstrap = p;
}

/** Resolves once the Enterprise bootstrap has settled (loaded, or failed → Community). */
export function whenEnterpriseSettled(): Promise<void> {
  return bootstrap;
}
