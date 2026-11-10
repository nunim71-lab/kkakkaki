import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, byteLength, formatPhone, hasRiskyChars, isMobile, messageType, normalizePhone, personalize } from '../src/sms.js';

test('한글은 2바이트, 영어·숫자는 1바이트', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('가나다'), 6);
  assert.equal(byteLength('안녕 hi\n'), 8);
});

test('90바이트까지는 짧은 문자, 넘으면 긴 문자', () => {
  assert.equal(messageType('가'.repeat(45)), 'SMS');
  assert.equal(messageType('가'.repeat(46)), 'LMS');
});

test('{이름} 을 사람마다 바꿔 넣음', () => {
  assert.equal(personalize('{이름}님 안녕하세요, {이름}님!', { name: '영희' }), '영희님 안녕하세요, 영희님!');
  assert.equal(personalize('안녕하세요', { name: '영희' }), '안녕하세요');
});

test('전화번호 정리', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone('+82 10-1234-5678'), '01012345678');
  assert.equal(formatPhone('01012345678'), '010-1234-5678');
  assert.ok(isMobile('010 1234 5678'));
  assert.ok(!isMobile('02-123-4567'));
});

test('이모지는 깨질 수 있다고 알려줌', () => {
  assert.ok(hasRiskyChars('안녕 😊'));
  assert.ok(!hasRiskyChars('안녕하세요!'));
});

test('받는 사람마다 문자·종류·비용 계산, 같은 번호는 한 번만, 휴대폰 아니면 알려줌', () => {
  const r = buildMessages({
    text: '{이름}님 ' + '가'.repeat(40),
    recipients: [
      { name: '영희', phone: '010-1111-2222' },
      { name: '남궁민수', phone: '01033334444' },
      { name: '영희 또', phone: '01011112222' },
      { name: '집', phone: '02-123-4567' },
    ],
    prices: { SMS: 20, LMS: 50 },
  });
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].text.startsWith('영희님 '), true);
  assert.equal(r.messages[0].type, 'SMS'); // 2+2+1+80 = 89 bytes... 영희(4)+님(2)+공백(1)+80 = 87
  assert.equal(r.messages[1].type, 'LMS'); // 남궁민수(8)+님(2)+공백(1)+80 = 91
  assert.deepEqual(r.count, { SMS: 1, LMS: 1 });
  assert.equal(r.cost, 70);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /집/);
});
