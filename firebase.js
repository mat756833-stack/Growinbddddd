// Import Firebase SDK modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCCOUhkqJILjR1qmfmQAfmQ-WkeSvnIFR0",
  authDomain: "invest-9731f.firebaseapp.com",
  databaseURL: "https://invest-9731f-default-rtdb.firebaseio.com",
  projectId: "invest-9731f",
  storageBucket: "invest-9731f.appspot.com",
  messagingSenderId: "1054310074316",
  appId: "1:1054310074316:web:1bae389847b0c8b4873f69",
  measurementId: "G-QQXWLJDJTJ"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
