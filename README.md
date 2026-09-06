# PersonaBot

A user-authenticated AI chatbot where every signed-in user writes their own
system instructions ("persona") and chats privately with Gemini. Built for
the **Accelerate AI with Cloud Run** ideathon.

- **Firebase Authentication** — Google sign-in on the frontend; every API
  call carries a Firebase ID token, verified server-side.
- **Firestore** — each user's persona and full chat history are stored under
  `/users/{uid}/...`, isolated per user.
- **Gemini API (AI Studio)** — multi-turn chat via `startChat()`, using the
  user's saved instructions as the `systemInstruction`.
- **Cloud Run** — the Express app is containerized and deployed as a fully
  managed, publicly reachable HTTPS service.
- **Secret Manager** — the Gemini API key is never stored in code or env
  files; it's fetched from Secret Manager at container start.

---

## 1. Prerequisites

- A Google Cloud project with billing enabled.
- `gcloud` CLI installed and authenticated (`gcloud init`).
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- Node.js 20+ if you want to run locally first.

Enable the APIs you'll need:

```bash
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

## 2. Set up Firebase

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   add Firebase to your existing GCP project.
2. **Authentication** → Sign-in method → enable **Google**.
3. **Build → Firestore Database** → create a database (production mode,
   pick a region).
4. Deploy the security rules in this repo:
   ```bash
   firebase deploy --only firestore:rules
   ```
5. Project settings → General → "Your apps" → add a **Web app**. Copy the
   resulting config object into `public/app.js`, replacing the
   `firebaseConfig` placeholder values.

## 3. Store the Gemini API key in Secret Manager

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key \
  --data-file=- --replication-policy=automatic
```

(If the secret already exists, use `gcloud secrets versions add gemini-api-key --data-file=-` instead.)

## 4. Deploy to Cloud Run

```bash
gcloud run deploy personabot \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars PROJECT_ID=$(gcloud config get-value project) \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

This builds the container from the `Dockerfile` via Cloud Build and deploys
it. Cloud Run will print a public `https://personabot-xxxxx-uc.a.run.app`
URL — that's your deployment link.

Grant the Cloud Run service's runtime service account access to the secret
and to Firestore if the deploy step didn't already do so:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Run locally (optional)

```bash
npm install
export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"   # skips Secret Manager locally
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
npm start
```

Visit `http://localhost:8080`.

---

## Project structure

```
personabot/
├── server.js           # Express backend: auth check, Firestore, Gemini
├── public/
│   ├── index.html
│   ├── app.js          # Firebase auth + fetch calls to the backend
│   └── style.css
├── Dockerfile
├── firestore.rules
└── package.json
```

---

## Submission helpers

**Brief description (paste into the form):**

> PersonaBot is a user-authenticated AI chatbot deployed on Cloud Run.
> Users sign in with Firebase Authentication (Google provider), then write
> their own custom system instructions to shape the assistant's persona.
> Every message and reply is stored per-user in Firestore
> (`/users/{uid}/messages`, `/users/{uid}/settings/persona`), so
> conversations and persona settings are private and isolated to each
> account. The backend calls the Gemini API in a multi-turn `startChat()`
> session, passing the user's saved instructions as the system prompt and
> their prior messages as history, so the assistant stays in character
> across turns. The Gemini API key is never hardcoded — it's stored in
> Google Cloud Secret Manager and fetched by the Cloud Run service at
> startup. The whole app is a single containerized Express service built
> and deployed straight from source to Cloud Run.

**Services utilized (check all in the form):**
- User authentication via Firebase ✅
- Multi-turn interaction with the Gemini API ✅
- User-isolated Firestore document storage ✅
- Secure API key retrieval via Google Cloud Secret Manager ✅

**Sample social post (remember the hashtag):**

> Built PersonaBot for the #AccelerateAIwithCloudRun challenge 🤖 — sign in,
> write your own AI persona, and chat with Gemini. Firebase Auth +
> Firestore + Secret Manager + Cloud Run, deployed straight from source.
> [deployment link] [repo link]
