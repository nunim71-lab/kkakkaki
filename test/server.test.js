import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

const NOW = Date.parse('2026-11-10T03:00:00Z');

async function start(t, fake = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kkak-'));
  const publicDir = path.join(dataDir, 'public');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>깍깍이</h1>');
  const sent = [];
  const solapi = {
    balance: async () => ({ balance: 5000, point: 0 }),
    send: async (req) => { sent.push(req); return { groupId: 'G1', status: 'PENDING', failed: fake.failed || [], accepted: [] }; },
    groupMessages: async () => fake.statuses || [],
    cancelSchedule: async (id) => { sent.push({ cancel: id }); },
  };
  const server = createServer({ dataDir, publicDir, makeSolapi: () => solapi, now: () => NOW });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const api = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { api, base, sent };
}

async function setup(api) {
  await api('POST', '/api/settings', { apiKey: 'K', apiSecret: 'S', sender: '010-9999-8888' });
  const a = await api('POST', '/api/contacts', { name: '영희', phone: '010-1111-2222', groups: '가족, 동창' });
  const b = await api('POST', '/api/contacts', { name: '철수', phone: '01033334444', groups: ['가족'] });
  return [a.data.contact.id, b.data.contact.id];
}

test('화면이 열리고, 다른 사이트에서 온 요청은 막음', async (t) => {
  const { api, base } = await start(t);
  assert.match(await (await fetch(base + '/')).text(), /깍깍이/);
  assert.equal((await api('POST', '/api/send', {}, { Origin: 'https://evil.example' })).status, 403);
  const status = await api('GET', '/api/status');
  assert.equal(status.data.build, '1.0');
  assert.equal(status.data.settings.configured, false);
});

test('설정: 시크릿은 다시 보여주지 않고, 빈칸이면 예전 것을 유지', async (t) => {
  const { api } = await start(t);
  await api('POST', '/api/settings', { apiKey: 'K', apiSecret: 'S', sender: '010-9999-8888', prices: { SMS: 18, LMS: 45 } });
  const r = await api('POST', '/api/settings', { apiKey: 'K2', apiSecret: '' });
  assert.deepEqual(r.data, { apiKey: 'K2', hasSecret: true, sender: '01099998888', prices: { SMS: 18, LMS: 45 }, configured: true });
  assert.equal((await api('POST', '/api/settings', { sender: '123' })).status, 400);
  assert.deepEqual((await api('POST', '/api/solapi/check')).data, { balance: 5000, point: 0 });
});

test('연락처: 추가·같은 번호 막기·고치기·지우기·그룹 이름 바꾸기', async (t) => {
  const { api } = await start(t);
  const [a] = await setup(api);
  assert.equal((await api('POST', '/api/contacts', { name: '또', phone: '01011112222' })).status, 400);
  assert.equal((await api('POST', '/api/contacts', { name: '집', phone: '02-123-4567' })).status, 400);
  await api('PUT', `/api/contacts/${a}`, { name: '김영희', phone: '01011112222', groups: ['가족'] });
  await api('POST', '/api/groups/rename', { from: '가족', to: '우리 가족' });
  let { contacts } = (await api('GET', '/api/contacts')).data;
  assert.deepEqual(contacts.map((c) => [c.name, c.groups]), [['김영희', ['우리 가족']], ['철수', ['우리 가족']]]);
  await api('POST', '/api/contacts/delete', { ids: [a] });
  ({ contacts } = (await api('GET', '/api/contacts')).data);
  assert.equal(contacts.length, 1);
});

test('구글 연락처 파일 가져오기', async (t) => {
  const { api } = await start(t);
  await setup(api);
  const text = 'First Name,Last Name,Phone 1 - Label,Phone 1 - Value,Labels\n영희,김,Mobile,010-1111-2222,모임 ::: * myContacts\n민지,박,Mobile,010-5555-6666,모임\n';
  const r = await api('POST', '/api/contacts/import', { text, filename: 'contacts.csv' });
  assert.deepEqual(r.data, { added: 1, updated: 1, same: 0, skipped: [] });
});

test('문구 저장·고치기·지우기', async (t) => {
  const { api } = await start(t);
  const { template } = (await api('POST', '/api/templates', { title: '모임', text: '{이름}님, 이번 주 모임 있어요!' })).data;
  await api('PUT', `/api/templates/${template.id}`, { title: '모임 안내', text: '바뀐 글' });
  assert.deepEqual((await api('GET', '/api/templates')).data.templates.map((x) => [x.title, x.text]), [['모임 안내', '바뀐 글']]);
  await api('DELETE', `/api/templates/${template.id}`);
  assert.equal((await api('GET', '/api/templates')).data.templates.length, 0);
});

test('보내기 전 확인 → 보내기 → 기록 → 상태 확인', async (t) => {
  const fake = { statuses: [{ phone: '01011112222', statusCode: '4000' }, { phone: '01033334444', statusCode: '3059', reason: '변작 의심' }] };
  const { api, sent } = await start(t, fake);
  const ids = await setup(api);
  const body = { contactIds: ids, extra: [{ phone: '010-1111-2222' }], text: '{이름}님 안녕하세요' };
  const pv = await api('POST', '/api/preview', body);
  assert.deepEqual([pv.data.recipients, pv.data.count, pv.data.cost, pv.data.problems], [2, { SMS: 2, LMS: 0 }, 40, []]);
  assert.equal(pv.data.sample.text, '영희님 안녕하세요');

  const { entry } = (await api('POST', '/api/send', body)).data;
  assert.equal(sent[0].from, '01099998888');
  assert.deepEqual(sent[0].messages.map((m) => m.text), ['영희님 안녕하세요', '철수님 안녕하세요']);
  assert.equal(sent[0].scheduledAt, null);
  assert.equal(entry.state, 'sent');

  const r = await api('POST', `/api/history/${entry.id}/refresh`);
  assert.deepEqual(r.data.entry.recipients.map((x) => [x.name, x.state, x.note]), [['영희', 'ok', '받음'], ['철수', 'err', '실패: 변작 의심']]);
});

test('보낼 수 없는 경우는 이유를 알려줌', async (t) => {
  const { api } = await start(t);
  assert.match((await api('POST', '/api/send', { text: '안녕', extra: [{ phone: '01011112222' }] })).data.error, /보내는 번호/);
  await setup(api);
  assert.match((await api('POST', '/api/send', { text: '', contactIds: [] })).data.error, /글을 써주세요/);
  assert.match((await api('POST', '/api/send', { text: '안녕', extra: [{ phone: '02-111-2222', name: '집' }] })).data.error, /휴대폰 번호가 아니에요/);
});

test('예약 보내기와 예약 취소', async (t) => {
  const { api, sent } = await start(t);
  const ids = await setup(api);
  const soon = new Date(NOW + 60 * 1000).toISOString();
  assert.match((await api('POST', '/api/send', { contactIds: ids, text: '안녕', scheduledAt: soon })).data.error, /3분 뒤/);
  const at = new Date(NOW + 24 * 3600 * 1000).toISOString();
  const { entry } = (await api('POST', '/api/send', { contactIds: ids, text: '안녕', scheduledAt: at })).data;
  assert.equal(sent[0].scheduledAt, at);
  assert.equal(entry.state, 'scheduled');
  const c = await api('POST', `/api/history/${entry.id}/cancel`);
  assert.equal(c.data.entry.state, 'cancelled');
  assert.deepEqual(sent[1], { cancel: 'G1' });
  assert.equal((await api('POST', `/api/history/${entry.id}/cancel`)).status, 400);
});
