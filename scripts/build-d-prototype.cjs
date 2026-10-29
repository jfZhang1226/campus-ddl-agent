/* Deterministic local assets. Node.js built-ins only; no model/service calls. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/development/d-notice-samples.json'), 'utf8'));
const target = path.join(root, 'docs/prototypes/d-experience');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'sample-data.js'), '/* Generated from fixtures/development/d-notice-samples.json. */\nwindow.DExperienceSamples = '+JSON.stringify(data, null, 2)+';\n');
const out = path.join(root, 'docs/images/d-experience');
fs.mkdirSync(out, { recursive: true });
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
const box = (x,y,w,h,fill='#fff',stroke='#dce5df',r=10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const text = (x,y,value,size=14,color='#18332d',weight=400) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(value)}</text>`;
function frame(title,active,content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="414" height="850" viewBox="0 0 414 850" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">D 的 T04 可编辑矢量草图，全部为合成示例，不是已实现应用截图。</desc><g font-family="Microsoft YaHei, sans-serif">${box(1,1,412,848,'#fff','#d6e1d9',24)}${box(23,24,39,39,'#23694e','#23694e',12)}${text(33,51,'课',20,'#fff',600)}${text(75,43,'课事清',20,'#18332d',600)}${text(75,62,'校园里的事，慢慢理清。',11,'#61736d')}${text(333,45,'设计草图',11,'#61736d')}${text(27,108,'助手',15,active==='assistant'?'#23694e':'#61736d',600)}${text(110,108,'任务',15,active==='tasks'?'#23694e':'#61736d',600)}<path d="M23 122H391" stroke="#dce5df"/><path d="M${active==='assistant'?24:108} 122h34" stroke="#23694e" stroke-width="3"/>${content}${text(24,824,'合成示例 · 待 A/B/C 评审 · 非实机运行结果',11,'#61736d')}</g></svg>`;
}
const assistant = frame('助手输入页与待确认任务卡','assistant',
  text(23,156,'添加一条通知',11,'#23694e',600)+text(23,185,'先记下来，再逐项确认。',20,'#18332d',600)+
  text(23,220,'通知原文',12,'#61736d')+box(23,232,368,110,'#f9fbf8')+
  text(35,258,'数据库：2026年11月6日18:00前提交',13)+text(35,281,'实验三报告PDF与源代码ZIP至学习通。',13)+text(35,324,'发布时间与导入时间分别保留',11,'#61736d')+
  box(23,357,130,42)+text(60,384,'语音入口',13)+box(163,357,228,42,'#23694e','#23694e')+text(238,384,'整理为任务',13,'#fff')+
  box(23,421,368,355)+box(23,421,368,39,'#e9f2eb','#cdded1')+text(38,446,'核对 1 个事项',13,'#18332d',600)+text(315,446,'待你确认',11,'#23694e')+
  text(38,486,'任务名称',11,'#61736d')+box(38,496,338,36)+text(49,520,'实验三报告',14)+text(38,558,'课程：数据库',13)+text(38,589,'截止：2026-11-06 18:00',14,'#23694e')+
  text(38,622,'材料：报告PDF、源代码ZIP',12,'#61736d')+text(38,651,'查看原通知与依据  ›',12,'#23694e')+text(38,682,'未确认前，任务列表不会改变。',11,'#61736d')+
  box(38,709,80,42)+text(64,736,'取消',13)+box(128,709,248,42,'#23694e','#23694e')+text(190,736,'确认并加入列表',13,'#fff'));
const tasks = frame('任务列表页与来源材料入口','tasks',
  text(23,156,'近期任务',11,'#23694e',600)+text(23,185,'先看截止，再决定安排。',20,'#18332d',600)+text(23,214,'正式截止与计划安排分开；系统提醒待接入。',11,'#61736d')+
  box(24,251,17,17,'#fff','#a9bbb0',4)+text(53,267,'实验三报告',16,'#18332d',600)+text(53,292,'数据库 · 尚未开始',12,'#61736d')+text(53,323,'2026-11-06 18:00 截止',14,'#23694e')+text(53,353,'原通知与材料  ›',12,'#23694e')+text(53,379,'2 项待准备 · 尚未确认提交',12,'#61736d')+
  '<path d="M23 404H391" stroke="#dce5df"/>'+box(24,434,17,17,'#fff','#a9bbb0',4)+text(53,450,'第八周习题',16,'#18332d',600)+text(53,477,'高等数学 · 尚未开始',12,'#61736d')+text(53,509,'2026-11-08 当天到期',14,'#23694e')+text(53,534,'具体截止时刻待确认',12,'#61736d')+text(53,565,'原通知与材料  ›',12,'#23694e')+
  '<path d="M23 591H391" stroke="#dce5df"/>'+text(24,638,'缺日期时：显示“截止日期待补充”',13,'#61736d')+text(24,672,'材料勾选不代表外部平台已经收到。',12,'#61736d')+text(24,705,'取消草案或保存失败，不新增任务。',12,'#61736d'));
fs.writeFileSync(path.join(out, 'assistant.svg'), assistant);
fs.writeFileSync(path.join(out, 'tasks.svg'), tasks);
console.log('Generated sample-data.js and two editable SVG sketches from synthetic inputs.');
