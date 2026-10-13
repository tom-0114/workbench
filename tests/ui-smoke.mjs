// Run with the isolated ui-fixture.mjs, never against a production API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const require = process.env.WORKBENCH_PLAYWRIGHT_DIR ? createRequire(resolve(process.env.WORKBENCH_PLAYWRIGHT_DIR,'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.WORKBENCH_UI_URL || 'http://127.0.0.1:5176';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/,'UI tests only target a local fixture');
const browser = await chromium.launch({channel:'msedge',headless:true});
const results=[];
let activePage;
const reset = () => fetch('http://127.0.0.1:3002/__test/reset',{method:'POST'});
const fail = () => fetch('http://127.0.0.1:3002/__test/fail',{method:'POST'});
async function waitText(page,text) { await page.getByText(text,{exact:true}).first().waitFor(); }
async function row(page,title) { const locator=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText(title,{exact:true})});await locator.waitFor();return locator; }
async function nav(page,label) { await page.locator('.wb-main-pane h1').waitFor();if(await page.getByRole('button',{name:'打开清单导航'}).isVisible())await page.getByRole('button',{name:'打开清单导航'}).click();await page.locator('.wb-navigation .wb-nav-item').filter({has:page.getByText(label,{exact:true})}).click();await page.locator('h1').filter({hasText:label}).waitFor(); }
async function save(page) { await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function closed(page) { const cancel=page.getByRole('button',{name:'取消',exact:true});if(await cancel.isVisible())await cancel.click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function check(name,fn) { await fn();results.push({name,result:'PASS'});console.log(`PASS ${name}`); }
try {
  await reset();
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  activePage=page;page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('.wb-main-pane h1').waitFor();
  await check('default list and desktop layout',async()=>{assert.equal(await page.locator('h1').textContent(),'今天');assert.equal(await page.locator('.wb-detail-panel').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);});
  await check('add, edit, save and reload',async()=>{
    await page.getByRole('textbox',{name:'添加任务',exact:true}).fill('验收新增任务');
    await page.getByRole('textbox',{name:'添加任务',exact:true}).press('Enter');await page.locator('#wb-title').waitFor();
    await page.locator('#wb-notes').fill('刷新后应当保留的备注');await save(page);
    await page.reload();const r=await row(page,'验收新增任务');await r.locator('.wb-sidebar-title').click();await page.locator('#wb-notes').waitFor();assert.equal(await page.locator('#wb-notes').inputValue(),'刷新后应当保留的备注');
  });
  await check('unsaved detail cannot be replaced by another task',async()=>{
    await page.locator('#wb-title').fill('修改中的标题');const other=await row(page,'和设计师确认首页修改');await other.locator('.wb-sidebar-title').click();await waitText(page,'请先保存或取消当前修改，再切换任务。');assert.equal(await page.locator('#wb-title').inputValue(),'修改中的标题');await closed(page);
  });
  await check('save failure retains draft and retry persists',async()=>{
    const r=await row(page,'验收新增任务');await r.locator('.wb-sidebar-title').click();await page.locator('#wb-title').fill('失败后重试成功的任务');await fail();await page.getByRole('button',{name:'保存',exact:true}).click();await waitText(page,'没有保存成功，请检查网络后重试。');assert.equal(await page.locator('#wb-title').inputValue(),'失败后重试成功的任务');await save(page);await page.reload();await row(page,'失败后重试成功的任务');
  });
  await check('add failure retains input and avoids duplicate',async()=>{
    const input=page.getByRole('textbox',{name:'添加任务',exact:true});await input.fill('保留新增输入');await fail();await input.press('Enter');await waitText(page,'新建失败，请检查网络后重试');assert.equal(await input.inputValue(),'保留新增输入');await input.press('Enter');await page.locator('#wb-title').waitFor();await closed(page);assert.equal(await page.getByText('保留新增输入',{exact:true}).count(),1);
  });
  await check('completion persists after reload and appears in history',async()=>{
    const r=await row(page,'保留新增输入');await r.getByRole('checkbox').click();await r.getByRole('checkbox',{checked:true}).waitFor();await page.reload();const done=await row(page,'保留新增输入');assert.equal(await done.getByRole('checkbox').getAttribute('aria-checked'),'true');await nav(page,'已完成');await row(page,'保留新增输入');
  });
  await check('recurrence completion applies to one day only',async()=>{
    await nav(page,'今天');const r=await row(page,'下班后跑步 30 分钟');await r.getByRole('checkbox').click();await r.getByRole('checkbox',{checked:true}).waitFor();await nav(page,'最近 7 天');const rows=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText('下班后跑步 30 分钟',{exact:true})});await rows.first().waitFor();assert.equal(await rows.count(),7);assert.equal(await rows.nth(1).getByRole('checkbox').getAttribute('aria-checked'),'false');
  });
  await check('search and tag navigation',async()=>{
    await page.getByRole('button',{name:'搜索任务'}).click();await page.getByRole('textbox',{name:'搜索任务'}).fill('设计师');await row(page,'和设计师确认首页修改');assert.equal(await page.locator('.wb-task-list .wb-sidebar-row').count(),1);await nav(page,'工作');await row(page,'和设计师确认首页修改');
  });
  await check('reschedule through task menu',async()=>{
    await nav(page,'今天');const r=await row(page,'失败后重试成功的任务');await r.getByRole('button',{name:'更多操作：失败后重试成功的任务'}).click();await page.getByRole('button',{name:'推迟到明天',exact:true}).click();await r.waitFor({state:'hidden'});await nav(page,'最近 7 天');await row(page,'失败后重试成功的任务');
  });
  await check('soft delete, recycle and restore',async()=>{
    await nav(page,'今天');const r=await row(page,'和设计师确认首页修改');await r.getByRole('button',{name:'更多操作：和设计师确认首页修改'}).click();await page.getByRole('button',{name:'删除事项',exact:true}).click();await page.getByRole('group',{name:'确认删除',exact:true}).getByRole('button',{name:'确认',exact:true}).click();await r.waitFor({state:'hidden'});await nav(page,'回收站');const recycled=await row(page,'和设计师确认首页修改');await recycled.getByRole('button',{name:'恢复事项'}).click();await recycled.waitFor({state:'hidden'});await page.reload();await row(page,'和设计师确认首页修改');
  });
  await check('calendar remains reachable',async()=>{await nav(page,'日历');await page.locator('.fc-daygrid-day').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);});
  assert.deepEqual(errors,[]);await context.close();
  await reset();
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const m=await mobileContext.newPage();await m.goto(base);await m.locator('h1').waitFor();
  activePage=m;m.setDefaultTimeout(10000);
  await check('mobile navigation, inbox add and bottom sheet',async()=>{
    assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await nav(m,'收集箱');await m.getByRole('textbox',{name:'添加任务',exact:true}).fill('手机收集箱任务');await m.getByRole('textbox',{name:'添加任务',exact:true}).press('Enter');await m.locator('[data-slot="sheet-content"]').waitFor();assert.equal(await m.locator('#wb-date').inputValue(),'');await m.locator('#wb-notes').fill('手机备注');await save(m);await m.reload();await nav(m,'收集箱');const r=await row(m,'手机收集箱任务');await r.locator('.wb-sidebar-title').click();await m.locator('#wb-notes').waitFor();assert.equal(await m.locator('#wb-notes').inputValue(),'手机备注');await closed(m);
  });
  await check('mobile task menu remains accessible',async()=>{const r=await row(m,'手机收集箱任务');await r.getByRole('button',{name:'更多操作：手机收集箱任务'}).click();await m.getByRole('button',{name:'移到今天',exact:true}).click();await r.waitFor({state:'hidden'});await nav(m,'今天');await row(m,'手机收集箱任务');});
  await mobileContext.close();
  await mkdir('docs/ui-redesign',{recursive:true});
  const report={time:new Date().toISOString(),boundary:'Isolated local in-memory API; no production authentication or PostgreSQL verification',results};
  await writeFile(`docs/ui-redesign/smoke-${process.env.WORKBENCH_UI_RUN || 'latest'}.json`,JSON.stringify(report,null,2));
  console.log(`All ${results.length} scenarios passed.`);
} catch(error) {await mkdir('docs/ui-redesign',{recursive:true});await activePage?.screenshot({path:'docs/ui-redesign/test-failure.png'});throw error;}
finally {await browser.close();await reset();}
