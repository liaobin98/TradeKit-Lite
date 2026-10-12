import assert from 'node:assert/strict';
import { createServer as socketServer } from 'node:net';
import { createServer } from 'vite';

// New random local origin, dedicated IndexedDB and in-memory legacy storage.
// Own tabs only; all upstream requests are fixtures. No real business data.
const database = 'tradekit-editing-' + crypto.randomUUID(), proxy = 'http://localhost:3456';
const reserved = socketServer();
await new Promise(done => reserved.listen(0, '127.0.0.1', done));
const port = reserved.address().port;
await new Promise(done => reserved.close(done));
const base = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, plugins: [{
  name: 'isolated-document-editing',
  transformIndexHtml() { return [{ tag: 'script', injectTo: 'head-prepend', children: `
    const nativeIDB = window.indexedDB;
    Object.defineProperty(window,'indexedDB',{configurable:true,value:{
      open:(name,version)=>nativeIDB.open(name==='tradekit-lite-workspace'?${JSON.stringify(database)}:name,version),
      deleteDatabase:name=>nativeIDB.deleteDatabase(name),cmp:nativeIDB.cmp.bind(nativeIDB),
    }});
    const legacy=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{
      get length(){return legacy.size},key:i=>[...legacy.keys()][i]??null,getItem:key=>legacy.get(key)??null,
      setItem:(key,value)=>legacy.set(key,String(value)),removeItem:key=>legacy.delete(key),
    }});
  ` }]; },
  configureServer(vite) { vite.middlewares.use((request, response, next) => {
    if (request.url === '/test-cleanup.html') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><body>Test cleanup</body>'); return; }
    if (!['/api/config', '/api/rates'].includes(request.url)) return next();
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/config' ? { aiConfigured: false } : { source: 'fixture', time: 'fixture', rates: { USD: 7, EUR: 8, GBP: 9, AED: 2 } }));
  }); },
}] });
let target, cleanup;
const checks = [];
async function api(path, body) {
  const response = await fetch(proxy + path + (target ? '?target=' + target : ''), body === undefined ? {} : { method: 'POST', body });
  const result = await response.json(); if (!response.ok || result.error) throw Error(JSON.stringify(result)); return result;
}
async function run(code) { return (await api('/eval', code)).value; }
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await run(expression)) return; await new Promise(done => setTimeout(done, 80)); }
  throw Error('Timed out: ' + expression + '\n' + await run('document.body.innerText.slice(0,2000)'));
}
const idle = () => new Promise(done => setTimeout(done, 1300));
async function click(text, selector = 'button') {
  await run(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click();true`);
}
async function input(label, value) {
  await run(`(()=>{const input=document.querySelector(${JSON.stringify('input[aria-label="' + label + '"]')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
}
const recordsExpression = `(async()=>{const {documentRecords}=await import('/src/features/documents/documents-store.ts');return documentRecords().map(entry=>entry.document);})()`;
const records = () => run(recordsExpression);
const activeId = () => run("history.state.tradekitNavigation.kind.split(':')[2]");
const number = () => run('document.querySelector(\'.workspace-title span\').textContent');
async function home() { await click('首页', '.site-navigation button'); await wait('document.querySelectorAll(".entry").length===6'); }
async function quote() {
  await run(`Array.from(document.querySelectorAll('.entry')).find(button=>button.textContent.includes('QT')).click();true`);
  await wait('!!document.querySelector(".reference-workspace,[role=alertdialog]")');
}
async function library(count) {
  await click('我的单据', '.site-navigation button');
  await wait(count ? `document.querySelectorAll('.documents-row').length===${count}` : '!!document.querySelector(".documents-empty")');
}
async function openBuyer(buyer) {
  await run(`Array.from(document.querySelectorAll('.documents-row')).find(row=>row.textContent.includes(${JSON.stringify(buyer)})).querySelector('.document-open').click();true`);
  await wait(`document.querySelector('input[aria-label="买方公司"]')?.value===${JSON.stringify(buyer)}`);
}
function check(label, passed) { assert.ok(passed, label); checks.push(label); }

try {
  await server.listen(); target = (await api('/new', base)).targetId;
  await wait('document.querySelectorAll(".entry").length===6');
  await quote(); await wait('!!document.querySelector(".reference-workspace")');
  const first = await activeId(), initialNumber = await number();
  await idle();
  check('Untouched blank does not autosave', (await records()).length === 0);
  check('New blank URL uses its number, not UUID', await run('location.hash') === '#/documents/qt/' + encodeURIComponent(initialNumber));
  await click('添加产品明细'); await idle();
  check('Adding empty product rows does not create a record', (await records()).length === 0);
  await input('买方公司', 'Temporary input'); await input('买方公司', ''); await idle();
  check('Clearing all entries before autosave stays blank', (await records()).length === 0);
  check('Blank pagehide/unload does not warn or create a record', await run(`(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);window.dispatchEvent(new Event('pagehide'));return !event.defaultPrevented;})()`));
  await library(0); await home(); await quote();
  check('Leaving a blank keeps library empty and homepage has no restore prompt', !await run('!!document.querySelector("[role=alertdialog]")') && (await records()).length === 0);
  await wait('!!document.querySelector(".reference-workspace")');
  const draft = await activeId();
  await input('买方公司', 'First draft buyer');
  await wait(`(async()=>{const docs=await ${recordsExpression};return docs.length===1&&docs[0].fields.buyer==='First draft buyer';})()`);
  check('Partial content autosaves as one draft', (await records())[0].status === 'draft');
  await library(1); check('Autosaved draft is visible in My documents', await run('document.body.innerText.includes("First draft buyer")'));
  await home(); await quote(); await wait('!!document.querySelector("[role=alertdialog]")');
  await click('恢复编辑', '[role=alertdialog] button'); await wait('!!document.querySelector(".reference-workspace")');
  check('Homepage restore opens the exact listed draft', await activeId() === draft && await run('document.querySelector(\'input[aria-label="买方公司"]\').value') === 'First draft buyer');

  const custom = '报价 2026/10:001?#';
  await library(1);
  await run(`(async()=>{const {updateWorkspace}=await import('/src/features/workspace/workspace-storage.ts');const {readDocument,documentRaw,saveDocument}=await import('/src/features/documents/documents-store.ts');await updateWorkspace(storage=>{const doc=readDocument(${JSON.stringify(draft)},storage);saveDocument({...doc,fields:{...doc.fields,number:${JSON.stringify(custom)}}},documentRaw(doc.id,storage),storage,{syncProducts:false});});return true;})()`);
  await wait(`document.querySelector('.documents-row').textContent.includes(${JSON.stringify(custom)})`);
  await openBuyer('First draft buyer'); await wait(`location.hash===${JSON.stringify('#/documents/qt/' + encodeURIComponent(custom))}`);
  check('A changed custom number opens with the same stable record ID', await activeId() === draft);
  const address = await run('location.href'); await api('/navigate', address);
  await wait('document.querySelector(\'input[aria-label="买方公司"]\')?.value==="First draft buyer"');
  check('Number link refresh opens the same record including encoded punctuation', await activeId() === draft);
  await input('买方公司', '');
  await wait(`(async()=>{const docs=await ${recordsExpression};return docs[0].fields.buyer==='';})()`);
  check('Clearing existing saved content still persists', (await records()).length === 1);
  await input('买方公司', 'First draft buyer');
  await click('新建空白', '.workspace-actions button'); await wait(`history.state.tradekitNavigation.kind!==${JSON.stringify('document:QT:' + draft)}`);
  const blankId = await activeId(); await idle();
  check('Toolbar new blank preserves original and does not create a placeholder record', (await records()).length === 1 && blankId !== draft && !await run('document.querySelector(\'input[aria-label="买方公司"]\').value'));
  await click('保存草稿', '.workspace-actions button');
  await wait(`(async()=>{const docs=await ${recordsExpression};return docs.length===2&&docs.some(doc=>doc.id===${JSON.stringify(blankId)});})()`);
  check('Explicit Save draft can still save an empty document', (await records()).find(doc => doc.id === blankId)?.status === 'draft');
  await input('买方公司', 'Second draft buyer'); await library(2);
  await run(`(async()=>{const {updateWorkspace}=await import('/src/features/workspace/workspace-storage.ts');const {readDocument,documentRaw,saveDocument}=await import('/src/features/documents/documents-store.ts');await updateWorkspace(storage=>{const doc=readDocument(${JSON.stringify(blankId)},storage);saveDocument({...doc,fields:{...doc.fields,number:${JSON.stringify(custom)}}},documentRaw(doc.id,storage),storage,{syncProducts:false});});return true;})()`);
  await openBuyer('First draft buyer');
  check('Duplicate-number first record is addressed explicitly', await activeId() === draft && await run('location.hash') === '#/documents/qt/' + encodeURIComponent(custom) + '?record=' + draft);
  await library(2); await openBuyer('Second draft buyer');
  const duplicateAddress = await run('location.href'); await api('/navigate', duplicateAddress);
  await wait('document.querySelector(\'input[aria-label="买方公司"]\')?.value==="Second draft buyer"');
  check('Duplicate-number second record stays distinct on refresh', await activeId() === blankId);

  await library(2);
  await run(`(async()=>{const {updateWorkspace}=await import('/src/features/workspace/workspace-storage.ts');const {newDocument,saveDocument}=await import('/src/features/documents/documents-store.ts');await updateWorkspace(storage=>{const doc=newDocument('QT');Object.assign(doc.fields,{number:'LATE-COMMIT',buyer:'Late committed buyer'});saveDocument(doc,null,storage,{syncProducts:false});});return true;})()`);
  await wait('document.querySelectorAll(".documents-row").length===3');
  check('An already-mounted library refreshes after a same-page committed write', await run('document.body.innerText.includes("LATE-COMMIT")&&document.body.innerText.includes("报价单 (3)")'));
  await home(); await quote(); await wait('!!document.querySelector("[role=alertdialog]")');
  check('Latest homepage recovery prompt references a record visible in the library', await run('document.querySelector("[role=alertdialog]").textContent.includes("LATE-COMMIT")'));
  await click('恢复编辑', '[role=alertdialog] button'); await wait('!!document.querySelector(".reference-workspace")');
  check('Recovered latest draft uses its number URL', await run('location.hash') === '#/documents/qt/LATE-COMMIT');
  assert.notEqual(first, draft);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  if (target) {
    await fetch(`${proxy}/navigate?target=${target}`, { method: 'POST', body: base + '/test-cleanup.html' }).catch(() => {});
    await fetch(`${proxy}/close?target=${target}`).catch(() => {});
  }
  try {
    const result = await (await fetch(`${proxy}/new`, { method: 'POST', body: base + '/test-cleanup.html' })).json(); cleanup = result.targetId;
    if (cleanup) await fetch(`${proxy}/eval?target=${cleanup}`, { method: 'POST', body: `new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(${JSON.stringify(database)});request.onsuccess=()=>resolve(true);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Test cleanup blocked'));})` });
  } finally { if (cleanup) await fetch(`${proxy}/close?target=${cleanup}`).catch(() => {}); }
  await server.close();
}
