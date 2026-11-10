import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeContacts, parseContactsFile, parseCsv } from '../src/contacts-import.js';

test('따옴표·쉼표·줄바꿈이 들어간 CSV', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,"2\n3",4\n'), [['a', 'b,c', 'd "e"'], ['1', '2\n3', '4']]);
});

// 구글 연락처 "Google CSV" 내보내기 (2024년 이후 형식)
const NEW_CSV = '﻿First Name,Middle Name,Last Name,Nickname,Organization Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value,Labels\n'
  + '영희,,김,,,,,Home,02-123-4567,Mobile,010-1111-2222,가족 ::: * myContacts\n'
  + 'John,,Smith,,,,,Mobile,+82 10-3333-4444,,,동창 ::: 모임 ::: * starred\n'
  + '집전화만,,,,,,,Home,031-555-6666,,,* myContacts\n'
  + ',,,,솔라피 회사,,,Work,010-7777-8888 ::: 010-9999-0000,,,\n';

// 예전 형식
const OLD_CSV = 'Name,Given Name,Family Name,Group Membership,Phone 1 - Type,Phone 1 - Value\n'
  + '이철수,철수,이,* My Contacts ::: 동네,Mobile,010-2222-3333\n';

test('구글 CSV (새 형식): 이름 붙이기, 휴대폰 번호 고르기, 라벨 → 그룹', () => {
  const list = parseContactsFile(NEW_CSV, 'contacts.csv');
  assert.deepEqual(list[0], { name: '김영희', phone: '01011112222', groups: ['가족'] });
  assert.deepEqual(list[1], { name: 'John Smith', phone: '01033334444', groups: ['동창', '모임'] });
  assert.equal(list[2].phone, ''); // 집 전화는 문자를 못 받음
  assert.deepEqual(list[3], { name: '솔라피 회사', phone: '01077778888', groups: [] });
});

test('구글 CSV (예전 형식)', () => {
  assert.deepEqual(parseContactsFile(OLD_CSV, 'google.csv'), [{ name: '이철수', phone: '01022223333', groups: ['동네'] }]);
});

test('vCard', () => {
  const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:박민지\r\nN:박;민지;;;\r\nTEL;TYPE=HOME:02-111-2222\r\nTEL;TYPE=CELL:010-4444-5555\r\nCATEGORIES:가족,myContacts\r\nEND:VCARD\r\n'
    + 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:최;지우;;;\r\nitem1.TEL:010-6666-7777\r\nEND:VCARD\r\n';
  assert.deepEqual(parseContactsFile(vcf, 'contacts.vcf'), [
    { name: '박민지', phone: '01044445555', groups: ['가족'] },
    { name: '최지우', phone: '01066667777', groups: [] },
  ]);
});

test('구글 파일이 아니면 알려줌', () => {
  assert.throws(() => parseContactsFile('이름,번호\n영희,010\n', 'x.csv'), /Google CSV/);
});

test('합치기: 이미 있는 번호는 그룹만 더하고, 번호 없는 사람은 건너뜀', () => {
  let n = 0;
  const { contacts, result } = mergeContacts(
    [{ id: 'a', name: '영희', phone: '01011112222', groups: ['친구'] }],
    parseContactsFile(NEW_CSV),
    () => `new${++n}`,
  );
  assert.deepEqual(result, { added: 2, updated: 1, same: 0, skipped: ['집전화만'] });
  assert.deepEqual(contacts[0], { id: 'a', name: '영희', phone: '01011112222', groups: ['친구', '가족'] });
  assert.equal(contacts.length, 3);
});
