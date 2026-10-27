const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('keyboard geometry only resizes the dialog layer, never the search frost', () => {
  const source = read('src/components/command-palette.tsx');
  const css = read('src/app/globals.css');
  assert.ok(source.includes('ref={viewport} className="search-viewport'));
  assert.ok(source.includes('style.setProperty("--search-height"'));
  assert.ok(!source.includes('setViewport('));
  assert.match(css, /\.search-overlay \{[^}]*height: 100lvh/s);
  assert.match(css, /\.search-viewport \{[^}]*height: var\(--search-height/s);
});

test('folder reveal does not animate the entire page layout or prefetch every saved title', () => {
  const source = read('src/components/favorites-folder.tsx');
  assert.ok(!source.includes('transition-[grid-template-rows]'));
  assert.ok(source.includes('prefetch={false}'));
  assert.ok(source.includes('requestIdleCallback'));
  assert.ok(source.includes('const FolderList = memo('));
  assert.ok(!source.includes('backdrop-blur-'));
  assert.ok(read('src/app/globals.css').includes('.folder-list-row { content-visibility: auto;'));
});

test('mobile folder motion bounds frost cost and keeps reduced-motion support', () => {
  const source = read('src/components/ui/glass-folder-cards.tsx');
  assert.match(source, /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?\.gf-front \{ -webkit-backdrop-filter: blur\(5px\)/);
  assert.ok(source.includes('decoding="async"'));
  assert.ok(source.includes('transform .44s'));
  assert.ok(source.includes('@media (prefers-reduced-motion: reduce)'));
  const light = read('src/app/light-theme.css');
  assert.match(light, /\.search-results\[role="listbox"\] \{ -webkit-backdrop-filter: none; backdrop-filter: none;/);
});

test('search exit fades the full frosted shell rather than leaving static blur behind', () => {
  const source = read('src/components/command-palette.tsx');
  assert.ok(source.includes('<motion.div key="search-overlay"'));
  assert.ok(source.includes('exit={{ opacity: 0 }}'));
  assert.ok(source.includes('exit={{ y: reduce ? 0 : -6'));
  assert.ok(source.includes('if (!open) { input.current?.blur(); return; }'));
});

test('touch does not inherit sticky desktop hover and hero markers stay flat', () => {
  assert.ok(read('tailwind.config.ts').includes('hoverOnlyWhenSupported: true'));
  const light = read('src/app/light-theme.css');
  const marker = light.match(/\.hero-pagination button\[aria-current="true"\] > span \{([^}]+)\}/)[1];
  assert.ok(marker.includes('box-shadow: none;'));
  assert.ok(!light.includes('article:is(:hover,:active,:focus-within)'));
});

test('synopsis freezes artwork geometry while preserving a composited zoom', () => {
  const hero = read('src/components/anime/anime-detail-hero.tsx');
  const css = read('src/app/globals.css');
  assert.ok(hero.includes('className="detail-art-layer"'));
  assert.ok(hero.includes('"--detail-art-height"'));
  assert.ok(hero.includes('"--detail-art-scale"'));
  assert.match(css, /\.detail-art-layer \{[^}]*will-change: transform/s);
  assert.ok(read('src/components/favorites-folder.tsx').includes('duration-[380ms]'));
});

test('cinema focus follows distance continuously and dragging does not snap on press', () => {
  const source = read('src/components/ui/centered-carousel.tsx');
  assert.ok(source.includes('geometry.current'));
  assert.ok(source.includes('motionFrame.current = requestAnimationFrame(tick)'));
  assert.ok(source.includes('mode === "cinema" ?'));
  const down = source.slice(source.indexOf('onPointerDown='), source.indexOf('onPointerMove='));
  assert.ok(!down.includes('centre('));
  assert.ok(read('src/components/home/home-shelves.tsx').includes('const CinemaCard = memo('));
});
