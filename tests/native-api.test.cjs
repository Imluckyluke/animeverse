const test=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/lib/native-catalog.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const moduleShim={exports:{}};
new Function('require','module','exports',js)(()=>({isChineseAnime:()=>false}),moduleShim,moduleShim.exports);
const {nativeCatalog}=moduleShim.exports;
test('native data includes every actual ready episode, never pending or private source links',()=>{
 const base={slug:'native',title:'عنوان',titleEn:'Title',titleJa:'',genres:[],audio:[],quality:[],synopsis:'داستان',art:{},episodeData:[
  {number:2,qualities:[{label:'1080p',status:'done',url:'https://t.me/testanivers/10',deepLink:'PRIVATE'}]},
  {number:1,qualities:[{label:'720p',status:'pending',deepLink:'SECRET'}]},
  {number:3,qualities:[{label:'720p',status:'done',url:'javascript:bad'}]},
 ]};
 const result=nativeCatalog([base,{...base,slug:'empty',episodeData:[]}]);
 assert.equal(result.schema,1);assert.equal(result.titles.length,1);
 assert.deepEqual(result.titles[0].episodes.map(e=>e.number),[2]);
 assert.equal(result.titles[0].readyCount,1);
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('SECRET'));
});
