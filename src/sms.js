// 문자 길이·종류·비용 계산과 이름 넣기, 전화번호 정리
// 우리나라 문자는 한글 2바이트, 영어·숫자·기호 1바이트로 셉니다 (EUC-KR 기준).

export const SMS_MAX_BYTES = 90; // 짧은 문자(SMS): 90바이트 (한글 약 45자)
export const LMS_MAX_BYTES = 2000; // 긴 문자(LMS): 2000바이트 (한글 약 1000자)
export const SUBJECT_MAX_BYTES = 40; // 긴 문자 제목: 40바이트
export const NAME_TAG = '{이름}';

// 기본 예상 요금 (원). 실제 요금은 문자 서비스마다 다르니 설정에서 바꿀 수 있어요.
export const DEFAULT_PRICES = { SMS: 20, LMS: 50 };

export function byteLength(text) {
  let bytes = 0;
  for (const ch of String(text ?? '')) bytes += ch.codePointAt(0) <= 0x7f ? 1 : 2;
  return bytes;
}

// 이모지 등 휴대폰에서 깨질 수 있는 글자 (한글 문자 표준에 없는 글자)
export function hasRiskyChars(text) {
  return /\p{Extended_Pictographic}/u.test(String(text ?? ''));
}

export function messageType(text) {
  return byteLength(text) <= SMS_MAX_BYTES ? 'SMS' : 'LMS';
}

// "{이름}님 안녕하세요" → "영희님 안녕하세요"
export function personalize(text, contact = {}) {
  return String(text ?? '').split(NAME_TAG).join(String(contact.name ?? '').trim());
}

// 010-1234-5678, +82 10 1234 5678 → 01012345678
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) digits = '0' + digits.slice(2);
  return digits;
}

// 문자를 받을 수 있는 휴대폰 번호인지 (010, 011, 016, 017, 018, 019)
export function isMobile(phone) {
  return /^01[016789]\d{7,8}$/.test(normalizePhone(phone));
}

// 발신번호: 휴대폰·일반전화 모두 가능 (솔라피에 미리 등록해야 함)
export function isValidSender(phone) {
  return /^0\d{8,10}$/.test(normalizePhone(phone)) || /^1[5-9]\d{6}$/.test(normalizePhone(phone));
}

export function formatPhone(value) {
  const p = normalizePhone(value);
  if (/^01\d{9}$/.test(p)) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (/^01\d{8}$/.test(p)) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

// 받는 사람마다 이름을 넣은 문자를 만들고, 종류·바이트·예상 비용을 계산
export function buildMessages({ text, subject = '', recipients, prices = DEFAULT_PRICES }) {
  const problems = [];
  const seen = new Set();
  const messages = [];
  for (const r of recipients || []) {
    const phone = normalizePhone(r.phone);
    if (!isMobile(phone)) {
      problems.push(`${r.name || phone || '(빈칸)'}: 휴대폰 번호가 아니에요 (${r.phone || '번호 없음'})`);
      continue;
    }
    if (seen.has(phone)) continue; // 같은 번호에 두 번 보내지 않음
    seen.add(phone);
    const body = personalize(text, r);
    const bytes = byteLength(body);
    const type = bytes <= SMS_MAX_BYTES ? 'SMS' : 'LMS';
    if (bytes > LMS_MAX_BYTES) problems.push(`${r.name || formatPhone(phone)}: 글이 너무 길어요 (${bytes}/${LMS_MAX_BYTES}바이트)`);
    messages.push({ name: String(r.name || '').trim(), phone, text: body, bytes, type, price: Number(prices[type]) || 0 });
  }
  if (byteLength(subject) > SUBJECT_MAX_BYTES) problems.push(`제목이 너무 길어요 (${byteLength(subject)}/${SUBJECT_MAX_BYTES}바이트, 한글 약 20자)`);
  const count = { SMS: messages.filter((m) => m.type === 'SMS').length, LMS: messages.filter((m) => m.type === 'LMS').length };
  const cost = messages.reduce((sum, m) => sum + m.price, 0);
  return { messages, count, cost, problems };
}
