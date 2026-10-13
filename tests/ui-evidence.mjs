import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = process.env.WORKBENCH_PLAYWRIGHT_DIR ? createRequire(resolve(process.env.WORKBENCH_PLAYWRIGHT_DIR,'package.json')) : createRequire(import.meta.url);
const {chromium}=require('playwright');
const base=process.env.WORKBENCH_UI_URL||'http://127.0.0.1:5176';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const out='docs/ui-redesign/final';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const reset=()=>fetch('http://127.0.0.1:3002/__test/reset',{method:'POST'});
async function ready(page) {await page.locator('.wb-main-pane h1').waitFor();await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));}
async function shot(page,name) {await ready(page);await page.screenshot({path:`${out}/${name}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);report.push({name,result:'PASS',viewport:page.viewportSize()});}
try {
  await reset();
  const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:`${out}/videos`,size:{width:1440,height:900}}});
  const p=await context.newPage();await p.goto(base);await shot(p,'desktop-list');
  await p.locator('[data-task-id="1"] .wb-sidebar-title').click();await p.locator('#wb-title').waitFor();await shot(p,'desktop-detail');
  await p.getByRole('button',{name:'取消',exact:true}).click();
  await p.locator('[data-task-id="1"] .wb-check').click();await p.locator('[data-task-id="1"] .wb-check[aria-checked="true"]').waitFor();await shot(p,'desktop-completed');
  await p.locator('.wb-nav-item').filter({has:p.getByText('最近 7 天',{exact:true})}).click();await shot(p,'desktop-upcoming');
  const video=p.video();await context.close();await rename(await video.path(),`${out}/interaction.webm`);
  await reset();
  const mc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const m=await mc.newPage();await m.goto(base);await shot(m,'mobile-list');
  await m.getByRole('button',{name:'打开清单导航'}).click();await m.locator('.wb-navigation').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));await shot(m,'mobile-navigation');
  await m.locator('.wb-navigation .wb-nav-item').filter({has:m.getByText('今天',{exact:true})}).click();await m.locator('[data-task-id="1"] .wb-sidebar-title').click();await m.locator('[data-slot="sheet-content"]').waitFor();await shot(m,'mobile-detail');await mc.close();
  for (const width of [320,720,768,1024,1100,1280,1920]) {
    const c=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:width===720?2:1});const pg=await c.newPage();await pg.goto(base);await shot(pg,`viewport-${width}`);await c.close();
  }
  const dark=await browser.newContext({viewport:{width:1440,height:900}});await dark.addInitScript(()=>localStorage.setItem('wb.appearance','dark'));const d=await dark.newPage();await d.goto(base);await shot(d,'dark-list');await dark.close();
  const long=await browser.newContext({viewport:{width:390,height:844}});const l=await long.newPage();
  const tasks=await (await fetch('http://127.0.0.1:3002/api/tasks')).json();await fetch('http://127.0.0.1:3002/api/tasks/1',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...tasks[0],title:'和团队一起核对新版本的上线安排，确认每一个待办事项的负责人和交付时间',tags:['工作','产品上线安排']})});
  await l.goto(base);await shot(l,'mobile-long-title');await long.close();
  await writeFile(`${out}/responsive-report.json`,JSON.stringify(report,null,2));console.log(`PASS ${report.length} screenshots and interaction.webm`);
} finally {await browser.close();await reset();}
