import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SolapiClient, authHeader, describeStatus } from '../src/solapi.js';

test('인증 헤더: HMAC-SHA256(날짜 + salt, 시크릿)', () => {
  const h = authHeader('KEY', 'SECRET', '2026-11-10T00:00:00.000Z', 'abc');
  const sig = createHmac('sha256', 'SECRET').update('2026-11-10T00:00:00.000Zabc').digest('hex');
  assert.equal(h, `HMAC-SHA256 apiKey=KEY, date=2026-11-10T00:00:00.000Z, salt=abc, signature=${sig}`);
  assert.match(authHeader('K', 'S'), /salt=[0-9a-zA-Z]{32}, /);
});

function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, json } = typeof reply === 'function' ? reply(url, init) : reply;
    return { ok: status < 400, status, text: async () => JSON.stringify(json) };
  };
  fn.calls = calls;
  return fn;
}

test('여러 명에게 보내기 + 예약', async () => {
  const fetchImpl = fakeFetch({ json: {
    groupInfo: { groupId: 'G1', status: 'SCHEDULED' },
    failedMessageList: [{ to: '01033334444', statusCode: '1062', statusMessage: '수신번호 형식 오류' }],
    messageList: [{ messageId: 'M1', statusCode: '2000', statusMessage: '정상 접수' }],
  } });
  const client = new SolapiClient({ apiKey: 'K', apiSecret: 'S', fetchImpl });
  const r = await client.send({
    from: '01099998888',
    subject: '모임 안내',
    scheduledAt: '2026-11-15T00:00:00.000Z',
    messages: [{ phone: '01011112222', text: '안녕', type: 'SMS' }, { phone: '01033334444', text: '긴 글', type: 'LMS' }],
  });
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.solapi.com/messages/v4/send-many/detail');
  assert.equal(call.method, 'POST');
  assert.match(call.headers.Authorization, /^HMAC-SHA256 apiKey=K, /);
  assert.deepEqual(call.body.messages, [
    { to: '01011112222', from: '01099998888', text: '안녕', type: 'SMS' },
    { to: '01033334444', from: '01099998888', text: '긴 글', type: 'LMS', subject: '모임 안내' },
  ]);
  assert.equal(call.body.scheduledDate, '2026-11-15T00:00:00.000Z');
  assert.equal(r.groupId, 'G1');
  assert.deepEqual(r.failed, [{ phone: '01033334444', reason: '수신번호 형식 오류' }]);
});

test('오류는 쉬운 말로', async () => {
  const client = new SolapiClient({ apiKey: 'K', apiSecret: 'S', fetchImpl: fakeFetch({ status: 403, json: { errorCode: 'NotEnoughBalance', errorMessage: 'balance' } }) });
  await assert.rejects(client.balance(), /잔액이 부족/);
});

test('보낸 문자 상태 확인 · 예약 취소', async () => {
  const fetchImpl = fakeFetch((url, init) => (init.method === 'DELETE' ? { json: {} } : { json: { messageList: { M1: { messageId: 'M1', to: '01011112222', statusCode: '4000' } } } }));
  const client = new SolapiClient({ apiKey: 'K', apiSecret: 'S', fetchImpl });
  assert.deepEqual(await client.groupMessages('G1'), [{ messageId: 'M1', phone: '01011112222', statusCode: '4000', reason: '' }]);
  assert.equal(fetchImpl.calls[0].url, 'https://api.solapi.com/messages/v4/list?groupId=G1&limit=500');
  await client.cancelSchedule('G1');
  assert.equal(fetchImpl.calls[1].url, 'https://api.solapi.com/messages/v4/groups/G1/schedule');
  assert.equal(fetchImpl.calls[1].method, 'DELETE');
});

test('상태 번호 → 쉬운 말', () => {
  assert.equal(describeStatus('4000').state, 'ok');
  assert.equal(describeStatus('3000').state, 'pending');
  assert.equal(describeStatus('3059', '변작된 발신번호').text, '실패: 변작된 발신번호');
});
