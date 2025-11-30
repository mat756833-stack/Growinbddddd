// /js/withdraw.js
import { auth, db } from './firebase.js';
import {
  doc, collection, runTransaction, serverTimestamp,
  query, where, orderBy, getDocs, onSnapshot, getDoc,
  setDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

/* UI SELECTORS */
const amountInput = document.getElementById('withdraw-amount');
const phoneInput = document.getElementById('withdraw-phone');
const submitBtn = document.getElementById('withdraw-submit');
const withdrawMsg = document.getElementById('withdraw-msg');
const withdrawTableBody = document.querySelector('#withdraw-table tbody');
const methodBtns = document.querySelectorAll('.method-btn');

let selectedMethod = 'bkash';
methodBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    methodBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMethod = btn.dataset.method;
  });
});

function showMsg(text, isError = false) {
  withdrawMsg.style.color = isError ? 'crimson' : 'green';
  withdrawMsg.textContent = text;
  setTimeout(() => withdrawMsg.textContent = '', 6000);
}

function validPhone(phone) { return /^01\d{9}$/.test(phone); }

/* Resolve user doc reference */
async function resolveUserDocRef(user) {
  const uid = user.uid;
  const directRef = doc(db, 'users', uid);

  const snap = await getDoc(directRef);
  if (snap.exists()) return directRef;

  await setDoc(directRef, {
    email: user.email || '',
    phone: user.phoneNumber || '',
    balance: 0,
    totalDeposit: 0,
    totalWithdraw: 0,
    createdAt: serverTimestamp()
  });

  return directRef;
}

/* MAIN WITHDRAW FUNCTION */
async function requestWithdraw(user, amount, phone, method) {
  const userDocRef = await resolveUserDocRef(user);
  const reqRef = doc(collection(db, 'withdrawRequests'));

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userDocRef);
      if (!snap.exists()) throw new Error("User not found");

      const data = snap.data();

      const curBal = Number(data.balance || 0);
      if (curBal < amount) throw new Error("Insufficient balance");

      const newBal = curBal - amount;

      // ⭐⭐ FIX: totalWithdraw increment ⭐⭐
      const curTotal = Number(data.totalWithdraw ?? 0);
      const newTotal = curTotal + amount;

      tx.update(userDocRef, {
        balance: newBal,
        totalWithdraw: newTotal,
        updatedAt: serverTimestamp()
      });

      const entry = {
        amount,
        phone,
        method,
        status: 'pending',
        requestId: reqRef.id,
        createdAt: Date.now()
      };

      tx.update(userDocRef, { withdrawHistory: arrayUnion(entry) });

      tx.set(reqRef, {
        uid: user.uid,
        amount,
        phone,
        method,
        status: "pending",
        refunded: false,
        createdAt: serverTimestamp()
      });
    });

    return { success: true };

  } catch (err) {
    return { success: false, message: err.message };
  }
}

/* LOAD HISTORY */
async function loadWithdrawHistory(uid) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);

  withdrawTableBody.innerHTML = "";

  if (!snap.exists()) return;

  const data = snap.data();
  const list = data.withdrawHistory || [];

  list.sort((a,b) => b.createdAt - a.createdAt);

  list.forEach(w => {
    const tr = `
      <tr>
        <td>${new Date(w.createdAt).toLocaleString()}</td>
        <td>${w.method}</td>
        <td>${w.phone}</td>
        <td>৳${w.amount}</td>
        <td>${w.status}</td>
      </tr>
    `;
    withdrawTableBody.insertAdjacentHTML("beforeend", tr);
  });
}

/* BUTTON SUBMIT */
submitBtn.addEventListener('click', async () => {
  const amount = parseFloat(amountInput.value);
  const phone = phoneInput.value.trim();

  if (amount < 500) return showMsg("Minimum ৳500", true);
  if (!validPhone(phone)) return showMsg("Invalid phone number", true);

  const user = auth.currentUser;
  if (!user) return showMsg("Login required", true);

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  const res = await requestWithdraw(user, amount, phone, selectedMethod);

  if (res.success) {
    showMsg("Withdraw submitted!");
    amountInput.value = "";
    phoneInput.value = "";
    loadWithdrawHistory(user.uid);
  } else {
    showMsg("Error: " + res.message, true);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Withdraw Request";
});

/* AUTH LISTENER */
onAuthStateChanged(auth, (user) => {
  if (user) {
    loadWithdrawHistory(user.uid);
  }
});
