// dashboard.js
// ES module — expects ./firebase.js to export `auth` and `db` (you already have that)
import { db } from "./firebase.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

/*
  Assumes your user document (users/{uid}) has fields like:
    - balance (number)
    - totalDeposit (number)
    - totalProfit (number)  OR dailyProfit (number)
    - totalWithdraw (number)
    - plans (array)  OR activePlans (array)
    - depositHistory (array)
    - withdrawHistory (array)
    - lastProfitDate, lastClaimDate (optional strings "YYYY-MM-DD")
*/

const DEFAULT_SELECTORS = {
  balance: "#dash-balance",
  profit: "#dash-profit",
  active: "#dash-active",
  totalDeposit: "#dash-deposits",
  totalWithdraw: "#dash-withdrawals",
  recentTbody: "#recent-activity tbody" // optional
};

function qs(sel) {
  if (!sel) return null;
  return typeof sel === "string" ? document.querySelector(sel) : sel;
}

function fmtBDT(v) {
  const n = Number(v || 0);
  if (Number.isNaN(n)) return "৳0";
  // format without decimals, with thousands separator
  return "৳" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function tryNumber(x) {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  const n = Number(x);
  return Number.isNaN(n) ? 0 : n;
}

function normalizeHistory(arr = [], type = "deposit") {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (item == null) return null;
    if (typeof item === "number") return { type, amount: item, when: null, raw: item };
    if (typeof item === "string") {
      // try extract number
      const m = item.match(/(\d+(\.\d+)?)/);
      const amt = m ? Number(m[1]) : 0;
      return { type, amount: amt, when: null, raw: item };
    }
    if (typeof item === "object") {
      const amount = tryNumber(item.amount ?? item.amt ?? item.value ?? item);
      let when = null;
      if (item.createdAt && typeof item.createdAt.toDate === "function") {
        when = item.createdAt.toDate();
      } else if (item.createdAt) {
        when = new Date(item.createdAt);
      } else if (item.at) {
        when = new Date(item.at);
      }
      return { type, amount, when, raw: item };
    }
    return null;
  }).filter(Boolean);
}

function combineRecent(depList, wdrList, limit = 10) {
  const list = [...(depList || []), ...(wdrList || [])];
  // if have dates, sort by date desc
  const haveDate = list.some(i => i.when instanceof Date && !Number.isNaN(i.when));
  if (haveDate) {
    list.sort((a,b) => {
      const ta = a.when ? a.when.getTime() : 0;
      const tb = b.when ? b.when.getTime() : 0;
      return tb - ta;
    });
  }
  return list.slice(0, limit);
}

export const Dashboard = (function() {
  let selectors = { ...DEFAULT_SELECTORS };
  let els = {};
  let unsubUser = null;
  let unsubPlans = null;
  let unsubTx = null;
  let currentUid = null;

  function bind() {
    els.balance = qs(selectors.balance);
    els.profit = qs(selectors.profit);
    els.active = qs(selectors.active);
    els.totalDeposit = qs(selectors.totalDeposit);
    els.totalWithdraw = qs(selectors.totalWithdraw);
    els.recentTbody = qs(selectors.recentTbody);
  }

  function clearUI() {
    if (els.balance) els.balance.textContent = fmtBDT(0);
    if (els.profit) els.profit.textContent = fmtBDT(0);
    if (els.active) els.active.textContent = "0";
    if (els.totalDeposit) els.totalDeposit.textContent = fmtBDT(0);
    if (els.totalWithdraw) els.totalWithdraw.textContent = fmtBDT(0);
    if (els.recentTbody) els.recentTbody.innerHTML = "";
  }

  function renderRecent(list = []) {
    if (!els.recentTbody) return;
    els.recentTbody.innerHTML = "";
    for (const it of list) {
      const tr = document.createElement("tr");
      const dateText = it.when ? new Date(it.when).toLocaleString() : "";
      const typeText = (it.type || "").toUpperCase();
      const amountText = fmtBDT(it.amount);
      tr.innerHTML = `<td>${dateText}</td><td>${typeText}</td><td>${amountText}</td>`;
      els.recentTbody.appendChild(tr);
    }
  }

  function renderFromDoc(docData) {
    if (!docData) { clearUI(); return; }

    // balance
    const balance = tryNumber(docData.balance);
    if (els.balance) els.balance.textContent = fmtBDT(balance);

    // profit — try dailyProfit first, else totalProfit
    const profit = tryNumber(docData.dailyProfit ?? docData.totalProfit ?? docData.total_profit ?? 0);
    if (els.profit) els.profit.textContent = fmtBDT(profit);

    // active plans — check plans array names
    let activeCount = 0;
    if (Array.isArray(docData.plans)) activeCount = docData.plans.length;
    else if (Array.isArray(docData.activePlans)) activeCount = docData.activePlans.length;
    if (els.active) els.active.textContent = String(activeCount || 0);

    // totals
    const tDep = tryNumber(docData.totalDeposit ?? docData.total_deposit ?? 0);
    const tWdr = tryNumber(docData.totalWithdraw ?? docData.total_withdraw ?? docData.total_withdrawn ?? 0);
    if (els.totalDeposit) els.totalDeposit.textContent = fmtBDT(tDep);
    if (els.totalWithdraw) els.totalWithdraw.textContent = fmtBDT(tWdr);

    // recent activity from depositHistory & withdrawHistory (fallback)
    const depsRaw = Array.isArray(docData.depositHistory) ? docData.depositHistory : [];
    const wdrRaw = Array.isArray(docData.withdrawHistory) ? docData.withdrawHistory : [];
    const deps = normalizeHistory(depsRaw, "deposit");
    const wdrs = normalizeHistory(wdrRaw, "withdraw");
    const recent = combineRecent(deps, wdrs, 10);
    renderRecent(recent);
  }

  function start(uid) {
    if (!uid) { console.warn("Dashboard.start: uid required"); return; }
    if (currentUid === uid && unsubUser) return; // already listening

    stop(); // clear previous

    currentUid = uid;
    const userRef = doc(db, "users", uid);

    unsubUser = onSnapshot(userRef, snap => {
      if (!snap.exists()) {
        renderFromDoc(null);
        return;
      }
      const data = snap.data();
      renderFromDoc(data);
    }, err => {
      console.error("Dashboard user snapshot error:", err);
      // on permission error or other, clear UI
      clearUI();
    });

    // Optionally: if you maintain a subcollection transactions, you could listen there too.
    // Example (uncomment if you use a transactions subcollection):
    // const txRef = collection(db, "users", uid, "transactions");
    // const q = query(txRef, orderBy("created_at","desc"), limit(20));
    // unsubTx = onSnapshot(q, qs => { /* build recent from txs */ });

  }

  async function claimDailyProfit(uid) {
    // Safe-guard: only run if doc has dailyProfit > 0 and lastProfitDate == today and not claimed today.
    if (!uid) throw new Error("uid required");
    const userRef = doc(db, "users", uid);

    return runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error("User doc not found");
      const d = snap.data();
      const daily = tryNumber(d.dailyProfit ?? d.daily_profit ?? 0);
      const lastProfitDate = d.lastProfitDate ?? d.last_profit_date ?? null;
      const lastClaimDate = d.lastClaimDate ?? d.last_claim_date ?? null;

      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
      if (!(daily > 0)) throw new Error("No daily profit to claim");
      if (lastProfitDate && lastProfitDate !== today) throw new Error("Daily profit not for today");
      if (lastClaimDate && lastClaimDate === today) throw new Error("Already claimed today");

      const oldBal = tryNumber(d.balance);
      const newBal = oldBal + daily;

      tx.update(userRef, {
        balance: newBal,
        dailyProfit: 0,
        daily_profit: 0,
        lastClaimDate: today,
        last_claim_date: today,
        updatedAt: serverTimestamp()
      });
      return { newBalance: newBal, claimed: daily };
    });
  }

  function stop() {
    if (unsubUser) { unsubUser(); unsubUser = null; }
    if (unsubPlans) { unsubPlans(); unsubPlans = null; }
    if (unsubTx) { unsubTx(); unsubTx = null; }
    currentUid = null;
    clearUI();
  }

  function init(opts = {}) {
    selectors = Object.assign({}, DEFAULT_SELECTORS, opts.selectors || {});
    bind();
    clearUI();
  }

  return {
    init,
    start,
    stop,
    claimDailyProfit // optional — call Dashboard.claimDailyProfit(uid)
  };
})();
