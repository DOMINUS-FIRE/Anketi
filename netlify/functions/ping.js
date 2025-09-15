// netlify/functions/ping.js
exports.handler = async () => {
  return { statusCode: 200, body: JSON.stringify({ ok: true, pong: true }) };
};
