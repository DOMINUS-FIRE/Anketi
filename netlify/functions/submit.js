// netlify/functions/submit.js

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ ok: false, error: "Method Not Allowed" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: "submit.js работает!",
        method: event.httpMethod,
        length: event.body ? event.body.length : 0
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err) })
    };
  }
};
