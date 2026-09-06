// ---------------------------------------------------------------------------
// Fill this in with your Firebase project's web config
// (Firebase console > Project settings > General > Your apps > SDK setup).
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyATiKIDhxFowJtjQl_maK0BR1kmZ3k",
  authDomain: "project-9b05a57f-3e24-4698-9a2.firebaseapp.com",
  projectId: "project-9b05a57f-3e24-4698-9a2",
  storageBucket: "project-9b05a57f-3e24-4698-9a2.firebasestorage.app",
  messagingSenderId: "437551487285",
  appId: "1:437551487285:web:2a9c8aa4656c87581ad47c",
};
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authError = document.getElementById("auth-error");

document.getElementById("sign-in-btn").addEventListener("click", async () => {
  authError.hidden = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error(err);
    authError.textContent = "Sign-in failed. Please try again.";
    authError.hidden = false;
  }
});

document.getElementById("sign-out-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    authView.hidden = true;
    appView.hidden = false;
    document.getElementById("user-email").textContent = user.email || "";
    await loadPersona();
    await loadHistory();
  } else {
    authView.hidden = false;
    appView.hidden = true;
  }
});

// ---------------------------------------------------------------------------
// Backend helpers
// ---------------------------------------------------------------------------
async function authedFetch(url, options = {}) {
  const token = await auth.currentUser.getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

const personaInput = document.getElementById("persona-input");
const personaStatus = document.getElementById("persona-status");

async function loadPersona() {
  const res = await authedFetch("/api/persona");
  const data = await res.json();
  personaInput.value = data.persona || "";
}

document.getElementById("save-persona-btn").addEventListener("click", async () => {
  personaStatus.textContent = "Saving…";
  const res = await authedFetch("/api/persona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions: personaInput.value }),
  });
  personaStatus.textContent = res.ok ? "Saved." : "Couldn't save. Try again.";
  setTimeout(() => (personaStatus.textContent = ""), 2500);
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

function renderMessage(role, text, { pending = false } = {}) {
  const div = document.createElement("div");
  div.className = `msg ${role}${pending ? " pending" : ""}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function loadHistory() {
  messagesEl.innerHTML = "";
  const res = await authedFetch("/api/history");
  const data = await res.json();
  (data.messages || []).forEach((m) => renderMessage(m.role, m.text));
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  renderMessage("user", text);
  const pendingEl = renderMessage("model", "Thinking…", { pending: true });

  try {
    const res = await authedFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    pendingEl.textContent = data.reply;
    pendingEl.classList.remove("pending");
  } catch (err) {
    console.error(err);
    pendingEl.textContent = "Something went wrong. Please try again.";
    pendingEl.classList.remove("pending");
  }
});
