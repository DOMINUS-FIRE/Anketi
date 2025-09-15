ㅤ, [16.09.2025 1:00]
// netlify/functions/submit.js
// Node 18 runtime: есть глобальные fetch, FormData, Blob

const Busboy = require('busboy');

// ---- helpers ---------------------------------------------------------
function parseMultipart(event, { maxBytes = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = event.headers || {};
    // Netlify даёт заголовки в lowercase; Busboy ждёт 'content-type'
    if (!headers['content-type']) {
      return reject(new Error('Missing content-type header'));
    }

    const bb = Busboy({ headers });

    const fields = {};
    const files = {};
    let total = 0;

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', (d) => {
        total += d.length;
        if (total > maxBytes) {
          file.unpipe();
          bb.removeAllListeners();
          return reject(new Error('Payload too large'));
        }
        chunks.push(d);
      });
      file.on('end', () => {
        files[name] = {
          filename: info.filename || 'upload',
          mime: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
        };
      });
    });

    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    bb.end(body);
  });
}

function computeAgeText(dobISO) {
  try {
    const d = new Date(dobISO);
    if (Number.isNaN(d.getTime())) return dobISO || '—';
    const t = new Date();
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return ${dobISO} (${age} лет);
  } catch { return dobISO || '—'; }
}

function buildWeekly(fields) {
  const days = [['mon','Пн'],['tue','Вт'],['wed','Ср'],['thu','Чт'],['fri','Пт'],['sat','Сб'],['sun','Вс']];
  const lines = [];
  for (const [k, t] of days) {
    const st  = (fields[`${k}_status`] || '').trim();
    const hrs = (fields[`${k}_hours`]  || '').trim();
    const rsn = (fields[`${k}_reason`] || '').trim();
    if (st === 'can')      lines.push(`${t}: сможет ${hrs  '— (часы не указаны)'} — причина: ${rsn  'причина не указана'}`);
    else if (st === 'cant')lines.push(`${t}: не сможет — причина: ${rsn || 'причина не указана'}`);
    else                   lines.push(`${t}: не указано`);
  }
  return lines.join('\n');
}

async function resolveChatId(token, adminChatEnv) {
  if (adminChatEnv && /^\-?\d+$/.test(adminChatEnv)) return adminChatEnv; // числовой ID
  const username = (adminChatEnv || '').replace(/^@/, '');
  if (!username) return null;

  const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { method: 'GET' });
  const json = await resp.json().catch(() => ({}));
  if (!json.ok) return null;

  for (let i = json.result.length - 1; i >= 0; i--) {
    const m = json.result[i]?.message;
    if (m?.from?.username && m.from.username.toLowerCase() === username.toLowerCase()) {
      return String(m.chat.id);
    }
  }
  return null;
}

// ---- handler ---------------------------------------------------------
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
    }

    const BOT_TOKEN  = process.env.BOT_TOKEN;
    const ADMIN_CHAT = process.env.ADMIN_CHAT || '';

    if (!BOT_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'BOT_TOKEN is not set' }) };
    }

    const { fields, files } = await parseMultipart(event, { maxBytes: 10 * 1024 * 1024 });
    const dobAge  = computeAgeText(fields.dob_date || '');
    const weekly  = buildWeekly(fields);
    const caption =
      <b>Новая анкета (ЛЕГО СИТИ)</b>\n +
      1) ФИО: ${fields.full_name || ''}\n +
      2) Дата рождения (возраст): ${dobAge}\n +
      3) Телефон: ${fields.phone || ''}\n +

ㅤ, [16.09.2025 1:00]
4) Telegram: @${(fields.telegram || '').replace(/^@/, '')}\n +
      5) Адрес (факт): ${fields.address || ''}\n +
      6) Прописка: ${fields.passport_registration || ''}\n +
      7) Паспорт: ${(fields.passport_number || '').replace(/\s+/g,'')}\n +
      8) Кем выдан: ${fields.passport_issuer || ''}\n +
      9) Образование: ${fields.education || '—'}\n +
      10) Опыт:\n${fields.experience || '—'}\n\n +
      11) Навыки:\n${fields.skills || '—'}\n\n +
      12) Почему к нам:\n${fields.why_us || '—'}\n\n +
      13) График (по дням):\n${weekly};

    // чат
    const chatId = await resolveChatId(BOT_TOKEN, ADMIN_CHAT);
    if (!chatId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Не найден chat_id. Напишите боту /start с нужного аккаунта и попробуйте снова.' }) };
    }

    const photo = files.photo;
    if (photo && photo.buffer?.length) {
      // используем глобальный FormData/Blob
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      const blob = new Blob([photo.buffer], { type: photo.mime || 'application/octet-stream' });
      form.append('photo', blob, photo.filename || 'photo.jpg');

      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'sendPhoto failed');
    } else {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' })
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'sendMessage failed');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (e) {
    // важное улучшение: всегда отдаём JSON — тогда на странице увидишь нормальную ошибку
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) };
  }
};
