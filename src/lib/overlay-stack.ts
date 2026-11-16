/**
 * Tracks overlays in open order so only the top-most dialog reacts to Escape
 * and Tab. Tokens are opaque symbols; releasing is idempotent so a dialog that
 * unmounts during a route change cannot remove another dialog's entry.
 */
const openOverlays: symbol[] = [];

export function pushOverlay(token: symbol): () => void {
  openOverlays.push(token);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = openOverlays.lastIndexOf(token);
    if (index >= 0) openOverlays.splice(index, 1);
  };
}

export function isTopOverlay(token: symbol): boolean {
  return openOverlays[openOverlays.length - 1] === token;
}
