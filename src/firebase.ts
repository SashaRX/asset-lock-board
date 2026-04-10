import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, remove, update, get } from 'firebase/database';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBxxpfnWqPgAmRgTaM7y0LmeQMaBhsQ38U",
  authDomain: "asset-lock-board.firebaseapp.com",
  databaseURL: "https://asset-lock-board-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "asset-lock-board",
  storageBucket: "asset-lock-board.firebasestorage.app",
  messagingSenderId: "51466759369",
  appId: "1:51466759369:web:34e241972cfb314a19f118",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { db, ref, onValue, set, remove, update, get, auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult };
