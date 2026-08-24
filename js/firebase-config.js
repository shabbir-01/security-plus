// js/firebase-config.js
// Firebase Realtime Database Integration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ============================================================================
// IMPORTANT: REPLACE THESE WITH YOUR ACTUAL FIREBASE CONFIG
// 1. Go to console.firebase.google.com
// 2. Create a new project and add a Web App
// 3. Enable Realtime Database (Start in Test Mode so anyone can read/write)
// 4. Copy the config object here:
// ============================================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase only if the config has been updated (or just initialize it and let it fail gracefully)
let database = null;

try {
  // Simple check to prevent errors if the user hasn't replaced the config yet
  if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    console.log("Firebase initialized successfully.");
  } else {
    console.warn("Firebase is not configured. Realtime sync will be disabled. Please update js/firebase-config.js");
  }
} catch (e) {
  console.error("Failed to initialize Firebase:", e);
}

/**
 * Pushes a decoded message to the database.
 * Used by the Scanner (phone).
 */
export function pushScanResult(message) {
  if (!database) return;
  
  const scanRef = ref(database, 'latest_scan');
  set(scanRef, {
    message: message,
    timestamp: Date.now()
  }).catch(err => console.error("Firebase write failed:", err));
}

/**
 * Listens for new decoded messages.
 * Used by the Projector (desktop).
 */
export function listenForScans(callback) {
  if (!database) return;

  const scanRef = ref(database, 'latest_scan');
  onValue(scanRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.message) {
      callback(data.message, data.timestamp);
    }
  });
}