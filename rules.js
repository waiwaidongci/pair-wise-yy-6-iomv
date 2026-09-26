// 取样规则与耐久卡判定（领域层）。
// 本文件只负责业务规则：建卡门槛、七天/十四天读数、失效联动、统计口径。
// 不碰 HTTP，不直接落盘——档案写入由调用方在 store.mutate 临界区内完成。

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_GRAMS = 3;
export const READING_POINTS = [
  { key: "day7", label: "第7天", day: 7 },
  { key: "day14", label: "第14天", day: 14 }
];
export const CARD_STATUSES = ["待读数", "已完成", "已失效"];

export class DomainError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const required = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new DomainError(400, "missing_field", `缺少${label}`);
  }
};

function findItem(db, itemCode) {
  const item = (db.items || []).find(x => x.code === itemCode || x.id === itemCode);
  if (!item) throw new DomainError(404, "item_not_found", "墨锭不存在");
  return item;
}

function findTest(item, testId) {
  const test = (item.tests || []).find(t => t.id === testId);
  if (!test) throw new DomainError(404, "test_not_found", "试磨记录不存在");
  return test;
}

function findCard(db, cardId) {
  const card = (db.cards || []).find(c => c.id === cardId || c.code === cardId);
  if (!card) throw new DomainError(404, "card_not_found", "耐久卡不存在");
  return card;
}

function nextTestId(db) {
  const n = (db.items || []).reduce(
    (m, item) => Math.max(m, ...(item.tests || []).map(t => parseInt(String(t.id).replace(/^T-/, ""), 10) || 0)),
    0
  );
  return "T-" + String(n + 1).padStart(3, "0");
}

function nextCardCode(db, now) {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `DC-${ymd}-`;
  const n = (db.cards || []).reduce(
    (m, c) => (c.code && c.code.startsWith(prefix)
      ? Math.max(m, parseInt(c.code.slice(prefix.length), 10) || 0)
      : m),
    0
  );
  return prefix + String(n + 1).padStart(3, "0");
}

function nextCardId(db) {
  const n = (db.cards || []).reduce(
    (m, c) => Math.max(m, parseInt(String(c.id).replace(/^DCARD-/, ""), 10) || 0),
    0
  );
  return "DCARD-" + String(n + 1).padStart(3, "0");
}

// ---- 墨锭建档与试磨 ----------------------------------------------------

export function createItem(db, input, now = new Date()) {
  const code = String(input.code || "").trim();
  required(code, "墨锭编号");
  if ((db.items || []).some(x => x.code === code)) {
    // 并发或重复建档：不写入任何东西，交给上层回 409
    throw new DomainError(409, "duplicate_item", "墨锭编号已存在");
  }
  const item = {
    id: "IS-" + now.getTime(),
    code,
    smokeSource: String(input.smokeSource || "").trim(),
    glueRatio: String(input.glueRatio || "").trim(),
    ageYears: input.ageYears === "" || input.ageYears === undefined ? null : Number(input.ageYears),
    storage: String(input.storage || "").trim(),
    status: ["待试磨", "已试磨", "重点观察"].includes(input.status) ? input.status : "待试磨",
    logs: [{ at: now.toISOString(), step: "建档", note: "创建墨锭" }],
    tests: []
  };
  db.items ||= [];
  db.items.unshift(item);
  return item;
}

export function addTest(db, itemCode, input, now = new Date()) {
  const item = findItem(db, itemCode);
  const score = Number(input.score);
  if (!Number.isFinite(score)) throw new DomainError(400, "invalid_score", "评分必须是数字");
  const test = {
    id: nextTestId(db),
    at: now.toISOString(),
    paper: String(input.paper || "").trim(),
    water: String(input.water || "").trim(),
    speed: String(input.speed || "").trim(),
    colorLayer: String(input.colorLayer || "").trim(),
    sediment: String(input.sediment || "").trim(),
    score
  };
  item.tests ||= [];
  item.tests.push(test);
  item.status = score >= 85 ? "已试磨" : "重点观察";
  item.logs ||= [];
  item.logs.push({
    at: now.toISOString(),
    step: "试磨",
    note: `${test.paper || "试纸"}${test.water ? "，" + test.water : ""}，评分${score}${test.sediment ? "，沉淀" + test.sediment : ""}`,
    score
  });
  return { item, test };
}

export function updateItemStatus(db, itemCode, status, now = new Date()) {
  const item = findItem(db, itemCode);
  if (!["待试磨", "已试磨", "重点观察"].includes(status)) {
    throw new DomainError(400, "invalid_status", "状态不合法");
  }
  item.status = status;
  item.logs ||= [];
  item.logs.push({ at: now.toISOString(), step: "状态", note: "更新为" + status });
  return item;
}

export function appendLog(db, itemCode, input, now = new Date()) {
  const item = findItem(db, itemCode);
  item.logs ||= [];
  item.logs.push({
    at: now.toISOString(),
    step: String(input.step || "备注"),
    note: String(input.note || "")
  });
  return item;
}

// ---- 潮箱耐久卡 --------------------------------------------------------

// 试磨后余墨入潮箱建卡。
// 不足三克或已发霉：留待重新取样——不建卡、不占编号、不写任何记录。
export function createCard(db, input, now = new Date()) {
  required(input.itemCode, "墨锭编号");
  required(input.testId, "试磨记录");
  required(input.sampler, "取样人");
  const item = findItem(db, input.itemCode);
  findTest(item, input.testId);

  const weight = Number(input.weightGrams);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new DomainError(400, "invalid_weight", "余墨重量必须是正数");
  }
  if (weight < MIN_GRAMS) {
    throw new DomainError(422, "sample_too_light", `余墨不足${MIN_GRAMS}克，留待取样，不建卡`);
  }
  if (input.moldy === true || input.moldy === "true") {
    throw new DomainError(422, "sample_moldy", "墨样已发霉，留待取样，不建卡");
  }

  db.cards ||= [];
  // 同一份试磨只允许一张有效卡；并发重复建档在此被挡住，返回 409。
  const conflict = db.cards.find(c => c.testId === input.testId && c.status !== "已失效");
  if (conflict) {
    throw new DomainError(409, "duplicate_card", `该试磨已有有效耐久卡 ${conflict.code}`);
  }

  const card = {
    id: nextCardId(db),
    code: nextCardCode(db, now),
    itemCode: item.code,
    testId: input.testId,
    storedAt: now.toISOString(),
    sample: { weightGrams: weight, sampler: String(input.sampler).trim() },
    status: "待读数",
    durable: null,
    readings: {},
    history: [
      { at: now.toISOString(), type: "建档", note: `余墨${weight}克，取样人${input.sampler.trim()}，入潮箱待读数` }
    ]
  };
  db.cards.unshift(card);
  item.logs ||= [];
  item.logs.push({
    at: now.toISOString(),
    step: "耐久取样",
    note: `余墨${weight}克入潮箱，取样人${input.sampler.trim()}，建卡 ${card.code}`
  });
  return card;
}

// 满七天、满十四天各记一次色差与起皮；两次必须由不同的人记录，
// 两次都正常才算耐久。
export function addReading(db, cardId, input, now = new Date()) {
  const card = findCard(db, cardId);
  if (card.status === "已失效") {
    throw new DomainError(409, "card_invalidated", "耐久卡已失效，不能再记录读数（旧读数仍可查）");
  }
  const point = READING_POINTS.find(p => p.key === String(input.point || ""));
  if (!point) throw new DomainError(400, "invalid_point", "读数节点只能是 day7 或 day14");

  required(input.by, "记录人");
  required(input.colorDelta, "色差");
  required(input.peeling, "起皮情况");
  const by = String(input.by).trim();
  const existing = card.readings || {};
  if (existing[point.key]) {
    throw new DomainError(409, "reading_exists", `${point.label}读数已记录`);
  }
  // 两次读数必须由不同的人
  const otherKey = point.key === "day7" ? "day14" : "day7";
  if (existing[otherKey] && existing[otherKey].by === by) {
    throw new DomainError(409, "same_reader", "七天与十四天读数必须由不同的人记录");
  }
  // 满期才能记
  const storedAt = new Date(card.storedAt).getTime();
  const dueAt = storedAt + point.day * DAY_MS;
  if (now.getTime() < dueAt) {
    throw new DomainError(409, "not_due_yet", `未满${point.day}天，${point.label}读数尚未到期`);
  }

  const normal = input.normal === true || input.normal === "true";
  const reading = {
    at: now.toISOString(),
    by,
    colorDelta: String(input.colorDelta).trim(),
    peeling: String(input.peeling).trim(),
    normal
  };
  card.readings = { ...existing, [point.key]: reading };
  card.history ||= [];
  card.history.push({
    at: now.toISOString(),
    type: `${point.label}读数`,
    note: `色差${reading.colorDelta}，起皮${reading.peeling}，记录人${by}，${normal ? "正常" : "异常"}`
  });

  if (READING_POINTS.every(p => card.readings[p.key])) {
    card.status = "已完成";
    card.completedAt = now.toISOString();
    card.durable = READING_POINTS.every(p => card.readings[p.key].normal);
    card.history.push({
      at: now.toISOString(),
      type: "完成",
      note: card.durable ? "两次读数均正常，判定耐久合格" : "存在异常读数，判定耐久不合格"
    });
  }

  const item = (db.items || []).find(x => x.code === card.itemCode);
  if (item) {
    item.logs ||= [];
    item.logs.push({
      at: now.toISOString(),
      step: `${point.label}读数`,
      note: `${card.code}：色差${reading.colorDelta}、起皮${reading.peeling}，记录人${by}，${normal ? "正常" : "异常"}`
    });
  }
  return card;
}

// 原试磨评分或沉淀更正：关联的有效卡立即失效并移出统计，旧读数保留可查。
export function correctTest(db, itemCode, testId, patch, now = new Date()) {
  const item = findItem(db, itemCode);
  const test = findTest(item, testId);
  const changes = [];
  if (patch.score !== undefined && patch.score !== "") {
    const score = Number(patch.score);
    if (!Number.isFinite(score)) throw new DomainError(400, "invalid_score", "评分必须是数字");
    if (score !== test.score) {
      changes.push(`评分${test.score}→${score}`);
      test.score = score;
    }
  }
  if (patch.sediment !== undefined && String(patch.sediment).trim() !== "") {
    const sediment = String(patch.sediment).trim();
    if (sediment !== test.sediment) {
      changes.push(`沉淀「${test.sediment || "无"}」→「${sediment}」`);
      test.sediment = sediment;
    }
  }
  if (changes.length === 0) {
    throw new DomainError(400, "no_change", "没有需要更正的评分或沉淀内容");
  }
  item.logs ||= [];
  item.logs.push({
    at: now.toISOString(),
    step: "试磨更正",
    note: changes.join("，"),
    score: test.score
  });

  const invalidatedCards = [];
  for (const card of (db.cards || [])) {
    if (card.itemCode === item.code && card.testId === testId && card.status !== "已失效") {
      card.status = "已失效";
      card.durable = null; // 移出耐久统计
      card.invalidated = { at: now.toISOString(), reason: "原试磨评分或沉淀更正：" + changes.join("，") };
      card.history ||= [];
      card.history.push({
        at: now.toISOString(),
        type: "失效",
        note: "原试磨评分或沉淀更正，卡立即失效并移出统计，旧读数仍保留可查"
      });
      item.logs.push({
        at: now.toISOString(),
        step: "耐久卡失效",
        note: `${card.code} 因原试磨评分或沉淀更正立即失效，移出统计`
      });
      invalidatedCards.push(card);
    }
  }
  return { item, test, invalidatedCards };
}

// ---- 查询与统计 --------------------------------------------------------

// 附上到期信息与墨锭摘要，方便列表渲染；不改动档案。
export function decorateCard(card, items, now = new Date()) {
  const item = (items || []).find(x => x.code === card.itemCode);
  const storedAt = new Date(card.storedAt).getTime();
  const points = Object.fromEntries(READING_POINTS.map(p => {
    const dueAt = storedAt + p.day * DAY_MS;
    return [p.key, {
      label: p.label,
      day: p.day,
      dueAt: new Date(dueAt).toISOString(),
      due: now.getTime() >= dueAt,
      recorded: Boolean((card.readings || {})[p.key])
    }];
  }));
  return {
    ...card,
    item: item ? {
      code: item.code,
      smokeSource: item.smokeSource,
      storage: item.storage
    } : null,
    points
  };
}

export function listCards(db, { status } = {}, now = new Date()) {
  let cards = db.cards || [];
  if (status) {
    if (!CARD_STATUSES.includes(status)) throw new DomainError(400, "invalid_status", "状态筛选不合法");
    cards = cards.filter(c => c.status === status);
  }
  return cards.map(c => decorateCard(c, db.items, now));
}

// 统计只数有效卡；已失效卡立即移出统计。
export function cardStats(db, now = new Date()) {
  const stats = { 待读数: 0, 已完成: 0, 已失效: 0, 耐久合格: 0, 耐久不合格: 0 };
  for (const card of (db.cards || [])) {
    if (stats[card.status] !== undefined) stats[card.status] += 1;
    if (card.status === "已完成") {
      if (card.durable) stats.耐久合格 += 1;
      else stats.耐久不合格 += 1;
    }
  }
  const dueNow = { day7: 0, day14: 0 };
  for (const card of (db.cards || [])) {
    if (card.status !== "待读数") continue;
    for (const p of READING_POINTS) {
      const r = (card.readings || {})[p.key];
      const dueAt = new Date(card.storedAt).getTime() + p.day * DAY_MS;
      if (!r && now.getTime() >= dueAt) dueNow[p.key] += 1;
    }
  }
  return { ...stats, 到期待记: dueNow.day7 + dueNow.day14 };
}
