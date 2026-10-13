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
const big = () => fetch('http://127.0.0.1:3002/__test/big',{method:'POST'});
const fail = () => fetch('http://127.0.0.1:3002/__test/fail',{method:'POST'});
const localDate = (offset=0) => { const d=new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
async function waitText(page,text) { await page.getByText(text,{exact:true}).first().waitFor(); }
async function row(page,title) { const locator=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText(title,{exact:true})});await locator.waitFor();return locator; }
async function nav(page,label) { await page.locator('.wb-main-pane h1').waitFor();if(await page.getByRole('button',{name:'打开清单导航'}).isVisible())await page.getByRole('button',{name:'打开清单导航'}).click();await page.locator('.wb-navigation .wb-nav-item').filter({has:page.getByText(label,{exact:true})}).click();await page.locator('h1').filter({hasText:label}).waitFor(); }
// 行内点击现在是标题编辑；详情面板走“更多操作 → 详细信息”。
// 弹层关闭有退场动画，定位器必须收敛到当前任务的菜单，避免撞上正在退场的旧弹层。
async function openDetail(page,title) { const r=await row(page,title);await r.getByRole('button',{name:`更多操作：${title}`}).click();await page.getByRole('dialog',{name:`更多操作：${title}`}).getByRole('button',{name:'详细信息'}).click();await page.locator('#wb-title').waitFor();return r; }
async function save(page) { await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function closed(page) { const cancel=page.getByRole('button',{name:'取消',exact:true});if(await cancel.isVisible())await cancel.click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function taskById(id) { return (await (await fetch(`http://127.0.0.1:3002/api/tasks`)).json()).find(t=>t.id===id); }
async function waitForTask(id,predicate) { for (let i=0;i<25;i++){const t=await taskById(id);if(t&&predicate(t))return t;await new Promise(r=>setTimeout(r,200));}throw new Error(`task ${id} 未在期限内满足断言`); }
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
    await page.reload();await openDetail(page,'验收新增任务');await page.locator('#wb-notes').waitFor();assert.equal(await page.locator('#wb-notes').inputValue(),'刷新后应当保留的备注');
  });
  await check('unsaved detail cannot be replaced by another task',async()=>{
    await page.locator('#wb-title').fill('修改中的标题');await openDetail(page,'和设计师确认首页修改');await waitText(page,'请先保存或取消当前修改，再切换任务。');assert.equal(await page.locator('#wb-title').inputValue(),'修改中的标题');await closed(page);
  });
  await check('save failure retains draft and retry persists',async()=>{
    await openDetail(page,'验收新增任务');await page.locator('#wb-title').fill('失败后重试成功的任务');await fail();await page.getByRole('button',{name:'保存',exact:true}).click();await waitText(page,'没有保存成功，请检查网络后重试。');assert.equal(await page.locator('#wb-title').inputValue(),'失败后重试成功的任务');await save(page);await page.reload();await row(page,'失败后重试成功的任务');
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
  await check('row click edits title inline',async()=>{
    await nav(page,'今天');const r=await row(page,'给家里买牛奶和水果');await r.locator('.wb-sidebar-title').click();
    // 进入编辑后标题文本被输入框取代，编辑框用 aria-label 全局定位
    const editor=page.getByRole('textbox',{name:'编辑：给家里买牛奶和水果'});await editor.waitFor();await editor.fill('给家里买牛奶和鸡蛋');await editor.press('Enter');
    await row(page,'给家里买牛奶和鸡蛋');assert.equal((await taskById(5)).title,'给家里买牛奶和鸡蛋');await page.reload();await row(page,'给家里买牛奶和鸡蛋');
  });
  await check('quick date reschedules and can clear to inbox',async()=>{
    await nav(page,'最近 7 天');const r=await row(page,'准备下周分享的提纲');
    await r.getByRole('button',{name:/日期：/}).click();
    await page.locator('.wb-date-pop').last().getByRole('button',{name:'明天',exact:true}).click();
    await r.getByRole('button',{name:'日期：明天，点击修改'}).waitFor();assert.equal((await taskById(8)).dueDate,localDate(1));
    await r.getByRole('button',{name:/日期：/}).click();await page.locator('.wb-date-pop').last().getByRole('button',{name:'清除日期',exact:true}).click();
    await r.waitFor({state:'hidden'});assert.equal((await taskById(8)).dueDate,'');
  });
  await check('quick priority sets high and tints the row',async()=>{
    const r=await row(page,'读完《纳瓦尔宝典》第三章');assert.equal(await r.evaluate(el=>el.classList.contains('is-pri-high')),false);
    await r.locator('.wb-pri-btn').click();await page.locator('.wb-pri-menu').last().getByRole('button',{name:'设为高优先级'}).click();
    await page.locator('.wb-sidebar-row.is-pri-high').filter({has:page.getByText('读完《纳瓦尔宝典》第三章',{exact:true})}).waitFor();
    assert.equal((await taskById(3)).priority,3);
    await r.locator('.wb-pri-btn').click();await page.locator('.wb-pri-menu').last().getByRole('button',{name:'设为无优先级'}).click();
    await page.locator('.wb-sidebar-row.is-pri-high').filter({has:page.getByText('读完《纳瓦尔宝典》第三章',{exact:true})}).waitFor({state:'hidden'});
    assert.equal((await taskById(3)).priority,0);
  });
  await check('recurring quick date offers once vs series scope',async()=>{
    await nav(page,'今天');const r=await row(page,'写周报');
    await r.getByRole('button',{name:/日期：/}).click();
    const pop=page.locator('.wb-date-pop').last();
    // 默认“仅这一次”：低风险的快捷意图
    assert.equal(await pop.getByRole('radio',{name:'仅这一次'}).getAttribute('aria-checked'),'true');
    await pop.locator('input[type="date"]').fill(localDate(3));
    await r.waitFor({state:'hidden'});
    const afterOnce=await taskById(11);assert.equal(afterOnce.dueDate,localDate(0));assert.equal(afterOnce.dateOverrides[localDate(0)],localDate(3));
    await nav(page,'最近 7 天');const rows=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText('写周报',{exact:true})});await rows.first().waitFor();assert.equal(await rows.count(),1);
    await rows.first().getByRole('button',{name:/日期：/}).click();
    const pop2=page.locator('.wb-date-pop').last();
    await pop2.getByRole('radio',{name:'整个系列'}).click();
    assert.equal(await pop2.getByRole('radio',{name:'整个系列'}).getAttribute('aria-checked'),'true');
    await pop2.locator('input[type="date"]').fill(localDate(2));
    const afterSeries=await waitForTask(11,t=>t.dueDate===localDate(2));assert.deepEqual(afterSeries.dateOverrides,{});
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
  await check('tabs switch fast with large data',async()=>{
    await reset();await big();
    await page.reload();await page.locator('.wb-main-pane h1').waitFor();
    // 开发模式下首次大渲染会同步触发样式按需编译（生产构建无此开销），先预热一轮再测量
    await page.evaluate(()=>{const btn=[...document.querySelectorAll('.wb-nav-item')].find(b=>b.textContent.includes('收集箱'));btn?.click();});
    await page.locator('h1').filter({hasText:'收集箱'}).waitFor();
    await page.evaluate(()=>{const btn=[...document.querySelectorAll('.wb-nav-item')].find(b=>b.textContent.includes('今天'));btn?.click();});
    await page.locator('h1').filter({hasText:'今天'}).waitFor();
    for (const label of ['全部任务','已完成','今天']) {
      const ms=await page.evaluate(async(label)=>{
        const btn=[...document.querySelectorAll('.wb-nav-item')].find(b=>b.textContent.includes(label));
        const t0=performance.now();
        btn.click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return performance.now()-t0;
      },label);
      console.log(`  切换「${label}」耗时 ${ms.toFixed(0)}ms`);
      // 开发模式行挂载约为生产 2-4 倍且有环境抖动；900ms 足以抓住 O(打卡×任务) 级别的秒级回归
      assert.ok(ms<900,`切换「${label}」耗时 ${ms.toFixed(0)}ms，超出 900ms`);
    }
    // 分段渲染：显示更多继续加载
    await nav(page,'已完成');
    const moreBtn=page.getByRole('button',{name:/显示更多，还有/});await moreBtn.waitFor();
    const beforeCount=await page.locator('.wb-task-list .wb-sidebar-row').count();
    await moreBtn.click();
    await page.waitForFunction(b=>document.querySelectorAll('.wb-task-list .wb-sidebar-row').length>b,beforeCount);
  });
  assert.deepEqual(errors,[]);await context.close();
  await reset();
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const m=await mobileContext.newPage();await m.goto(base);await m.locator('h1').waitFor();
  activePage=m;m.setDefaultTimeout(10000);
  await check('mobile navigation, inbox add and bottom sheet',async()=>{
    assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await nav(m,'收集箱');await m.getByRole('textbox',{name:'添加任务',exact:true}).fill('手机收集箱任务');await m.getByRole('textbox',{name:'添加任务',exact:true}).press('Enter');await m.locator('[data-slot="sheet-content"]').waitFor();assert.equal(await m.locator('#wb-date').inputValue(),'');await m.locator('#wb-notes').fill('手机备注');await save(m);await m.reload();await nav(m,'收集箱');await openDetail(m,'手机收集箱任务');await m.locator('#wb-notes').waitFor();assert.equal(await m.locator('#wb-notes').inputValue(),'手机备注');await closed(m);
  });
  await check('mobile task menu remains accessible',async()=>{const r=await row(m,'手机收集箱任务');await r.getByRole('button',{name:'更多操作：手机收集箱任务'}).click();await m.getByRole('button',{name:'移到今天',exact:true}).click();await r.waitFor({state:'hidden'});await nav(m,'今天');await row(m,'手机收集箱任务');});
  await check('mobile quick date and priority',async()=>{
    // 在「今天」视图改期到明天会让任务移出视图，先切到「最近 7 天」验证
    await nav(m,'最近 7 天');
    const r=await row(m,'手机收集箱任务');
    await r.getByRole('button',{name:/日期：/}).click();await m.locator('.wb-date-pop').last().locator('input[type="date"]').fill(localDate(1));await r.getByRole('button',{name:'日期：明天，点击修改'}).waitFor();
    await r.locator('.wb-pri-btn').click();await m.locator('.wb-pri-menu').last().getByRole('button',{name:'设为高优先级'}).click();await m.locator('.wb-sidebar-row.is-pri-high').filter({has:m.getByText('手机收集箱任务',{exact:true})}).waitFor();
  });
  await mobileContext.close();
  await mkdir('docs/ui-redesign',{recursive:true});
  const report={time:new Date().toISOString(),boundary:'Isolated local in-memory API; no production authentication or PostgreSQL verification',results};
  await writeFile(`docs/ui-redesign/smoke-${process.env.WORKBENCH_UI_RUN || 'latest'}.json`,JSON.stringify(report,null,2));
  console.log(`All ${results.length} scenarios passed.`);
} catch(error) {await mkdir('docs/ui-redesign',{recursive:true});await activePage?.screenshot({path:'docs/ui-redesign/test-failure.png'});throw error;}
finally {await browser.close();await reset();}
