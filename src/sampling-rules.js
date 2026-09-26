// 取样规则：纯领域逻辑，不碰存储和页面。
// 余墨不足三克或发霉的墨样留待取样、不占卡；满七天/十四天各记一次读数，
// 两次须由不同人记录，两次都正常才算耐久。

export const MIN_WEIGHT_G = 3; // 余墨不足三克 → 留待取样
export const READING_DAYS = [7, 14]; // 满七天、满十四天各记一次
export const MAX_COLOR_DIFF = 2.0; // 色差 ΔE 上限，超过即不正常
export const DAY_MS = 24 * 60 * 60 * 1000;

export function toBool(value) {
  return value === true || value === "true" || value === "有" || value === "是";
}

// 取样判定：能建档返回 { fileable: true }，否则留待取样并给出原因。
export function evaluateSampleIntake({ weightGrams, moldy }) {
  if (toBool(moldy)) return { fileable: false, reason: "墨样发霉，留待重新取样" };
  const weight = Number(weightGrams);
  if (!Number.isFinite(weight) || weight < MIN_WEIGHT_G) {
    return { fileable: false, reason: `余墨不足${MIN_WEIGHT_G}克，留待取样` };
  }
  return { fileable: true };
}

export function readingDueAt(filedAt, day) {
  return new Date(new Date(filedAt).getTime() + day * DAY_MS);
}

// 单次读数是否正常：色差在限内且未起皮。
export function isReadingNormal({ colorDiff, peeling }) {
  return Number(colorDiff) <= MAX_COLOR_DIFF && !toBool(peeling);
}

function fail(status, code, message) {
  return { ok: false, status, code, message };
}

// 校验一条待录入的读数。通过时返回规范化后的读数，否则返回 HTTP 状态与原因。
export function validateReading(card, input, now = new Date()) {
  if (card.invalidatedAt) return fail(409, "card_invalidated", "耐久卡已失效，不能再记录读数");
  const day = Number(input.day);
  if (!READING_DAYS.includes(day)) return fail(400, "invalid_day", "读数只能是满七天或满十四天");
  const reader = String(input.reader ?? "").trim();
  if (!reader) return fail(400, "invalid_reader", "记录人不能为空");
  const colorDiff = Number(input.colorDiff);
  if (!Number.isFinite(colorDiff) || colorDiff < 0) return fail(400, "invalid_color_diff", "色差需为不小于 0 的数字");
  const peeling = toBool(input.peeling);
  const readings = card.readings || [];
  if (readings.some((r) => r.day === day)) return fail(409, "reading_exists", `满${day}天读数已记录，请勿重复录入`);
  const first = readings.find((r) => r.day === READING_DAYS[0]);
  if (day === READING_DAYS[1] && !first) return fail(422, "reading_order", "须先记录满七天读数");
  if (day === READING_DAYS[1] && first.reader === reader) return fail(422, "reader_must_differ", "两次读数须由不同人记录");
  const dueAt = readingDueAt(card.filedAt, day);
  if (now < dueAt) return fail(422, "reading_not_due", `未满${day}天，${dueAt.toISOString()} 后才可记录`);
  return { ok: true, reading: { day, reader, colorDiff, peeling, normal: isReadingNormal({ colorDiff, peeling }) } };
}

// 汇总一张卡的展示状态：待读数 / 已完成 / 已失效，以及下次读数与耐久结论。
export function summarizeCard(card, now = new Date()) {
  const readings = [...(card.readings || [])].sort((a, b) => a.day - b.day);
  const invalidated = Boolean(card.invalidatedAt);
  const complete = READING_DAYS.every((d) => readings.some((r) => r.day === d));
  const durable = complete && readings.every((r) => r.normal);
  const nextDay = READING_DAYS.find((d) => !readings.some((r) => r.day === d));
  const dueAt = nextDay !== undefined ? readingDueAt(card.filedAt, nextDay) : null;
  return {
    ...card,
    readings,
    state: invalidated ? "已失效" : complete ? "已完成" : "待读数",
    result: complete ? (durable ? "耐久" : "不耐久") : null,
    nextReadingDay: !invalidated && !complete ? nextDay : null,
    nextDueAt: dueAt ? dueAt.toISOString() : null,
    nextDue: dueAt ? now >= dueAt : false,
  };
}

// 统计只覆盖有效卡；已失效的卡移出统计，但读数仍可查。
export function computeStats(summaries) {
  const active = summaries.filter((c) => c.state !== "已失效");
  return {
    待读数: active.filter((c) => c.state === "待读数").length,
    已完成: active.filter((c) => c.state === "已完成").length,
    耐久: active.filter((c) => c.result === "耐久").length,
    不耐久: active.filter((c) => c.result === "不耐久").length,
  };
}
