import { requestChatCompletion } from '../server/chatProxy.js';

const writeJson = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const result = await requestChatCompletion(req.body || {});
    writeJson(res, 200, result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    writeJson(res, status, {
      error: status >= 500 ? 'Secure chat proxy failed. Check server AI env vars.' : error.message
    });
  }
}
