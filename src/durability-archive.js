// 档案保存：耐久卡与留待取样墨样的持久化。
// 所有写操作经队列串行化（并发重复建档时后者必得 409），
// 先校验后落盘，临时文件 + 原子改名，记录不留半截。

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { computeStats, evaluateSampleIntake, summarizeCard, toBool, validateReading } from "./sampling-rules.js";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function newCardId() {
  return "DC-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeSample(input) {
  const sampleCode = String(input.sampleCode ?? "").trim();
  if (!sampleCode) throw new HttpError(400, "invalid_sample_code", "墨样编号不能为空");
  const weightGrams = Number(input.weightGrams);
  if (!Number.isFinite(weightGrams) || weightGrams < 0) {
    throw new HttpError(400, "invalid_weight", "余墨重量需为不小于 0 的数字");
  }
  const sampler = String(input.sampler ?? "").trim();
  if (!sampler) throw new HttpError(400, "invalid_sampler", "取样人不能为空");
  return {
    sampleCode,
    itemCode: String(input.itemCode ?? "").trim() || null,
    weightGrams,
    sampler,
    moldy: toBool(input.moldy),
  };
}

export function createDurabilityArchive({ filePath, now = () => new Date() }) {
  let queue = Promise.resolve();
  // 串行执行写操作：并发请求按到达顺序逐个校验、逐个落盘。
  function exclusive(task) {
    const run = queue.then(task);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async function load() {
    if (!existsSync(filePath)) return { cards: [], pendingSamples: [] };
    const db = JSON.parse(await readFile(filePath, "utf8"));
    db.cards ||= [];
    db.pendingSamples ||= [];
    return db;
  }

  async function save(db) {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = filePath + "." + process.pid + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, filePath); // 原子替换，文件永远不会只写一半
  }

  function findCard(db, id) {
    return db.cards.find((c) => c.id === id || c.sampleCode === id);
  }

  return {
    // 墨样建档：不合格留待取样（不占卡），重复编号 409。
    async fileSample(input) {
      return exclusive(async () => {
        const sample = normalizeSample(input); // 先校验，不合格不写任何记录
        const db = await load();
        if (db.cards.some((c) => c.sampleCode === sample.sampleCode)) {
          throw new HttpError(409, "card_exists", `墨样 ${sample.sampleCode} 已建档，请勿重复建档`);
        }
        const intake = evaluateSampleIntake(sample);
        if (!intake.fileable) {
          const held = { ...sample, heldAt: now().toISOString(), reason: intake.reason };
          db.pendingSamples = [...db.pendingSamples.filter((s) => s.sampleCode !== sample.sampleCode), held];
          await save(db);
          return { held: true, sample: held };
        }
        db.pendingSamples = db.pendingSamples.filter((s) => s.sampleCode !== sample.sampleCode);
        const card = {
          id: newCardId(),
          ...sample,
          chamber: "潮箱",
          filedAt: now().toISOString(),
          readings: [],
          invalidatedAt: null,
          invalidReason: null,
        };
        db.cards.unshift(card);
        await save(db);
        return { held: false, card };
      });
    },

    // 录入读数：满七天 / 满十四天各一次，规则由 sampling-rules 校验。
    async addReading(cardId, input) {
      return exclusive(async () => {
        const db = await load();
        const card = findCard(db, cardId);
        if (!card) throw new HttpError(404, "card_not_found", "耐久卡不存在");
        const check = validateReading(card, input, now());
        if (!check.ok) throw new HttpError(check.status, check.code, check.message);
        card.readings.push({ ...check.reading, at: now().toISOString() });
        await save(db);
        return summarizeCard(card, now());
      });
    },

    // 试磨评分或沉淀更正后，关联卡立即失效（含已完成卡），旧读数保留可查。
    async invalidateForItem(itemCode, reason) {
      return exclusive(async () => {
        const db = await load();
        const at = now().toISOString();
        let invalidated = 0;
        for (const card of db.cards) {
          if (card.itemCode === itemCode && !card.invalidatedAt) {
            card.invalidatedAt = at;
            card.invalidReason = reason;
            invalidated += 1;
          }
        }
        if (invalidated) await save(db);
        return invalidated;
      });
    },

    // 单卡查询：已失效的卡也能查到旧读数。
    async get(cardId) {
      const db = await load();
      const card = findCard(db, cardId);
      if (!card) throw new HttpError(404, "card_not_found", "耐久卡不存在");
      return summarizeCard(card, now());
    },

    async list() {
      const db = await load();
      const at = now();
      const cards = db.cards.map((c) => summarizeCard(c, at));
      return { cards, pendingSamples: db.pendingSamples, stats: computeStats(cards) };
    },
  };
}
