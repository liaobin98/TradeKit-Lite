import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.mjs';

// Isolated random origin and synthetic data; never opens the user's existing tabs.
const require = createRequire(import.meta.url), viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const helper = await build({ stdin: { contents: `
  import { WorkspaceDatabase } from './src/features/workspace/workspace-storage.ts';
  import { fresh } from './src/features/documents/model.ts';
  import { KEY } from './src/features/workspace/workspace-storage.ts';
  import { DOCUMENTS_DATA_KEY, parseDocumentsStore, documentsRaw } from './src/features/documents/documents-store.ts';
  import { emptyCatalogStore, captureCatalogDocuments, CATALOG_DATA_KEY } from './src/features/catalogs/catalog-storage.ts';
  import { createWorkspaceBackup, workspaceBackupSummary } from './src/features/workspace/workspace-backup.ts';
  window.__multi = { db: await WorkspaceDatabase.open(), fresh, KEY, DOCUMENTS_DATA_KEY, emptyCatalogStore, captureCatalogDocuments, CATALOG_DATA_KEY, createWorkspaceBackup, workspaceBackupSummary };
  window.__multi.read = async () => { await window.__multi.db.refresh(); return parseDocumentsStore(documentsRaw(window.__multi.db.storage)); };
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', target: 'es2022' });
const app = createApp({ production: true, env: {}, fetchImpl: async () => Response.json({ rates: { USD: 1, CNY: 7, EUR: .9, GBP: .75, AED: 3.67 }, time_last_update_utc: 'Sun, 11 Oct 2026 00:00:00 +0000' }) });
const server = createServer((request, response) => {
  if (request.url === '/__multi-test.mjs') { response.setHeader('Content-Type', 'application/javascript'); response.end(helper.outputFiles[0].text); }
  else app(request, response);
}).listen(0, '127.0.0.1');
await new Promise(done => server.once('listening', done));
const base = `http://127.0.0.1:${server.address().port}`, proxy = 'http://localhost:3456';
let target;
const checks = [];
async function run(body) {
  const result = await (await fetch(`${proxy}/eval?target=${target}`, { method: 'POST', body })).json();
  if (result.error) throw Error(JSON.stringify(result.error)); return result.value;
}
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await run(expression)) return;
    await new Promise(done => setTimeout(done, 80));
  }
  throw Error(`Timed out: ${expression}\n${await run('document.body.innerText.slice(0,2000)')}`);
}
async function helperReady() { await run("(async()=>{if(!window.__multi)await import('/__multi-test.mjs');return true;})()"); }
async function records() {
  await helperReady();
  return run('(async()=>Object.values((await __multi.read()).records).map(record=>JSON.parse(record.raw)))()');
}
async function click(text, scope = 'button') {
  await run(`Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click(); true`);
}
async function edit(label, value) {
  await run(`(()=>{const input=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
}
const activeId = () => run("history.state.tradekitNavigation.kind.split(':')[2]");
async function home() { await click('首页', '.site-navigation button'); await wait("document.querySelectorAll('.entry').length===6"); }
async function open(kind) {
  await run(`Array.from(document.querySelectorAll('.entry')).find(button=>button.textContent.includes(${JSON.stringify(kind)})).click(); true`);
  await wait("!!document.querySelector('.reference-workspace,[role=alertdialog]')");
}
function check(name, condition) { assert.ok(condition, name); checks.push(name); }

try {
  const result = await (await fetch(`${proxy}/new`, { method: 'POST', body: base })).json();
  target = result.targetId; if (!target) throw Error(JSON.stringify(result));
  await wait("document.querySelectorAll('.entry').length===6");
  await helperReady();
  await run(`(async()=>{await __multi.db.update(storage=>{
    const old=__multi.fresh('QT');old.fields.seller='Retained directory seller';old.fields.buyer='Legacy buyer';
    for(const prefix of ['draft:','draft-previous:','draft-corrupt:'])storage.setItem(__multi.KEY+prefix+'QT',JSON.stringify(old));
    storage.setItem(__multi.KEY+__multi.CATALOG_DATA_KEY,JSON.stringify(__multi.captureCatalogDocuments(__multi.emptyCatalogStore(),[old])));
    storage.removeItem(__multi.KEY+__multi.DOCUMENTS_DATA_KEY);
  });return true;})()`);
  await fetch(`${proxy}/navigate?target=${target}`, { method: 'POST', body: base });
  await wait("document.querySelectorAll('.entry').length===6"); await helperReady();
  check('One-time reset clears legacy documents, retains independent seller copies', await run(`(()=>{const s=__multi.db.storage;return !s.getItem(__multi.KEY+'draft:QT')&&!s.getItem(__multi.KEY+'draft-previous:QT')&&JSON.parse(s.getItem(__multi.KEY+'catalogs')).records.sellers.some(record=>record.title==='Retained directory seller');})()`));

  await open('QT'); await wait("!!document.querySelector('.reference-workspace')");
  check('No draft means no restore dialog and blank seller information', await run("!document.querySelector('[role=alertdialog]')&&document.querySelector('input[aria-label=\"卖方公司\"]').value===''"));
  const first = await activeId();
  await new Promise(done => setTimeout(done, 1200));
  check('An untouched new document stays unsaved until content or explicit saving', !(await records()).some(doc => doc.id === first));
  await edit('卖方公司', 'First seller'); await edit('买方公司', 'First buyer'); await edit('产品 1 单价', '-1');
  check('Save stays enabled despite invalid numeric content', await run("!Array.from(document.querySelectorAll('.workspace-actions button')).find(button=>button.textContent.trim()==='保存').disabled"));
  await click('保存', '.workspace-actions button');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(first)}].raw).status==='saved')()`);
  check('Save accepts incomplete/invalid contents and clears the draft state', (await records()).find(doc => doc.id === first)?.rows[0].price === '-1');
  await edit('买方公司', 'Edited saved buyer');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(first)}].raw).fields.buyer==='Edited saved buyer')()`);
  check('Editing autosaves to the same saved record without reverting to draft', (await records()).find(doc => doc.id === first)?.status === 'saved');
  const address = await run('location.href');
  await fetch(`${proxy}/navigate?target=${target}`, { method: 'POST', body: address });
  await wait("document.querySelector('input[aria-label=\"买方公司\"]')?.value==='Edited saved buyer'"); await helperReady();
  check('Refreshing a saved record retains its exact ID and remains editable', await activeId() === first && await run("!document.querySelector('input[aria-label=\"买方公司\"]').disabled"));

  await home(); await open('QT'); await wait("!!document.querySelector('.reference-workspace')");
  check('Saved QT alone does not trigger homepage restoration', !await run("!!document.querySelector('[role=alertdialog]')"));
  const second = await activeId(); check('Homepage creates a different independent ID', second !== first);
  await edit('买方公司', 'Second draft buyer'); await click('保存草稿', '.workspace-actions button');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(second)}].raw).status==='draft')()`);
  check('Both same-type records are retained', (await records()).filter(doc => doc.kind === 'QT').length === 2);
  await home(); await open('QT'); await wait("!!document.querySelector('[role=alertdialog]')");
  await click('恢复编辑', '[role=alertdialog] button'); await wait("!!document.querySelector('.reference-workspace')");
  check('Homepage restores the corresponding draft, not an already saved record', await activeId() === second);
  await click('保存', '.workspace-actions button');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(second)}].raw).status==='saved')()`);
  await edit('买方公司', 'Second saved edit');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(second)}].raw).fields.buyer==='Second saved edit')()`);
  await click('保存草稿', '.workspace-actions button');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(second)}].raw).status==='draft')()`);
  check('Only Save draft explicitly changes a saved record back to draft', (await records()).find(doc => doc.id === second)?.status === 'draft');
  await click('新建空白', '.workspace-actions button'); await wait(`history.state.tradekitNavigation.kind!==${JSON.stringify('document:QT:' + second)}`);
  const third = await activeId();
  check('Toolbar new blank preserves existing records without an empty placeholder', (await records()).filter(doc => doc.kind === 'QT').length === 2 && third !== second);
  check('Toolbar blank also clears seller information', await run("document.querySelector('input[aria-label=\"卖方公司\"]').value===''") );
  await click('保存草稿', '.workspace-actions button');
  await wait(`(async()=>!!(await __multi.read()).records[${JSON.stringify(third)}])()`);
  await home(); await open('PI'); await wait("!!document.querySelector('.reference-workspace')");
  check('Drafts from other types do not trigger restoration', !await run("!!document.querySelector('[role=alertdialog]')"));
  await click('保存草稿', '.workspace-actions button');
  await wait("(async()=>Object.values((await __multi.read()).records).some(record=>JSON.parse(record.raw).kind==='PI'))()");
  await click('我的单据', '.site-navigation button'); await wait("document.querySelectorAll('.documents-row').length===4");
  check('Document list shows multiple records per type and draft tags only', await run("document.querySelectorAll('.document-status').length===3&&!document.querySelector('.document-status-issued')&&document.body.innerText.includes('报价单 (3)')"));
  const firstDoc = (await records()).find(doc => doc.id === first);
  await run(`Array.from(document.querySelectorAll('.documents-row')).find(row=>row.textContent.includes(${JSON.stringify(firstDoc.fields.number)})).querySelector('.document-open').click(); true`);
  await wait(`history.state.tradekitNavigation.kind===${JSON.stringify('document:QT:' + first)}`);
  check('Opening a listed saved record selects its exact ID', await run("document.querySelector('input[aria-label=\"买方公司\"]').value==='Edited saved buyer'"));
  await edit('产品 1 单价', '');
  await wait(`(async()=>JSON.parse((await __multi.read()).records[${JSON.stringify(first)}].raw).rows[0].price==='')()`);
  await run('window.print=()=>{}; true'); await click('打印', '.workspace-actions button');
  await wait("Array.from(document.querySelectorAll('.workspace-actions button')).every(button=>!button.disabled)");
  check('Printing does not change the saved state or lock the editor', (await records()).find(doc => doc.id === first)?.status === 'saved' && await run("!document.querySelector('input[aria-label=\"买方公司\"]').disabled"));
  await click('我的单据', '.site-navigation button'); await wait("document.querySelectorAll('.documents-row').length===4");
  await run(`Array.from(document.querySelectorAll('.documents-row')).find(row=>row.textContent.includes(${JSON.stringify(firstDoc.fields.number)})).querySelector('.documents-delete').click(); true`);
  await wait("!!document.querySelector('[role=alertdialog]')"); await click('删除单据', '[role=alertdialog] button');
  await wait("document.querySelectorAll('.documents-row').length===3&&!document.querySelector('[role=alertdialog]')");
  check('Deleting one QT leaves the other QT documents and PI intact', (await records()).filter(doc => doc.kind === 'QT').length === 2 && (await records()).some(doc => doc.kind === 'PI'));
  check('Backup summary includes all remaining documents', await run("(async()=>{await __multi.db.refresh();return __multi.workspaceBackupSummary(__multi.createWorkspaceBackup(__multi.db.storage)).documents===3;})()"));
  await run("Array.from(document.querySelectorAll('[role=tab]')).find(tab=>tab.textContent.trim()==='报价单 (2)').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,ctrlKey:false})); true");
  await wait("document.querySelectorAll('.documents-row').length===2");
  await run("document.querySelector('[aria-label=\"全选当前分类单据\"]').click(); true");
  await wait("!document.querySelector('.documents-bulk-delete').disabled");
  await click('删除所选 (2)', '.documents-bulk-delete'); await wait("!!document.querySelector('[role=alertdialog]')");
  await click('删除 2 份单据', '[role=alertdialog] button');
  await wait("document.querySelectorAll('.documents-row').length===1&&!document.querySelector('[role=alertdialog]')");
  check('Bulk deletion removes all selected same-type IDs, not other types', (await records()).length === 1 && (await records())[0].kind === 'PI');
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  if (target) await fetch(`${proxy}/close?target=${target}`).catch(() => {});
  await new Promise(done => server.close(done));
}
