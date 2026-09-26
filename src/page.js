// 页面操作：只负责渲染和调用 API，不含取样规则与存储逻辑。

const fields = [["code","墨锭编号","text"],["smokeSource","烟料来源","text"],["glueRatio","胶料比例","text"],["ageYears","存放年限","number"],["storage","存放位置","text"]];
const stages = ["待试磨","已试磨","重点观察"];
const extraFields = [["paper","试磨纸张"],["water","加水量"],["speed","出墨速度"],["colorLayer","墨色层次"],["sediment","沉淀情况"],["score","评分"]];
const cardStates = ["待读数","已完成","已失效"];

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>墨锭试磨室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.bad { color:var(--warn); border-color:var(--warn); } .pill.good { color:var(--accent); border-color:var(--accent); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:120px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .wide { grid-column:1 / -1; } .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    table { width:100%; border-collapse:collapse; font-size:14px; } th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); } th { color:var(--muted); font-weight:600; }
    #toast { position:fixed; right:18px; bottom:18px; max-width:360px; padding:12px 16px; border-radius:8px; background:#20241f; color:#fff; display:none; box-shadow:0 6px 20px rgba(0,0,0,.25); }
    #toast.err { background:var(--warn); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>墨锭试磨室</h1><div class="meta">墨锭建档、试磨记录、潮箱耐久卡</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增墨锭</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map((s) => "<option>" + s + "</option>").join("")}</select><button>保存墨锭</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>创建试磨记录</h2><label>选择墨锭</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="correctForm" style="margin-top:14px"><h2>更正试磨结果</h2><div class="meta">更正评分或沉淀后，关联耐久卡立即失效并移出统计，旧读数仍可查。</div><label>选择墨锭</label><select name="id" id="correctSelect"></select><div class="row"><div><label>更正后评分</label><input name="score" type="number" step="1"></div><div><label>更正后沉淀情况</label><input name="sediment" placeholder="如：无 / 少量"></div></div><label>更正人</label><input name="corrector" required><label>备注</label><input name="note"><button class="secondary">提交更正</button></form>
      <form id="sampleForm" style="margin-top:14px"><h2>墨样建档（潮箱耐久卡）</h2><div class="meta">试磨余墨存入潮箱。不足三克或发霉的墨样留待取样，不占卡；重复建档返回 409。</div><label>墨样编号</label><input name="sampleCode" required placeholder="如 IS-001-R1"><label>关联墨锭</label><select name="itemCode" id="sampleItemSelect"><option value="">（不关联）</option></select><div class="row"><div><label>余墨重量（克）</label><input name="weightGrams" type="number" step="0.1" min="0" required></div><div><label>取样人</label><input name="sampler" required></div></div><label><input name="moldy" type="checkbox" style="width:auto"> 墨样发霉</label><button>存进潮箱建档</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map((s) => "<option>" + s + "</option>").join("")}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>选择墨锭后录入试磨记录，系统会保留多次试磨结果并更新评分状态。</h2><div class="grid" id="cards"></div></div>
    </section>
    <section class="wide panel" id="durability">
      <h2>潮箱耐久卡</h2>
      <div class="stats" id="cardStats"></div>
      <div class="toolbar"><select id="cardStateFilter"><option value="">全部卡片</option>${cardStates.map((s) => "<option>" + s + "</option>").join("")}</select><input id="cardSearch" placeholder="搜索墨样编号或记录人"></div>
      <div class="grid" id="cardList"></div>
      <h2 style="margin-top:18px">留待取样（不占卡）</h2>
      <div id="pendingWrap"></div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
    const fields = ${JSON.stringify(fields)};
    const stages = ${JSON.stringify(stages)};
    const extraFields = ${JSON.stringify(extraFields)};
    let items = [];
    let durability = { cards: [], pendingSamples: [], stats: {} };
    const $ = (sel) => document.querySelector(sel);
    function toast(text, isErr) {
      const el = $('#toast');
      el.textContent = text;
      el.className = isErr ? 'err' : '';
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.display = 'none'; }, 4200);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || '请求失败');
      return data;
    }
    function esc(v) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
    function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('zh-CN', { hour12:false }) : ''; }

    function renderForms() {
      $('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      $('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function renderItems() {
      const opts = items.map(item => '<option value="'+esc(item.id || item.code)+'">'+esc(item.code || item.id)+'</option>').join('');
      $('#itemSelect').innerHTML = opts;
      $('#correctSelect').innerHTML = opts;
      $('#sampleItemSelect').innerHTML = '<option value="">（不关联）</option>' + items.map(item => '<option value="'+esc(item.code)+'">'+esc(item.code)+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      $('#stats').innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = $('#statusFilter').value;
      const q = $('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      $('#cards').innerHTML = visible.map(itemCardHtml).join('') || '<div class="meta">暂无墨锭</div>';
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => { try { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); } catch (e) { toast(e.message, true); } });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const note = prompt('记录备注'); if (note) { try { await api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } catch (e) { toast(e.message, true); } } });
    }
    function itemCardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+esc(item[key] ?? '')+'</div>').join('');
      const trial = '<div><b>评分</b> '+esc(item.score ?? '—')+' · <b>沉淀</b> '+esc(item.sediment ?? '—')+'</div>';
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+esc(l.step)+'：'+esc(l.note)+'</div>').join('');
      return '<article class="card"><h3>'+esc(item.code || item.id)+'</h3><span class="pill">'+esc(item.status)+'</span>'+main+trial+'<label>状态</label><select data-status="'+esc(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><button class="secondary" data-note="'+esc(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }

    function renderDurability() {
      const invalidated = durability.cards.filter(c => c.state === '已失效').length;
      const tiles = Object.entries(durability.stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('')
        + '<div class="stat"><span>已失效（不计入统计）</span><strong>'+invalidated+'</strong></div>';
      $('#cardStats').innerHTML = tiles;
      const state = $('#cardStateFilter').value;
      const q = $('#cardSearch').value.trim();
      const visible = durability.cards.filter(c => (!state || c.state === state) && (!q || JSON.stringify(c).includes(q)));
      $('#cardList').innerHTML = visible.map(cardHtml).join('') || '<div class="meta">暂无耐久卡</div>';
      document.querySelectorAll('[data-record]').forEach(btn => btn.onclick = () => submitReading(btn.dataset.record, btn.dataset.day));
      const held = durability.pendingSamples;
      $('#pendingWrap').innerHTML = held.length
        ? '<table><tr><th>墨样编号</th><th>关联墨锭</th><th>余墨(克)</th><th>取样人</th><th>原因</th><th>留样时间</th></tr>' + held.map(s => '<tr><td>'+esc(s.sampleCode)+'</td><td>'+esc(s.itemCode || '—')+'</td><td>'+esc(s.weightGrams)+'</td><td>'+esc(s.sampler)+'</td><td class="warn">'+esc(s.reason)+'</td><td class="meta">'+fmtTime(s.heldAt)+'</td></tr>').join('') + '</table>'
        : '<div class="meta">暂无留待取样的墨样</div>';
    }
    function cardHtml(card) {
      const head = '<article class="card"><h3>'+esc(card.sampleCode)+'</h3><div><span class="pill'+(card.state==='已失效'?' bad':card.result==='耐久'?' good':'')+'">'+card.state+(card.result ? ' · '+card.result : '')+'</span></div>'
        + '<div class="meta">关联墨锭 '+esc(card.itemCode || '—')+' · 余墨 '+esc(card.weightGrams)+' 克 · 取样人 '+esc(card.sampler)+'</div>'
        + '<div class="meta">'+esc(card.chamber || '潮箱')+' · 建档 '+fmtTime(card.filedAt)+'</div>';
      let bodyHtml = '';
      if (card.state === '待读数') {
        bodyHtml = card.nextDue
          ? '<div class="row3"><div><label>记录人</label><input id="r-'+card.id+'-reader"></div><div><label>色差 ΔE</label><input id="r-'+card.id+'-diff" type="number" step="0.1" min="0"></div><div><label>起皮</label><select id="r-'+card.id+'-peel"><option value="无">无</option><option value="有">有</option></select></div></div><button data-record="'+card.id+'" data-day="'+card.nextReadingDay+'">记录满'+card.nextReadingDay+'天读数</button>'
          : '<div class="meta">满'+card.nextReadingDay+'天读数未到期，'+fmtTime(card.nextDueAt)+' 后可记录</div>';
      } else if (card.state === '已失效') {
        bodyHtml = '<div class="warn">已失效：'+esc(card.invalidReason || '')+'</div><div class="meta">失效时间 '+fmtTime(card.invalidatedAt)+'，读数保留可查</div>';
      }
      const readings = (card.readings || []).map(r => '<div>满'+r.day+'天 · '+esc(r.reader)+' · 色差 '+esc(r.colorDiff)+' · 起皮 '+(r.peeling?'有':'无')+' · '+(r.normal?'<span class="pill good">正常</span>':'<span class="pill bad">异常</span>')+' <span class="meta">'+fmtTime(r.at)+'</span></div>').join('');
      return head + bodyHtml + '<div class="logs meta">'+(readings || '暂无读数')+'</div></article>';
    }
    async function submitReading(cardId, day) {
      try {
        await api('/api/durability/cards/'+cardId+'/readings', { method:'POST', body: JSON.stringify({
          day: Number(day),
          reader: document.getElementById('r-'+cardId+'-reader').value,
          colorDiff: document.getElementById('r-'+cardId+'-diff').value,
          peeling: document.getElementById('r-'+cardId+'-peel').value,
        }) });
        toast('读数已记录');
        await load();
      } catch (e) { toast(e.message, true); }
    }

    async function load() {
      const [itemList, dura] = await Promise.all([api('/api/items'), api('/api/durability')]);
      items = itemList;
      durability = dura;
      renderItems();
      renderDurability();
    }
    $('#createForm').onsubmit = async (event) => { event.preventDefault(); try { await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) }); event.target.reset(); await load(); } catch (e) { toast(e.message, true); } };
    $('#actionForm').onsubmit = async (event) => { event.preventDefault(); try { await api('/api/items/'+$('#itemSelect').value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) }); event.target.reset(); await load(); } catch (e) { toast(e.message, true); } };
    $('#correctForm').onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        const res = await api('/api/items/'+data.id+'/correction', { method:'POST', body: JSON.stringify(data) });
        toast(res.invalidated ? '更正已保存，'+res.invalidated+' 张耐久卡已失效' : '更正已保存');
        event.target.reset();
        await load();
      } catch (e) { toast(e.message, true); }
    };
    $('#sampleForm').onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      data.moldy = event.target.moldy.checked;
      try {
        const res = await api('/api/durability/cards', { method:'POST', body: JSON.stringify(data) });
        toast(res.held ? '已留待取样：'+res.sample.reason : '墨样 '+res.card.sampleCode+' 已建档入潮箱');
        event.target.reset();
        await load();
      } catch (e) { toast(e.message, true); await load(); }
    };
    $('#statusFilter').onchange = renderItems; $('#search').oninput = renderItems;
    $('#cardStateFilter').onchange = renderDurability; $('#cardSearch').oninput = renderDurability;
    $('#reload').onclick = () => load().catch(e => toast(e.message, true));
    renderForms();
    load().catch(e => toast(e.message, true));
  </script>
</body>
</html>`;
}
