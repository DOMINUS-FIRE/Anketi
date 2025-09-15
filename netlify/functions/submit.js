ㅤ, [16.09.2025 1:33]
// netlify/functions/submit.js
// Node 18 runtime: доступны глобальные fetch, FormData и Blob (через undici)
const Busboy = require('busboy');

// ---------- helpers ----------
function parseMultipart(event, maxBytes = 10 * 1024 * 1024) {
  // разбор multipart/form-data в { fields, files }
  return new Promise((resolve, reject) => {
    try {
      const headers = event && event.headers ? event.headers : {};
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
            try { file.unpipe(); } catch(_) {}
            return reject(new Error('Payload too large'));
          }
          chunks.push(d);
        });
        file.on('end', () => {
          files[name] = {
            filename: (info && info.filename) || 'upload',
            mime: (info && info.mimeType) || 'application/octet-stream',
            buffer: Buffer.concat(chunks)
          };
        });
      });

      bb.on('close', () => resolve({ fields, files }));
      bb.on('error', (e) => reject(e));

      const bodyBuf = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : Buffer.from(event.body || '', 'utf8');

      bb.end(bodyBuf);
    } catch (e) {
      reject(e);
    }
  });
}

function computeAgeText(dobISO) {
  try {
    if (!dobISO) return '—';
    const d = new Date(dobISO);
    if (isNaN(d.getTime())) return dobISO;
    const t = new Date();
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return ${dobISO} (${age} лет);
  } catch {
    return dobISO || '—';
  }
}

function buildWeekly(fields) {
  const days = [
    ['mon','Пн'],['tue','Вт'],['wed','Ср'],
    ['thu','Чт'],['fri','Пт'],['sat','Сб'],['sun','Вс']
  ];
  const lines = [];
  for (let i=0;i<days.length;i++) {
    const k = days[i][0], t = days[i][1];
    const st  = (fields[k + '_status'] || '').trim();
    const hrs = (fields[k + '_hours']  || '').trim();
    const rsn = (fields[k + '_reason'] || '').trim();
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
  // если ADMIN_CHAT — число (chat_id), используем его
  if (adminChatEnv && /^-?\d+$/.test(adminChatEnv)) return adminChatEnv;
  // если @username — пробуем найти его в getUpdates (нужно заранее написать боту /start)
  const username = (adminChatEnv || '').replace(/^@/, '');
  if (!username) return null;

  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const j = await r.json().catch(() => ({}));
  if (!j || !j.ok) return null;

  for (let i = j.result.length - 1; i >= 0; i--) {
    const m = j.result[i] && j.result[i].message;
    if (m && m.from && m.from.username &&
        String(m.from.username).toLowerCase() === username.toLowerCase()) {
      return String(m.chat.id);
    }
  }
  return null;
}

// ---------- handler ----------
exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
    }

    const BOT_TOKEN  = process.env.BOT_TOKEN;
    const ADMIN_CHAT = process.env.ADMIN_CHAT || '';

    if (!BOT_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'BOT_TOKEN is not set' }) };
    }

    // Парсим тело запроса

ㅤ, [16.09.2025 1:33]
const { fields, files } = await parseMultipart(event, 10 * 1024 * 1024);

    // Собираем текст анкеты
    const caption =
      <b>Новая анкета (ЛЕГО СИТИ)</b>\n +
      1) ФИО: ${fields.full_name || ''}\n +
      2) Дата рождения (возраст): ${computeAgeText(fields.dob_date || '')}\n +
      3) Телефон: ${fields.phone || ''}\n +
      4) Telegram: @${String(fields.telegram || '').replace(/^@/, '')}\n +
      5) Адрес (факт): ${fields.address || ''}\n +
      6) Прописка: ${fields.passport_registration || ''}\n +
      7) Паспорт: ${String(fields.passport_number || '').replace(/\s+/g,'')}\n +
      8) Кем выдан: ${fields.passport_issuer || ''}\n +
      9) Образование: ${fields.education || '—'}\n +
      10) Опыт:\n${fields.experience || '—'}\n\n +
      11) Навыки:\n${fields.skills || '—'}\n\n +
      12) Почему к нам:\n${fields.why_us || '—'}\n\n +
      13) График (по дням):\n${buildWeekly(fields)};

    // Определяем chat_id
    const chatId = await resolveChatId(BOT_TOKEN, ADMIN_CHAT);
    if (!chatId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Не найден chat_id. Напишите боту /start с нужного аккаунта и попробуйте снова.' }) };
    }

    // Отправка — если есть фото, шлём sendPhoto, иначе sendMessage
    const photo = files.photo;
    if (photo && photo.buffer && photo.buffer.length) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      const blob = new Blob([photo.buffer], { type: photo.mime || 'application/octet-stream' });
      form.append('photo', blob, photo.filename || 'photo.jpg');

      const rp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
      const jp = await rp.json();
      if (!jp.ok) throw new Error(jp.description || 'sendPhoto failed');
    } else {
      const rm = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' })
      });
      const jm = await rm.json();
      if (!jm.ok) throw new Error(jm.description || 'sendMessage failed');
    }

    // успех
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (e) {
    // всегда отдаём JSON, чтобы страница показала понятную ошибку
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
