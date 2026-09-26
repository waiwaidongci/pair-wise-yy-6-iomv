// 档案保存层：JSON 落盘。
// 职责只有「读档案」与「串行改档案」两件事——所有写操作走同一把队锁，
// 读-校验-写在一个临界区内完成，并发建档不会产生双份或半截记录；
// 落盘先写临时文件再 rename，进程中断也不会留下写坏的 JSON。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "./seed.js";

export class JsonStore {
  constructor(path) {
    this.path = path;
    this.tail = Promise.resolve();
  }

  async #load() {
    if (!existsSync(this.path)) {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(seed, null, 2));
    }
    return JSON.parse(await readFile(this.path, "utf8"));
  }

  // 只读访问
  async read() {
    return this.#load();
  }

  // 串行化的读-改-写：fn 收到档案对象，返回值作为结果返回；
  // fn 抛错则不落盘，档案保持原状（页面与记录都不留半截）。
  mutate(fn) {
    const run = this.tail.then(async () => {
      const db = await this.#load();
      const result = await fn(db);
      const tmp = this.path + ".tmp";
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, this.path);
      return result;
    });
    // 队列本身不因单次业务失败而断裂
    this.tail = run.then(() => {}, () => {});
    return run;
  }
}
