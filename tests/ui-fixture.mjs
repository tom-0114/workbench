// Isolated local API fixture for UI verification. Never use this for deployment.
import http from 'node:http';
const localDate = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let tasks, completions, reminders, subscriptions, failNext = false;
function reset() {
  tasks = [
    ['整理本周的项目进度',0,3,['工作'],'核对上线进度与待确认的问题，下午同步给团队。'],
    ['和设计师确认首页修改',0,2,['工作'],'确认任务列表、详情面板和移动端的布局。'],
    ['读完《纳瓦尔宝典》第三章',0,1,['阅读'],'记录三个值得实践的想法。'],
    ['下班后跑步 30 分钟',0,0,['生活'],''],
    ['给家里买牛奶和水果',0,0,['生活'],''],
    ['整理昨天的会议记录',-1,2,['工作'],'补齐每个人的行动事项。'],
    ['预约周末的口腔检查',null,0,['生活'],''],
    ['准备下周分享的提纲',2,2,['工作'],''],
    ['每周复盘',3,1,['成长'],''],
    ['回复合作方的邮件',0,0,['工作'],''],
    ['写周报',0,2,['工作'],''],
  ].map(([title,offset,priority,tags,notes],i)=>({id:i+1,title,notes,priority,tags,dueDate:offset===null?'':localDate(offset),dueTime:'',remindOffset:null,repeatRule:i===3?'daily':i===10?'weekly':'none',completed:i===9,completedAt:i===9?new Date().toISOString():null,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
  completions=[];reminders=[];subscriptions=[];
  failNext=false;
}
reset();
http.createServer(async(req,res)=>{
  let raw=''; for await (const part of req) raw+=part;
  const body=raw?JSON.parse(raw):{};
  const path=req.url.split('?')[0];
  const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(path==='/__test/reset'){reset();return json(200,{ok:true});}
  if(path==='/__test/fail'){failNext=true;return json(200,{ok:true});}
  if(path==='/__test/reminders')return json(200,reminders);
  // 性能验证：300 条普通任务 + 每日重复任务 800 天打卡
  if(path==='/__test/big'){
    for(let i=0;i<300;i++){const offset=(i%60)-30;tasks.push({id:100+i,title:`压测任务 ${i+1}`,notes:'',priority:i%4,tags:['压测'],dueDate:localDate(offset),repeatRule:'none',completed:i%5===0,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}
    tasks.push({id:900,title:'压测每日打卡',notes:'',priority:1,tags:['压测'],dueDate:localDate(-800),repeatRule:'daily',completed:false,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    for(let i=1;i<=800;i++)completions.push(`900:${localDate(-i)}`);
    return json(200,{ok:true,tasks:tasks.length,completions:completions.length});
  }
  if(path==='/api/auth/session')return json(200,{authenticated:true,username:'chentong',isAdmin:false});
  if(path==='/api/tasks'&&req.method==='GET')return json(200,tasks);
  if(path==='/api/completions'&&req.method==='GET')return json(200,completions);
  if(failNext&&req.method!=='GET'){failNext=false;return json(503,{error:'Fixture save failure'});}
  if(path==='/api/tasks'&&req.method==='POST'){const task={dueTime:'',remindOffset:null,completedAt:null,...body,id:Math.max(0,...tasks.map(t=>t.id))+1,deletedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};tasks.push(task);return json(200,task);}
  if(path==='/api/reminders'&&req.method==='PUT'){reminders=body.reminders;return json(200,{count:reminders.length});}
  if(path==='/api/push/config')return json(200,{enabled:false});
  if(path==='/api/import'&&req.method==='POST'){
    if(body.app!=='workbench'||!Array.isArray(body.tasks))return json(400,{error:'不是 Workbench 的备份文件'});
    const map=new Map();let next=Math.max(0,...tasks.map(t=>t.id))+1;
    tasks=body.tasks.map(t=>{const id=next++;map.set(t.id,id);return {...t,id};});
    completions=body.completions.map(k=>{const [id,date]=k.split(':');return map.has(Number(id))?`${map.get(Number(id))}:${date}`:null;}).filter(Boolean);
    return json(200,{tasks:tasks.length,completions:completions.length});
  }
  if(path==='/api/completions'&&req.method==='POST'){const key=`${body.taskId}:${body.date}`;completions=completions.filter(k=>k!==key);if(body.done)completions.push(key);return json(200,{ok:true});}
  const match=path.match(/^\/api\/tasks\/(\d+)(?:\/(restore|permanent))?$/);
  if(match){const id=Number(match[1]);const task=tasks.find(t=>t.id===id);if(!task)return json(404,{});if(req.method==='PUT'){Object.assign(task,body,{id,updatedAt:new Date().toISOString()});return json(200,task);}if(req.method==='DELETE'){if(match[2]==='permanent')tasks=tasks.filter(t=>t.id!==id);else task.deletedAt=new Date().toISOString();}if(match[2]==='restore')task.deletedAt=null;return json(200,{ok:true});}
  return json(404,{error:'Unsupported fixture request'});
}).listen(Number(process.env.WORKBENCH_UI_FIXTURE_PORT || 3002),'127.0.0.1',()=>console.log(`UI test fixture: http://127.0.0.1:${process.env.WORKBENCH_UI_FIXTURE_PORT || 3002} (in-memory data only)`));
