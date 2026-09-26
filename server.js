// HTTP 路由层：把请求分派给取样规则 / 档案保存 / 页面操作，自身不含业务规则。
import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDurabilityArchive, HttpError } from "./src/durability-archive.js";
import { page } from "./src/page.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = join(__dirname, "data", "ink-stick-testing.json");
const defaultArchivePath = join(__dirname, "data", "durability-cards.json");
const port = Number(process.env.PORT || 3037);

const seed = {
  "items": [
    {
      "code": "IS-001",
      "smokeSource": "黄山松烟",
      "glueRatio": "7.5%",
      "ageYears": 8,
      "storage": "恒湿柜B",
      "status": "已试磨",
      "score": 86,
      "sediment": "无",
      "logs": [
        { "at": "2026-06-11", "step": "试磨", "note": "宣纸20滴水，出墨快，评分86", "score": 86 }
      ]
    },
    {
      "code": "IS-002",
      "smokeSource": "桐油烟",
      "glueRatio": "8%",
      "ageYears": 3,
      "storage": "试样盒C",
      "status": "待试磨",
      "logs": []
    }
  ]
};
const statLabels = ["待试磨", "已试磨", "重点观察"];

// 演示用耐久卡种子：日期相对当前时间，覆盖待读数 / 已完成 / 已失效 / 留待取样。
function demoArchiveSeed() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  return {
    cards: [
      { id: "DC-seed-1", sampleCode: "IS-001-R1", itemCode: "IS-001", weightGrams: 5.2, sampler: "赵一", moldy: false, chamber: "潮箱", filedAt: iso(now - 8 * day), readings: [], invalidatedAt: null, invalidReason: null },
      { id: "DC-seed-2", sampleCode: "IS-001-R2", itemCode: "IS-001", weightGrams: 4.1, sampler: "赵一", moldy: false, chamber: "潮箱", filedAt: iso(now - 16 * day), readings: [
        { day: 7, reader: "钱二", colorDiff: 0.9, peeling: false, normal: true, at: iso(now - 9 * day) }
      ], invalidatedAt: null, invalidReason: null },
      { id: "DC-seed-3", sampleCode: "IS-002-R1", itemCode: "IS-002", weightGrams: 6.0, sampler: "孙三", moldy: false, chamber: "潮箱", filedAt: iso(now - 20 * day), readings: [
        { day: 7, reader: "钱二", colorDiff: 0.7, peeling: false, normal: true, at: iso(now - 13 * day) },
        { day: 14, reader: "李四", colorDiff: 1.1, peeling: false, normal: true, at: iso(now - 6 * day) }
      ], invalidatedAt: null, invalidReason: null },
      { id: "DC-seed-4", sampleCode: "IS-002-R2", itemCode: "IS-002", weightGrams: 3.8, sampler: "孙三", moldy: false, chamber: "潮箱", filedAt: iso(now - 20 * day), readings: [
        { day: 7, reader: "钱二", colorDiff: 1.2, peeling: false, normal: true, at: iso(now - 13 * day) },
        { day: 14, reader: "周五", colorDiff: 3.4, peeling: true, normal: false, at: iso(now - 6 * day) }
      ], invalidatedAt: null, invalidReason: null },
      { id: "DC-seed-5", sampleCode: "IS-001-R0", itemCode: "IS-001", weightGrams: 4.6, sampler: "赵一", moldy: false, chamber: "潮箱", filedAt: iso(now - 30 * day), readings: [
        { day: 7, reader: "钱二", colorDiff: 0.8, peeling: false, normal: true, at: iso(now - 23 * day) }
      ], invalidatedAt: iso(now - 2 * day), invalidReason: "试磨更正：评分 86→82" }
    ],
    pendingSamples: [
      { sampleCode: "IS-002-R3", itemCode: "IS-002", weightGrams: 2.4, sampler: "孙三", moldy: false, heldAt: iso(now - 1 * day), reason: "余墨不足3克，留待取样" }
    ]
  };
}

export async function createApp({ dbPath = defaultDbPath, archivePath = defaultArchivePath, now, seedArchive } = {}) {
  async function loadDb() {
    if (!existsSync(dbPath)) {
      await mkdir(dirname(dbPath), { recursive: true });
      await writeFile(dbPath, JSON.stringify(seed, null, 2));
    }
    return JSON.parse(await readFile(dbPath, "utf8"));
  }
  async function saveDb(db) {
    const tmp = dbPath + "." + process.pid + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, dbPath);
  }
  if (seedArchive && !existsSync(archivePath)) {
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, JSON.stringify(seedArchive, null, 2));
  }
  const archive = createDurabilityArchive({ filePath: archivePath, now });

  async function body(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  }
  function send(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data, null, 2));
  }
  function summarize(item) {
    const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
    return { ...item, logCount };
  }
  function findItem(db, id) {
    return db.items.find((x) => x.id === id || x.code === id);
  }
  // 当前试磨结论：以 item.score / item.sediment 为准，兼容旧数据里的 tests 与 logs。
  function currentTrial(item) {
    const lastTest = (item.tests || []).at(-1);
    const logScore = [...(item.logs || [])].reverse().find((l) => l.score !== undefined)?.score;
    const score = item.score ?? lastTest?.score ?? logScore;
    const sediment = item.sediment ?? lastTest?.sediment;
    return { recorded: score !== undefined || sediment !== undefined, score, sediment };
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const db = await loadDb();
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page());
      }
      if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
      if (req.method === "POST" && url.pathname === "/api/items") {
        const input = await body(req);
        const item = { id: "IS-" + Date.now(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建墨锭" }] };
        db.items.unshift(item);
        await saveDb(db);
        return send(res, 201, item);
      }
      const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
      if (patch && req.method === "PATCH") {
        const item = findItem(db, patch[1]);
        if (!item) return send(res, 404, { error: "item_not_found" });
        Object.assign(item, await body(req));
        item.logs ||= [];
        item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
        await saveDb(db);
        return send(res, 200, item);
      }
      const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
      if (log && req.method === "POST") {
        const item = findItem(db, log[1]);
        if (!item) return send(res, 404, { error: "item_not_found" });
        const input = await body(req);
        item.logs ||= [];
        item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
        await saveDb(db);
        return send(res, 201, item);
      }
      const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
      if (action && req.method === "POST") {
        const item = findItem(db, action[1]);
        if (!item) return send(res, 404, { error: "item_not_found" });
        const input = await body(req);
        item.logs ||= [];
        const score = Number(input.score || 0);
        item.tests ||= [];
        item.tests.push({ at: new Date().toISOString(), ...input, score });
        item.score = score;
        if (input.sediment !== undefined && input.sediment !== "") item.sediment = input.sediment;
        item.status = score >= 85 ? "已试磨" : "重点观察";
        item.logs.push({ at: new Date().toISOString(), step: "试磨", note: (input.paper || "试纸") + "，评分" + score, score });
        await saveDb(db);
        return send(res, 201, item);
      }
      // 更正原试磨评分或沉淀：关联耐久卡立即失效并移出统计，旧读数保留可查。
      const correction = url.pathname.match(/^\/api\/items\/([^/]+)\/correction$/);
      if (correction && req.method === "POST") {
        const item = findItem(db, correction[1]);
        if (!item) return send(res, 404, { error: "item_not_found" });
        const input = await body(req);
        const hasScore = input.score !== undefined && String(input.score).trim() !== "";
        const hasSediment = input.sediment !== undefined && String(input.sediment).trim() !== "";
        if (!hasScore && !hasSediment) return send(res, 400, { error: "no_change", message: "请提供要更正的评分或沉淀情况" });
        const current = currentTrial(item);
        if (!current.recorded) return send(res, 422, { error: "no_trial_record", message: "该墨锭尚无试磨记录，无法更正" });
        const nextScore = hasScore ? Number(input.score) : current.score;
        if (hasScore && !Number.isFinite(nextScore)) return send(res, 400, { error: "invalid_score", message: "评分需为数字" });
        const nextSediment = hasSediment ? String(input.sediment).trim() : current.sediment;
        const changes = [];
        if (nextScore !== current.score) changes.push(`评分 ${current.score ?? "未记录"}→${nextScore}`);
        if (nextSediment !== current.sediment) changes.push(`沉淀 ${current.sediment ?? "未记录"}→${nextSediment}`);
        if (!changes.length) return send(res, 400, { error: "no_change", message: "更正内容与原记录一致" });
        const reason = "试磨更正：" + changes.join("，");
        const invalidated = await archive.invalidateForItem(item.code, reason); // 先失效卡再落更正，不留半截
        item.score = nextScore;
        item.sediment = nextSediment;
        if ((item.tests || []).length) Object.assign(item.tests.at(-1), { score: nextScore, sediment: nextSediment });
        if (nextScore !== undefined) item.status = nextScore >= 85 ? "已试磨" : "重点观察";
        item.logs ||= [];
        item.logs.push({ at: new Date().toISOString(), step: "更正", note: reason + (input.corrector ? `（更正人：${input.corrector}）` : "") + (input.note ? `。${input.note}` : ""), score: nextScore });
        await saveDb(db);
        return send(res, 200, { item, invalidated });
      }
      // 潮箱耐久卡
      if (req.method === "GET" && url.pathname === "/api/durability") return send(res, 200, await archive.list());
      if (req.method === "POST" && url.pathname === "/api/durability/cards") {
        const result = await archive.fileSample(await body(req));
        return send(res, result.held ? 200 : 201, result);
      }
      const reading = url.pathname.match(/^\/api\/durability\/cards\/([^/]+)\/readings$/);
      if (reading && req.method === "POST") {
        return send(res, 201, await archive.addReading(decodeURIComponent(reading[1]), await body(req)));
      }
      const cardGet = url.pathname.match(/^\/api\/durability\/cards\/([^/]+)$/);
      if (cardGet && req.method === "GET") return send(res, 200, await archive.get(decodeURIComponent(cardGet[1])));
      if (req.method === "GET" && url.pathname === "/api/stats") {
        const stats = Object.fromEntries(statLabels.map((label) => [label, 0]));
        for (const item of db.items) if (stats[item.status] !== undefined) stats[item.status] += 1;
        return send(res, 200, stats);
      }
      send(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.code, message: error.message });
      send(res, 500, { error: error.message });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = await createApp({ seedArchive: demoArchiveSeed() });
  server.listen(port, () => console.log("墨锭试磨室 listening on http://localhost:" + port));
}
