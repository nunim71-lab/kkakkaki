// 구글 연락처에서 내보낸 파일(Google CSV 또는 vCard)을 읽어 연락처 목록으로 바꿈
import { isMobile, normalizePhone } from './sms.js';

// 따옴표·줄바꿈이 들어간 칸까지 처리하는 CSV 읽기
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const SPLIT = /\s*:::\s*/; // 구글은 한 칸에 여러 값을 " ::: " 로 이어 씀

// 구글 라벨 → 깍깍이 그룹 ("* myContacts", "* starred" 같은 구글 기본 라벨은 뺌)
function labelsToGroups(value) {
  return String(value || '').split(SPLIT).map((g) => g.trim()).filter((g) => g && !g.startsWith('*') && !/^(my ?contacts|starred)$/i.test(g));
}

function hasHangul(s) {
  return /[가-힣]/.test(s);
}

// 한글 이름은 성+이름 붙여서 (김 + 영희 → 김영희), 영어 이름은 띄어서
function joinName(first, middle, last) {
  const parts = [last, first, middle].map((p) => (p || '').trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.some(hasHangul)) return parts.join('');
  return [first, middle, last].map((p) => (p || '').trim()).filter(Boolean).join(' ');
}

// 휴대폰 번호를 하나 고름: "Mobile/휴대전화" 라벨 우선, 그다음 010으로 시작하는 번호
function pickMobile(phones) {
  const mobiles = phones.filter((p) => isMobile(p.value));
  const labeled = mobiles.find((p) => /mobile|cell|휴대|핸드폰/i.test(p.label || ''));
  return normalizePhone((labeled || mobiles[0])?.value || '');
}

export function parseGoogleCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const at = (row, name) => { const i = col(name); return i >= 0 ? row[i] || '' : ''; };
  const phoneCols = header
    .map((h, i) => [h.trim().match(/^Phone (\d+) - Value$/i), i])
    .filter(([m]) => m)
    .map(([m, i]) => ({ value: i, label: header.findIndex((h) => new RegExp(`^Phone ${m[1]} - (Label|Type)$`, 'i').test(h.trim())) }));
  if (!phoneCols.length) throw new Error('구글 연락처 파일이 아닌 것 같아요. 구글 연락처에서 "Google CSV" 형식으로 내보낸 파일을 골라주세요.');

  return rows.map((row) => {
    const name = (at(row, 'Name') || joinName(at(row, 'First Name') || at(row, 'Given Name'), at(row, 'Middle Name') || at(row, 'Additional Name'), at(row, 'Last Name') || at(row, 'Family Name'))
      || at(row, 'Nickname') || at(row, 'File As') || at(row, 'Organization Name') || at(row, 'Organization 1 - Name')).trim();
    const phones = phoneCols.flatMap(({ value, label }) => String(row[value] || '').split(SPLIT).map((v) => ({ value: v, label: label >= 0 ? row[label] : '' })));
    const groups = labelsToGroups(at(row, 'Labels') || at(row, 'Group Membership'));
    return { name, phone: pickMobile(phones), groups };
  });
}

// vCard(.vcf) 읽기: FN(이름), TEL(번호), CATEGORIES(라벨)
export function parseVcard(text) {
  const unfolded = String(text).replace(/^﻿/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/^BEGIN:VCARD$/im).slice(1);
  return cards.map((card) => {
    const lines = card.split('\n');
    const get = (key) => lines.filter((l) => l.toUpperCase().startsWith(key)).map((l) => ({ params: l.slice(0, l.indexOf(':')), value: l.slice(l.indexOf(':') + 1).replace(/\\,/g, ',').replace(/\\;/g, ';') }));
    let name = get('FN')[0]?.value?.trim() || '';
    if (!name) {
      const [last = '', first = '', middle = ''] = (get('N:')[0]?.value || get('N;')[0]?.value || '').split(';');
      name = joinName(first, middle, last);
    }
    const phones = [...get('TEL'), ...lines.filter((l) => /^item\d+\.TEL/i.test(l)).map((l) => ({ params: '', value: l.slice(l.indexOf(':') + 1) }))]
      .map((t) => ({ value: t.value, label: /CELL|MOBILE/i.test(t.params) ? 'mobile' : '' }));
    const groups = get('CATEGORIES').flatMap((c) => c.value.split(',')).map((g) => g.trim()).filter((g) => g && !/^(my ?contacts|starred)$/i.test(g));
    return { name, phone: pickMobile(phones), groups };
  });
}

export function parseContactsFile(text, filename = '') {
  if (/\.vcf$/i.test(filename) || /^﻿?BEGIN:VCARD/i.test(String(text).trimStart())) return parseVcard(text);
  return parseGoogleCsv(text);
}

// 가져온 연락처를 지금 목록에 합침: 이미 있는 번호는 새로 넣지 않고 그룹만 더함
export function mergeContacts(existing, incoming, makeId) {
  const contacts = existing.map((c) => ({ ...c, groups: [...(c.groups || [])] }));
  const byPhone = new Map(contacts.map((c) => [c.phone, c]));
  const result = { added: 0, updated: 0, same: 0, skipped: [] };
  for (const item of incoming) {
    if (!item.phone) {
      if (item.name) result.skipped.push(item.name);
      continue;
    }
    const found = byPhone.get(item.phone);
    if (found) {
      const newGroups = item.groups.filter((g) => !found.groups.includes(g));
      if (newGroups.length) { found.groups.push(...newGroups); result.updated++; } else result.same++;
      continue;
    }
    const contact = { id: makeId(), name: item.name || item.phone, phone: item.phone, groups: [...new Set(item.groups)] };
    contacts.push(contact);
    byPhone.set(contact.phone, contact);
    result.added++;
  }
  return { contacts, result };
}
