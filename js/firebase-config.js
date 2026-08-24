// js/firebase-config.js
// Firebase Realtime Database Integration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ============================================================================
// IMPORTANT: REPLACE THESE WITH YOUR ACTUAL FIREBASE CONFIG
// 1. Go to console.firebase.google.com
// 2. Create a new project and add a Web App
// 3. Enable Realtime Database (Start in Test Mode so anyone can read/write)
// 4. Copy the config object here:
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDD4gh_PJ9c5rrZYqJ_rMQQdJKV5L_Ig1E",
  authDomain: "hidden-reveal-stego.firebaseapp.com",
  databaseURL: "https://hidden-reveal-stego-default-rtdb.firebaseio.com",
  projectId: "hidden-reveal-stego",
  storageBucket: "hidden-reveal-stego.firebasestorage.app",
  messagingSenderId: "173936462668",
  appId: "1:173936462668:web:4ad8fc4ae7643019f05de9",
  measurementId: "G-CNHRH7TDJ7",
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
    console.warn(
      "Firebase is not configured. Realtime sync will be disabled. Please update js/firebase-config.js",
    );
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

  const scanRef = ref(database, "latest_scan");
  set(scanRef, {
    message: message,
    timestamp: Date.now(),
  }).catch((err) => console.error("Firebase write failed:", err));
}

/**
 * Listens for new decoded messages.
 * Used by the Projector (desktop).
 */
export function listenForScans(callback) {
  if (!database) return;

  const scanRef = ref(database, "latest_scan");
  onValue(scanRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.message) {
      callback(data.message, data.timestamp);
    }
  });
}
