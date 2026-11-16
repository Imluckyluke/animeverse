/** Small, tab-local checkpoints stored on the browser's own history entries. */
const STATE_KEY = "__avNavigation";
type ScrollPoint = { url: string; x: number; y: number };

function readState(win: Window) {
  return win.history.state?.[STATE_KEY] ?? {};
}

function writeState(win: Window, patch: Record<string, unknown>) {
  try {
    // Preserve Next's router state and other controls sharing this history entry.
    win.history.replaceState({ ...win.history.state, [STATE_KEY]: { ...readState(win), ...patch } }, "");
    return true;
  } catch {
    return false; // History can be unavailable in restricted browser contexts.
  }
}

function currentUrl(win: Window) {
  return `${win.location.pathname}?${new URLSearchParams(win.location.search)}${win.location.hash}`;
}

function readScroll(win: Window): ScrollPoint | null {
  const value = readState(win).scroll;
  return value && value.url === currentUrl(win) && Number.isFinite(value.x) &&
    Number.isFinite(value.y) && value.y >= 0 ? value : null;
}

export function readCatalogPage(win: Window, key: string, total: number) {
  const value = readState(win).catalog;
  return value?.key === key && Number.isSafeInteger(value.count) && value.count >= 30
    ? Math.min(total, value.count) : Math.min(total, 30);
}

export function rememberCatalogPage(win: Window, key: string, count: number) {
  if (Number.isSafeInteger(count) && count >= 30) writeState(win, { catalog: { key, count } });
}

export function replaceNavigationUrl(win: Window, url: string) {
  // Next's public History API integration copies its own internal state. Passing
  // its internal navigation flag back would bypass the search-param update.
  win.history.replaceState({ [STATE_KEY]: readState(win) }, "", url);
}

/** Restore only history traversal/reloads, never a fresh detail-page navigation. */
export function installScrollRestoration(win: Window) {
  const previous = win.history.scrollRestoration;
  let activeUrl = currentUrl(win);
  let pending = readScroll(win);
  let frame = 0;
  let deadline = 0;
  let observer: ResizeObserver | undefined;
  const stop = () => {
    win.cancelAnimationFrame(frame);
    win.clearTimeout(deadline);
    observer?.disconnect();
    observer = undefined;
    pending = null;
  };
  const save = () => {
    if (pending || activeUrl !== currentUrl(win)) return;
    if (!writeState(win, { scroll: { url: activeUrl, x: win.scrollX, y: win.scrollY } })) {
      win.history.scrollRestoration = previous;
    }
  };
  const scheduleSave = () => {
    if (pending) return;
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(save);
  };
  const restore = (final = false) => {
    if (!pending || pending.url !== currentUrl(win)) return;
    const maxY = Math.max(0, win.document.documentElement.scrollHeight - win.innerHeight);
    // A remounted/streamed list must grow back before restoring a deep position.
    if (!final && maxY + 2 < pending.y) return;
    win.scrollTo({ left: pending.x, top: Math.min(pending.y, maxY), behavior: "instant" });
    stop();
  };
  const commit = (route: string) => {
    if (route !== currentUrl(win).split("#")[0]) return;
    activeUrl = currentUrl(win);
    if (!pending || pending.url !== activeUrl || win.location.hash) {
      stop(); // A checkpoint for another route must not block saving this one.
      return;
    }
    observer?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => restore());
      observer.observe(win.document.body);
    }
    win.clearTimeout(deadline);
    deadline = win.setTimeout(() => restore(true), 5000);
    frame = win.requestAnimationFrame(() => restore());
  };
  const pop = () => {
    stop();
    pending = readScroll(win);
    // Same-page history traversals need no React route commit.
    if (activeUrl.split("#")[0] === currentUrl(win).split("#")[0]) commit(activeUrl.split("#")[0]);
  };
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    if (link.origin === win.location.origin) save();
  };
  const interrupt = () => { if (pending) stop(); };
  win.history.scrollRestoration = "manual";
  win.addEventListener("scroll", scheduleSave, { passive: true });
  win.addEventListener("popstate", pop);
  win.addEventListener("pagehide", save);
  win.document.addEventListener("click", click, true);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    win.addEventListener(event, interrupt, { passive: true });
  }
  return {
    commit,
    dispose() {
      save();
      stop();
      win.history.scrollRestoration = previous;
      win.removeEventListener("scroll", scheduleSave);
      win.removeEventListener("popstate", pop);
      win.removeEventListener("pagehide", save);
      win.document.removeEventListener("click", click, true);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) win.removeEventListener(event, interrupt);
    },
  };
}
