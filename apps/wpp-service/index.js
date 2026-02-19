const express = require('express');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

let chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  if (fs.existsSync('/usr/bin/chromium-browser')) chromePath = '/usr/bin/chromium-browser';
  else if (fs.existsSync('/usr/bin/chromium')) chromePath = '/usr/bin/chromium';
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  },
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('QR available - scan with WhatsApp');
});
client.on('ready', () => console.log('WPP client ready'));
client.on('auth_failure', (msg) => console.error('Auth failure', msg));

app.get('/status', (req, res) => {
  const ready = client.info && client.info.me ? true : false;
  res.json({ ready });
});

app.post('/send', async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) return res.status(400).json({ error: 'number and message required' });
  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    const sent = await client.sendMessage(chatId, message);
    res.json({ ok: true, id: sent.id._serialized });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

client.initialize();

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log('WPP service listening on', PORT));
