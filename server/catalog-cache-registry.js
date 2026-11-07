// Tiny registry so modules that cache catalog-derived data (Hevy name→catalog
// maps) can be invalidated after a catalog re-sync without catalog.js importing
// them directly (which would create an import cycle). Each cache registers a
// clear function at module load; catalog.js calls invalidateCatalogCaches()
// once a sync has rewritten the catalog.

const clearers = new Set();

/** Register a cache-clearing function. Returns an unregister function. */
export function registerCatalogCache(clearFn) {
  if (typeof clearFn === 'function') clearers.add(clearFn);
  return () => clearers.delete(clearFn);
}

/** Invalidate every registered catalog-derived cache. Best-effort. */
export function invalidateCatalogCaches() {
  for (const clear of clearers) {
    try {
      clear();
    } catch {
      // A broken clearer must never abort a catalog sync.
    }
  }
}
