#!/usr/bin/env node
// 깍깍이 서버: 내 컴퓨터(127.0.0.1)에서만 열리는 작은 서버. 브라우저 화면에서 문자를 쓰면 솔라피로 보내줍니다.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeContacts, parseContactsFile } from './contacts-import.js';
import { DEFAULT_PRICES, buildMessages, isMobile, isValidSender, normalizePhone } from './sms.js';
import { SolapiClient, describeStatus } from './solapi.js';
import { MAX_HISTORY, Store, makeId } from './store.js';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 빌드 번호: 업데이트할 때마다 package.json 의 build 끝자리를 1씩 올림 (1.0 → 1.1)
export const BUILD = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build;

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 연락처 파일 포함 최대 10MB
const MIN_SCHEDULE_MS = 3 * 60 * 1000; // 예약은 지금부터 3분 뒤부터
const MAX_SCHEDULE_MS = 180 * 24 * 60 * 60 * 1000; // 예약은 6개월 안쪽만 (솔라피 규칙)
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/icon.png': ['icon.png', 'image/png'],
  '/kkak.wav': ['kkak.wav', 'audio/wav'],
};

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RequestError('파일이 너무 커요 (최대 10MB).', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new RequestError('요청 형식이 올바르지 않습니다.');
  }
}

function hostnameOf(value) {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return '';
  }
}

// 다른 웹사이트가 몰래 깍깍이에게 문자를 보내게 하지 못하도록, 내 컴퓨터 주소로 온 요청만 받음
function isLocalRequest(req) {
  if (!LOCAL_HOSTS.includes(hostnameOf(req.headers.host || ''))) return false;
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !LOCAL_HOSTS.includes(hostnameOf(origin))) return false;
  return true;
}

function cleanGroups(groups) {
  const list = Array.isArray(groups) ? groups : String(groups || '').split(',');
  return [...new Set(list.map((g) => String(g).trim()).filter(Boolean))].slice(0, 30);
}

function cleanContact(body) {
  const name = String(body.name || '').trim().slice(0, 50);
  const phone = normalizePhone(body.phone);
  if (!name) throw new RequestError('이름을 넣어주세요.');
  if (!isMobile(phone)) throw new RequestError('휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)');
  return { name, phone, groups: cleanGroups(body.groups) };
}

function publicSettings(settings) {
  return {
    apiKey: settings.apiKey || '',
    hasSecret: Boolean(settings.apiSecret),
    sender: settings.sender || '',
    prices: { ...DEFAULT_PRICES, ...(settings.prices || {}) },
    configured: Boolean(settings.apiKey && settings.apiSecret && settings.sender),
  };
}

export function createServer({ dataDir = path.join(ROOT, 'data'), publicDir = path.join(ROOT, 'public'), makeSolapi = (s) => new SolapiClient(s), now = () => Date.now() } = {}) {
  const store = new Store(dataDir);

  async function solapi() {
    const settings = await store.read('settings');
    if (!settings.apiKey || !settings.apiSecret) throw new RequestError('아직 솔라피 열쇠가 없어요. ⚙️ 설정에서 솔라피 API 키와 시크릿을 넣어주세요.');
    return { client: makeSolapi({ apiKey: settings.apiKey, apiSecret: settings.apiSecret }), settings };
  }

  // 화면에서 고른 받는 사람(연락처 id + 직접 넣은 번호) → [{ name, phone }]
  async function resolveRecipients({ contactIds = [], extra = [] }) {
    const contacts = await store.read('contacts');
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const picked = contactIds.map((id) => byId.get(id)).filter(Boolean).map((c) => ({ name: c.name, phone: c.phone }));
    const typed = (Array.isArray(extra) ? extra : []).map((e) => ({ name: String(e.name || '').trim(), phone: e.phone }));
    return [...picked, ...typed];
  }

  async function plan(body) {
    const settings = await store.read('settings');
    const recipients = await resolveRecipients(body);
    const prices = { ...DEFAULT_PRICES, ...(settings.prices || {}) };
    const result = buildMessages({ text: body.text, subject: String(body.subject || '').trim(), recipients, prices });
    if (!String(body.text || '').trim()) result.problems.unshift('보낼 글을 써주세요.');
    if (!result.messages.length && !result.problems.length) result.problems.push('받는 사람을 골라주세요.');
    return { ...result, settings };
  }

  function checkSchedule(scheduledAt) {
    if (!scheduledAt) return null;
    const t = new Date(scheduledAt).getTime();
    if (!Number.isFinite(t)) throw new RequestError('예약 시각이 올바르지 않아요.');
    if (t < now() + MIN_SCHEDULE_MS) throw new RequestError('예약은 지금부터 3분 뒤부터 할 수 있어요. 바로 보내려면 예약을 꺼주세요.');
    if (t > now() + MAX_SCHEDULE_MS) throw new RequestError('예약은 6개월 안쪽으로만 할 수 있어요.');
    return new Date(t).toISOString();
  }

  async function updateHistory(id, change) {
    let found;
    await store.update('history', async (list) => {
      const entry = list.find((h) => h.id === id);
      if (!entry) throw new RequestError('보낸 기록을 찾지 못했어요.', 404);
      found = await change(entry);
      return list;
    });
    return found;
  }

  const routes = {
    'GET /api/status': async () => {
      const [settings, contacts, templates] = await Promise.all([store.read('settings'), store.read('contacts'), store.read('templates')]);
      return { build: BUILD, settings: publicSettings(settings), counts: { contacts: contacts.length, templates: templates.length } };
    },

    // ---- ⚙️ 설정 (시크릿은 화면에 다시 보여주지 않음) ----
    'GET /api/settings': async () => publicSettings(await store.read('settings')),
    'POST /api/settings': async (body) => {
      const settings = await store.update('settings', (s) => {
        const next = { ...s };
        if (body.apiKey !== undefined) next.apiKey = String(body.apiKey).trim();
        if (String(body.apiSecret || '').trim()) next.apiSecret = String(body.apiSecret).trim();
        if (body.sender !== undefined) {
          const sender = normalizePhone(body.sender);
          if (sender && !isValidSender(sender)) throw new RequestError('보내는 번호를 확인해 주세요. (예: 010-1234-5678)');
          next.sender = sender;
        }
        if (body.prices) {
          next.prices = {};
          for (const type of ['SMS', 'LMS']) {
            const v = Number(body.prices[type]);
            if (!Number.isFinite(v) || v < 0 || v > 1000) throw new RequestError('요금은 0~1000원 사이 숫자로 넣어주세요.');
            next.prices[type] = v;
          }
        }
        return next;
      });
      return publicSettings(settings);
    },
    'POST /api/solapi/check': async () => {
      const { client } = await solapi();
      return client.balance();
    },

    // ---- 📇 연락처 ----
    'GET /api/contacts': async () => ({ contacts: await store.read('contacts') }),
    'POST /api/contacts': async (body) => {
      const contact = { id: makeId(), ...cleanContact(body) };
      await store.update('contacts', (list) => {
        if (list.some((c) => c.phone === contact.phone)) throw new RequestError('이미 있는 번호예요.');
        return [...list, contact];
      });
      return { contact };
    },
    'PUT /api/contacts/:id': async (body, id) => {
      const fields = cleanContact(body);
      let contact;
      await store.update('contacts', (list) => {
        if (list.some((c) => c.phone === fields.phone && c.id !== id)) throw new RequestError('같은 번호의 다른 연락처가 있어요.');
        contact = list.find((c) => c.id === id);
        if (!contact) throw new RequestError('연락처를 찾지 못했어요.', 404);
        Object.assign(contact, fields);
        return list;
      });
      return { contact };
    },
    'POST /api/contacts/delete': async ({ ids = [] }) => {
      const remove = new Set(ids);
      const list = await store.update('contacts', (l) => l.filter((c) => !remove.has(c.id)));
      return { contacts: list };
    },
    'POST /api/contacts/import': async ({ text, filename }) => {
      if (!String(text || '').trim()) throw new RequestError('파일이 비어 있어요.');
      let incoming;
      try {
        incoming = parseContactsFile(text, filename);
      } catch (err) {
        throw new RequestError(err.message);
      }
      let result;
      await store.update('contacts', (list) => {
        const merged = mergeContacts(list, incoming, makeId);
        result = merged.result;
        return merged.contacts;
      });
      return result;
    },
    // 그룹 이름 바꾸기 / 그룹 지우기 (연락처는 그대로, 그룹 표시만 바뀜)
    'POST /api/groups/rename': async ({ from, to }) => {
      const name = String(to || '').trim();
      if (!name) throw new RequestError('새 그룹 이름을 넣어주세요.');
      await store.update('contacts', (list) => list.map((c) => ({ ...c, groups: cleanGroups(c.groups.map((g) => (g === from ? name : g))) })));
      return { ok: true };
    },
    'POST /api/groups/delete': async ({ name }) => {
      await store.update('contacts', (list) => list.map((c) => ({ ...c, groups: c.groups.filter((g) => g !== name) })));
      return { ok: true };
    },

    // ---- 📝 자주 쓰는 문구 ----
    'GET /api/templates': async () => ({ templates: await store.read('templates') }),
    'POST /api/templates': async ({ title, text }) => {
      if (!String(text || '').trim()) throw new RequestError('문구 내용을 넣어주세요.');
      const template = { id: makeId(), title: String(title || '').trim().slice(0, 40) || String(text).trim().split('\n')[0].slice(0, 20), text: String(text) };
      await store.update('templates', (list) => [template, ...list]);
      return { template };
    },
    'PUT /api/templates/:id': async ({ title, text }, id) => {
      if (!String(text || '').trim()) throw new RequestError('문구 내용을 넣어주세요.');
      let template;
      await store.update('templates', (list) => {
        template = list.find((t) => t.id === id);
        if (!template) throw new RequestError('문구를 찾지 못했어요.', 404);
        Object.assign(template, { title: String(title || '').trim().slice(0, 40) || template.title, text: String(text) });
        return list;
      });
      return { template };
    },
    'DELETE /api/templates/:id': async (_, id) => {
      await store.update('templates', (list) => list.filter((t) => t.id !== id));
      return { ok: true };
    },

    // ---- ✉️ 보내기 ----
    // 보내기 전 확인: 몇 명에게, 짧은/긴 문자, 예상 비용
    'POST /api/preview': async (body) => {
      const { messages, count, cost, problems, settings } = await plan(body);
      return { recipients: messages.length, count, cost, problems, sender: settings.sender || '', sample: messages[0] || null };
    },
    'POST /api/send': async (body) => {
      const { messages, count, cost, problems, settings } = await plan(body);
      if (problems.length) throw new RequestError(problems.join('\n'));
      if (!settings.sender) throw new RequestError('보내는 번호(내 휴대폰 번호)가 없어요. ⚙️ 설정에서 넣어주세요.');
      const scheduledAt = checkSchedule(body.scheduledAt);
      const { client } = await solapi();
      const subject = String(body.subject || '').trim();
      const sent = await client.send({ from: settings.sender, messages, subject, scheduledAt });
      const failedBy = new Map(sent.failed.map((f) => [normalizePhone(f.phone), f.reason]));
      const entry = {
        id: makeId(),
        time: new Date(now()).toISOString(),
        scheduledAt,
        groupId: sent.groupId,
        text: String(body.text),
        subject,
        count,
        cost,
        state: failedBy.size === messages.length ? 'failed' : scheduledAt ? 'scheduled' : 'sent',
        recipients: messages.map((m) => {
          const reason = failedBy.get(m.phone);
          return { name: m.name, phone: m.phone, type: m.type, state: reason ? 'err' : 'pending', note: reason ? `접수 실패: ${reason}` : scheduledAt ? '예약됨' : '보내는 중' };
        }),
      };
      await store.update('history', (list) => [entry, ...list].slice(0, MAX_HISTORY));
      return { entry };
    },

    // ---- 🕘 보낸 기록 ----
    'GET /api/history': async () => ({ history: await store.read('history') }),
    // 솔라피에 물어봐서 잘 받았는지 새로 확인
    'POST /api/history/:id/refresh': async (_, id) => {
      const history = await store.read('history');
      const target = history.find((h) => h.id === id);
      if (!target) throw new RequestError('보낸 기록을 찾지 못했어요.', 404);
      if (!target.groupId || target.state === 'cancelled') return { entry: target };
      const { client } = await solapi();
      const statuses = await client.groupMessages(target.groupId);
      const byPhone = new Map(statuses.map((s) => [normalizePhone(s.phone), s]));
      const entry = await updateHistory(id, (h) => {
        for (const r of h.recipients) {
          const s = byPhone.get(r.phone);
          if (!s || r.note?.startsWith('접수 실패')) continue;
          const d = describeStatus(s.statusCode, s.reason);
          if (h.state === 'scheduled' && d.state === 'pending') continue; // 아직 예약 시각 전
          r.state = d.state;
          r.note = d.text;
        }
        if (h.state === 'scheduled' && h.recipients.some((r) => r.state !== 'pending')) h.state = 'sent';
        h.checkedAt = new Date(now()).toISOString();
        return h;
      });
      return { entry };
    },
    'POST /api/history/:id/cancel': async (_, id) => {
      const history = await store.read('history');
      const target = history.find((h) => h.id === id);
      if (!target) throw new RequestError('보낸 기록을 찾지 못했어요.', 404);
      if (target.state !== 'scheduled') throw new RequestError('예약된 문자만 취소할 수 있어요.');
      if (new Date(target.scheduledAt).getTime() <= now()) throw new RequestError('이미 보낼 시각이 지났어요.');
      const { client } = await solapi();
      await client.cancelSchedule(target.groupId);
      const entry = await updateHistory(id, (h) => {
        h.state = 'cancelled';
        for (const r of h.recipients) if (r.state === 'pending') r.note = '예약 취소됨';
        return h;
      });
      return { entry };
    },
    'POST /api/history/delete': async ({ ids }) => {
      const remove = Array.isArray(ids) ? new Set(ids) : null; // ids 가 없으면 모두 지움
      const list = await store.update('history', (l) => (remove ? l.filter((h) => !remove.has(h.id)) : []));
      return { history: list };
    },
  };

  function findRoute(method, pathname) {
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ');
      if (m !== method) continue;
      const re = new RegExp('^' + pattern.replace(':id', '([\\w-]+)') + '$');
      const match = pathname.match(re);
      if (match) return [handler, match[1]];
    }
    return null;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!isLocalRequest(req)) return sendJson(res, 403, { error: '깍깍이는 내 컴퓨터에서만 쓸 수 있어요.' });

      const file = req.method === 'GET' && STATIC[url.pathname];
      if (file) {
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        return res.end(await readFile(path.join(publicDir, file[0])));
      }

      const route = url.pathname.startsWith('/api/') && findRoute(req.method, url.pathname);
      if (!route) return sendJson(res, 404, { error: '없는 경로입니다.' });
      const body = req.method === 'GET' ? {} : await readJson(req);
      return sendJson(res, 200, await route[0](body, route[1]));
    } catch (err) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      if (!err.status) console.error(err);
      return sendJson(res, status, { error: err.message || '서버 오류가 발생했습니다.' });
    }
  });
}

// start.bat 으로 켰을 때만 크롬을 앱 창으로 열어줌
function openBrowser(address) {
  if (process.env.OPEN_BROWSER !== '1') return;
  const chrome = findChrome();
  const opener = chrome ? [chrome, [`--app=${address}`, '--window-size=1100,800']]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]]
    : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function findChrome() {
  const dirs = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === 'win32'
    ? [
        ...dirs.map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')),
        ...dirs.map((dir) => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe')), // 크롬이 없으면 엣지
      ]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : [];
  return candidates.find((file) => existsSync(file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3001; // 재잘이(3000)와 같이 켜도 되게 3001
  const host = '127.0.0.1'; // 내 컴퓨터에서만 열림
  const address = `http://${host}:${port}`;
  const server = createServer();
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.log(`깍깍이가 이미 켜져 있어요. ${address} 을(를) 엽니다.`);
    openBrowser(address);
    process.exit(0);
  });
  server.listen(port, host, () => {
    console.log(`깍깍이 (빌드 ${BUILD}) 실행 중: ${address}`);
    console.log('이 창을 닫으면 깍깍이도 꺼집니다.');
    openBrowser(address);
  });
}
