ㅤ, [16.09.2025 1:18]
// netlify/functions/submit.js
// Node 18 runtime on Netlify: has global fetch, FormData, Blob (via undici)
const Busboy = require('busboy');

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    try {
      const headers = event && event.headers ? event.headers : {};
      if (!headers['content-type']) {
        return reject(new Error('Missing content-type header'));
      }
      const bb = Busboy({ headers: headers });

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
            buffer: Buffer.concat(chunks)
          };
        });
      });

      bb.on('close', function () { resolve({ fields: fields, files: files }); });
      bb.on('error', function (err) { reject(err); });

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
    if (!dobISO) return '-';
    const d = new Date(dobISO);
    if (isNaN(d.getTime())) return dobISO;
    const t = new Date();
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return dobISO + ' (' + age + ' let)';
  } catch (_) {
    return dobISO || '-';
  }
}

function buildWeekly(fields) {
  const days = [
    ['mon','Pn'],['tue','Vt'],['wed','Sr'],
    ['thu','Cht'],['fri','Pt'],['sat','Sb'],['sun','Vs']
  ];
  const lines = [];
  for (let i = 0; i < days.length; i++) {
    const k = days[i][0], t = days[i][1];
    const st  = (fields[k + '_status'] || '').trim();
    const hrs = (fields[k + '_hours']  || '').trim();
    const rsn = (fields[k + '_reason'] || '').trim();
    if (st === 'can') {
      lines.push(t + ': smozhet ' + (hrs  '- (chasy ne ukazany)') + ' - prichina: ' + (rsn  'prichina ne ukazana'));
    } else if (st === 'cant') {
      lines.push(t + ': ne smozhet - prichina: ' + (rsn || 'prichina ne ukazana'));
    } else {
      lines.push(t + ': ne ukazano');
    }
  }
  return lines.join('\n');
}

async function resolveChatId(token, adminChatEnv) {
  if (adminChatEnv && /^-?\d+$/.test(adminChatEnv)) return adminChatEnv; // numeric chat_id
  const username = (adminChatEnv || '').replace(/^@/, '');
  if (!username) return null;

  const r = await fetch('https://api.telegram.org/bot' + token + '/getUpdates', { method: 'GET' });
  const j = await r.json().catch(function(){ return {}; });
  if (!j || !j.ok) return null;

  for (let i = j.result.length - 1; i >= 0; i--) {
    const m = j.result[i] && j.result[i].message;
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

    const BOT_TOKEN  = process.env.BOT_TOKEN;
    const ADMIN_CHAT = process.env.ADMIN_CHAT || '';
    if (!BOT_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'BOT_TOKEN is not set' }) };
    }

    const parsed = await parseMultipart(event);
    const fields = parsed.fields || {};
    const files  = parsed.files  || {};

ㅤ, [16.09.2025 1:18]
// Build caption (ASCII only; replace Russian long dash with '-')
    const caption =
      '<b>Novaya anketa (LEGO CITY)</b>\n' +
      '1) FIO: ' + (fields.full_name || '') + '\n' +
      '2) Data rozhdeniya (vozrast): ' + computeAgeText(fields.dob_date || '') + '\n' +
      '3) Telefon: ' + (fields.phone || '') + '\n' +
      '4) Telegram: @' + String(fields.telegram || '').replace(/^@/, '') + '\n' +
      '5) Adres (fakt): ' + (fields.address || '') + '\n' +
      '6) Propiska: ' + (fields.passport_registration || '') + '\n' +
      '7) Pasport: ' + String(fields.passport_number || '').replace(/\s+/g,'') + '\n' +
      '8) Kem vydan: ' + (fields.passport_issuer || '') + '\n' +
      '9) Obrazovanie: ' + (fields.education || '-') + '\n' +
      '10) Opyt:\n' + (fields.experience || '-') + '\n\n' +
      '11) Navyki:\n' + (fields.skills || '-') + '\n\n' +
      '12) Pochemu k nam:\n' + (fields.why_us || '-') + '\n\n' +
      '13) Grafik (po dnyam):\n' + buildWeekly(fields);

    const chatId = await resolveChatId(BOT_TOKEN, ADMIN_CHAT);
    if (!chatId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Chat ID not found. Write /start to the bot and retry.' }) };
    }

    const photo = files.photo;
    if (photo && photo.buffer && photo.buffer.length) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      const blob = new Blob([photo.buffer], { type: photo.mime || 'application/octet-stream' });
      form.append('photo', blob, photo.filename || 'photo.jpg');

      const rp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendPhoto', { method: 'POST', body: form });
      const jp = await rp.json();
      if (!jp.ok) throw new Error(jp.description || 'sendPhoto failed');
    } else {
      const rm = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' })
      });
      const jm = await rm.json();
      if (!jm.ok) throw new Error(jm.description || 'sendMessage failed');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
