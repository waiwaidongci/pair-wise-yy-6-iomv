// 页面操作层：只负责把档案渲染成页面、收集表单并调用 API。
// 取样规则与档案保存不放在这里——所有判定以后端返回为准，
// 提交失败只弹提示、不本地补写，页面不会出现“半截卡”。

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>墨锭试磨室 · 潮箱耐久卡</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --gold:#8a6d2f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button:disabled { background:#aab3a6; cursor:not-allowed; }
    .tabs { display:flex; gap:8px; margin-bottom:16px; } .tabs button { background:#e2e8de; color:var(--ink); } .tabs button.active { background:var(--accent); color:#fff; }
    .layout { display:grid; grid-template-columns:380px 1fr; gap:22px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; align-items:center; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.due { border-color:var(--gold); color:var(--gold); font-weight:700; } .pill.bad { border-color:var(--warn); color:var(--warn); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:120px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .point { border:1px dashed var(--line); border-radius:6px; padding:8px 10px; margin-top:6px; } .point.done { border-style:solid; background:#f7f9f5; }
    .inline { display:flex; gap:8px; flex-wrap:wrap; align-items:center; } .inline label { margin:0; }
    .testrow { border-top:1px solid var(--line); padding-top:6px; font-size:13px; }
    #toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%); background:#2c332a; color:#fff; padding:11px 18px; border-radius:8px; opacity:0; pointer-events:none; transition:opacity .2s; max-width:80vw; } #toast.show { opacity:1; } #toast.err { background:var(--warn); }
    .hidden { display:none; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{padding:16px;} .layout{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header>
    <div><h1>墨锭试磨室</h1><div class="meta">墨锭建档 · 试磨记录 · 潮箱耐久卡（余墨取样、七天/十四天读数、失效联动）</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <div class="tabs">
      <button id="tabSticks" class="active">墨锭档案</button>
      <button id="tabCards">潮箱耐久卡</button>
    </div>

    <section id="sticksView" class="layout">
      <div>
        <form id="createForm"><h2>新增墨锭</h2>
          <label>墨锭编号</label><input name="code" required>
          <label>烟料来源</label><input name="smokeSource">
          <label>胶料比例</label><input name="glueRatio">
          <label>存放年限</label><input name="ageYears" type="number">
          <label>存放位置</label><input name="storage">
          <label>初始状态</label><select name="status"><option>待试磨</option><option>已试磨</option><option>重点观察</option></select>
          <div style="margin-top:12px"><button>保存墨锭</button></div>
        </form>
        <form id="testForm" style="margin-top:14px"><h2>创建试磨记录</h2>
          <label>选择墨锭</label><select name="itemCode" id="stickSelect"></select>
          <label>试磨纸张</label><input name="paper">
          <label>加水量</label><input name="water">
          <label>出墨速度</label><input name="speed">
          <label>墨色层次</label><input name="colorLayer">
          <label>沉淀情况</label><input name="sediment" placeholder="无 / 少 / 有细砂…">
          <label>评分</label><input name="score" type="number" required>
          <div style="margin-top:12px"><button>提交试磨</button></div>
        </form>
      </div>
      <div>
        <div class="stats" id="stickStats"></div>
        <div class="toolbar">
          <select id="stickStatus"><option value="">全部状态</option><option>待试磨</option><option>已试磨</option><option>重点观察</option></select>
          <input id="stickSearch" placeholder="搜索编号或关键词">
        </div>
        <div class="panel"><h2>墨锭列表</h2><div class="grid" id="stickCards"></div></div>
      </div>
    </section>

    <section id="cardsView" class="layout hidden">
      <div>
        <form id="cardForm"><h2>试磨余墨入潮箱建卡</h2>
          <label>选择墨锭</label><select name="itemCode" id="cardItemSelect"></select>
          <label>对应试磨记录</label><select name="testId" id="cardTestSelect"></select>
          <label>余墨重量（克，不足3克留待取样不建卡）</label><input name="weightGrams" type="number" step="0.1" min="0" required>
          <label>取样人</label><input name="sampler" required>
          <div class="inline" style="margin-top:10px"><input type="checkbox" name="moldy" id="moldyBox" style="width:auto"><label for="moldyBox" style="margin:0">墨样已发霉（发霉不建卡）</label></div>
          <div style="margin-top:12px"><button>存入潮箱建卡</button></div>
        </form>
        <div class="panel" style="margin-top:14px">
          <h2>读数规则</h2>
          <div class="meta">满 7 天记第一次色差/起皮，满 14 天记第二次；两次须由<b>不同的人</b>记录；两次都正常才算耐久合格。</div>
          <div class="meta" style="margin-top:6px">原试磨评分或沉淀一旦更正，关联耐久卡<b>立即失效并移出统计</b>，旧读数仍可在“已失效”中查看。</div>
        </div>
      </div>
      <div>
        <div class="stats" id="cardStats"></div>
        <div class="toolbar">
          <select id="cardStatus"><option value="">全部</option><option>待读数</option><option>已完成</option><option>已失效</option></select>
          <input id="cardSearch" placeholder="搜索卡号 / 墨锭编号 / 取样人">
        </div>
        <div class="panel"><h2>耐久卡列表（待读数 · 已失效 · 已完成）</h2><div class="grid" id="cardCards"></div></div>
      </div>
    </section>
  </main>
  <div id="toast"></div>

  <script>
    const DAY_MS = 24*60*60*1000;
    let sticks = [], cards = [];

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { code:data.code });
      return data;
    }
    let toastTimer;
    function toast(msg, isErr) {
      const el = document.querySelector('#toast');
      el.textContent = msg; el.className = 'show' + (isErr ? ' err' : '');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 3200);
    }
    const fmt = iso => { try { const d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } catch { return iso; } };
    const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const formJson = form => {
      const data = {};
      for (const [k,v] of new FormData(form).entries()) data[k] = v;
      data.moldy = form.moldy ? form.moldy.checked : false;
      return data;
    };

    // ---------- 墨锭档案 ----------
    async function loadSticks() {
      sticks = await api('/api/items');
      renderSticks();
    }
    function renderSticks() {
      const stages = ["待试磨","已试磨","重点观察"];
      document.querySelector('#stickStats').innerHTML = stages.map(s =>
        '<div class="stat"><span>'+s+'</span><strong>'+sticks.filter(i => i.status===s).length+'</strong></div>').join('');
      document.querySelector('#stickSelect').innerHTML = sticks.map(i => '<option value="'+esc(i.code)+'">'+esc(i.code)+' · '+esc(i.smokeSource||'')+'</option>').join('');
      const status = document.querySelector('#stickStatus').value;
      const q = document.querySelector('#stickSearch').value.trim();
      const visible = sticks.filter(i => (!status || i.status===status) && (!q || JSON.stringify(i).includes(q)));
      document.querySelector('#stickCards').innerHTML = visible.map(stickCardHtml).join('') || '<div class="meta">暂无墨锭</div>';
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => {
        try { await api('/api/items/'+encodeURIComponent(sel.dataset.status), { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await loadSticks(); }
        catch (e) { toast(e.message, true); loadSticks(); }
      });
      document.querySelectorAll('[data-correct]').forEach(btn => btn.onclick = () => correctTest(btn.dataset.correct, btn.dataset.test);
    }
    function stickCardHtml(item) {
      const tests = (item.tests||[]).map(t =>
        '<div class="testrow">试磨 '+fmt(t.at)+'｜'+esc(t.paper)+'｜评分<b>'+esc(t.score)+'</b>｜沉淀：'+esc(t.sediment||'无')+
        ' <button type="button" class="secondary" data-correct="'+esc(item.code)+'" data-test="'+esc(t.id)+'">更正评分/沉淀</button></div>').join('');
      const logs = (item.logs||[]).slice(-5).map(l => '<div>'+esc(l.step)+'（'+fmt(l.at)+'）：'+esc(l.note)+'</div>').join('');
      return '<article class="card"><h3>'+esc(item.code)+'</h3><span class="pill">'+esc(item.status)+'</span>'+
        '<div class="meta">'+esc(item.smokeSource)+'｜胶 '+esc(item.glueRatio)+'｜'+esc(item.ageYears ?? '')+' 年｜'+esc(item.storage)+'</div>'+
        '<div><b>试磨记录</b>'+(tests || '<div class="meta">暂无</div>')+'</div>'+
        '<div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    async function correctTest(itemCode, testId) {
      const score = prompt('更正后的评分（留空表示不改）：');
      if (score === null) return;
      const sediment = prompt('更正后的沉淀情况（留空表示不改）：');
      if (sediment === null) return;
      const body = {};
      if (score.trim() !== '') body.score = Number(score);
      if (sediment.trim() !== '') body.sediment = sediment.trim();
      if (!Object.keys(body).length) { toast('未填写任何更正内容', true); return; }
      try {
        const r = await api('/api/items/'+encodeURIComponent(itemCode)+'/tests/'+encodeURIComponent(testId)+'/correction', { method:'POST', body: JSON.stringify(body) });
        toast('已更正，关联耐久卡 '+(r.invalidatedCards.length ? r.invalidatedCards.map(c=>c.code).join('、')+' 已立即失效并移出统计' : '（无有效卡受影响）'));
      } catch (e) { toast('更正失败：'+e.message, true); }
      await Promise.all([loadSticks(), loadCards()]);
    }

    // ---------- 潮箱耐久卡 ----------
    async function loadCards() {
      cards = await api('/api/cards');
      renderCards();
    }
    function renderCards() {
      const stats = cards.reduce((m,c) => { m[c.status] = (m[c.status]||0)+1;
        if (c.status==='已完成') { c.durable ? m.耐久合格++ : m.耐久不合格++; } return m; },
        { 待读数:0, 已完成:0, 已失效:0, 耐久合格:0, 耐久不合格:0 });
      document.querySelector('#cardStats').innerHTML = [
        ['待读数', stats.待读数], ['耐久合格（完成）', stats.耐久合格], ['耐久不合格（完成）', stats.耐久不合格], ['已失效（移出统计）', stats.已失效]
      ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');

      const opts = sticks.map(i => {
        const tests = (i.tests||[]).map(t => '<option value="'+esc(t.id)+'" data-item="'+esc(i.code)+'">'+fmt(t.at)+'｜评分'+esc(t.score)+'｜沉淀'+esc(t.sediment||'无')+'</option>').join('');
        return '<optgroup label="'+esc(i.code)+' '+esc(i.smokeSource||'')+'">'+(tests || '<option value="">（无试磨记录）</option>')+'</optgroup>';
      }).join('');
      const itemSel = document.querySelector('#cardItemSelect');
      const prevItem = itemSel.value;
      itemSel.innerHTML = sticks.map(i => '<option value="'+esc(i.code)+'">'+esc(i.code)+' · '+esc(i.smokeSource||'')+'</option>').join('');
      if (prevItem && sticks.some(i => i.code===prevItem)) itemSel.value = prevItem;
      const testSel = document.querySelector('#cardTestSelect');
      const syncTests = () => {
        testSel.innerHTML = (sticks.find(i => i.code===itemSel.value)?.tests||[]).map(t => '<option value="'+esc(t.id)+'">'+fmt(t.at)+'｜评分'+esc(t.score)+'｜沉淀'+esc(t.sediment||'无')+'</option>').join('') || '<option value="">（该墨锭暂无试磨记录）</option>';
      };
      itemSel.onchange = syncTests; syncTests();

      const status = document.querySelector('#cardStatus').value;
      const q = document.querySelector('#cardSearch').value.trim();
      const visible = cards.filter(c => (!status || c.status===status) && (!q || JSON.stringify(c).includes(q)));
      document.querySelector('#cardCards').innerHTML = visible.map(durableCardHtml).join('') || '<div class="meta">暂无耐久卡</div>';
      document.querySelectorAll('[data-reading]').forEach(btn => btn.onclick = () => submitReading(btn.dataset.reading, btn.dataset.point, btn.closest('.card'));
    }
    function durableCardHtml(card) {
      const invalid = card.status==='已失效';
      const pill = '<span class="pill'+(card.status==='待读数'?' due':'')+'">'+esc(card.status)+'</span>' +
        (card.status==='已完成' ? '<span class="pill '+(card.durable?'':'bad')+'">'+(card.durable?'耐久合格':'耐久不合格')+'</span>' : '');
      const points = ['day7','day14'].map(k => {
        const p = card.points[k], r = card.readings[k];
        if (r) {
          return '<div class="point done"><b>'+esc(p.label)+'读数</b>（'+fmt(r.at)+'）<div class="meta">色差 '+esc(r.colorDelta)+'｜起皮 '+esc(r.peeling)+'｜记录人 '+esc(r.by)+'｜'+(r.normal?'正常':'<span class="warn">异常</span>')+'</div></div>';
        }
        const dueText = '到期时间 '+fmt(p.dueAt);
        const form = '<div class="point"><b>'+esc(p.label)+'读数</b> <span class="pill'+(p.due?' due':'')+'">'+dueText+'</span>'+
          (p.due ?
          '<label>色差</label><input name="colorDelta" placeholder="如 0.8">'+
          '<label>起皮</label><select name="peeling"><option>无</option><option>轻微起皮</option><option>明显起皮</option></select>'+
          '<label class="inline"><input type="checkbox" name="normal" checked style="width:auto"> 本次读数正常</label>'+
          '<label>记录人（须与另一次不同）</label><input name="by">'+
          '<div style="margin-top:8px"><button type="button" data-reading="'+esc(card.id)+'" data-point="'+k+'">提交'+esc(p.label)+'读数</button></div>'
          : '<div class="meta">尚未满 '+p.day+' 天，到期才能记录</div>')+'</div>';
        return form;
      }).join('');
      const hist = (card.history||[]).map(h => '<div>'+esc(h.type)+'（'+fmt(h.at)+'）：'+esc(h.note)+'</div>').join('');
      return '<article class="card"><h3>'+esc(card.code)+'</h3>'+pill+
        '<div class="meta">墨锭 '+esc(card.itemCode)+'（'+esc(card.item?.smokeSource||'')+'）｜试磨 '+esc(card.testId)+'</div>'+
        '<div class="meta">入潮箱 '+fmt(card.storedAt)+'｜余墨 '+esc(card.sample.weightGrams)+' 克｜取样人 '+esc(card.sample.sampler)+'</div>'+
        (invalid ? '<div class="warn">失效原因：'+esc(card.invalidated?.reason||'原试磨评分或沉淀更正')+'（'+fmt(card.invalidated?.at)+'）</div><div class="meta">旧读数仍可查：</div>' : '')+
        points+
        '<div class="logs meta">'+hist+'</div></article>';
    }
    async function submitReading(cardId, point, root) {
      const get = name => root.querySelector('[name="'+name+'"]');
      const body = {
        point,
        colorDelta: get('colorDelta').value.trim(),
        peeling: get('peeling').value,
        normal: get('normal').checked,
        by: get('by').value.trim()
      };
      if (!body.colorDelta || !body.by) { toast('请填写色差和记录人', true); return; }
      try {
        await api('/api/cards/'+encodeURIComponent(cardId)+'/readings', { method:'POST', body: JSON.stringify(body) });
        toast('读数已记录');
      } catch (e) { toast('读数失败：'+e.message, true); }
      await Promise.all([loadCards(), loadSticks()]);
    }

    // ---------- 表单与切换 ----------
    document.querySelector('#createForm').onsubmit = async e => {
      e.preventDefault();
      const form = e.target;
      try { await api('/api/items', { method:'POST', body: JSON.stringify(formJson(form)) }); form.reset(); toast('墨锭已建档'); await loadSticks(); }
      catch (err) { toast('建档失败：'+err.message, true); }
    };
    document.querySelector('#testForm').onsubmit = async e => {
      e.preventDefault();
      const form = e.target;
      try { await api('/api/items/'+encodeURIComponent(form.itemCode.value)+'/tests', { method:'POST', body: JSON.stringify(formJson(form)) }); form.reset(); toast('试磨记录已提交'); await Promise.all([loadSticks(), loadCards()]); }
      catch (err) { toast('提交失败：'+err.message, true); }
    };
    document.querySelector('#cardForm').onsubmit = async e => {
      e.preventDefault();
      const form = e.target;
      try {
        await api('/api/cards', { method:'POST', body: JSON.stringify(formJson(form)) });
        form.reset(); toast('耐久卡已建立，余墨存入潮箱'); await Promise.all([loadCards(), loadSticks()]);
      } catch (err) {
        // 422：不足三克或发霉，留待取样；409：重复建档。页面不留任何半截。
        toast('建卡失败：'+err.message, true);
      }
    };
    document.querySelector('#stickStatus').onchange = renderSticks;
    document.querySelector('#stickSearch').oninput = renderSticks;
    document.querySelector('#cardStatus').onchange = renderCards;
    document.querySelector('#cardSearch').oninput = renderCards;
    document.querySelector('#reload').onclick = () => { loadSticks(); loadCards(); };
    document.querySelector('#tabSticks').onclick = () => {
      document.querySelector('#sticksView').classList.remove('hidden');
      document.querySelector('#cardsView').classList.add('hidden');
      document.querySelector('#tabSticks').classList.add('active');
      document.querySelector('#tabCards').classList.remove('active');
    };
    document.querySelector('#tabCards').onclick = () => {
      document.querySelector('#cardsView').classList.remove('hidden');
      document.querySelector('#sticksView').classList.add('hidden');
      document.querySelector('#tabCards').classList.add('active');
      document.querySelector('#tabSticks').classList.remove('active');
    };
    loadSticks(); loadCards();
  </script>
</body>
</html>`;
}
