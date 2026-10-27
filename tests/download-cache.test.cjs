const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
function load(file,dependencies={}){
 const shim={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('require','module','exports',js)(name=>dependencies[name]??require(name),shim,shim.exports);return shim.exports;
}
const {isGitHubCacheUrl,validDownloadTarget}=load('src/lib/download-cache-contract.ts');
test('direct Telegram downloads use only the exact ready public file URL',()=>{
 const {telegramDownloadUrl}=load('src/lib/download-cache-contract.ts');
 const url='https://t.me/testanivers/123';
 assert.equal(telegramDownloadUrl({status:'done',url}),url);
 for(const status of ['pending','failed','unknown',undefined])assert.equal(telegramDownloadUrl({status,url}),undefined);
 for(const url of ['https://t.me/private/123','https://t.me/testanivers/0','https://t.me/testanivers/123?x=1','https://t.me/testanivers/123/4','https://t.me.evil.test/testanivers/123','https://attacker@t.me/testanivers/123','javascript:alert(1)',undefined])assert.equal(telegramDownloadUrl({status:'done',url}),undefined);
});
test('Telegram is a direct per-quality link while GitHub keeps its popup action',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/components/anime/episode-list.tsx'),'utf8');
 assert.ok(source.includes('href={telegramUrl} target="_blank" rel="noopener noreferrer"'));
 assert.ok(source.includes('با کیفیت ${quality.label} از تلگرام'));
 assert.ok(source.includes('telegramDownloadUrl(liveQuality'));
 assert.ok(source.includes('download(ep.number, quality.label)'));
 assert.ok(source.includes('chooseBulk('));
 assert.ok(source.includes('method === "github"'));
 assert.ok(source.includes('<DownloadMethodTabs'));
 assert.ok(source.includes('key={method} className="episode-quality-actions'));
 const tabs=fs.readFileSync(path.join(__dirname,'../src/components/anime/download-method-tabs.tsx'),'utf8');
 assert.ok(tabs.includes('role="tablist"'));assert.ok(tabs.includes('role="tab"'));
 assert.ok(tabs.includes('aria-controls={`${id}-panel`}'));
 assert.ok(tabs.includes('ArrowLeft')&&tabs.includes('Home')&&tabs.includes('End'));
 const css=fs.readFileSync(path.join(__dirname,'../src/app/downloads.css'),'utf8');
 assert.ok(css.includes('.download-method-indicator{'));
 assert.ok(css.includes('transform:translateX(-100%)'));
 assert.ok(css.includes('.episode-quality-actions{animation:none}'));
});
test('GitHub downloads accept only the two public cache asset paths',()=>{
 assert.ok(isGitHubCacheUrl('https://github.com/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/cache/file.mkv'));
 assert.ok(isGitHubCacheUrl('https://github.com/itisluckyluke-dev/animeverse-popular-downloads/releases/download/cache/file.mkv'));
 for(const url of ['https://github.com.evil.test/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/cache/file.mkv','https://attacker@github.com/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/cache/file.mkv','https://github.com/itisluckyluke-dev/animeverse/releases/download/cache/file.mkv','https://github.com/Imluckyluke/animeverse-temporary-downloads/releases/download/cache/file.mkv','javascript:alert(1)'])assert.equal(isGitHubCacheUrl(url),false);
 assert.ok(validDownloadTarget('https://t.me/testanivers/100'));
 assert.equal(validDownloadTarget('https://t.me/private/100'),false);
});
test('discovery must be freshly HMAC-signed before a backend receives authorization',()=>{
 const crypto=require('node:crypto');const secret='test-only-shared-key-not-a-production-credential';
 const {signedCacheOrigin}=load('src/lib/download-cache.ts',{'./download-cache-contract':{isGitHubCacheUrl}});
 const now=Date.now();const payload={version:1,origin:'https://test-cache.trycloudflare.com',updatedAt:new Date(now).toISOString()};
 payload.signature=crypto.createHmac('sha256',secret).update('1\n'+payload.origin+'\n'+payload.updatedAt).digest('hex');
 assert.equal(signedCacheOrigin(payload,secret,now),payload.origin);
 assert.throws(()=>signedCacheOrigin({...payload,origin:'https://attacker.trycloudflare.com'},secret,now));
 assert.throws(()=>signedCacheOrigin({...payload,origin:'https://attacker.example'},secret,now));
 assert.throws(()=>signedCacheOrigin(payload,secret,now+37*3600_000));
 assert.throws(()=>signedCacheOrigin(payload,'wrong-key',now));
});
test('preparation stays in the site popup rather than opening tabs',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/components/anime/episode-list.tsx'),'utf8');
 assert.ok(source.includes('startDownload('));assert.ok(source.includes('chooseBulk('));
 assert.ok(!source.includes('openRealDownload'));assert.ok(!source.includes('window.open'));
 const bridge=fs.readFileSync(path.join(__dirname,'../src/app/download/page.tsx'),'utf8');assert.ok(bridge.includes('redirect('));
});
test('download history restores identifiers, rechecks stale URLs and rejects malformed entries',()=>{
 const model=load('src/lib/download-manager.ts',{'./download-cache-contract':{validDownloadTarget}});
 const row={id:'valid-record-uuid-12345',slug:'example',title:'Title',quality:'720p',episode:3,all:false,total:1,createdAt:100,updatedAt:110,serverId:'a'.repeat(64),items:[{episode:3,quality:'720p',status:'ready',size:100,bytes:100,url:'https://github.com/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/cache/video.mkv'}]};
 const restored=model.parseDownloadHistory(JSON.stringify([row,{...row,id:'bad'}]));
 assert.equal(restored.length,1);assert.equal(restored[0].serverId,row.serverId);assert.equal(restored[0].items[0].status,'checking');
 assert.equal(model.parseDownloadHistory(JSON.stringify([row]),false)[0].items[0].status,'ready');
 assert.equal(model.progressPercent({...row.items[0],status:'uploading',bytes:200}),99);
 assert.equal(model.progressPercent(row.items[0]),100);
 assert.equal(model.mergeDownloadHistory([row],[{...row,updatedAt:120,title:'New'}])[0].title,'New');
 const legacy={...row,items:[{...row.items[0],url:'https://github.com/Imluckyluke/animeverse-temporary-downloads/releases/download/cache/video.mkv'}]};
 const migrated=model.parseDownloadHistory(JSON.stringify([legacy]));
 assert.equal(migrated[0].serverId,row.serverId);assert.equal(migrated[0].items[0].url,undefined);assert.equal(migrated[0].items[0].status,'checking');
});
test('legacy account discovery is rejected before fetching or forwarding authorization',async()=>{
 const previous={AV_DOWNLOAD_CACHE_DISCOVERY_URL:process.env.AV_DOWNLOAD_CACHE_DISCOVERY_URL,AV_DOWNLOAD_CACHE_TOKEN:process.env.AV_DOWNLOAD_CACHE_TOKEN};
 process.env.AV_DOWNLOAD_CACHE_DISCOVERY_URL='https://raw.githubusercontent.com/Imluckyluke/animeverse-temporary-downloads/main/cache-origin.json';
 process.env.AV_DOWNLOAD_CACHE_TOKEN='test-only-shared-key-not-a-production-credential';
 try{
  const {cacheRequest}=load('src/lib/download-cache.ts',{'./download-cache-contract':{isGitHubCacheUrl},'node:https':{request(){throw Error('Legacy discovery must not make a request');}}});
  await assert.rejects(cacheRequest('/v1/jobs/'+'a'.repeat(64)),/پیکربندی کش معتبر نیست/);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('unchanged status polls reuse rows and only the changed episode is replaced',()=>{
 const {reconcileTransfers}=load('src/lib/download-manager.ts',{'./download-cache-contract':{validDownloadTarget}});
 const previous=[{episode:1,quality:'720p',status:'queued',bytes:0},{episode:2,quality:'720p',status:'uploading',bytes:10,size:100}];
 assert.equal(reconcileTransfers(previous,previous.map(row=>({...row}))),previous);
 const next=reconcileTransfers(previous,[{...previous[0]},{...previous[1],bytes:20}]);
 assert.equal(next[0],previous[0]);assert.notEqual(next[1],previous[1]);assert.equal(next[1].bytes,20);
});
test('large registered batches persist a compact preview without losing their server identity',()=>{
 const model=load('src/lib/download-manager.ts',{'./download-cache-contract':{validDownloadTarget}});
 const row={id:'valid-history-uuid-12345',slug:'example',title:'Title',quality:'720p',all:true,total:1000,createdAt:100,updatedAt:110,serverId:'f'.repeat(64),items:Array.from({length:1000},(_,n)=>({episode:n+1,quality:'720p',status:'waiting',bytes:0}))};
 const compact=model.persistableDownloadHistory([row]);assert.equal(compact[0].items.length,20);assert.equal(compact[0].total,1000);assert.equal(compact[0].serverId,row.serverId);
 const restored=model.parseDownloadHistory(JSON.stringify(compact));assert.equal(restored[0].serverId,row.serverId);assert.equal(restored[0].total,1000);
 assert.equal(model.persistableDownloadHistory([{...row,serverId:undefined}])[0].items.length,1000);
 const otherTab={...compact[0],updatedAt:120,items:compact[0].items.map(item=>({...item,bytes:5}))};
 const merged=model.mergeDownloadHistory([row],[otherTab]);assert.equal(merged[0].items.length,1000);assert.equal(merged[0].items[0].bytes,5);assert.equal(merged[0].items[999],row.items[999]);
});
test('download motion uses full-track physical coordinates and the shared floating glass',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/app/downloads.css'),'utf8');
 assert.ok(css.includes('left:0;right:auto;width:100%'));
 assert.ok(css.includes('translateX(100%)')&&css.includes('translateX(-100%)'));
 assert.ok(!css.includes('transition:width'));assert.ok(css.includes('--av-download-dock-lift'));
 assert.ok(css.includes('background:var(--av-floating-glass)'));
 const component=fs.readFileSync(path.join(__dirname,'../src/components/downloads/download-center.tsx'),'utf8');
 assert.ok(component.includes('lockPageScroll()'));assert.ok(component.includes('glass-surface'));
 assert.ok(!component.includes('scale: .985'));assert.ok(component.includes('useIsPresent'));
});
