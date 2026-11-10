// 솔라피(SOLAPI) 문자 발송 서비스와 이야기하는 부분
// 인증: HMAC-SHA256 (API 키 + 날짜 + 임의 글자(salt) + 서명). 키와 시크릿은 data/ 폴더에만 저장합니다.
import { createHmac, randomBytes } from 'node:crypto';

const BASE_URL = 'https://api.solapi.com';
const SALT_CHARS = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 솔라피가 돌려주는 오류를 쉬운 말로
const FRIENDLY_ERRORS = [
  [/SignatureDoesNotMatch|signature/i, 'API 시크릿이 맞지 않아요. ⚙️ 설정에서 솔라피 API 시크릿을 다시 확인해 주세요.'],
  [/InvalidApiKey|Invalid API ?Key/i, 'API 키가 맞지 않아요. ⚙️ 설정에서 솔라피 API 키를 다시 확인해 주세요.'],
  [/NotEnoughBalance|balance/i, '솔라피 잔액이 부족해요. 솔라피 홈페이지에서 충전해 주세요.'],
  [/sender|발신번호|SenderNumber/i, '보내는 번호가 솔라피에 등록되지 않았어요. 솔라피 홈페이지 → 발신번호 관리에서 내 번호를 등록해 주세요.'],
];

export function friendlyError(code, message) {
  const text = `${code || ''} ${message || ''}`;
  const hit = FRIENDLY_ERRORS.find(([re]) => re.test(text));
  return hit ? `${hit[1]} (${code || message})` : `솔라피 오류: ${message || code}`;
}

// 문자 상태 번호 → 쉬운 말
export function describeStatus(statusCode, reason = '') {
  const code = String(statusCode || '');
  if (code === '4000') return { state: 'ok', text: '받음' };
  if (code === '2000' || code === '3000' || !code) return { state: 'pending', text: '보내는 중' };
  return { state: 'err', text: reason ? `실패: ${reason}` : `실패 (${code})` };
}

export function authHeader(apiKey, apiSecret, date = new Date().toISOString(), salt = randomSalt()) {
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function randomSalt(size = 32) {
  const bytes = randomBytes(size);
  let s = '';
  for (const b of bytes) s += SALT_CHARS[b % SALT_CHARS.length];
  return s;
}

export class SolapiClient {
  constructor({ apiKey, apiSecret, fetchImpl = globalThis.fetch, baseUrl = BASE_URL }) {
    this.apiKey = String(apiKey || '').trim();
    this.apiSecret = String(apiSecret || '').trim();
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: authHeader(this.apiKey, this.apiSecret), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(`솔라피에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (${err.message})`);
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { errorMessage: text.slice(0, 200) }; }
    if (!res.ok) {
      const err = new Error(friendlyError(data.errorCode, data.errorMessage || `HTTP ${res.status}`));
      err.status = res.status >= 500 ? 502 : 400;
      throw err;
    }
    return data;
  }

  // 잔액 확인 (연결 확인용으로도 씀)
  async balance() {
    const data = await this.request('GET', '/cash/v1/balance');
    return { balance: Number(data.balance) || 0, point: Number(data.point) || 0 };
  }

  // 여러 명에게 보내기. scheduledAt 이 있으면 그 시각에 솔라피가 대신 보내줌 (내 컴퓨터가 꺼져 있어도 됨)
  async send({ from, messages, subject = '', scheduledAt }) {
    const body = {
      messages: messages.map((m) => ({
        to: m.phone,
        from,
        text: m.text,
        type: m.type,
        ...(m.type === 'LMS' && subject ? { subject } : {}),
      })),
      allowDuplicates: false,
      showMessageList: true,
      ...(scheduledAt ? { scheduledDate: new Date(scheduledAt).toISOString() } : {}),
    };
    const data = await this.request('POST', '/messages/v4/send-many/detail', body);
    const failed = (data.failedMessageList || []).map((f) => ({ phone: f.to, reason: f.statusMessage || f.statusCode }));
    const accepted = (data.messageList || []).map((m) => ({ messageId: m.messageId, statusCode: m.statusCode, statusMessage: m.statusMessage }));
    return { groupId: data.groupInfo?.groupId || '', status: data.groupInfo?.status || '', failed, accepted, raw: data };
  }

  // 한 번에 보낸 문자들이 잘 갔는지 확인
  async groupMessages(groupId) {
    const data = await this.request('GET', `/messages/v4/list?groupId=${encodeURIComponent(groupId)}&limit=500`);
    return Object.values(data.messageList || {}).map((m) => ({
      messageId: m.messageId,
      phone: Array.isArray(m.to) ? m.to[0] : m.to,
      statusCode: m.statusCode,
      reason: m.reason || m.statusMessage || '',
    }));
  }

  // 예약 취소
  async cancelSchedule(groupId) {
    await this.request('DELETE', `/messages/v4/groups/${encodeURIComponent(groupId)}/schedule`);
  }
}
