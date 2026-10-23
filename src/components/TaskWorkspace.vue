<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { Solar } from 'lunar-typescript';
import { Bell, CalendarDays, CalendarRange, Check, CheckCheck, ChevronDown, ChevronRight, Download, Inbox, ListTodo, LogOut, Menu, Plus, Search, Settings, Settings2, Sun, Tag, Trash2, Upload, UserCog, X } from 'lucide-vue-next';
import { useTaskStore } from '@/stores/tasks';
import { currentUser } from '@/lib/auth';
import { addDays, fmtDate, parseDate } from '@/lib/date';
import { parseQuickAdd } from '@/lib/nl-parse';
import { searchTasks } from '@/lib/search';
import { useListDrag } from '@/lib/list-drag';
import { expandOccurrences } from '@/lib/recurrence';
import { lunarText } from '@/lib/lunar';
import { loadAppearance, setAppearance, type Appearance } from '@/lib/appearance';
import { downloadTaskBackup } from '@/lib/backup';
import type { Occurrence, Task } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import SidebarTaskRow from './SidebarTaskRow.vue';
import RecycleTaskRow from './RecycleTaskRow.vue';
import MonthView from './MonthView.vue';
import AccountDialog from './AccountDialog.vue';
import ImportDialog from './ImportDialog.vue';
import NotificationDialog from './NotificationDialog.vue';
import CalendarSettingsDialog from './CalendarSettingsDialog.vue';
import { pushState, refreshPushStatus } from '@/lib/push';

defineProps<{ selectedKey?: string }>();
const emit = defineEmits<{ 'open-task': [occ: Occurrence]; logout: [] }>();
const store = useTaskStore();
const mobile = useMediaQuery('(max-width: 767px)');
// 与 TaskSheet 的内嵌详情面板同一断点：详情占住右侧时收集箱侧栏先让位
const INBOX_KEY = 'wb.calendarInbox';
const calendarInbox = ref(localStorage.getItem(INBOX_KEY) === '1');
function setCalendarInbox(open: boolean) { calendarInbox.value = open; localStorage.setItem(INBOX_KEY, open ? '1' : '0'); }
type View = 'today' | 'upcoming' | 'all' | 'inbox' | 'completed' | 'calendar' | 'trash' | 'tag' | 'search';
const initialView = new URLSearchParams(window.location.search).get('view') as View;
const view = ref<View>(['today','upcoming','all','inbox','completed','calendar','trash','search'].includes(initialView) ? initialView : 'today');
const activeTag = ref('');
const navOpen = ref(false);
const accountOpen = ref(false);
const importOpen = ref(false);
const notifyOpen = ref(false);
const calendarSettingsOpen = ref(false);
const pushStatusLabel = computed(() => ({ on: '已开启', off: '未开启', denied: '已拦截', 'needs-install': '需添加到主屏幕', 'server-off': '未配置', unsupported: '不支持' } as Record<string, string>)[pushState.status] ?? '');
const settingsOpen = ref(false);
const query = ref('');
const titleInput = ref('');
const addInput = ref<HTMLInputElement>();
const searchInput = ref<HTMLInputElement>();
const scrollEl = ref<HTMLElement>();
const addBusy = ref(false);
// 新建后不弹窗：底部提示一下，可点“编辑”；新行短暂高亮
const notice = ref<{ text: string; occ?: Occurrence } | null>(null);
const justAdded = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function showNotice(text: string, occ?: Occurrence) {
  clearTimeout(noticeTimer);
  notice.value = { text, occ };
  noticeTimer = setTimeout(() => (notice.value = null), 4000);
}
const WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];
const showDone = ref(true);
const collapsed = ref(new Set<string>());
const sort = ref('priority');
const appearance = ref<Appearance>(loadAppearance());
const appearanceOptions: Array<[Appearance, string]> = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
const toOcc = (task: Task): Occurrence => ({ task, date: task.dueDate, completed: task.completed, isVirtual: false });
const upcoming = computed(() => store.occurrencesInRange(store.currentDate, addDays(store.currentDate, 6)));
// In an unbounded list, show the next occurrence of each recurring task once.
const all = computed(() => {
  const recurring = store.activeTasks.filter(t => t.repeatRule !== 'none').map(task => {
    const start = task.dueDate > store.currentDate ? task.dueDate : store.currentDate;
    return expandOccurrences([task], store.completions, start, addDays(start,400)).find(o => !o.completed);
  }).filter((o): o is Occurrence => !!o);
  return [...store.activeTasks.filter(t => t.repeatRule === 'none').map(toOcc), ...recurring];
});
const completed = computed(() => {
  const result = store.activeTasks.filter(t => t.repeatRule === 'none' && t.completed).map(toOcc);
  // 打卡记录按任务分组，每个重复任务只展开一次自己的历史区间；
  // 老实现“每条打卡 × 全部任务”双重展开，已完成页打卡多时会明显卡顿。
  const byTask = new Map<number, string[]>();
  for (const key of store.completions) {
    const [id, date] = key.split(':');
    if (!date) continue;
    const list = byTask.get(Number(id));
    if (list) list.push(date);
    else byTask.set(Number(id), [date]);
  }
  for (const [id, dates] of byTask) {
    const task = store.tasks.find(t => t.id === id);
    if (!task || task.deletedAt || task.repeatRule === 'none') continue;
    const entries = Object.entries(task.dateOverrides ?? {});
    const from = [task.dueDate, ...dates, ...entries.map(([origin]) => origin)].reduce((a, b) => (b && b < a ? b : a), dates[0]);
    const to = [...dates, ...entries.map(([, target]) => target)].reduce((a, b) => (b > a ? b : a), dates[0]);
    const done = new Set(expandOccurrences([task], store.completions, from, to).filter(o => o.completed).map(o => o.date));
    for (const date of dates) {
      if (done.has(date)) result.push({ task, date, completed: true, isVirtual: true });
    }
  }
  return result.sort((a, b) => doneKey(b).localeCompare(doneKey(a)));
});
// 完成时间排序键：普通任务用完成时刻，旧数据没有完成时刻就退回截止日；重复任务用打卡那天
function doneKey(o: Occurrence): string {
  if (o.isVirtual || !o.task.completedAt) return `${o.date || o.task.updatedAt.slice(0, 10)}T99`;
  const d = new Date(o.task.completedAt);
  return `${fmtDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const tags = computed(() => [...new Set(store.activeTasks.flatMap(t => t.tags))].sort((a,b) => a.localeCompare(b,'zh-CN')));
const navItems = computed(() => [
  { id: 'inbox' as View, label: '收集箱', icon: Inbox, count: store.inboxTasks.length },
  { id: 'today' as View, label: '今天', icon: Sun, count: store.todayOccurrences.filter(o => !o.completed).length },
  { id: 'upcoming' as View, label: '最近 7 天', icon: CalendarRange, count: upcoming.value.filter(o => !o.completed).length },
  { id: 'all' as View, label: '全部任务', icon: ListTodo, count: all.value.filter(o => !o.completed).length },
]);
const title = computed(() => view.value === 'tag' ? activeTag.value : ({today:'今天',upcoming:'最近 7 天',all:'全部任务',inbox:'收集箱',completed:'已完成',calendar:'日历',trash:'回收站',search:'搜索任务'} as Record<string,string>)[view.value]);
const dateLabel = computed(() => new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(parseDate(store.currentDate)));
const lunarLabel = computed(() => {
  const d = parseDate(store.currentDate);
  const lunar = Solar.fromYmd(d.getFullYear(),d.getMonth()+1,d.getDate()).getLunar();
  return `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}${lunar.getJieQi() ? ' · '+lunar.getJieQi() : ''}`;
});
const occurrences = computed(() => {
  if(view.value==='today') return store.todayOccurrences;
  if(view.value==='upcoming') return upcoming.value;
  if(view.value==='inbox') return store.inboxTasks.map(toOcc);
  if(view.value==='completed') return completed.value;
  if(view.value==='tag') return all.value.filter(o => o.task.tags.includes(activeTag.value));
  if(view.value==='search') {
    // 子任务命中时显示它的父任务
    const ids = new Set(searchTasks(store.tasks.filter(t=>!t.deletedAt),query.value).map(t=>t.parentId ?? t.id));
    return all.value.filter(o=>ids.has(o.task.id));
  }
  return all.value;
});
const pending = computed(() => occurrences.value.filter(o=>!o.completed).sort((a,b) => sort.value==='title' ? a.task.title.localeCompare(b.task.title,'zh-CN') : sort.value==='date' ? a.date.localeCompare(b.date)||(a.task.dueTime||'99').localeCompare(b.task.dueTime||'99')||a.task.id-b.task.id : b.task.priority-a.task.priority||a.task.id-b.task.id));
const done = computed(() => view.value==='completed' ? [] : occurrences.value.filter(o=>o.completed));
const groups = computed(() => {
  // 有逾期时“今天”分组即使为空也保留，作为拖放落点
  if(view.value==='today') {
    const overdue = store.overdueTasks.map(toOcc);
    return [
      {key:'overdue',label:'逾期',items:overdue},
      {key:'today',label:'今天',items:pending.value},
    ].filter(g=>g.items.length||(g.key==='today'&&overdue.length));
  }
  if(view.value==='completed') {
    const byDay = new Map<string, Occurrence[]>();
    for (const o of completed.value) {
      const day = doneKey(o).slice(0, 10);
      const list = byDay.get(day);
      if (list) list.push(o); else byDay.set(day, [o]);
    }
    return [...byDay].map(([day, items]) => ({ key: day, label: day===addDays(store.currentDate,-1) ? '昨天' : formatDate(day), items }));
  }
  // 7 天都列出来，空的日子也能把任务拖进去
  if(view.value==='upcoming') {
    if(!pending.value.length) return [];
    return Array.from({length:7},(_,i)=>addDays(store.currentDate,i)).map(date=>({key:date,label:`${formatDate(date)} · ${WEEKDAYS[parseDate(date).getDay()]}`,items:pending.value.filter(o=>o.date===date)}));
  }
  return [{key:'pending',label:view.value==='inbox'?'未安排日期':'待办',items:pending.value}].filter(g=>g.items.length);
});
const progress = computed(() => store.todayOccurrences.length ? Math.round(store.todayOccurrences.filter(o=>o.completed).length/store.todayOccurrences.length*100) : 0);
// 大清单分段渲染：一次挂载上千行会让切换明显卡顿，先渲染一部分，点“显示更多”继续
const RENDER_STEP = 400;
const renderLimit = ref(150);
function limitItems<T>(items: T[]): T[] { return items.length > renderLimit.value ? items.slice(0, renderLimit.value) : items; }
// 上限按所有分组合计：已完成页按天分组时可能有上千个小组，逐组限制等于没限制
const visibleGroups = computed(() => {
  let left = renderLimit.value;
  const out: Array<{ key: string; label: string; items: Occurrence[]; total: number }> = [];
  for (const g of groups.value) {
    if (left <= 0) break;
    const items = g.items.length > left ? g.items.slice(0, left) : g.items;
    out.push({ ...g, items, total: g.items.length });
    left -= items.length;
  }
  return out;
});
const moreCount = computed(() => {
  const total = groups.value.reduce((n,group) => n + group.items.length, 0) + done.value.length;
  const rendered = visibleGroups.value.reduce((n,group) => n + group.items.length, 0) + limitItems(done.value).length;
  return total - rendered;
});
function showMore() { renderLimit.value += RENDER_STEP; }
/** 分组对应的拖放日期：今天清单只有“今天”组可放，最近 7 天每天都可放 */
function dropDate(key: string) {
  if(view.value==='today') return key==='today' ? store.currentDate : undefined;
  if(view.value==='upcoming') return key;
  return undefined;
}
const listDrag = useListDrag({ container: scrollEl, onDrop: dropOnDate });
// 重复任务只挪这一次，不动整个系列
async function dropOnDate(occKey: string, date: string) {
  const occ = groups.value.flatMap(g=>g.items).find(o=>`${o.task.id}:${o.date}`===occKey);
  if(!occ||occ.date===date) return;
  try {
    await store.rescheduleOccurrence(occ, date, occ.isVirtual ? 'once' : 'series');
    showNotice(`「${occ.task.title}」已移到${formatDate(date)}`);
  } catch { /* Store 显示错误提示 */ }
}
const parsed = computed(() => titleInput.value.trim() ? parseQuickAdd(titleInput.value,parseDate(store.currentDate)) : null);
const emptyText = computed(() => ({today:'今天的事情都处理好了',inbox:'把还没安排的事情记在这里',completed:'完成的任务会出现在这里',trash:'回收站是空的',search:query.value ? '没有找到相关任务' : '搜索标题、标签或备注'} as Record<string,string>)[view.value] || '这份清单还没有待办');

function formatDate(date: string) {
  if(!date) return '未安排';
  if(date===store.currentDate) return '今天';
  if(date===addDays(store.currentDate,1)) return '明天';
  const d=parseDate(date);
  return `${d.getFullYear()!==parseDate(store.currentDate).getFullYear()?d.getFullYear()+'年':''}${d.getMonth()+1}月${d.getDate()}日（${lunarText(date)}）`;
}
// 切换清单只换数据源，不强制重建列表（重建会让大列表整屏重挂载造成卡顿）；滚动位置手动复位
async function navigate(target: View, tag = '') {
  view.value=target;activeTag.value=tag;navOpen.value=false;collapsed.value=new Set();renderLimit.value=150;
  await nextTick();
  scrollEl.value?.scrollTo({top:0});
}
function collapse(key: string) { const next=new Set(collapsed.value);if(next.has(key))next.delete(key);else next.add(key);collapsed.value=next; }
async function focusAdd() { if(['calendar','completed','trash','search'].includes(view.value))navigate('today');await nextTick();addInput.value?.focus(); }
async function openSearch() { navigate('search');await nextTick();searchInput.value?.focus(); }
async function addTask() {
  if(addBusy.value||!titleInput.value.trim())return;
  const p=parseQuickAdd(titleInput.value,parseDate(store.currentDate));
  addBusy.value=true;
  try {
    // 只写了时间没写日期，按今天处理
    const task=await store.addTask({title:p.title,dueDate:p.dueDate??(p.dueTime||['today','upcoming'].includes(view.value)?store.currentDate:''),dueTime:p.dueTime??'',repeatRule:p.repeatRule??'none',repeatUntil:p.repeatUntil??'',tags:view.value==='tag'?[activeTag.value]:[]});
    titleInput.value='';
    // 直接创建不弹窗；落到当前清单之外（如写了“明天”）时在提示里说明去向
    const occ=toOcc(task);
    const key=`${task.id}:${task.dueDate}`;
    await nextTick();
    const visible=groups.value.some(g=>g.items.some(o=>`${o.task.id}:${o.date}`===key));
    showNotice(visible?`已添加「${task.title}」`:`已添加「${task.title}」到${task.dueDate?formatDate(task.dueDate):'收集箱'}`,occ);
    if(visible){justAdded.value=key;setTimeout(()=>{if(justAdded.value===key)justAdded.value='';},1600);}
  } catch { await nextTick();addInput.value?.focus(); }
  finally {addBusy.value=false;}
}
function changeAppearance(value: Appearance) {appearance.value=value;setAppearance(value);}
function onKey(event: KeyboardEvent) {
  const target=event.target as HTMLElement|null;
  if(target?.closest('[role="dialog"], [role="listbox"]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();void openSearch();return;}
  if(target?.closest('input,textarea,select,[contenteditable="true"]')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key.toLowerCase()==='n'){event.preventDefault();void focusAdd();}
  if(event.key.toLowerCase()==='t'){event.preventDefault();store.refreshDate();navigate('today');}
  if(event.key==='Escape')navOpen.value=false;
  if(view.value==='calendar'&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();window.dispatchEvent(new CustomEvent('wb:calendar-nav',{detail:event.key==='ArrowLeft'?'prev':'next'}));}
}
onMounted(()=>{window.addEventListener('keydown',onKey);void refreshPushStatus();});
onBeforeUnmount(()=>window.removeEventListener('keydown',onKey));
</script>

<template>
  <div class="wb-workspace">
    <button v-if="mobile && navOpen" class="wb-nav-backdrop" aria-label="关闭清单导航" @click="navOpen=false" />
    <aside class="wb-navigation" :class="{ 'is-open': navOpen }" aria-label="清单导航" :inert="mobile && !navOpen">
      <div class="wb-profile">
        <span class="wb-avatar">{{ currentUser?.username?.slice(0,1).toUpperCase() || 'W' }}</span>
        <div><strong>{{ currentUser?.username || '我的工作台' }}</strong><span>个人空间</span></div>
        <button v-if="mobile" class="wb-control" aria-label="关闭导航" @click="navOpen=false"><X /></button>
      </div>
      <button class="wb-search-entry" @click="openSearch"><Search /><span>搜索任务</span><kbd v-if="!mobile">Ctrl F</kbd></button>
      <Button class="wb-nav-add" @click="focusAdd"><Plus data-icon="inline-start" />添加任务</Button>
      <div class="wb-nav-scroll">
        <nav class="wb-smart-lists" aria-label="智能清单">
          <button v-for="item in navItems" :key="item.id" class="wb-nav-item" :class="{ 'is-selected': view === item.id }" :aria-current="view===item.id?'page':undefined" @click="navigate(item.id)">
            <component :is="item.icon" /><span>{{ item.label }}</span><span class="wb-nav-count">{{ item.count }}</span>
          </button>
          <button class="wb-nav-item" :class="{ 'is-selected': view === 'calendar' }" :aria-current="view==='calendar'?'page':undefined" @click="navigate('calendar')"><CalendarDays /><span>日历</span></button>
        </nav>
        <div class="wb-nav-section"><span>我的标签</span><Tag /></div>
        <nav aria-label="标签分类">
          <button v-for="tag in tags" :key="tag" class="wb-nav-item wb-tag-nav" :class="{ 'is-selected': view === 'tag' && activeTag === tag }" :aria-current="view==='tag'&&activeTag===tag?'page':undefined" @click="navigate('tag',tag)">
            <Tag /><span>{{ tag }}</span><span class="wb-nav-count">{{ all.filter(o=>!o.completed&&o.task.tags.includes(tag)).length }}</span>
          </button>
          <p v-if="!tags.length" class="wb-nav-note">为任务添加标签后，可在这里分类查看。</p>
        </nav>
        <nav class="wb-archive-nav" aria-label="历史任务">
          <button class="wb-nav-item" :class="{ 'is-selected': view==='completed' }" @click="navigate('completed')"><CheckCheck /><span>已完成</span></button>
          <button class="wb-nav-item" :class="{ 'is-selected': view==='trash' }" @click="navigate('trash')"><Trash2 /><span>回收站</span><span v-if="store.recycleBinTasks.length" class="wb-nav-count">{{ store.recycleBinTasks.length }}</span></button>
        </nav>
      </div>
      <div class="wb-nav-footer">
        <span class="wb-brand"><Check />Workbench</span>
        <Popover v-model:open="settingsOpen">
          <PopoverTrigger as-child><button class="wb-control" aria-label="设置" title="设置"><Settings2 /></button></PopoverTrigger>
          <PopoverContent side="top" align="start" class="wb-settings-popover">
            <strong>设置</strong>
            <label for="wb-appearance">外观</label>
            <select id="wb-appearance" :value="appearance" @change="changeAppearance(($event.target as HTMLSelectElement).value as Appearance)"><option v-for="[value,label] in appearanceOptions" :key="value" :value="value">{{ label }}</option></select>
            <button @click="accountOpen=true;settingsOpen=false"><UserCog />{{ currentUser?.isAdmin?'账号与成员':'账号设置' }}</button>
            <button @click="downloadTaskBackup(store.tasks,store.completions);settingsOpen=false"><Download />导出备份</button>
            <button @click="importOpen=true;settingsOpen=false"><Upload />导入备份</button>
            <button @click="notifyOpen=true;settingsOpen=false"><Bell />提醒通知<span class="wb-settings-status">{{ pushStatusLabel }}</span></button>
            <button @click="emit('logout')"><LogOut />退出登录</button>
            <p>N 添加任务 · T 今天 · Ctrl+F 搜索</p>
          </PopoverContent>
        </Popover>
      </div>
    </aside>

    <main class="wb-main-pane">
      <header class="wb-list-header">
        <div class="wb-list-heading">
          <button v-if="mobile" class="wb-control" aria-label="打开清单导航" :aria-expanded="navOpen" @click="navOpen=true"><Menu /></button>
          <div><h1>{{ title }}</h1><p v-if="view==='today'">{{ dateLabel }}<span class="wb-lunar">{{ lunarLabel }}</span></p><p v-else-if="view==='upcoming'">{{ formatDate(store.currentDate) }} — {{ formatDate(addDays(store.currentDate,6)) }}</p><p v-else-if="view==='inbox'">先记下来，稍后安排</p><p v-else-if="view==='tag'">按标签整理的任务</p></div>
        </div>
        <div v-if="view==='calendar'" class="wb-calendar-actions">
          <button type="button" class="wb-control" aria-label="日历设置" title="日历设置" @click="calendarSettingsOpen=true"><Settings aria-hidden="true" /></button>
          <button v-if="!mobile" type="button" class="wb-inbox-toggle" :class="{ 'is-on': calendarInbox }" :aria-pressed="calendarInbox" @click="setCalendarInbox(!calendarInbox)"><Inbox aria-hidden="true" />收集箱<span>{{ store.inboxTasks.length }}</span></button>
        </div>
        <label v-if="!['calendar','trash','completed'].includes(view)" class="wb-sort"><span class="sr-only">任务排序</span><select v-model="sort" aria-label="任务排序"><option value="priority">按优先级</option><option value="date">按日期</option><option value="title">按标题</option></select><ChevronDown /></label>
      </header>
      <MonthView v-if="view==='calendar'" class="wb-workspace-calendar" :inbox-open="calendarInbox" @open-task="emit('open-task',$event)" @close-inbox="setCalendarInbox(false)" />
      <template v-else>
        <div class="wb-list-tools">
          <form v-if="!['completed','trash','search'].includes(view)" class="wb-quick-entry" :aria-busy="addBusy" @submit.prevent="addTask">
            <Plus aria-hidden="true" /><input ref="addInput" v-model="titleInput" aria-label="添加任务" placeholder="添加任务，试试“明天交周报”" :disabled="addBusy" @keydown.enter="($event as KeyboardEvent).isComposing && $event.preventDefault()" />
            <Button v-if="titleInput.trim()" type="submit" size="sm" :disabled="addBusy">{{ addBusy?'添加中':'添加' }}</Button><kbd v-else-if="!mobile">N</kbd>
          </form>
          <p v-if="parsed?.hint" class="wb-parse-hint">{{ parsed.hint }}</p>
          <div v-if="view==='search'" class="wb-search-field"><Search /><input ref="searchInput" v-model="query" aria-label="搜索任务" placeholder="搜索标题、标签或备注" /><button v-if="query" class="wb-control" aria-label="清空搜索" @click="query='' "><X /></button></div>
        </div>
        <div ref="scrollEl" class="wb-task-scroll" :class="{ 'is-dragging': listDrag.dragging.value }" @pointerdown="listDrag.onPointerDown">
          <template v-if="view==='trash'"><ul v-if="store.recycleBinTasks.length" class="wb-task-list"><RecycleTaskRow v-for="task in store.recycleBinTasks" :key="task.id" :task="task" /></ul><div v-else class="wb-list-empty"><Trash2 /><h2>{{ emptyText }}</h2><p>删除的任务会保留在这里，方便恢复。</p></div></template>
          <template v-else>
            <section v-for="group in visibleGroups" :key="group.key" class="wb-task-group" :class="{ 'is-overdue': group.key==='overdue', 'is-empty-day': !group.total }" :data-drop-date="dropDate(group.key)">
              <button class="wb-group-heading" :aria-expanded="!collapsed.has(group.key)" @click="collapse(group.key)"><ChevronRight :class="{ 'is-expanded': !collapsed.has(group.key) }" /><h2>{{ group.label }}</h2><span>{{ group.total }}</span></button>
              <ul v-show="!collapsed.has(group.key)" class="wb-task-list">
                <SidebarTaskRow v-for="occ in group.items" :key="`${occ.task.id}:${occ.date}`" :class="{ 'is-new': justAdded===`${occ.task.id}:${occ.date}` }" :occurrence="occ" :selected="selectedKey===`${occ.task.id}:${occ.date}`" :can-move-today="group.key==='overdue'||view==='inbox'" :can-postpone="view==='today'" :drag-enabled="view==='today'||view==='upcoming'" @open-task="emit('open-task',$event)" />
              </ul>
              <p v-if="!group.total" class="wb-group-empty" :class="{ 'is-always': view==='today' }">{{ view==='today' ? '把逾期任务拖到这里，安排到今天' : '没有任务，可以把其他日子的任务拖过来' }}</p>
            </section>
            <section v-if="view==='today'&&listDrag.dragging.value" class="wb-task-group wb-drop-extra" :data-drop-date="addDays(store.currentDate,1)"><h2>拖到这里，推迟到明天</h2></section>
            <section v-if="done.length" class="wb-task-group wb-completed-group"><button class="wb-group-heading" :aria-expanded="showDone" @click="showDone=!showDone"><ChevronRight :class="{ 'is-expanded': showDone }" /><h2>已完成</h2><span>{{ done.length }}</span></button><ul v-show="showDone" class="wb-task-list"><SidebarTaskRow v-for="occ in limitItems(done)" :key="`${occ.task.id}:${occ.date}`" :occurrence="occ" :selected="selectedKey===`${occ.task.id}:${occ.date}`" @open-task="emit('open-task',$event)" /></ul></section>
            <button v-if="moreCount>0" class="wb-list-more" @click="showMore">显示更多，还有 {{ moreCount }} 项</button>
            <div v-if="!groups.length&&!done.length" class="wb-list-empty"><CheckCheck v-if="view==='today'||view==='completed'" /><Search v-else-if="view==='search'" /><Inbox v-else /><h2>{{ emptyText }}</h2><p v-if="view==='today'">留一点时间给自己，也可以添加新的安排。</p><p v-else-if="view==='inbox'">添加任务后，点开详情即可设置日期。</p></div>
          </template>
        </div>
        <footer class="wb-list-footer"><template v-if="view==='today'"><span>今日已完成 {{ store.todayOccurrences.filter(o=>o.completed).length }} / {{ store.todayOccurrences.length }}</span><div class="wb-progress" role="progressbar" aria-label="今日完成进度" :aria-valuenow="progress" :aria-valuemin="0" :aria-valuemax="100"><i :style="{width:progress+'%'}" /></div></template><span v-else>{{ view==='trash'?store.recycleBinTasks.length:occurrences.length }} 项任务</span></footer>
      </template>
    </main>
    <div v-if="notice" class="wb-notice" role="status">
      <Check aria-hidden="true" /><span>{{ notice.text }}</span>
      <button v-if="notice.occ" type="button" @click="emit('open-task',notice.occ);notice=null">编辑</button>
    </div>
    <AccountDialog v-model:open="accountOpen" />
    <ImportDialog v-model:open="importOpen" />
    <NotificationDialog v-model:open="notifyOpen" />
    <CalendarSettingsDialog v-model:open="calendarSettingsOpen" />
  </div>
</template>
