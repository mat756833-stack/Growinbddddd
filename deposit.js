// deposit.js (FINAL) - SweetAlert 40s timer + transactional write
import { auth, db } from './firebase.js';
import {
  collection, addDoc, serverTimestamp,
  doc, runTransaction, arrayUnion, increment, getDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

/* UI refs (match your HTML) */
const amountInput = document.getElementById('deposit-amount');
const phoneInput = document.getElementById('deposit-phone');
const trxInput = document.getElementById('deposit-trxid');
const methodButtons = document.querySelectorAll('.method-btn');
const paymentNumberBox = document.getElementById('payment-number-box');
const agentNumberInput = document.getElementById('agent-number');
const copyBtn = document.getElementById('copy-number');
const depositMsg = document.getElementById('deposit-msg');
const depositTableBody = document.querySelector('#deposit-table tbody');
const depositButton = document.getElementById('deposit-submit'); // optional

let selectedMethod = null;
let currentUser = null;

/* Method selector UI */
methodButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    methodButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMethod = btn.dataset.method || 'bkash';
    if (paymentNumberBox) paymentNumberBox.style.display = 'block';
    if (selectedMethod === 'bkash') agentNumberInput.value = '01701884859';
    if (selectedMethod === 'nogod') agentNumberInput.value = '0170XXXXXXX';
    if (selectedMethod === 'rocket') agentNumberInput.value = '0160XXXXXXX';
  });
});

/* Copy number */
copyBtn?.addEventListener('click', () => {
  agentNumberInput.select();
  document.execCommand('copy');
  if (depositMsg) {
    depositMsg.textContent = 'Number copied ✓';
    setTimeout(() => depositMsg.textContent = '', 2000);
  }
});

/* Auth observer */
onAuthStateChanged(auth, user => {
  currentUser = user || null;
  if (currentUser) {
    if (depositMsg) depositMsg.textContent = 'Logged in as ' + (currentUser.email || currentUser.uid);
    loadDepositHistory().catch(e => console.warn('loadDepositHistory err', e));
  } else {
    if (depositMsg) depositMsg.textContent = 'Please login to deposit';
    if (depositTableBody) depositTableBody.innerHTML = '';
  }
});

/* Helper: append to UI table */
function appendRowToTable(date, method, phone, amount, status) {
  if (!depositTableBody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${date}</td><td>${method}</td><td>${phone}</td><td>৳${amount}</td><td>${status}</td>`;
  depositTableBody.prepend(tr);
}

/* Load deposit history (from users/{uid}.depositHistory if exists) */
async function loadDepositHistory() {
  if (!currentUser) return;
  try {
    const userRef = doc(db, 'users', currentUser.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const hist = data.depositHistory || [];
    if (depositTableBody) depositTableBody.innerHTML = '';
    hist.slice().reverse().forEach(h => {
      const dateStr = (h.createdAt instanceof Date) ? h.createdAt.toLocaleString()
        : (h.createdAt && typeof h.createdAt.toDate === 'function') ? h.createdAt.toDate().toLocaleString()
        : (h.createdAt ? new Date(h.createdAt).toLocaleString() : '');
      appendRowToTable(dateStr, h.method || '-', h.phone || '-', h.amount || 0, h.status || 'success');
    });
  } catch (e) {
    console.warn('loadDepositHistory error', e);
  }
}

/* Core: perform deposit transaction (identical to your previous logic) */
async function performDepositWrite(amount, phone, trx, method) {
  // 1) create paymentRequests doc
  const requestsCol = collection(db, 'paymentRequests');
  const reqDoc = {
    uid: currentUser.uid,
    email: currentUser.email || null,
    amount,
    method,
    phone,
    trxId: trx,
    status: 'success',
    createdAt: serverTimestamp()
  };
  const addedRef = await addDoc(requestsCol, reqDoc);
  console.log('[deposit] paymentRequests added:', addedRef.id);

  // 2) prepare deposit history entry (client timestamp for arrayUnion)
  const historyEntry = {
    requestId: addedRef.id,
    type: 'deposit',
    amount,
    method,
    phone,
    trxId: trx,
    status: 'success',
    createdAt: new Date()
  };

  // 3) transactionally update user doc
  const userRef = doc(db, 'users', currentUser.uid);
  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      transaction.set(userRef, {
        balance: amount,
        depositHistory: [historyEntry],
        totalDeposit: amount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      transaction.update(userRef, {
        balance: increment(amount),
        depositHistory: arrayUnion(historyEntry),
        totalDeposit: increment(amount),
        updatedAt: serverTimestamp()
      });
    }
  });

  // UI append
  appendRowToTable(new Date().toLocaleString(), method, phone, amount, 'success');
}

/* NEW: SweetAlert 40s timer flow */
export async function startDepositFlow() {
  // Basic validation before modal
  const amount = Number(amountInput?.value);
  const phone = phoneInput?.value?.trim();
  const trx = trxInput?.value?.trim();
  const method = selectedMethod || 'bkash';

  if (!currentUser) {
    return Swal.fire({ icon: 'warning', title: 'Login required', text: 'Please sign in first.' });
  }
  if (!method) return Swal.fire({ icon: 'error', title: 'Select method', text: 'Choose a payment method.' });
  if (!amount || isNaN(amount) || amount < 500) return Swal.fire({ icon: 'error', title: 'Invalid amount', text: 'Minimum ৳500 required.' });
  if (!/^01\d{9}$/.test(phone)) return Swal.fire({ icon: 'error', title: 'Invalid phone', text: 'Use 01XXXXXXXXX' });
  if (!trx) return Swal.fire({ icon: 'error', title: 'Missing trx', text: 'Enter transaction ID.' });

  // ensure Swal present
  if (typeof Swal === 'undefined') {
    alert('SweetAlert2 not loaded. Add CDN: <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>');
    return;
  }

  let timerInterval;
  const TOTAL_SEC = 40;
  let remaining = TOTAL_SEC;

  // show modal
  await Swal.fire({
    title: 'Hold on — verifying payment',
    html: `
      <div style="font-size:16px;margin-bottom:8px">Keep this window open for <b>${TOTAL_SEC}</b> seconds</div>
      <div id="swal-count" style="font-size:28px;font-weight:700;color:#0a6">${TOTAL_SEC}</div>
      <div style="margin-top:10px;font-size:40px; animation: pulse 1s infinite">💳</div>
      <style>
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
      </style>
    `,
    timer: TOTAL_SEC * 1000,
    timerProgressBar: true,
    showCancelButton: true,
    cancelButtonText: 'Cancel ❌',
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    willOpen: () => {
      const elCount = document.getElementById('swal-count');
      timerInterval = setInterval(() => {
        remaining--;
        if (elCount) elCount.textContent = remaining;
      }, 1000);
    },
    willClose: () => {
      clearInterval(timerInterval);
    }
  }).then(async (result) => {
    if (result.dismiss === Swal.DismissReason.timer) {
      // timer completed => do write
      try {
        if (depositMsg) { depositMsg.style.color = '#0a6'; depositMsg.textContent = 'Processing deposit...'; }
        await performDepositWrite(amount, phone, trx, method);
        if (depositMsg) { depositMsg.style.color = '#0a6'; depositMsg.textContent = 'Deposit submitted and balance incremented.'; }
        Swal.fire({ icon: 'success', title: 'Deposit recorded', text: `৳${amount} recorded.` });
        // clear inputs
        if (amountInput) amountInput.value = '';
        if (phoneInput) phoneInput.value = '';
        if (trxInput) trxInput.value = '';
      } catch (err) {
        console.error('deposit write failed', err);
        if (depositMsg) { depositMsg.style.color = 'red'; depositMsg.textContent = 'Error: ' + (err.message || err); }
        Swal.fire({ icon: 'error', title: 'Deposit failed', text: (err.message || 'Could not complete deposit') });
      }
    } else {
      // user cancelled / closed
      if (depositMsg) { depositMsg.style.color = 'crimson'; depositMsg.textContent = 'Deposit cancelled by user.'; }
      Swal.fire({ icon: 'info', title: 'Cancelled', text: 'Deposit was cancelled.' });
    }
  });
}

// Backward compatibility: if you prefer onclick="depositRequest()" keep a simple wrapper
export async function depositRequest(amountFromButton) {
  // If depositRequest called with amount param, set input value (useful for prefill)
  if (amountFromButton && amountInput) amountInput.value = amountFromButton;
  // call startDepositFlow (the authority)
  return startDepositFlow();
}

// window export for inline HTML onclick
window.startDepositFlow = startDepositFlow;
window.depositRequest = depositRequest;
