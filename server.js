/**
 * PersonaBot server
 * - Verifies Firebase Auth ID tokens on every API call
 * - Stores each user's persona instructions + chat history in Firestore,
 *   isolated under /users/{uid}/...
 * - Retrieves the Gemini API key from Google Cloud Secret Manager at runtime
 * - Talks to Gemini (AI Studio) using multi-turn chat with a per-user system instruction
 */

const path = require('path');
const express = require('express');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ---------------------------------------------------------------------------
// Firebase Admin / Firestore
// ---------------------------------------------------------------------------
admin.initializeApp(); // Uses Application Default Credentials on Cloud Run
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Gemini client, backed by a secret pulled from Secret Manager
// ---------------------------------------------------------------------------
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function loadGeminiApiKey() {
  // Local dev convenience: allow a plain env var so you don't need GCP for testing.
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const secretName = process.env.GEMINI_SECRET_NAME || 'gemini-api-key';

  if (!projectId) {
    throw new Error(
      'No GEMINI_API_KEY set and no PROJECT_ID configured for Secret Manager lookup.'
    );
  }

  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString('utf8');
}

const genAIPromise = loadGeminiApiKey().then((key) => new GoogleGenerativeAI(key));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Verify the Firebase ID token sent by the client on every protected route.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <idToken> header.' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired auth token.' });
  }
}

function userDoc(uid) {
  return db.collection('users').doc(uid);
}

const DEFAULT_PERSONA =
  'You are a helpful, friendly assistant. Answer clearly and concisely.';

// ---------------------------------------------------------------------------
// Persona (custom system instructions), stored per-user
// ---------------------------------------------------------------------------
app.get('/api/persona', requireAuth, async (req, res) => {
  try {
    const snap = await userDoc(req.uid).collection('settings').doc('persona').get();
    res.json({ persona: snap.exists ? snap.data().instructions : DEFAULT_PERSONA });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load persona.' });
  }
});

app.post('/api/persona', requireAuth, async (req, res) => {
  try {
    const instructions = (req.body.instructions || '').slice(0, 4000);
    await userDoc(req.uid)
      .collection('settings')
      .doc('persona')
      .set({
        instructions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save persona.' });
  }
});

// ---------------------------------------------------------------------------
// Chat history, stored per-user
// ---------------------------------------------------------------------------
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const snap = await userDoc(req.uid)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get();
    const messages = snap.docs.map((d) => {
      const data = d.data();
      return { role: data.role, text: data.text };
    });
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const genAI = await genAIPromise;
    const ref = userDoc(req.uid);

    const [personaSnap, historySnap] = await Promise.all([
      ref.collection('settings').doc('persona').get(),
      ref.collection('messages').orderBy('createdAt', 'asc').limit(50).get(),
    ]);

    const persona = personaSnap.exists ? personaSnap.data().instructions : DEFAULT_PERSONA;
    const history = historySnap.docs.map((d) => {
      const data = d.data();
      return { role: data.role === 'user' ? 'user' : 'model', parts: [{ text: data.text }] };
    });

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: persona,
    });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(ref.collection('messages').doc(), { role: 'user', text: message, createdAt: now });
    batch.set(ref.collection('messages').doc(), { role: 'model', text: reply, createdAt: now });
    await batch.commit();

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gemini request failed. Check server logs.' });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`PersonaBot listening on port ${port}`));
