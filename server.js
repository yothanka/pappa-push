// Pappa Pronta - Server push notifications
// Invia una notifica push all'orario di ogni pasto, anche a telefono bloccato/app chiusa.

const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Chiavi VAPID (mettile come variabili d'ambiente su Render) ---
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'INCOLLA_QUI_LA_PUBLIC_KEY';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'INCOLLA_QUI_LA_PRIVATE_KEY';
const CONTACT       = process.env.VAPID_CONTACT || 'mailto:tu@esempio.it';

webpush.setVapidDetails(CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

// --- Memoria abbonamenti (file JSON, semplice e sufficiente per uso personale) ---
const DB = path.join(__dirname, 'subs.json');
let subs = [];
try { subs = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { subs = []; }
function persist() { try { fs.writeFileSync(DB, JSON.stringify(subs)); } catch (e) { console.error('save err', e); } }

// La chiave pubblica serve al browser per iscriversi
app.get('/vapidPublicKey', (req, res) => res.send(VAPID_PUBLIC));

// Il browser invia: subscription + lista pasti + fuso orario (offset in minuti)
app.post('/subscribe', (req, res) => {
  const { subscription, meals, tzOffset } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'no subscription' });
  const idx = subs.findIndex(s => s.subscription.endpoint === subscription.endpoint);
  const entry = { subscription, meals: meals || [], tzOffset: tzOffset ?? 0, sent: {} };
  if (idx >= 0) { entry.sent = subs[idx].sent || {}; subs[idx] = entry; }
  else subs.push(entry);
  persist();
  res.json({ ok: true, count: subs.length });
});

// Disiscrizione
app.post('/unsubscribe', (req, res) => {
  const ep = req.body?.endpoint;
  subs = subs.filter(s => s.subscription.endpoint !== ep);
  persist();
  res.json({ ok: true });
});

// Endpoint di "keep-alive" per il ping anti-spegnimento
app.get('/ping', (req, res) => res.send('pong'));

// Invia una notifica di prova immediata (per confermare che tutto funziona)
app.post('/test', async (req, res) => {
  const ep = req.body?.endpoint;
  const s = subs.find(x => x.subscription.endpoint === ep) || subs[subs.length - 1];
  if (!s) return res.status(404).json({ error: 'no subscription' });
  try {
    await webpush.sendNotification(s.subscription, JSON.stringify({
      title: '🐶 Pappa Pronta', body: 'Notifiche attive! Tutto funziona ✅', id: null
    }));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.statusCode || 'send failed' });
  }
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- Scheduler: ogni minuto controlla se è ora di un pasto ---
function localHHMM(tzOffsetMin) {
  // tzOffsetMin = getTimezoneOffset() del browser (es. Italia estate = -120)
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const local = new Date(utcMs - tzOffsetMin * 60000);
  const hh = String(local.getHours()).padStart(2, '0');
  const mm = String(local.getMinutes()).padStart(2, '0');
  return { hhmm: `${hh}:${mm}`, day: local.toDateString() };
}

cron.schedule('* * * * *', async () => {
  for (const s of subs) {
    const { hhmm, day } = localHHMM(s.tzOffset || 0);
    if (s.sentDay !== day) { s.sent = {}; s.sentDay = day; }
    for (const m of (s.meals || [])) {
      const key = m.id + '@' + m.time;
      if (m.time === hhmm && !s.sent[key]) {
        s.sent[key] = true;
        const payload = JSON.stringify({ title: '🐶 Ora della pappa!', body: `${m.name} — ${m.time}`, id: m.id });
        try {
          await webpush.sendNotification(s.subscription, payload);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // subscription scaduta: rimuovila
            subs = subs.filter(x => x.subscription.endpoint !== s.subscription.endpoint);
          }
          console.error('push err', err.statusCode);
        }
      }
    }
  }
  persist();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Pappa Pronta server su porta ' + PORT));
