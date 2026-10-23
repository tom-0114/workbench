// Run with the isolated ui-fixture.mjs, never against a production API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
// 点任务标题打开编辑弹窗；行内改标题走“更多操作 → 重命名”。
// 弹层关闭有退场动画，定位器必须收敛到当前任务的菜单，避免撞上正在退场的旧弹层。
async function openDetail(page,title) { const r=await row(page,title);await r.locator('.wb-sidebar-title').click();await page.locator('#wb-title').waitFor();return r; }
// 时间控件：弹层里手输后回车
// Ant Design 日期面板：点开后按 title=YYYY-MM-DD 点日期格，不在本月就翻到下个月
async function pickDate(page,trigger,ymd) { await trigger.click();const pop=page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)').last();await pop.waitFor();if(!await pop.locator(`td[title="${ymd}"]`).count())await pop.locator('.ant-picker-header-next-btn').click();await pop.locator(`td[title="${ymd}"]`).click(); }
// Ant Design 时间：电脑上可直接输入 HH:mm 回车
async function setTime(page,selector,value) { const input=page.locator(selector);await input.click();await input.fill(value);await input.press('Enter');await page.waitForFunction(([sel,v])=>document.querySelector(sel)?.value===v,[selector,value]);await page.waitForTimeout(250); }
async function save(page) { await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function closed(page) { const cancel=page.getByRole('button',{name:'取消',exact:true});if(await cancel.isVisible())await cancel.click();await page.locator('#wb-title').waitFor({state:'hidden'}); }
async function taskById(id) { return (await (await fetch(`http://127.0.0.1:3002/api/tasks`)).json()).find(t=>t.id===id); }
// 新建不弹窗：回车后出现“已添加”提示，任务直接落库
async function quickAdd(page,text) { const input=page.getByRole('textbox',{name:'添加任务',exact:true});await input.fill(text);await input.press('Enter');await page.locator('.wb-notice').filter({hasText:'已添加'}).waitFor();assert.equal(await page.locator('#wb-title').count(),0,'新建后不应弹出编辑窗');assert.equal(await input.inputValue(),''); }
// 鼠标拖动任务行到某个分组（按住移动几像素后开始拖）
async function dragRowTo(page,rowLocator,zoneLocator) { await rowLocator.scrollIntoViewIfNeeded();const a=await rowLocator.locator('.wb-sidebar-title').boundingBox();const b=await zoneLocator.boundingBox();await page.mouse.move(a.x+20,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+30,a.y+a.height/2+6,{steps:3});const box=await page.locator('.wb-task-scroll').boundingBox();let z=b;for(let i=0;i<60&&(z.y+20>box.y+box.height-60||z.y+20<box.y+60);i++){await page.mouse.move(a.x+30,z.y>box.y?box.y+box.height-8:box.y+8);await page.waitForTimeout(80);z=await zoneLocator.boundingBox();}await page.mouse.move(z.x+z.width/2,z.y+Math.min(z.height/2,24),{steps:12});await zoneLocator.and(page.locator('.is-drop-target')).waitFor();await page.mouse.up(); }
async function waitForTask(id,predicate) { for (let i=0;i<25;i++){const t=await taskById(id);if(t&&predicate(t))return t;await new Promise(r=>setTimeout(r,200));}throw new Error(`task ${id} 未在期限内满足断言`); }
async function waitForTaskWhere(predicate) { for (let i=0;i<25;i++){const tasks=await (await fetch(`http://127.0.0.1:3002/api/tasks`)).json();const t=tasks.find(predicate);if(t)return t;await new Promise(r=>setTimeout(r,200));}throw new Error('没有任务在期限内满足断言'); }
async function check(name,fn) { await fn();results.push({name,result:'PASS'});console.log(`PASS ${name}`); }
try {
  await reset();
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page=await context.newPage();
  activePage=page;page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('.wb-main-pane h1').waitFor();
  await check('default list and desktop layout',async()=>{assert.equal(await page.locator('h1').textContent(),'今天');assert.equal(await page.locator('.wb-detail-panel').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);});
  await check('add, edit, save and reload',async()=>{
    await quickAdd(page,'验收新增任务');
    await page.locator('.wb-sidebar-row.is-new').filter({hasText:'验收新增任务'}).waitFor();
    await page.locator('.wb-notice').getByRole('button',{name:'编辑'}).click();await page.locator('#wb-title').waitFor();
    await page.locator('#wb-notes').fill('刷新后应当保留的备注');await save(page);
    await page.reload();await openDetail(page,'验收新增任务');await page.locator('#wb-notes').waitFor();assert.equal(await page.locator('#wb-notes').inputValue(),'刷新后应当保留的备注');
  });
  await check('click outside or Esc saves, cancel discards',async()=>{
    await page.locator('#wb-title').fill('点空白保存的标题');
    await page.mouse.click(8,8);await page.locator('#wb-title').waitFor({state:'hidden'});
    await waitForTaskWhere(t=>t.title==='点空白保存的标题');
    await openDetail(page,'点空白保存的标题');await page.locator('#wb-title').fill('取消后不该保存');await closed(page);
    await row(page,'点空白保存的标题');
    await openDetail(page,'点空白保存的标题');await page.locator('#wb-title').fill('验收新增任务');await page.keyboard.press('Escape');
    await page.locator('#wb-title').waitFor({state:'hidden'});await row(page,'验收新增任务');
    // 标题清空时点空白不关闭，提示先填好或取消
    await openDetail(page,'验收新增任务');await page.locator('#wb-title').fill('');await page.mouse.click(8,8);
    await waitText(page,'标题不能为空。填好再关闭，或点“取消”放弃修改。');await closed(page);
  });
  await check('save failure retains draft and retry persists',async()=>{
    await openDetail(page,'验收新增任务');await page.locator('#wb-title').fill('失败后重试成功的任务');await fail();await page.getByRole('button',{name:'保存',exact:true}).click();await waitText(page,'没有保存成功，请检查网络后重试。');assert.equal(await page.locator('#wb-title').inputValue(),'失败后重试成功的任务');await save(page);await page.reload();await row(page,'失败后重试成功的任务');
  });
  await check('add failure retains input and avoids duplicate',async()=>{
    const input=page.getByRole('textbox',{name:'添加任务',exact:true});await input.fill('保留新增输入');await fail();await input.press('Enter');await waitText(page,'新建失败，请检查网络后重试');assert.equal(await input.inputValue(),'保留新增输入');await input.press('Enter');await row(page,'保留新增输入');assert.equal(await page.getByText('保留新增输入',{exact:true}).count(),1);
  });
  await check('natural language quick add parses date',async()=>{
    const input=page.getByRole('textbox',{name:'添加任务',exact:true});await input.fill('明天交周报');
    await page.locator('.wb-parse-hint').filter({hasText:'明天'}).waitFor();
    await input.press('Enter');await page.locator('.wb-notice').filter({hasText:'已添加「交周报」到明天'}).waitFor();
    await waitForTaskWhere(t=>t.title==='交周报'&&t.dueDate===localDate(1));
  });
  await check('completion persists after reload and appears in history',async()=>{
    const r=await row(page,'保留新增输入');await r.getByRole('checkbox').click();await r.getByRole('checkbox',{checked:true}).waitFor();await page.reload();const done=await row(page,'保留新增输入');assert.equal(await done.getByRole('checkbox').getAttribute('aria-checked'),'true');await nav(page,'已完成');await row(page,'保留新增输入');
  });
  await check('recurrence completion applies to one day only',async()=>{
    await nav(page,'今天');const r=await row(page,'下班后跑步 30 分钟');await r.getByRole('checkbox').click();await r.getByRole('checkbox',{checked:true}).waitFor();await nav(page,'最近 7 天');const rows=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText('下班后跑步 30 分钟',{exact:true})});await rows.first().waitFor();assert.equal(await rows.count(),7);assert.equal(await rows.nth(1).getByRole('checkbox').getAttribute('aria-checked'),'false');
  });
  await check('sort control reorders and groups collapse',async()=>{
    await nav(page,'今天');
    const firstRow=()=>page.locator('.wb-task-group:not(.is-overdue) .wb-sidebar-row').first();
    const priTop=await firstRow().textContent();
    assert.ok(priTop?.includes('整理本周的项目进度'),'默认按优先级应高优在前');
    await page.getByLabel('任务排序').selectOption('title');
    assert.notEqual(await firstRow().textContent(),priTop,'按标题后顺序应变化');
    await page.getByLabel('任务排序').selectOption('priority');
    assert.ok((await firstRow().textContent())?.includes('整理本周的项目进度'),'切回优先级应恢复');
    // 分组折叠
    const heading=page.locator('.wb-task-group.is-overdue .wb-group-heading');
    await heading.click();
    assert.equal(await page.locator('.wb-task-group.is-overdue .wb-task-list').isHidden(),true,'折叠后列表应隐藏');
    await heading.click();
    assert.equal(await page.locator('.wb-task-group.is-overdue .wb-task-list').isVisible(),true,'展开后列表应可见');
  });
  await check('rename from menu edits title inline and ignores IME enter',async()=>{
    await nav(page,'今天');const r=await row(page,'给家里买牛奶和水果');await r.getByRole('button',{name:'更多操作：给家里买牛奶和水果'}).click();
    await page.getByRole('dialog',{name:'更多操作：给家里买牛奶和水果'}).getByRole('button',{name:'重命名'}).click();
    // 进入编辑后标题文本被输入框取代，编辑框用 aria-label 全局定位
    const editor=page.getByRole('textbox',{name:'编辑：给家里买牛奶和水果'});await editor.waitFor();await editor.fill('给家里买牛奶和鸡蛋');
    // 输入法选词中的 Enter 不应保存
    await editor.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
    await page.waitForTimeout(200);assert.equal((await taskById(5)).title,'给家里买牛奶和水果','合成中的 Enter 不应保存');
    await editor.press('Enter');
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
    await pickDate(page,pop.locator('.wb-picker'),localDate(3));
    await r.waitFor({state:'hidden'});
    const afterOnce=await taskById(11);assert.equal(afterOnce.dueDate,localDate(0));assert.equal(afterOnce.dateOverrides[localDate(0)],localDate(3));
    await nav(page,'最近 7 天');const rows=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText('写周报',{exact:true})});await rows.first().waitFor();assert.equal(await rows.count(),1);
    await rows.first().getByRole('button',{name:/日期：/}).click();
    const pop2=page.locator('.wb-date-pop').last();
    await pop2.getByRole('radio',{name:'整个系列'}).click();
    assert.equal(await pop2.getByRole('radio',{name:'整个系列'}).getAttribute('aria-checked'),'true');
    await pickDate(page,pop2.locator('.wb-picker'),localDate(2));
    const afterSeries=await waitForTask(11,t=>t.dueDate===localDate(2));assert.deepEqual(afterSeries.dateOverrides,{});
  });
  await check('moved occurrence reflects on calendar',async()=>{
    // 仅这一次改期后，月视图中原日期不再显示、新日期出现（覆盖 expandOccurrences 的例外分支）
    const rows=page.locator('.wb-task-list .wb-sidebar-row').filter({has:page.getByText('写周报',{exact:true})});
    await rows.first().getByRole('button',{name:/日期：/}).click();
    const pop=page.locator('.wb-date-pop').last();
    assert.equal(await pop.getByRole('radio',{name:'仅这一次'}).getAttribute('aria-checked'),'true');
    await pickDate(page,pop.locator('.wb-picker'),localDate(5));
    await waitForTask(11,t=>t.dateOverrides&&t.dateOverrides[localDate(2)]===localDate(5));
    await nav(page,'日历');
    await page.locator('.fc-daygrid-day').first().waitFor();
    assert.equal(await page.locator(`.fc-daygrid-day[data-date="${localDate(2)}"] .wb-event`).filter({has:page.getByText('写周报')}).count(),0,'原日期不应再显示');
    assert.equal(await page.locator(`.fc-daygrid-day[data-date="${localDate(5)}"] .wb-event`).filter({has:page.getByText('写周报')}).count(),1,'新日期应出现');
  });
  await check('calendar quick add, event click, complete and navigation',async()=>{
    // 点日期数字唤起快速添加（避开当天的重复任务事件）
    await page.locator(`.fc-daygrid-day[data-date="${localDate(1)}"] .fc-daygrid-day-number`).click();
    await page.locator('.wb-quick-add').waitFor();
    await page.locator('.wb-quick-add input').fill('临时讨论');
    await page.locator('.wb-quick-add').getByRole('button',{name:'保存'}).click();
    await page.locator(`.fc-daygrid-day[data-date="${localDate(1)}"] .wb-event`).filter({has:page.getByText('临时讨论')}).waitFor();
    // 点事项标题打开详情
    await page.locator('.wb-event').filter({has:page.getByText('临时讨论')}).locator('.wb-title').click();
    await page.locator('#wb-title').waitFor();
    assert.equal(await page.locator('#wb-title').inputValue(),'临时讨论');
    await closed(page);
    // 日历上的完成打卡
    const eventCheck=page.locator('.wb-event').filter({has:page.getByText('临时讨论')}).getByRole('button',{name:'完成：临时讨论'});
    await eventCheck.click();
    await page.locator('.wb-event').filter({has:page.getByText('临时讨论')}).getByRole('button',{name:'取消完成：临时讨论'}).waitFor();
    // ←/→ 切换月份
    const titleBefore=await page.locator('.fc-toolbar-title').textContent();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(t=>{const el=document.querySelector('.fc-toolbar-title');return el&&el.textContent!==t;},titleBefore);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(t=>{const el=document.querySelector('.fc-toolbar-title');return el&&el.textContent===t;},titleBefore);
    // 每天重复任务在月视图铺开多天
    assert.ok(await page.locator('.wb-event').filter({has:page.getByText('下班后跑步 30 分钟')}).count()>=5,'重复任务应在月视图多天出现');
    await nav(page,'今天');
  });
  await check('search covers title, notes and tags',async()=>{
    await page.getByRole('button',{name:'搜索任务'}).click();await page.getByRole('textbox',{name:'搜索任务'}).fill('设计师');await row(page,'和设计师确认首页修改');assert.equal(await page.locator('.wb-task-list .wb-sidebar-row').count(),1);await nav(page,'工作');await row(page,'和设计师确认首页修改');
    await page.getByRole('button',{name:'搜索任务'}).click();
    const q=page.getByRole('textbox',{name:'搜索任务'});
    await q.fill('移动端');await row(page,'和设计师确认首页修改');
    await q.fill('成长');await row(page,'每周复盘');
    await q.fill('不存在的关键词xyz');await waitText(page,'没有找到相关任务');
    await page.locator('.wb-search-field').getByRole('button',{name:'清空搜索'}).click();await waitText(page,'搜索标题、标签或备注');
    await nav(page,'今天');
  });
  await check('reschedule through task menu',async()=>{
    await nav(page,'今天');const r=await row(page,'失败后重试成功的任务');await r.getByRole('button',{name:'更多操作：失败后重试成功的任务'}).click();await page.getByRole('button',{name:'推迟到明天',exact:true}).click();await r.waitFor({state:'hidden'});await nav(page,'最近 7 天');await row(page,'失败后重试成功的任务');
  });
  await check('soft delete, recycle and restore',async()=>{
    await nav(page,'今天');const r=await row(page,'和设计师确认首页修改');await r.getByRole('button',{name:'更多操作：和设计师确认首页修改'}).click();await page.getByRole('button',{name:'删除事项',exact:true}).click();await page.getByRole('group',{name:'确认删除',exact:true}).getByRole('button',{name:'确认',exact:true}).click();await r.waitFor({state:'hidden'});await nav(page,'回收站');const recycled=await row(page,'和设计师确认首页修改');await recycled.getByRole('button',{name:'恢复事项'}).click();await recycled.waitFor({state:'hidden'});await page.reload();await row(page,'和设计师确认首页修改');
  });
  await check('detail edits repeat rule for the series',async()=>{
    await nav(page,'最近 7 天');await openDetail(page,'写周报');
    await page.getByRole('combobox',{name:'重复'}).click();
    await page.getByRole('option',{name:'每月',exact:true}).click();
    await save(page);
    await waitForTask(11,t=>t.repeatRule==='monthly');
    // 恢复为每周，避免影响后续用例
    await fetch('http://127.0.0.1:3002/api/tasks/11',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...await taskById(11),repeatRule:'weekly'})});
  });
  await check('repeat until ends the series and one day completes alone',async()=>{
    const title='下班后跑步 30 分钟';
    await nav(page,'今天');await openDetail(page,title);
    await pickDate(page,page.locator('#wb-repeat-until'),localDate(2));
    await page.getByText('到这天为止，共 3 次',{exact:true}).waitFor();
    await page.getByRole('checkbox',{name:/这一次已完成/}).check();
    for(let i=0;!(await (await fetch('http://127.0.0.1:3002/api/completions')).json()).includes(`4:${localDate(0)}`);i++){assert.ok(i<25,'单次完成未写入');await new Promise(r=>setTimeout(r,200));}
    await save(page);
    await waitForTask(4,t=>t.repeatUntil===localDate(2));
    await nav(page,'最近 7 天');
    const inDay=offset=>page.locator(`.wb-task-group[data-drop-date="${localDate(offset)}"]`).filter({hasText:title});
    await inDay(2).waitFor();
    assert.equal(await inDay(0).count(),0,'今天这次已完成，不在待办里');
    assert.equal(await inDay(3).count(),0,'截止日之后不再出现');
    await fetch('http://127.0.0.1:3002/api/tasks/4',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...await taskById(4),repeatUntil:''})});
    await fetch('http://127.0.0.1:3002/api/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:4,date:localDate(0),done:false})});
    await page.reload();await page.locator('.wb-main-pane h1').waitFor();
  });
  await check('keyboard shortcuts navigate and focus',async()=>{
    await nav(page,'最近 7 天');
    await page.keyboard.press('n');
    assert.equal(await page.getByRole('textbox',{name:'添加任务',exact:true}).evaluate(el=>el===document.activeElement),true,'N 应聚焦添加输入框');
    // 焦点回到空白处后 T 才会生效（输入框内按键被守卫忽略）
    await page.locator('.wb-list-header h1').click();
    await page.keyboard.press('t');
    await page.locator('h1').filter({hasText:'今天'}).waitFor();
    await page.keyboard.press('Control+f');
    await page.locator('h1').filter({hasText:'搜索任务'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'搜索任务'}).evaluate(el=>el===document.activeElement),true,'Ctrl+F 应聚焦搜索框');
    await nav(page,'今天');
  });
  await check('dark appearance persists across reload',async()=>{
    await page.locator('.wb-nav-footer').getByRole('button',{name:'设置'}).click();
    await page.locator('#wb-appearance').selectOption('dark');
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),true);
    await page.reload();await page.locator('.wb-main-pane h1').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),true,'刷新后应保持深色');
    await page.locator('.wb-nav-footer').getByRole('button',{name:'设置'}).click();
    await page.locator('#wb-appearance').selectOption('light');
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),false);
    await page.keyboard.press('Escape');await page.locator('.wb-settings-popover').waitFor({state:'hidden'});
  });
  await check('backup export downloads valid json',async()=>{
    await page.keyboard.press('Escape');
    await page.locator('.wb-nav-footer').getByRole('button',{name:'设置'}).click();
    await page.getByRole('button',{name:'导出备份'}).waitFor();
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出备份'}).click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/^workbench-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const content=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(content.app,'workbench');assert.ok(Array.isArray(content.tasks)&&content.tasks.length>0);assert.ok(Array.isArray(content.completions));
  });
  await check('recycle permanent delete purges task',async()=>{
    await nav(page,'今天');const r=await row(page,'给家里买牛奶和鸡蛋');await r.getByRole('button',{name:'更多操作：给家里买牛奶和鸡蛋'}).click();await page.getByRole('button',{name:'删除事项',exact:true}).click();await page.getByRole('group',{name:'确认删除',exact:true}).getByRole('button',{name:'确认',exact:true}).click();await r.waitFor({state:'hidden'});
    await nav(page,'回收站');const recycled=await row(page,'给家里买牛奶和鸡蛋');
    await recycled.getByRole('button',{name:'永久删除事项'}).click();
    await page.getByRole('group',{name:'确认永久删除',exact:true}).getByRole('button',{name:'永久删除',exact:true}).click();
    await recycled.waitFor({state:'hidden'});
    assert.equal(await taskById(5),undefined,'永久删除后任务应不存在');
    await waitText(page,'回收站是空的');
  });
  await check('calendar remains reachable',async()=>{await nav(page,'日历');await page.locator('.fc-daygrid-day').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);});
  // 祖先元素残留 transform 会让 fixed 定位的拖拽镜像偏离光标；挤满的格子不能只剩“另外 N 个”
  await check('calendar drag mirror follows cursor and crowded day keeps visible events',async()=>{
    await reset();await page.reload();await nav(page,'日历');
    const today=page.locator(`.fc-daygrid-day[data-date="${localDate(0)}"]`);
    await today.locator('.fc-daygrid-more-link').waitFor();
    assert.ok(await today.locator('.fc-daygrid-event-harness').evaluateAll(els=>els.filter(e=>getComputedStyle(e).visibility==='visible').length)>0,'今天的格子应至少显示一个事项');
    const offset=new Date().getDay()===0?-1:1;
    const src=await today.locator('.fc-daygrid-event').filter({hasText:'整理本周的项目进度'}).locator('.wb-title').boundingBox();
    const dst=await page.locator(`.fc-daygrid-day[data-date="${localDate(offset)}"]`).boundingBox();
    const x=dst.x+dst.width/2,y=dst.y+dst.height/2;
    await page.mouse.move(src.x+10,src.y+src.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:12});
    const mirror=await page.locator('.fc-event-dragging').boundingBox();
    assert.ok(mirror&&x>=mirror.x&&x<=mirror.x+mirror.width&&y>=mirror.y&&y<=mirror.y+mirror.height,`拖拽镜像 ${JSON.stringify(mirror)} 应覆盖光标 ${x},${y}`);
    await page.mouse.up();
    await waitForTask(1,t=>t.dueDate===localDate(offset));
  });
  await check('calendar inbox sidebar: quick add, drag in and drag back',async()=>{
    await reset();await page.reload();await nav(page,'日历');
    await page.locator('.wb-inbox-toggle').click();const panel=page.locator('.wb-cal-inbox');await panel.waitFor();
    await panel.getByLabel('记到收集箱').fill('侧栏记录的事');await panel.getByLabel('记到收集箱').press('Enter');
    await panel.locator('.wb-inbox-item').filter({hasText:'侧栏记录的事'}).waitFor();
    const offset=new Date().getDay()===0?-1:1;
    const src=await panel.locator('.wb-inbox-item').filter({hasText:'预约周末的口腔检查'}).boundingBox();
    const dst=await page.locator(`.fc-daygrid-day[data-date="${localDate(offset)}"]`).boundingBox();
    await page.mouse.move(src.x+60,src.y+src.height/2);await page.mouse.down();await page.mouse.move(dst.x+dst.width/2,dst.y+dst.height/2,{steps:15});await page.mouse.up();
    await waitForTask(7,t=>t.dueDate===localDate(offset));
    const ev=await page.locator(`.fc-daygrid-day[data-date="${localDate(offset)}"] .fc-daygrid-event`).filter({hasText:'预约周末的口腔检查'}).locator('.wb-title').boundingBox();
    const list=await panel.locator('.wb-cal-inbox-list').boundingBox();
    await page.mouse.move(ev.x+10,ev.y+ev.height/2);await page.mouse.down();await page.mouse.move(list.x+list.width/2,list.y+80,{steps:15});
    await page.locator('.wb-cal-inbox.is-drop-target').waitFor();await page.mouse.up();
    await waitForTask(7,t=>t.dueDate==='');
    await panel.getByRole('button',{name:'收起收集箱'}).click();await panel.waitFor({state:'hidden'});
  });
  await check('detail adds a reminder with date and time, row shows it and schedule syncs',async()=>{
    await reset();await page.reload();await nav(page,'最近 7 天');await openDetail(page,'准备下周分享的提纲');
    // 任务只有日期，没有时间控件
    assert.equal(await page.locator('#wb-time').count(),0);
    await page.getByRole('button',{name:'添加提醒'}).click();
    await setTime(page,'#wb-remind-time','14:15');
    await waitText(page,'服务器还没配置推送，暂时不会发出提醒');
    await save(page);
    // 提醒以任务当天 09:00 为基准：14:15 = 提前 -315 分钟
    await waitForTask(8,t=>t.dueTime===''&&t.remindOffset===540-855);
    await (await row(page,'准备下周分享的提纲')).getByRole('button',{name:/日期：.*，提醒 14:15，点击修改/}).waitFor();
    let synced;for(let i=0;i<25&&!synced;i++){synced=(await (await fetch('http://127.0.0.1:3002/__test/reminders')).json()).find(r=>r.taskId===8);if(!synced)await new Promise(r=>setTimeout(r,200));}
    assert.match(synced?.body??'',/^今天 \d+月\d+日 周.（.+月.+）$/,'正文应带日期、星期和农历');assert.equal(synced.date,localDate(2));
    // 日历上也能看到提醒时间
    await nav(page,'日历');await page.locator(`.fc-daygrid-day[data-date="${localDate(2)}"] .wb-event-remind`).filter({hasText:'14:15'}).waitFor();
    await nav(page,'最近 7 天');
  });
  await check('reminder on another day, then removed',async()=>{
    await openDetail(page,'准备下周分享的提纲');
    await pickDate(page,page.locator('#wb-remind-date'),localDate(1));await setTime(page,'#wb-remind-time','08:07');
    await page.locator('#wb-notes').fill('## 带上投影仪\n第二行不进通知');
    await save(page);
    // 任务当天 09:00 往前推到前一天 08:07 = 提前 24 小时 53 分
    await waitForTask(8,t=>t.remindOffset===24*60+53);
    await (await row(page,'准备下周分享的提纲')).getByRole('button',{name:/提醒 明天 08:07/}).waitFor();
    let synced;for(let i=0;i<25&&!synced;i++){synced=(await (await fetch('http://127.0.0.1:3002/__test/reminders')).json()).find(r=>r.taskId===8&&r.fireAt===new Date(`${localDate(1)}T08:07`).toISOString());if(!synced)await new Promise(r=>setTimeout(r,200));}
    assert.ok(synced,'提醒时刻应同步到后端');
    assert.match(synced.body,/^明天 \d+月\d+日 周.（.+）\n带上投影仪$/,'第二行是去掉 Markdown 前缀的备注首行');
    await openDetail(page,'准备下周分享的提纲');await page.getByRole('button',{name:'取消提醒'}).click();await save(page);
    await waitForTask(8,t=>t.remindOffset===null);
  });
  await check('quick add turns a parsed time into a reminder',async()=>{
    const input=page.getByRole('textbox',{name:'添加任务',exact:true});await input.fill('后天下午3点 体检');
    await page.locator('.wb-parse-hint').filter({hasText:'提醒 15:00'}).waitFor();
    await input.press('Enter');await page.locator('.wb-notice').filter({hasText:'已添加'}).waitFor();
    await waitForTaskWhere(t=>t.title==='体检'&&t.dueDate===localDate(2)&&t.dueTime===''&&t.remindOffset===540-900);
  });
  await check('recurring streak badge and completed view grouped by day',async()=>{
    await fetch('http://127.0.0.1:3002/api/tasks/4',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...await taskById(4),dueDate:localDate(-5)})});
    for(const d of [-1,-2,-3])await fetch('http://127.0.0.1:3002/api/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:4,date:localDate(d),done:true})});
    await page.reload();await nav(page,'今天');
    await (await row(page,'下班后跑步 30 分钟')).getByLabel('已连续完成 3 次').waitFor();
    await openDetail(page,'下班后跑步 30 分钟');await page.locator('.wb-task-stats').filter({hasText:'已连续完成 3 次 · 累计完成 3 次'}).waitFor();await closed(page);
    const r=await row(page,'给家里买牛奶和水果');await r.getByRole('checkbox').click();await r.getByRole('checkbox',{checked:true}).waitFor();
    await waitForTask(5,t=>t.completed&&!!t.completedAt);
    await nav(page,'已完成');
    const todayGroup=page.locator('.wb-task-group').filter({has:page.locator('h2',{hasText:/^今天$/})});
    await todayGroup.getByText('给家里买牛奶和水果',{exact:true}).waitFor();
    await page.locator('.wb-task-group').filter({has:page.locator('h2',{hasText:/^昨天$/})}).getByText('下班后跑步 30 分钟',{exact:true}).waitFor();
  });
  await check('today: drag overdue task onto today',async()=>{
    await reset();await page.reload();await nav(page,'今天');
    const overdue=await row(page,'整理昨天的会议记录');
    const todayGroup=page.locator(`.wb-task-group[data-drop-date="${localDate(0)}"]`);
    // 逾期分组不是落点
    assert.equal(await page.locator('.wb-task-group.is-overdue[data-drop-date]').count(),0);
    await dragRowTo(page,overdue,todayGroup);
    await waitForTask(6,t=>t.dueDate===localDate(0));
    await todayGroup.getByText('整理昨天的会议记录',{exact:true}).waitFor();
    assert.equal(await page.locator('#wb-title').count(),0,'拖完不应打开编辑窗');
    await page.locator('.wb-notice').filter({hasText:'已移到今天'}).waitFor();
  });
  await check('today: drag a task to the tomorrow slot that appears while dragging',async()=>{
    const target=await row(page,'给家里买牛奶和水果');
    const a=await target.locator('.wb-sidebar-title').boundingBox();
    await page.mouse.move(a.x+20,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+30,a.y+a.height/2+8,{steps:3});
    const slot=page.locator('.wb-drop-extra');await slot.waitFor();const b=await slot.boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await slot.and(page.locator('.is-drop-target')).waitFor();await page.mouse.up();
    await waitForTask(5,t=>t.dueDate===localDate(1));
    await slot.waitFor({state:'hidden'});
  });
  await check('upcoming: seven day groups, drag today to a later day, recurring moves once',async()=>{
    await nav(page,'最近 7 天');
    assert.equal(await page.locator('.wb-task-group[data-drop-date]').count(),7);
    const r=await row(page,'和设计师确认首页修改');
    await dragRowTo(page,r,page.locator(`.wb-task-group[data-drop-date="${localDate(3)}"]`));
    await waitForTask(2,t=>t.dueDate===localDate(3));
    // 重复任务只挪这一次
    const weekly=page.locator(`.wb-task-group[data-drop-date="${localDate(0)}"] .wb-sidebar-row`).filter({has:page.getByText('写周报',{exact:true})});
    await dragRowTo(page,weekly,page.locator(`.wb-task-group[data-drop-date="${localDate(1)}"]`));
    const t=await waitForTask(11,t=>t.dateOverrides&&t.dateOverrides[localDate(0)]===localDate(1));assert.equal(t.dueDate,localDate(0));
    // 同一天不是落点，松手不改
    const before=(await taskById(1)).updatedAt;
    const r1=await row(page,'整理本周的项目进度');await r1.scrollIntoViewIfNeeded();const own=page.locator(`.wb-task-group[data-drop-date="${localDate(0)}"]`);
    const a=await r1.locator('.wb-sidebar-title').boundingBox();const b=await own.boundingBox();
    await page.mouse.move(a.x+20,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+40,b.y+20,{steps:8});
    assert.equal(await page.locator('.is-drop-target').count(),0);await page.mouse.up();
    assert.equal((await taskById(1)).updatedAt,before);
  });
  await check('subtasks: add, linkage between parent and children, edit in dialog',async()=>{
    await nav(page,'今天');
    const parent=await row(page,'整理本周的项目进度');
    await parent.getByRole('button',{name:'更多操作：整理本周的项目进度'}).click();
    await page.getByRole('dialog',{name:'更多操作：整理本周的项目进度'}).getByRole('button',{name:'添加子任务'}).click();
    const add=parent.getByRole('textbox',{name:'添加子任务'});await add.waitFor();
    await add.fill('核对上线进度');await add.press('Enter');await parent.getByText('核对上线进度',{exact:true}).waitFor();
    await add.fill('同步给团队');await add.press('Enter');await parent.getByText('同步给团队',{exact:true}).waitFor();
    await parent.getByRole('button',{name:/子任务 0\/2/}).waitFor();
    // 子任务不单独出现在清单里
    assert.equal(await page.locator('.wb-task-list > .wb-sidebar-row').filter({has:page.locator('.wb-sidebar-title',{hasText:'核对上线进度'})}).count(),0);
    const subs=(await (await fetch('http://127.0.0.1:3002/api/tasks')).json()).filter(t=>t.parentId===1);assert.equal(subs.length,2);
    // 全部子任务完成 → 父任务自动完成
    await parent.getByRole('checkbox',{name:'完成子任务：核对上线进度'}).click();await waitForTask(subs[0].id,t=>t.completed);
    assert.equal((await taskById(1)).completed,false);
    await parent.getByRole('checkbox',{name:'完成子任务：同步给团队'}).click();
    await waitForTask(1,t=>t.completed);
    // 取消一个子任务 → 父任务重新打开
    const doneParent=page.locator('.wb-sidebar-row').filter({has:page.locator('.wb-sidebar-title',{hasText:'整理本周的项目进度'})});
    await doneParent.getByRole('checkbox',{name:'取消完成子任务：同步给团队'}).click();
    await waitForTask(1,t=>!t.completed);
    // 完成父任务 → 子任务一起完成
    await (await row(page,'整理本周的项目进度')).getByRole('checkbox',{name:'完成：整理本周的项目进度'}).click();
    await waitForTask(subs[1].id,t=>t.completed);await waitForTask(1,t=>t.completed);
    // 弹窗里改名、删除、新增；新增未完成子任务会让父任务重新打开
    await openDetail(page,'整理本周的项目进度');
    const dlg=page.getByRole('dialog');
    const rename=dlg.getByRole('textbox',{name:'子任务标题：同步给团队'});await rename.fill('同步给全组');await rename.press('Enter');
    await waitForTask(subs[1].id,t=>t.title==='同步给全组');
    await dlg.getByRole('button',{name:'删除子任务：核对上线进度'}).click();
    for(let i=0;i<25&&await taskById(subs[0].id);i++)await new Promise(r=>setTimeout(r,200));
    assert.equal(await taskById(subs[0].id),undefined);
    const add2=dlg.getByRole('textbox',{name:'添加子任务'});await add2.fill('写会议纪要');await add2.press('Enter');
    await waitForTask(1,t=>!t.completed);
    await closed(page);
    // 删除父任务，子任务一起进回收站、一起恢复
    await (await row(page,'整理本周的项目进度')).getByRole('button',{name:'更多操作：整理本周的项目进度'}).click();
    await page.getByRole('dialog',{name:'更多操作：整理本周的项目进度'}).getByRole('button',{name:'删除事项'}).click();
    await page.getByRole('group',{name:'确认删除'}).getByRole('button',{name:'确认'}).click();
    await waitForTaskWhere(t=>t.parentId===1&&t.title==='写会议纪要'&&!!t.deletedAt);
    await nav(page,'回收站');assert.equal(await page.locator('.wb-task-list').getByText('写会议纪要',{exact:true}).count(),0,'子任务不单独进回收站');
    await (await row(page,'整理本周的项目进度')).getByRole('button',{name:/恢复/}).click();
    await waitForTaskWhere(t=>t.parentId===1&&t.title==='写会议纪要'&&!t.deletedAt);
  });
  await check('subtasks on a recurring task are checked per day',async()=>{
    await nav(page,'今天');const r=await row(page,'下班后跑步 30 分钟');
    await r.getByRole('button',{name:'更多操作：下班后跑步 30 分钟'}).click();
    await page.getByRole('dialog',{name:'更多操作：下班后跑步 30 分钟'}).getByRole('button',{name:'添加子任务'}).click();
    const add=r.getByRole('textbox',{name:'添加子任务'});await add.fill('拉伸 5 分钟');await add.press('Enter');
    await r.getByRole('checkbox',{name:'完成子任务：拉伸 5 分钟'}).click();
    const sub=await waitForTaskWhere(t=>t.parentId===4);
    const comps=async()=>await (await fetch('http://127.0.0.1:3002/api/completions')).json();
    for(let i=0;i<25&&!(await comps()).includes(`4:${localDate(0)}`);i++)await new Promise(r=>setTimeout(r,200));
    const c=await comps();assert.ok(c.includes(`${sub.id}:${localDate(0)}`));assert.ok(c.includes(`4:${localDate(0)}`),'唯一的子任务完成后父任务当天打卡');
    assert.equal((await taskById(sub.id)).completed,false,'重复任务的子任务按天记录，不改 completed');
  });
  await check('import backup validates file and replaces data',async()=>{
    const openImport=async()=>{await page.getByRole('button',{name:'设置'}).click();await page.getByRole('button',{name:'导入备份'}).click();await page.getByRole('dialog',{name:'导入备份'}).waitFor();};
    await openImport();
    await page.getByLabel('选择备份文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"app":"other"}')});
    await waitText(page,'这不是 Workbench 导出的备份文件');
    const backup={app:'workbench',version:1,exportedAt:new Date().toISOString(),tasks:[{id:1,title:'从备份恢复的任务',notes:'',dueDate:localDate(0),dueTime:'',remindOffset:null,priority:2,tags:['恢复'],repeatRule:'none',completed:false,completedAt:null,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],completions:[]};
    await page.getByLabel('选择备份文件').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await waitText(page,'1 个任务、0 条打卡');
    await page.getByRole('button',{name:'替换并恢复'}).click();await waitText(page,'已恢复 1 个任务、0 条打卡记录');
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await nav(page,'今天');await row(page,'从备份恢复的任务');
    assert.equal(await page.getByText('和设计师确认首页修改',{exact:true}).count(),0);
  });
  await check('notification settings and PWA assets',async()=>{
    await page.getByRole('button',{name:'设置'}).click();await page.getByRole('button',{name:/提醒通知/}).click();
    await waitText(page,'服务器还没配置推送密钥（VAPID），暂时无法开启。');await page.keyboard.press('Escape');
    const manifest=await (await fetch(`${base}/manifest.webmanifest`)).json();
    assert.equal(manifest.display,'standalone');
    for(const icon of manifest.icons)assert.equal((await fetch(`${base}/${icon.src}`)).status,200);
    assert.match(await (await fetch(`${base}/sw.js`)).text(),/addEventListener\("push"/);
    assert.ok(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())),'Service Worker 应已注册');
  });
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
    assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await nav(m,'收集箱');await m.getByRole('textbox',{name:'添加任务',exact:true}).fill('手机收集箱任务');await m.getByRole('textbox',{name:'添加任务',exact:true}).press('Enter');await openDetail(m,'手机收集箱任务');await m.locator('[data-slot="sheet-content"]').waitFor();assert.equal(await m.locator('#wb-date').inputValue(),'');await m.locator('#wb-notes').fill('手机备注');await save(m);await m.reload();await nav(m,'收集箱');await openDetail(m,'手机收集箱任务');await m.locator('#wb-notes').waitFor();assert.equal(await m.locator('#wb-notes').inputValue(),'手机备注');await closed(m);
  });
  await check('mobile task menu remains accessible',async()=>{const r=await row(m,'手机收集箱任务');await r.getByRole('button',{name:'更多操作：手机收集箱任务'}).click();await m.getByRole('button',{name:'移到今天',exact:true}).click();await r.waitFor({state:'hidden'});await nav(m,'今天');await row(m,'手机收集箱任务');});
  await check('mobile quick date and priority',async()=>{
    // 在「今天」视图改期到明天会让任务移出视图，先切到「最近 7 天」验证
    await nav(m,'最近 7 天');
    const r=await row(m,'手机收集箱任务');
    await r.getByRole('button',{name:/日期：/}).click();await pickDate(m,m.locator('.wb-date-pop').last().locator('.wb-picker'),localDate(1));await r.getByRole('button',{name:'日期：明天，点击修改'}).waitFor();
    await r.locator('.wb-pri-btn').click();await m.locator('.wb-pri-menu').last().getByRole('button',{name:'设为高优先级'}).click();await m.locator('.wb-sidebar-row.is-pri-high').filter({has:m.getByText('手机收集箱任务',{exact:true})}).waitFor();
  });
  await check('mobile calendar inbox sheet schedules a task',async()=>{
    await nav(m,'日历');await m.locator('.wb-calendar-inbox-btn').click();
    const sheet=m.locator('.wb-inbox-sheet');await sheet.waitFor();
    const item=sheet.locator('li').filter({hasText:'预约周末的口腔检查'});await item.getByRole('button',{name:'明天',exact:true}).click();
    await waitForTask(7,t=>t.dueDate===localDate(1));
  });
  await check('mobile long-press drags a task to another day',async()=>{
    await m.reload();await nav(m,'最近 7 天');const r=await row(m,'读完《纳瓦尔宝典》第三章');
    const zone=m.locator(`.wb-task-group[data-drop-date="${localDate(2)}"]`);await r.scrollIntoViewIfNeeded();
    const a=await r.locator('.wb-sidebar-title').boundingBox();
    const cdp=await mobileContext.newCDPSession(m);const x=a.x+30,y=a.y+a.height/2;
    // 长按约 0.35 秒后才进入拖动；目标在屏幕下方时停在底边让列表自动滚动
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await new Promise(r=>setTimeout(r,500));
    await m.locator('.wb-drag-ghost').waitFor();
    const bottom=(await m.locator('.wb-task-scroll').boundingBox());const edge=bottom.y+bottom.height-6;
    let b=await zone.boundingBox();
    for(let i=0;i<60&&b.y+30>edge-60;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:edge}]});await new Promise(r=>setTimeout(r,60));b=await zone.boundingBox();}
    for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:edge+(b.y+20-edge)*i/6}]});
    await zone.and(m.locator('.is-drop-target')).waitFor();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitForTask(3,t=>t.dueDate===localDate(2));
  });
  await mobileContext.close();
  await mkdir('docs/ui-redesign',{recursive:true});
  const report={time:new Date().toISOString(),boundary:'Isolated local in-memory API; no production authentication or PostgreSQL verification',results};
  await writeFile(`docs/ui-redesign/smoke-${process.env.WORKBENCH_UI_RUN || 'latest'}.json`,JSON.stringify(report,null,2));
  console.log(`All ${results.length} scenarios passed.`);
} catch(error) {await mkdir('docs/ui-redesign',{recursive:true});await activePage?.screenshot({path:'docs/ui-redesign/test-failure.png'});throw error;}
finally {await browser.close();await reset();}
