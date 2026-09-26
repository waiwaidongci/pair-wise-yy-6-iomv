import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSampleIntake } from "../src/sampling-rules.js";
import { createDurabilityArchive } from "../src/durability-archive.js";
import { createApp } from "../server.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-09-01T08:00:00.000Z");

async function tempDir() {
  return mkdtemp(join(tmpdir(), "durability-"));
}

function makeArchive(dir, now) {
  return createDurabilityArchive({ filePath: join(dir, "cards.json"), now });
}

test("取样规则：不足三克或发霉留待取样，合格才建档", () => {
  assert.equal(evaluateSampleIntake({ weightGrams: 2.9, moldy: false }).fileable, false);
  assert.equal(evaluateSampleIntake({ weightGrams: 3, moldy: false }).fileable, true);
  assert.equal(evaluateSampleIntake({ weightGrams: 9, moldy: true }).fileable, false);
  assert.match(evaluateSampleIntake({ weightGrams: 1, moldy: false }).reason, /不足3克/);
});

test("建档：合格墨样占卡，不合格留待取样不占卡，补足后可再建档", async () => {
  const dir = await tempDir();
  try {
    const archive = makeArchive(dir, () => T0);
    const held = await archive.fileSample({ sampleCode: "S-1", itemCode: "IS-1", weightGrams: 2.1, sampler: "甲" });
    assert.equal(held.held, true);
    let list = await archive.list();
    assert.equal(list.cards.length, 0); // 不占卡
    assert.equal(list.pendingSamples.length, 1);

    const moldy = await archive.fileSample({ sampleCode: "S-2", weightGrams: 8, sampler: "甲", moldy: true });
    assert.equal(moldy.held, true);
    assert.match(moldy.sample.reason, /发霉/);

    const ok = await archive.fileSample({ sampleCode: "S-1", itemCode: "IS-1", weightGrams: 3.5, sampler: "甲" });
    assert.equal(ok.held, false);
    list = await archive.list();
    assert.equal(list.cards.length, 1);
    assert.equal(list.pendingSamples.length, 1); // S-1 已从留样移除，只剩 S-2
    assert.equal(list.pendingSamples[0].sampleCode, "S-2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("建档：并发重复建档只有一个成功，其余 409，记录不留半截", async () => {
  const dir = await tempDir();
  try {
    const archive = makeArchive(dir, () => T0);
    const attempts = Array.from({ length: 5 }, () => archive.fileSample({ sampleCode: "S-9", weightGrams: 5, sampler: "甲" }).then(
      (r) => ({ ok: true, r }),
      (e) => ({ ok: false, e }),
    ));
    const results = await Promise.all(attempts);
    assert.equal(results.filter((r) => r.ok).length, 1);
    const conflicts = results.filter((r) => !r.ok);
    assert.equal(conflicts.length, 4);
    assert.ok(conflicts.every((r) => r.e.status === 409 && r.e.code === "card_exists"));
    const saved = JSON.parse(await readFile(join(dir, "cards.json"), "utf8"));
    assert.equal(saved.cards.length, 1); // 落盘的只有一张完整卡
    assert.equal(saved.cards[0].sampleCode, "S-9");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("读数：满七天、满十四天各由不同人记录，两次正常才算耐久", async () => {
  const dir = await tempDir();
  try {
    let clock = T0;
    const archive = makeArchive(dir, () => clock);
    const { card } = await archive.fileSample({ sampleCode: "S-7", weightGrams: 6, sampler: "甲" });

    await assert.rejects(archive.addReading(card.id, { day: 7, reader: "乙", colorDiff: 0.5, peeling: false }), /未满7天/);

    clock = new Date(T0.getTime() + 7 * DAY);
    const after7 = await archive.addReading(card.id, { day: 7, reader: "乙", colorDiff: 0.5, peeling: false });
    assert.equal(after7.state, "待读数");
    await assert.rejects(archive.addReading(card.id, { day: 7, reader: "丙", colorDiff: 0.5, peeling: false }), (e) => e.status === 409);

    clock = new Date(T0.getTime() + 10 * DAY);
    await assert.rejects(archive.addReading(card.id, { day: 14, reader: "丙", colorDiff: 0.5, peeling: false }), /未满14天/);

    clock = new Date(T0.getTime() + 14 * DAY);
    await assert.rejects(archive.addReading(card.id, { day: 14, reader: "乙", colorDiff: 0.5, peeling: false }), /不同人/);

    const done = await archive.addReading(card.id, { day: 14, reader: "丙", colorDiff: 1.2, peeling: false });
    assert.equal(done.state, "已完成");
    assert.equal(done.result, "耐久");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("读数：任一次异常即不耐久；已失效的卡不能再记读数", async () => {
  const dir = await tempDir();
  try {
    let clock = T0;
    const archive = makeArchive(dir, () => clock);
    const { card } = await archive.fileSample({ sampleCode: "S-8", itemCode: "IS-9", weightGrams: 6, sampler: "甲" });
    clock = new Date(T0.getTime() + 7 * DAY);
    await archive.addReading(card.id, { day: 7, reader: "乙", colorDiff: 0.5, peeling: false });
    clock = new Date(T0.getTime() + 14 * DAY);
    const done = await archive.addReading(card.id, { day: 14, reader: "丙", colorDiff: 2.6, peeling: true });
    assert.equal(done.result, "不耐久");

    await archive.invalidateForItem("IS-9", "试磨更正：评分 90→80");
    await assert.rejects(archive.addReading(card.id, { day: 7, reader: "丁", colorDiff: 0.1, peeling: false }), (e) => e.status === 409 && e.code === "card_invalidated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("失效：更正后卡移出统计，旧读数仍能查", async () => {
  const dir = await tempDir();
  try {
    let clock = T0;
    const archive = makeArchive(dir, () => clock);
    const { card } = await archive.fileSample({ sampleCode: "S-10", itemCode: "IS-10", weightGrams: 6, sampler: "甲" });
    clock = new Date(T0.getTime() + 7 * DAY);
    await archive.addReading(card.id, { day: 7, reader: "乙", colorDiff: 0.5, peeling: false });

    const count = await archive.invalidateForItem("IS-10", "试磨更正：沉淀 无→少量");
    assert.equal(count, 1);

    const list = await archive.list();
    assert.equal(list.stats.待读数, 0); // 已失效不计入统计
    assert.equal(list.cards[0].state, "已失效");

    const got = await archive.get(card.id); // 旧读数仍能查
    assert.equal(got.state, "已失效");
    assert.equal(got.readings.length, 1);
    assert.equal(got.readings[0].reader, "乙");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP：并发建档 409、更正使卡失效且统计排除", async () => {
  const dir = await tempDir();
  const server = await createApp({
    dbPath: join(dir, "items.json"),
    archivePath: join(dir, "cards.json"),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, payload) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  try {
    // 并发重复建档 → 一个 201，其余 409
    const sample = { sampleCode: "IS-001-R1", itemCode: "IS-001", weightGrams: 5, sampler: "甲" };
    const resps = await Promise.all([post("/api/durability/cards", sample), post("/api/durability/cards", sample), post("/api/durability/cards", sample)]);
    const statuses = resps.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);

    // 不足三克 → 200 留待取样，不占卡
    const held = await post("/api/durability/cards", { sampleCode: "IS-001-R2", itemCode: "IS-001", weightGrams: 1.2, sampler: "甲" });
    assert.equal(held.status, 200);
    let dura = await (await fetch(base + "/api/durability")).json();
    assert.equal(dura.cards.length, 1);
    assert.equal(dura.pendingSamples.length, 1);

    // 更正试磨评分 → 关联卡立即失效并移出统计
    const fix = await post("/api/items/IS-001/correction", { score: 80, corrector: "质检员" });
    assert.equal(fix.status, 200);
    assert.equal((await fix.json()).invalidated, 1);
    dura = await (await fetch(base + "/api/durability")).json();
    assert.equal(dura.cards[0].state, "已失效");
    assert.equal(dura.stats.待读数, 0);

    // 旧读数仍能查
    const card = await (await fetch(base + "/api/durability/cards/IS-001-R1")).json();
    assert.equal(card.state, "已失效");
    assert.match(card.invalidReason, /评分 86→80/);

    // 无变化的更正 → 400
    const again = await post("/api/items/IS-001/correction", { score: 80 });
    assert.equal(again.status, 400);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
