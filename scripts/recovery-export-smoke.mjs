import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { createServer as socketServer } from 'node:net';
import express from 'express';
// 隔离的本地夹具：临时 Edge 资料目录、模拟 API 和虚构业务数据。
// 不接触日常浏览器、真实业务 origin、供应商或打印机；下载仅写入 test-artifacts。
const output=path.resolve('test-artifacts/project-audit');
await fs.access(path.resolve('dist/index.html')); // 先执行 npm run build。
const profile=path.join(os.tmpdir(),'tradekit-audit-browser-'+Date.now());
const downloads=path.join(output,'fixed-downloads-'+Date.now());
await fs.mkdir(downloads,{recursive:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reserved=socketServer();
await new Promise(done=>reserved.listen(0,'127.0.0.1',done));
const port=reserved.address().port;
await new Promise(done=>reserved.close(done));
const vite=await createServer({logLevel:'silent',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:{ignored:['**/test-artifacts/**']}},plugins:[{
  name:'audit-fixtures',configureServer(server){server.middlewares.use((req,res,next)=>{
    if(!req.url?.startsWith('/api/'))return next();
    res.setHeader('content-type','application/json');
    if(req.url==='/api/config')return res.end(JSON.stringify({aiConfigured:true,aiRequiresToken:true}));
    if(req.url==='/api/rates')return res.end(JSON.stringify({time:new Date().toISOString(),rates:{USD:7,EUR:8,GBP:9,AED:2}}));
    res.statusCode=401;res.end(JSON.stringify({error:'审计夹具：访问口令错误'}));
  });}
}]});
await vite.listen();
const origin='http://127.0.0.1:'+vite.httpServer.address().port;
const browser=spawn(process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-component-update','--disable-sync','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--user-data-dir='+profile,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let ws,productionServer;let nextId=0;const pending=new Map();const report={origin,checks:{},exceptions:[]};
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
  const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out: '+method));},60000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});}
async function page(url){const {targetId}=await send('Target.createTarget',{url});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);return sessionId;}
async function evaluate(session,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function until(session,expression,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await evaluate(session,expression))return;}catch{}await wait(100);}throw Error('Timed out: '+expression);}
async function input(session,label,value){return evaluate(session,`(()=>{const e=document.querySelector('input[aria-label="'+${JSON.stringify(label)}+'"]');if(!e)throw Error('Missing input '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);}
async function click(session,text,scope='document'){return evaluate(session,`(()=>{const e=Array.from(${scope}.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button '+${JSON.stringify(text)});e.click();return true;})()`);}
try{
  let endpoint;
  for(let i=0;i<100;i++){try{const lines=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);endpoint=`ws://127.0.0.1:${lines[0]}${lines[1]}`;break;}catch{}await wait(100);}
  if(!endpoint)throw Error('Isolated Edge failed to start');
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')report.exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const tab=await page(origin);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},tab);
  await until(tab,'document.querySelectorAll(".entry").length===6');
  console.log('Isolated home loaded');
  await evaluate(tab,'document.querySelector(".entry").click()');
  await until(tab,'!!document.querySelector("fieldset.editor")');
  report.checks.editorInputs=await evaluate(tab,'Array.from(document.querySelectorAll("fieldset.editor input")).map(e=>e.getAttribute("aria-label"))');
  await evaluate(tab,`(()=>{const file=new File([new Uint8Array(2000001)],'oversized.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);const e=document.querySelector('fieldset.editor input[type=file]');e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await until(tab,'document.body.textContent.includes("请选择小于 2 MB")');
  report.checks.hiddenUploadError=await evaluate(tab,`(()=>{const e=Array.from(document.querySelectorAll('.status-notice')).find(e=>e.textContent.includes('请选择小于'));const p=e.parentElement,s=getComputedStyle(p),r=p.getBoundingClientRect();return {text:e.textContent,parentClass:p.className,width:r.width,height:r.height,overflow:s.overflow,clip:s.clip,visibleToolbar:document.querySelector('.workspace-save-feedback').textContent};})()`);
  assert.ok(report.checks.hiddenUploadError.height>1);
  await input(tab,'买方公司','AUDIT LOCAL BUYER');
  await wait(1400);
  const record=await evaluate(tab,`(async()=>{const m=await import('/src/features/documents/documents-store.ts');return m.documentRecords()[0].document;})()`);
  // Verify an actual PDF export before injecting any storage failure.
  await click(tab,'PDF');
  await until(tab,'!document.querySelector("fieldset.editor").disabled',45000);
  await wait(500);
  report.checks.pdf=await evaluate(tab,`({messages:Array.from(document.querySelectorAll('.status-notice')).map(e=>({text:e.textContent,parent:e.parentElement.className})),previewHeight:document.querySelector('.paper').getBoundingClientRect().height})`);
  report.checks.pdf.files=await fs.readdir(downloads);
  console.log('Upload error and PDF checked');
  await evaluate(tab,`(async()=>{const {WorkspaceDatabase}=await import('/src/features/workspace/workspace-storage.ts');const m=await import('/src/features/documents/documents-store.ts');const db=await WorkspaceDatabase.open();await db.update(s=>{const d=m.newDocument('QT',m.readDocument(${JSON.stringify(record.id)},s));d.fields.number='AUDIT-LONG-QT';d.rows=Array.from({length:100},(_,i)=>({...d.rows[0],name:'Audit product '+(i+1),qty:'1',price:'1'}));m.saveDocument(d,null,s);});db.close();})()`);
  const longTab=await page(origin+'#/documents/qt');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},longTab);
  await until(longTab,'document.querySelectorAll(".preview tbody tr").length>=100');
  report.checks.longPdf=await evaluate(longTab,`(()=>{const p=document.querySelector('.paper'),r=p.getBoundingClientRect(),td=p.querySelector('tbody td');return {rows:p.querySelectorAll('tbody tr').length,previewHeight:r.height,previewWidth:r.width,fontPx:parseFloat(getComputedStyle(td).fontSize),estimatedPdfFontPt:parseFloat(getComputedStyle(td).fontSize)*Math.min(190/r.width,277/r.height)*72/25.4};})()`);
  report.checks.pagination=await evaluate(longTab,`(async()=>{const {createPdfPages}=await import('/src/features/documents/pdf-pages.ts');const layout=await createPdfPages(document.querySelector('.paper'));const result={pages:layout.pages.length,rows:layout.pages.flatMap(p=>Array.from(p.querySelectorAll('tbody tr')).map(r=>r.cells[0].textContent)),headers:layout.pages.filter(p=>p.querySelector('tbody')).every(p=>p.querySelector('thead')),totalCount:layout.pages.filter(p=>p.querySelector('.reference-total')).length,widths:layout.pages.map(p=>p.getBoundingClientRect().width),heights:layout.pages.map(p=>p.getBoundingClientRect().height)};layout.dispose();return result;})()`);
  assert.deepEqual(report.checks.pagination.rows,Array.from({length:100},(_,i)=>String(i+1)));
  assert.ok(report.checks.pagination.headers&&report.checks.pagination.pages>1);
  assert.equal(report.checks.pagination.totalCount,1);
  assert.ok(report.checks.pagination.widths.every(w=>w===720));
  assert.ok(report.checks.pagination.heights.every(h=>h<=720*277/190));
  await click(longTab,'PDF');
  await until(longTab,'!document.querySelector("fieldset.editor").disabled',45000);
  await wait(500);
  const longPdf=await fs.readFile(path.join(downloads,'AUDIT-LONG-QT.pdf'));
  report.checks.longPdf.pageCount=(longPdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length;
  assert.equal(report.checks.longPdf.pageCount,report.checks.pagination.pages);
  console.log('Long document PDF checked');
  report.checks.layoutMatrix=[];
  for(const width of [320,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},longTab);
    const cases=await evaluate(longTab,`(async()=>{const {createPdfPages}=await import('/src/features/documents/pdf-pages.ts');const source=document.querySelector('.preview > .paper'),original=source.className;const results=[];for(const name of ['classic','executive','swiss','gallery','ledger','diplomatic','atelier','axis','signature','meridian']){source.className='paper '+name;const layout=await createPdfPages(source);results.push({name,pages:layout.pages.length,rows:layout.pages.reduce((n,p)=>n+p.querySelectorAll('tbody tr').length,0),fits:layout.pages.every(p=>p.getBoundingClientRect().height<=720*277/190),tableHeaders:layout.pages.filter(p=>p.querySelector('tbody')).every(p=>!!p.querySelector('thead')),fontPx:parseFloat(getComputedStyle(layout.pages[0].querySelector('tbody td')).fontSize)});layout.dispose();}source.className=original;return results;})()`);
    assert.ok(cases.every(c=>c.pages>1&&c.rows===100&&c.fits&&c.tableHeaders&&c.fontPx>=10));
    report.checks.layoutMatrix.push({width,cases});
  }
  report.checks.longNotes=await evaluate(longTab,`(async()=>{const {createPdfPages}=await import('/src/features/documents/pdf-pages.ts');const source=document.querySelector('.preview > .paper'),remarks=document.createElement('section');remarks.className='preview-remarks';remarks.innerHTML='<strong>备注 REMARKS</strong><p></p>';const text='长备注需要完整保留，English details and terms. '.repeat(500);remarks.querySelector('p').textContent=text;source.insertBefore(remarks,source.querySelector('.preview-bank'));const layout=await createPdfPages(source);const result={pages:layout.pages.length,complete:layout.pages.flatMap(p=>Array.from(p.querySelectorAll('.preview-remarks p')).map(n=>n.textContent)).join('')===text,fits:layout.pages.every(p=>p.getBoundingClientRect().height<=720*277/190)};layout.dispose();remarks.remove();return result;})()`);
  assert.ok(report.checks.longNotes.complete&&report.checks.longNotes.fits);
  console.log('Template and long notes pagination checked');
  await evaluate(tab,`(async()=>{const {WorkspaceDatabase}=await import('/src/features/workspace/workspace-storage.ts');const m=await import('/src/features/documents/documents-store.ts');const db=await WorkspaceDatabase.open();await db.update(s=>{const d=m.readDocument(${JSON.stringify(record.id)},s);d.notes='OTHER TAB VERSION';m.saveDocument(d,m.documentRaw(d.id,s),s);});db.close();return true;})()`);
  await until(tab,'document.querySelector(".workspace-save-feedback").textContent.includes("另一标签页")');
  await input(tab,'买方公司','UNSAVED CHANGES NEED RESCUE');
  await evaluate(tab,`document.querySelector('button[aria-label="备份 / 恢复全部资料"]').click()`);
  await until(tab,'!!document.querySelector(".workspace-backup-dialog")');
  await click(tab,'备份全部资料');
  await until(tab,'!!document.querySelector(".workspace-backup-error")');
  report.checks.conflictBackup=await evaluate(tab,`({error:document.querySelector('.workspace-backup-error').textContent,unsavedValue:document.querySelector('input[aria-label="买方公司"]').value,availableActions:Array.from(document.querySelector('.workspace-backup-dialog').querySelectorAll('button')).map(e=>e.textContent.trim())})`);
  await until(tab,'!!document.querySelector(".workspace-backup-success")');
  await wait(300);
  const backupFile=(await fs.readdir(downloads)).find(name=>name.startsWith('tradekit-all-data'));
  const rescueText=await fs.readFile(path.join(downloads,backupFile),'utf8');
  const rescue=JSON.parse(rescueText);
  assert.equal(rescue.version,2);
  assert.equal(rescue.editing.fields.buyer,'UNSAVED CHANGES NEED RESCUE');
  report.checks.conflictBackup.backupContainsUnsaved=true;
  await click(tab,'导出当前编辑副本');
  await until(tab,'document.querySelector(".workspace-backup-success")?.textContent.includes("已导出当前编辑副本")');
  await wait(200);
  const editingFile=(await fs.readdir(downloads)).find(name=>name.startsWith('tradekit-editing-copy'));
  const editingCopy=JSON.parse(await fs.readFile(path.join(downloads,editingFile),'utf8'));
  assert.equal(editingCopy.document.fields.buyer,'UNSAVED CHANGES NEED RESCUE');
  report.checks.editingCopy=true;
  await evaluate(tab,`(()=>{const f=new File([${JSON.stringify(rescueText)}],'rescue.json',{type:'application/json'}),t=new DataTransfer();t.items.add(f);const e=document.querySelector('.workspace-backup-dialog input[type=file]');e.files=t.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(tab,'!!document.querySelector(".workspace-restore-review")');
  await click(tab,'确认恢复');
  await until(tab,'document.querySelector(".workspace-backup-success")?.textContent.includes("资料已恢复")');
  const restored=await evaluate(tab,`(async()=>{const m=await import('/src/features/documents/documents-store.ts');return m.documentRecords().map(r=>({id:r.document.id,buyer:r.document.fields.buyer,notes:r.document.notes}));})()`);
  assert.ok(restored.some(d=>d.id!==record.id&&d.buyer==='UNSAVED CHANGES NEED RESCUE'));
  assert.ok(restored.some(d=>d.id===record.id&&d.notes==='OTHER TAB VERSION'));
  report.checks.conflictBackup.restoredBothVersions=true;
  await evaluate(tab,`(async()=>{const {WorkspaceDatabase}=await import('/src/features/workspace/workspace-storage.ts');const m=await import('/src/features/documents/documents-store.ts');const db=await WorkspaceDatabase.open();await db.update(s=>{const d=m.readDocument(${JSON.stringify(record.id)},s);d.fields.buyer='OTHER TAB BUYER';m.saveDocument(d,m.documentRaw(d.id,s),s);});db.close();})()`);
  await until(tab,'document.querySelector(".workspace-save-feedback").textContent.includes("另一标签页")');
  await click(tab,'重新读取已保存版本');
  await until(tab,'!!document.querySelector("[role=alertdialog]")');
  await click(tab,'重新读取');
  await until(tab,`document.querySelector('input[aria-label="买方公司"]').value==='OTHER TAB BUYER'`);
  report.checks.confirmedReload=true;
  console.log('Conflict backup checked');
  report.checks.corruptRecord=await evaluate(tab,`(async()=>{const {WorkspaceDatabase,KEY}=await import('/src/features/workspace/workspace-storage.ts');const m=await import('/src/features/documents/documents-store.ts');const db=await WorkspaceDatabase.open();let healthy;await db.update(s=>{healthy=m.newDocument('PI');healthy.fields.buyer='UNAFFECTED RECORD';m.saveDocument(healthy,null,s);const all=JSON.parse(s.getItem(KEY+'documents'));const bad=all.records[${JSON.stringify(record.id)}];bad.previousRaw=bad.raw;bad.raw='{broken';s.setItem(KEY+'documents',JSON.stringify(all));});const result={};for(const [label,fn] of Object.entries({readHealthy:()=>m.readDocument(healthy.id,db.storage),readRecovery:()=>m.previousDocument(${JSON.stringify(record.id)},db.storage),initialize:()=>m.initializeDocuments(db.storage)})){try{result[label]={ok:true,value:fn()};}catch(e){result[label]={ok:false,error:String(e)};}}db.close();return result;})()`);
  const damaged=await page(origin);
  await until(damaged,'!!document.querySelector("section[aria-label=单据恢复]")');
  report.checks.corruptRecord.startup=await evaluate(damaged,`({text:document.body.innerText,buttons:Array.from(document.querySelectorAll('button')).map(e=>e.textContent),backupAvailable:!!document.querySelector('.workspace-backup-trigger')})`);
  assert.ok(report.checks.corruptRecord.readHealthy.ok&&report.checks.corruptRecord.readRecovery.ok&&report.checks.corruptRecord.initialize.ok);
  await click(damaged,'恢复上一版本');
  await until(damaged,'!!document.querySelector("[role=alertdialog]")');
  await click(damaged,'确认恢复');
  await until(damaged,'!document.querySelector("section[aria-label=单据恢复]")');
  report.checks.recovered=await evaluate(damaged,`(async()=>{const m=await import('/src/features/documents/documents-store.ts');return {document:!!m.readDocument(${JSON.stringify(record.id)}),archive:m.readDocumentsEnvelope(m.documentsRaw()).quarantine.length};})()`);
  assert.deepEqual(report.checks.recovered,{document:true,archive:1});
  await evaluate(damaged,`(async()=>{const {WorkspaceDatabase,KEY}=await import('/src/features/workspace/workspace-storage.ts');const db=await WorkspaceDatabase.open();await db.update(s=>s.setItem(KEY+'documents','{broken collection'));db.close();})()`);
  const fatal=await page(origin);
  await until(fatal,'document.body.textContent.includes("无法打开本地资料存储")');
  await evaluate(fatal,`document.querySelector('button[aria-label="备份 / 恢复全部资料"]').click()`);
  await until(fatal,'!!document.querySelector(".workspace-backup-dialog")');
  await click(fatal,'备份全部资料');
  await until(fatal,'!!document.querySelector(".workspace-backup-success")');
  await evaluate(fatal,`(()=>{const f=new File([${JSON.stringify(rescueText)}],'rescue.json',{type:'application/json'}),t=new DataTransfer();t.items.add(f);const e=document.querySelector('.workspace-backup-dialog input[type=file]');e.files=t.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(fatal,'!!document.querySelector(".workspace-restore-review")');
  await click(fatal,'确认恢复');
  await until(fatal,'document.querySelectorAll(".entry").length===6');
  report.checks.startupRecovery=true;
  // 构建后的外链 CSS 也必须在独立排版 iframe 中正确加载。
  const production=express();
  production.use((req,res,next)=>{res.setHeader('X-Frame-Options','DENY');if(req.path.startsWith('/api/'))return res.json(req.path==='/api/config'?{aiConfigured:false}:{rates:{USD:7,EUR:8,GBP:9,AED:2},time:new Date().toISOString()});next();});
  production.use(express.static(path.resolve('dist')));
  productionServer=await new Promise(done=>{const server=production.listen(0,'127.0.0.1',()=>done(server));});
  const built=await page('http://127.0.0.1:'+productionServer.address().port);
  await until(built,'document.querySelectorAll(".entry").length===6');
  await evaluate(built,'document.querySelector(".entry").click()');
  await until(built,'!!document.querySelector("fieldset.editor")');
  await input(built,'买方公司','PRODUCTION PDF');
  await click(built,'PDF');
  await until(built,'document.body.textContent.includes("文件已导出。")',45000);
  report.checks.productionPdf=true;
  assert.deepEqual(report.exceptions,[]);
  console.log('Corrupt record and startup recovery checked');
}catch(error){report.error=String(error);console.error(error);process.exitCode=1;}
finally{
  report.downloads=downloads;
  await fs.writeFile(path.join(output,'fix-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({success:!report.error,pdfPages:report.checks.longPdf?.pageCount,templateCases:report.checks.layoutMatrix?.reduce((n,m)=>n+m.cases.length,0),downloads,report:path.join(output,'fix-results.json')},null,2));
  if(ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}ws.close();}
  if(browser.exitCode===null)browser.kill();
  if(productionServer)await new Promise(done=>productionServer.close(done));
  await vite.close();
}
