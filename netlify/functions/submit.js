ㅤ, [16.09.2025 1:08]
// netlify/functions/submit.js
// Node 18 runtime (Netlify): есть глобальные fetch, FormData, Blob
const Busboy = require('busboy');

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    try {
      const headers = event && event.headers ? event.headers : {};
      if (!headers['content-type']) {
        return reject(new Error('Missing content-type header'));
      }
      const bb = Busboy({ headers });

      const fields = {};
      const files = {};
      const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
      let total = 0;

      bb.on('field', function (name, val) { fields[name] = val; });

      bb.on('file', function (name, file, info) {
        const chunks = [];
        file.on('data', function (d) {
          total += d.length;
          if (total > MAX_BYTES) {
            try { file.unpipe(); } catch(_) {}
            return reject(new Error('Payload too large'));
          }
          chunks.push(d);
        });
        file.on('end', function () {
          files[name] = {
            filename: info && info.filename ? info.filename : 'upload',
            mime: info && info.mimeType ? info.mimeType : 'application/octet-stream',
            buffer: Buffer.concat(chunks),
          };
        });
      });

      bb.on('close', function () { resolve({ fields: fields, files: files }); });
      bb.on('error', function (err) { reject(err); });

      const bodyBuf = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64')
        : Buffer.from(event.body || '', 'utf8');

      bb.end(bodyBuf);
    } catch (e) { reject(e); }
  });
}

function computeAgeText(dobISO) {
  try {
    if (!dobISO) return '—';
    const d = new Date(dobISO);
    if (isNaN(d.getTime())) return dobISO;
    const t = new Date();
    var age = t.getFullYear() - d.getFullYear();
    var m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return dobISO + ' (' + age + ' лет)';
  } catch (_) { return dobISO || '—'; }
}

function buildWeekly(fields) {
  var days = [
    ['mon','Пн'],['tue','Вт'],['wed','Ср'],
    ['thu','Чт'],['fri','Пт'],['sat','Сб'],['sun','Вс']
  ];
  var lines = [];
  for (var i=0;i<days.length;i++) {
    var k = days[i][0], t = days[i][1];
    var st = (fields[k + '_status'] || '').trim();
    var hrs = (fields[k + '_hours']  || '').trim();
    var rsn = (fields[k + '_reason'] || '').trim();
    if (st === 'can') {
      lines.push(t + ': сможет ' + (hrs  '— (часы не указаны)') + ' — причина: ' + (rsn  'причина не указана'));
    } else if (st === 'cant') {
      lines.push(t + ': не сможет — причина: ' + (rsn || 'причина не указана'));
    } else {
      lines.push(t + ': не указано');
    }
  }
  return lines.join('\n');
}

async function resolveChatId(token, adminChatEnv) {
  if (adminChatEnv && /^-?\d+$/.test(adminChatEnv)) return adminChatEnv; // числовой chat_id
  var username = (adminChatEnv || '').replace(/^@/, '');
  if (!username) return null;

  var r = await fetch('https://api.telegram.org/bot' + token + '/getUpdates');
  var j = await r.json().catch(function(){ return {}; });
  if (!j || !j.ok) return null;

  for (var i=j.result.length-1; i>=0; i--) {
    var m = j.result[i] && j.result[i].message;
    if (m && m.from && m.from.username && String(m.from.username).toLowerCase() === username.toLowerCase()) {
      return String(m.chat.id);
    }
  }
  return null;
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
    }

    var BOT_TOKEN  = process.env.BOT_TOKEN;
    var ADMIN_CHAT = process.env.ADMIN_CHAT || '';
    if (!BOT_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'BOT_TOKEN is not set' }) };
    }

    var parsed = await parseMultipart(event);
    var fields = parsed.fields || {};
    var files  = parsed.files  || {};

    var caption =
      '<b>Новая анкета (ЛЕГО СИТИ)</b>\n' +
      '1) ФИО: ' + (fields.full_name || '') + '\n' +

ㅤ, [16.09.2025 1:08]
'2) Дата рождения (возраст): ' + computeAgeText(fields.dob_date || '') + '\n' +
      '3) Телефон: ' + (fields.phone || '') + '\n' +
      '4) Telegram: @' + String(fields.telegram || '').replace(/^@/, '') + '\n' +
      '5) Адрес (факт): ' + (fields.address || '') + '\n' +
      '6) Прописка: ' + (fields.passport_registration || '') + '\n' +
      '7) Паспорт: ' + String(fields.passport_number || '').replace(/\s+/g,'') + '\n' +
      '8) Кем выдан: ' + (fields.passport_issuer || '') + '\n' +
      '9) Образование: ' + (fields.education || '—') + '\n' +
      '10) Опыт:\n' + (fields.experience || '—') + '\n\n' +
      '11) Навыки:\n' + (fields.skills || '—') + '\n\n' +
      '12) Почему к нам:\n' + (fields.why_us || '—') + '\n\n' +
      '13) График (по дням):\n' + buildWeekly(fields);

    var chatId = await resolveChatId(BOT_TOKEN, ADMIN_CHAT);
    if (!chatId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Не найден chat_id. Напишите боту /start и повторите.' }) };
    }

    var photo = files.photo;
    if (photo && photo.buffer && photo.buffer.length) {
      var form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      var blob = new Blob([photo.buffer], { type: photo.mime || 'application/octet-stream' });
      form.append('photo', blob, photo.filename || 'photo.jpg');

      var rp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendPhoto', { method: 'POST', body: form });
      var jp = await rp.json();
      if (!jp.ok) throw new Error(jp.description || 'sendPhoto failed');
    } else {
      var rm = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' })
      });
      var jm = await rm.json();
      if (!jm.ok) throw new Error(jm.description || 'sendMessage failed');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) };
  }
};
