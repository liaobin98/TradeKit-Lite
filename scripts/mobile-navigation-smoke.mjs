import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { createApp } from '../server/app.mjs';

// An isolated fixture document loads the production bundle in a live iframe.
// Production routes retain X-Frame-Options: DENY; no shipping headers are changed.
// Never resize the user's browser or access their business origin.
const app = createApp({ production: true, env: {}, fetchImpl: async () => Response.json({
  rates: { USD: 1, CNY: 7, EUR: .9, GBP: .75, AED: 3.67 }, time_last_update_utc: 'Mon, 12 Oct 2026 00:00:00 +0000',
}) });
const fixture = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/__mobile-navigation-fixture') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.end(fixture);
  } else app(request, response);
}).listen(0, '127.0.0.1');
await new Promise(done => server.once('listening', done));
const origin = `http://127.0.0.1:${server.address().port}`, proxy = 'http://localhost:3456';
let target, checks = 0;
async function run(body) {
  const response = await (await fetch(`${proxy}/eval?target=${target}`, { method: 'POST', body })).json();
  if (response.error) throw Error(JSON.stringify(response.error)); return response.value;
}
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await run(expression)) return;
    await new Promise(done => setTimeout(done, 80));
  }
  const state = await run(`(()=>{const d=document.querySelector('#mobile-nav-frame')?.contentDocument;return d?{width:d.defaultView.innerWidth,desktop:d.defaultView.matchMedia('(min-width: 769px)').matches,menu:!!d.querySelector('.mobile-site-menu'),navDisplay:d.defaultView.getComputedStyle(d.querySelector('.site-navigation')).display}:null;})()`);
  throw Error(`Timed out: ${expression}\n${JSON.stringify(state)}`);
}
const doc = "document.querySelector('#mobile-nav-frame').contentDocument";
const mobile = body => run(`(()=>{const d=${doc};${body}})()`);
const visible = selector => `!!d.querySelector(${JSON.stringify(selector)})?.getClientRects().length`;
async function openMenu() {
  await mobile("d.querySelector('.mobile-menu-trigger').click(); return true;");
  await wait(`!!${doc}.querySelector('.mobile-site-menu')`);
}
function check(value, label) { assert.ok(value, label); checks++; }
try {
  check((await fetch(origin)).headers.get('x-frame-options')==='DENY', 'Production embedding protection remains unchanged');
  const response = await (await fetch(`${proxy}/new`, { method: 'POST', body: origin })).json();
  target = response.targetId; if (!target) throw Error(JSON.stringify(response));
  await wait("!!document.querySelector('.site-navigation')");
  await run(`(()=>{const f=document.createElement('iframe');f.id='mobile-nav-frame';f.style.cssText='position:fixed;top:0;left:0;width:1280px;height:850px;border:0;z-index:50';f.src=${JSON.stringify(origin + '/__mobile-navigation-fixture')};document.body.append(f);return true;})()`);
  await wait(`!!${doc}?.querySelector('.home-header')`);
  check(await mobile(`return ${visible('.site-navigation')}&&!(${visible('.mobile-navigation')});`), 'Desktop navigation remains inline');
  await run("document.querySelector('#mobile-nav-frame').style.width='390px'; true");
  await wait(`${doc}.defaultView.innerWidth===390&&${doc}.querySelector('.mobile-menu-trigger').getClientRects().length>0`);
  await openMenu();
  check(await mobile("const trigger=d.querySelector('.mobile-menu-trigger'),menu=d.querySelector('.mobile-site-menu');return trigger.getAttribute('aria-expanded')==='true'&&trigger.getAttribute('aria-controls')===menu.id&&menu.contains(d.activeElement);"), 'Expanded state, controlled panel and initial focus');
  check(await mobile("const text=d.querySelector('.mobile-site-menu').textContent;return ['首页','我的单据','卖方','买方','产品','备份 / 恢复','GitHub','更新日志'].every(label=>text.includes(label))&&!text.includes('关于');"), 'All navigation and tools are inside the menu without an About heading');
  await mobile("d.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return true;");
  await wait(`!${doc}.querySelector('.mobile-site-menu')`);
  check(await mobile("return d.activeElement===d.querySelector('.mobile-menu-trigger');"), 'Escape returns focus to the hamburger');
  for (const [label, title] of [['我的单据','我的单据'],['卖方','卖方资料'],['买方','买方资料'],['产品','产品资料']]) {
    await openMenu();
    await mobile(`Array.from(d.querySelectorAll('.mobile-navigation-link')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click();return true;`);
    await wait(`${doc}.querySelector('.documents-heading h1')?.textContent===${JSON.stringify(title)}&&!${doc}.querySelector('.mobile-site-menu')`);
    await openMenu();
    check(await mobile(`return d.querySelector('.mobile-site-menu [aria-current="page"]')?.textContent.trim()===${JSON.stringify(label)};`), `${label} navigates, closes, and highlights correctly`);
    await mobile("d.querySelector('.mobile-menu-trigger').click();return true;");
    await wait(`!${doc}.querySelector('.mobile-site-menu')`);
  }
  await openMenu();
  await mobile("Array.from(d.querySelectorAll('.mobile-navigation-link')).find(button=>button.textContent.trim()==='备份 / 恢复').click();return true;");
  await wait(`!!${doc}.querySelector('.workspace-backup-dialog')&&!${doc}.querySelector('.mobile-site-menu')`);
  check(await mobile("return d.querySelectorAll('.workspace-backup-dialog').length===1&&d.querySelector('.workspace-backup-dialog').contains(d.activeElement);"), 'Backup opens one shared dialog with focus inside');
  await mobile("d.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return true;");
  await wait(`!${doc}.querySelector('.workspace-backup-dialog')`);
  check(await mobile("return d.activeElement===d.querySelector('.mobile-menu-trigger');"), 'Closing backup restores hamburger focus');
  await openMenu();
  await mobile("Array.from(d.querySelectorAll('.mobile-navigation-link')).find(button=>button.textContent.trim()==='首页').click();return true;");
  await wait(`!!${doc}.querySelector('.home-header')&&!${doc}.querySelector('.mobile-site-menu')`);
  check(true, 'Home link works');
  await openMenu();
  await mobile("const button=d.querySelector('.site-brand');button.dispatchEvent(new d.defaultView.PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',isPrimary:true}));button.click();return true;");
  await wait(`!${doc}.querySelector('.mobile-site-menu')`);
  check(true, 'Outside click closes the menu');
  await openMenu();
  await run("document.querySelector('#mobile-nav-frame').style.width='1040px';true");
  await wait(`${doc}.defaultView.innerWidth===1040`);
  // Background tabs may defer iframe resize events. Deliver the lifecycle event
  // explicitly after layout changes; don't activate/resize the user's window.
  await mobile("d.defaultView.dispatchEvent(new d.defaultView.Event('resize'));return true;");
  await wait(`!${doc}.querySelector('.mobile-site-menu')&&${doc}.querySelector('.site-navigation').getClientRects().length>0`);
  check(await mobile("return !d.querySelector('.mobile-menu-trigger').getClientRects().length&&!!d.querySelector('.workspace-backup-trigger').getClientRects().length;"), 'Resizing restores the desktop layout and dismisses the menu');
  console.log(JSON.stringify({ passed: checks }, null, 2));
} finally {
  if (target) await fetch(`${proxy}/close?target=${target}`).catch(() => {});
  await new Promise(done => server.close(done));
}
