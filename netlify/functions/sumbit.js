ㅤ, [15.09.2025 21:26]
// netlify/functions/submit.js
// Node 18+, CommonJS
const Busboy = require('busboy');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

/** Разбор multipart/form-data в { fields, files } */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: event.headers });
    const fields = {};
    const files = {};

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
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

    // Netlify даёт body в base64, если бинарные данные
    const isBase64 = event.isBase64Encoded;
    const body = isBase64 ? Buffer.from(event.body || '', 'base64') : event.body;
    bb.end(body);
  });
}

function computeAgeText(dobISO) {
  try {
    const d = new Date(dobISO);
    if (Number.isNaN(d.getTime())) return dobISO;
    const t = new Date();
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return ${dobISO} (${age} лет);
  } catch {
    return dobISO;
  }
}

function buildWeekly(fields) {
  const days = [['mon','Пн'],['tue','Вт'],['wed','Ср'],['thu','Чт'],['fri','Пт'],['sat','Сб'],['sun','Вс']];
  const lines = [];
  for (const [k, t] of days) {
    const st = (fields[`${k}_status`] || '').trim();
    const hrs = (fields[`${k}_hours`]  || '').trim();
    const rsn = (fields[`${k}_reason`] || '').trim();
    if (st === 'can') {
      lines.push(`${t}: сможет ${hrs  '— (часы не указаны)'} — причина: ${rsn  'причина не указана'}`);
    } else if (st === 'cant') {
      lines.push(`${t}: не сможет — причина: ${rsn || 'причина не указана'}`);
    } else {
      lines.push(`${t}: не указано`);
    }
  }
  return lines.join('\n');
}

async function resolveChatId(token, adminChatEnv) {
  // Если задан числовой chat_id — используем его
  if (adminChatEnv && /^\-?\d+$/.test(adminChatEnv)) return adminChatEnv;

  // Если указан @username — пытаемся найти его в последних апдейтах (после /start)
  const username = (adminChatEnv || '').replace(/^@/, '');
  if (!username) return null;

  const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;           // ← добавишь в Netlify → Site settings → Environment variables
    const ADMIN_CHAT = process.env.ADMIN_CHAT || '';   // можно числовой id или @username (например @LegoCity43)

    if (!BOT_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'BOT_TOKEN is not set' }) };
    }

    const { fields, files } = await parseMultipart(event);
    const photo = files.photo; // файл из input name="photo"

    // текст анкеты
    const dobAge = computeAgeText(fields.dob_date || '');
    const weekly = buildWeekly(fields);

    const caption =
      <b>Новая анкета (ЛЕГО СИТИ)</b>\n +
      1) ФИО: ${fields.full_name || ''}\n +
      2) Дата рождения (возраст): ${dobAge}\n +
      3) Телефон: ${fields.phone || ''}\n +
      4) Telegram: @${(fields.telegram || '').replace(/^@/, '')}\n +
      5) Адрес (факт): ${fields.address || ''}\n +
      6) Прописка: ${fields.

ㅤ, [15.09.2025 21:26]
passport_registration || ''}\n +
      7) Паспорт: ${(fields.passport_number || '').replace(/\s+/g,'')}\n +
      8) Кем выдан: ${fields.passport_issuer || ''}\n +
      9) Образование: ${fields.education || '—'}\n +
      10) Опыт:\n${fields.experience || '—'}\n\n +
      11) Навыки:\n${fields.skills || '—'}\n\n +
      12) Почему к нам:\n${fields.why_us || '—'}\n\n +
      13) График (по дням):\n${weekly};

    // выясняем chat_id
    const chatId = await resolveChatId(BOT_TOKEN, ADMIN_CHAT);
    if (!chatId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Не найден chat_id. Напишите боту /start с аккаунта ADMIN_CHAT и повторите.' })
      };
    }

    // Отправка: если есть фото — sendPhoto, иначе sendMessage
    if (photo && photo.buffer?.length) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('photo', photo.buffer, { filename: photo.filename, contentType: photo.mime });

      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'sendPhoto failed');
    } else {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' })
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'sendMessage failed');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
