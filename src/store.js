// 깍깍이 저장소: 설정·연락처·문구·보낸 기록을 내 컴퓨터의 data/ 폴더에 JSON 파일로 저장
// data/ 폴더는 .gitignore 에 있어서 GitHub 에 절대 올라가지 않아요.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const makeId = () => randomBytes(6).toString('hex');

const DEFAULTS = {
  settings: {},
  contacts: [],
  templates: [],
  history: [],
};

export const MAX_HISTORY = 300;

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve(); // 저장이 겹치지 않게 한 줄로 세움
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  async read(name) {
    try {
      return JSON.parse(await readFile(this.file(name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(DEFAULTS[name]);
      throw new Error(`${name}.json 파일을 읽지 못했어요: ${err.message}`);
    }
  }

  async write(name, value) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(name)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, this.file(name)); // 저장 도중 꺼져도 파일이 깨지지 않게
  }

  // 읽고 → 고치고 → 저장을 한 번에 (동시에 두 번 고쳐도 안전)
  update(name, change) {
    const run = this.queue.then(async () => {
      const current = await this.read(name);
      const next = await change(current);
      await this.write(name, next);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
