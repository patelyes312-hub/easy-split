/* =========================================================================
   EasySplit Live — Splitwise-style app
   Routes (hash based):
     #/login            auth page
     #/dashboard        overview across all groups (post-login landing)
     #/groups/:id       group detail (tabs: overview | expenses | members)
   ========================================================================= */

const C = window.APP_CONFIG || {};
const configured =
  C.SUPABASE_URL &&
  !C.SUPABASE_URL.startsWith("PASTE_") &&
  C.SUPABASE_KEY &&
  !C.SUPABASE_KEY.startsWith("PASTE_");

const sb = configured
  ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/* ---------- State ---------- */
let session = null,
  profile = null,
  groups = [],
  signup = false,
  busy = false,
  channel = null,
  charts = {}, // live Chart.js instances keyed by canvas id
  detail = {
    gid: "",
    group: null,
    members: [],
    pending: [],
    isOwner: false,
    expenses: [],
    tab: "overview",
  };

/* ---------- Palette for charts ---------- */
const PALETTE = ["#6c5cf6", "#35ccaf", "#ff8585", "#ffd27a", "#5fb0ff", "#c88bff", "#7ee787", "#ff9d74", "#f178b6", "#8ad6cc"];

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (s) => document.getElementById(s);
const money = (n) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n || 0);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c],
  );
const initials = (name) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
const colorFor = (i) => PALETTE[i % PALETTE.length];

function toast(msg, kind = "success") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  el("toasts").appendChild(t);
  setTimeout(() => {
    t.style.cssText += "opacity:0;transform:translateY(8px);transition:all .2s ease";
    setTimeout(() => t.remove(), 220);
  }, 3200);
}

const setMsg = (text, kind = "error") => {
  const m = el("authMessage");
  m.textContent = text || "";
  m.dataset.kind = text ? kind : "";
};

function destroyCharts() {
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
}

/* =========================================================================
   AUTH
   ========================================================================= */
function applyMode() {
  el("authTitle").textContent = signup ? "Create account" : "Sign in";
  el("authSubmit").textContent = signup ? "Create account" : "Sign in";
  el("authToggle").textContent = signup ? "I already have an account" : "Create an account";
  el("nameLabel").hidden = !signup;
  el("fullName").required = signup;
}
function setBusy(v) {
  busy = v;
  const b = el("authSubmit");
  b.disabled = v;
  b.dataset.loading = v ? "1" : "";
}
function initAuthUI() {
  if (!configured) {
    el("authMessage").innerHTML =
      "Open <b>config.js</b> and paste your Supabase URL and publishable key, then reload.";
    el("authMessage").dataset.kind = "error";
    el("authSubmit").disabled = true;
    el("authToggle").disabled = true;
  }
  el("authToggle").onclick = () => { signup = !signup; setMsg(""); applyMode(); };
  el("togglePw").onclick = () => {
    const pw = el("password");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    el("togglePw").textContent = show ? "Hide" : "Show";
  };
  el("authForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!sb || busy) return;
    setMsg("");
    const email = el("email").value.trim();
    const password = el("password").value;
    const fullName = el("fullName").value.trim();
    if (signup && !fullName) return setMsg("Please enter your full name.");
    setBusy(true);
    try {
      const r = signup
        ? await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
        : await sb.auth.signInWithPassword({ email, password });
      if (r.error) setMsg(r.error.message);
      else if (signup && !r.data.session) {
        setMsg("Account created. Check your email to confirm, then sign in.", "info");
        signup = false;
        applyMode();
      }
    } catch (err) {
      setMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  el("signOut").onclick = async () => { if (sb) await sb.auth.signOut(); };
  el("sideToggle").onclick = () => {
    const open = el("shell").classList.toggle("side-open");
    document.body.classList.toggle("no-scroll", open);
  };
  el("sideBackdrop").onclick = closeDrawer;
  applyMode();
}

/* =========================================================================
   SESSION LIFECYCLE
   ========================================================================= */
async function boot() {
  initAuthUI();
  window.addEventListener("hashchange", route);
  if (!sb) return showAuth();
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => onSession(s));
}

async function onSession(s) {
  const wasLoggedIn = !!session;
  session = s;
  if (s) {
    await loadProfile();
    if (!wasLoggedIn && (!location.hash || location.hash === "#/login")) {
      location.hash = "#/dashboard";
    }
    route();
  } else {
    profile = null;
    groups = [];
    destroyCharts();
    detail = { gid: "", group: null, members: [], pending: [], isOwner: false, expenses: [], tab: "overview" };
    if (channel) { await sb.removeChannel(channel); channel = null; }
    showAuth();
  }
}

async function loadProfile() {
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  profile = data || {
    id: session.user.id,
    full_name: session.user.user_metadata?.full_name || session.user.email,
    email: session.user.email,
  };
  const chip = el("userChip");
  chip.innerHTML = `<span class="dot">${esc(initials(profile.full_name))}</span><div><b style="display:block">${esc(profile.full_name)}</b><span style="font-size:12px;color:var(--muted)">${esc(profile.email)}</span></div>`;
}

function showAuth() { el("auth").hidden = false; el("shell").hidden = true; }
function showShell() { el("auth").hidden = true; el("shell").hidden = false; }

/* =========================================================================
   SIDEBAR NAV
   ========================================================================= */
function renderSidebar(activeKey) {
  const nav = el("sideNav");
  nav.innerHTML = `
    <button class="side-link ${activeKey === "dashboard" ? "active" : ""}" data-nav="#/dashboard">
      <span class="ic">▚</span> Dashboard
    </button>
    <div class="side-section">Groups</div>
    ${
      groups.length
        ? groups
            .map(
              (g) => `<button class="side-link ${activeKey === g.id ? "active" : ""}" data-nav="#/groups/${g.id}">
                <span class="ic">${esc(initials(g.name))}</span> ${esc(g.name)}
              </button>`,
            )
            .join("")
        : `<p class="muted" style="font-size:13px;padding:4px 10px">No groups yet</p>`
    }
    <button class="side-link" id="navNewGroup"><span class="ic">+</span> New group</button>`;
  nav.querySelectorAll("[data-nav]").forEach((b) => {
    b.onclick = () => {
      location.hash = b.dataset.nav;
      closeDrawer();
    };
  });
  el("navNewGroup").onclick = () => { closeDrawer(); openNewGroup(); };
}

function closeDrawer() {
  el("shell").classList.remove("side-open");
  document.body.classList.remove("no-scroll");
}

/* =========================================================================
   ROUTER
   ========================================================================= */
function parseHash() {
  return (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
}
async function route() {
  if (!session) return showAuth();
  showShell();
  const parts = parseHash();
  if (parts[0] === "groups" && parts[1]) {
    await renderGroupDetail(parts[1]);
  } else if (parts[0] === "dashboard") {
    await renderDashboard();
  } else {
    location.hash = "#/dashboard";
  }
}
function loading() {
  destroyCharts();
  el("view").innerHTML = `<div class="loader"><div class="spinner"></div>Loading…</div>`;
}

/* ---------- Fetch all groups with members + expenses (for dashboard) ---------- */
async function fetchGroupsFull() {
  const { data: gs, error } = await sb.from("groups").select("*").order("created_at");
  if (error) throw error;
  groups = gs || [];
  const full = await Promise.all(
    groups.map(async (g) => {
      const [m, e] = await Promise.all([
        sb.from("group_members").select("*").eq("group_id", g.id),
        sb.from("expenses").select("*,expense_splits(*)").eq("group_id", g.id),
      ]);
      return { group: g, members: m.data || [], expenses: e.data || [] };
    }),
  );
  return full;
}

// Net balance for the current user inside one group: +owed / -owe
function myBalanceInGroup(bundle) {
  const me = bundle.members.find((x) => x.user_id === session.user.id && x.status !== "pending");
  if (!me) return 0;
  let net = 0;
  bundle.expenses.forEach((e) => {
    if (e.paid_by_member_id === me.id) net += Number(e.amount);
    (e.expense_splits || []).forEach((s) => {
      if (s.member_id === me.id) net -= Number(s.amount);
    });
  });
  return net;
}

/* =========================================================================
   VIEW: DASHBOARD
   ========================================================================= */
async function renderDashboard() {
  if (channel) { await sb.removeChannel(channel); channel = null; }
  renderSidebar("dashboard");
  loading();
  let full;
  try {
    full = await fetchGroupsFull();
  } catch (err) {
    el("view").innerHTML = `<div class="empty">Could not load dashboard. ${esc(err.message)}</div>`;
    return;
  }
  renderSidebar("dashboard");

  let totalOwe = 0, totalOwed = 0, grandSpend = 0;
  const perGroup = full.map((b) => {
    const net = myBalanceInGroup(b);
    if (net < -0.005) totalOwe += -net;
    else if (net > 0.005) totalOwed += net;
    const real = b.expenses.filter((e) => e.kind !== "settlement");
    const spend = real.reduce((a, e) => a + Number(e.amount), 0);
    grandSpend += spend;
    return { id: b.group.id, name: b.group.name, net, spend, members: b.members.filter((m) => m.status !== "pending").length, count: real.length };
  });
  const netTotal = totalOwed - totalOwe;

  // recent activity across all groups
  const activity = full
    .flatMap((b) => b.expenses.map((e) => ({ ...e, gname: b.group.name })))
    .sort((a, z) => new Date(z.created_at) - new Date(a.created_at))
    .slice(0, 8);

  el("view").innerHTML = `
    <div class="page-head">
      <div>
        <p class="crumb">Overview</p>
        <h1>Hi ${esc((profile.full_name || "").split(" ")[0] || "there")} 👋</h1>
        <p class="muted">Here's where you stand across all your groups.</p>
      </div>
      <button class="btn-primary" id="dashNewGroup">+ New group</button>
    </div>

    <div class="summary">
      <div class="sum-card owe"><small>You owe</small><strong>${money(totalOwe)}</strong></div>
      <div class="sum-card owed"><small>You are owed</small><strong>${money(totalOwed)}</strong></div>
      <div class="sum-card"><small>Net balance</small><strong class="${netTotal >= 0 ? "positive" : "negative"}">${money(netTotal)}</strong></div>
    </div>

    <div class="two-col">
      <section class="panel">
        <div class="panel-title"><div><h2>Spending by group</h2><p>Total ${money(grandSpend)}</p></div></div>
        ${
          grandSpend > 0
            ? `<div class="chart-wrap"><canvas id="dashChart"></canvas></div>
               <div class="chart-legend">${perGroup
                 .filter((g) => g.spend > 0)
                 .map((g, i) => `<div class="legend-item"><span class="sw" style="background:${colorFor(i)}"></span>${esc(g.name)}<span class="amt">${money(g.spend)}</span></div>`)
                 .join("")}</div>`
            : '<div class="empty">No spending yet. Add an expense to see the breakdown.</div>'
        }
      </section>

      <section class="panel">
        <div class="panel-title"><div><h2>Your groups</h2><p>${perGroup.length} total</p></div></div>
        ${
          perGroup.length
            ? perGroup
                .map(
                  (g) => `<div class="row" data-open="${g.id}" style="cursor:pointer">
                    <span class="avatar">${esc(initials(g.name))}</span>
                    <div class="grow"><b>${esc(g.name)}</b><span>${g.members} members · ${g.count} expenses</span></div>
                    <strong class="${g.net >= 0 ? "positive" : "negative"}">${g.net >= 0 ? "+" : ""}${money(g.net)}</strong>
                  </div>`,
                )
                .join("")
            : '<div class="empty">No groups yet. Create one to get started.</div>'
        }
      </section>
    </div>

    <section class="panel" style="margin-top:15px">
      <div class="panel-title"><div><h2>Recent activity</h2><p>Latest expenses everywhere</p></div></div>
      ${
        activity.length
          ? activity
              .map(
                (e) => `<div class="row">
                  <span class="avatar">£</span>
                  <div class="grow"><b>${esc(e.description)}</b><span>${esc(e.gname)} · ${esc(e.expense_date)}</span></div>
                  <strong>${money(Number(e.amount))}</strong>
                </div>`,
              )
              .join("")
          : '<div class="empty">No activity yet.</div>'
      }
    </section>`;

  el("dashNewGroup").onclick = openNewGroup;
  document.querySelectorAll("[data-open]").forEach((r) => (r.onclick = () => (location.hash = `#/groups/${r.dataset.open}`)));

  // draw doughnut
  const spendData = perGroup.filter((g) => g.spend > 0);
  if (spendData.length) {
    const ctx = el("dashChart");
    charts.dash = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: spendData.map((g) => g.name),
        datasets: [{ data: spendData.map((g) => g.spend), backgroundColor: spendData.map((_, i) => colorFor(i)), borderColor: "#121928", borderWidth: 3 }],
      },
      options: { plugins: { legend: { display: false } }, cutout: "62%", maintainAspectRatio: false },
    });
  }
}

/* =========================================================================
   GROUP: create
   ========================================================================= */
function openNewGroup() {
  modal(
    "Create a group",
    '<label>Group name<input name="name" required placeholder="Scotland trip"></label>',
    async (f) => {
      const name = f.get("name").trim();
      if (!name) { toast("Please enter a group name.", "error"); return false; }
      const { data, error } = await sb.rpc("create_group", { p_name: name });
      if (error) { toast(error.message, "error"); return false; }
      toast("Group created.");
      location.hash = `#/groups/${data}`;
    },
  );
}

async function deleteGroup(gid, name) {
  if (!confirm(`Delete "${name}"? This removes all its members, expenses and settlements. This cannot be undone.`)) return;
  const { error } = await sb.rpc("delete_group", { p_group_id: gid });
  if (error) return toast(error.message, "error");
  toast("Group deleted.");
  if (channel) { await sb.removeChannel(channel); channel = null; }
  detail.gid = "";
  location.hash = "#/dashboard";
}

/* =========================================================================
   VIEW: GROUP DETAIL
   ========================================================================= */
async function renderGroupDetail(gid) {
  const sameGroup = detail.gid === gid;
  detail.gid = gid;
  if (!sameGroup) detail.tab = "overview";
  renderSidebar(gid);
  loading();
  await loadGroupData(gid);
  if (!detail.group) {
    el("view").innerHTML = `<div class="empty">Group not found or you don't have access yet.</div>`;
    return;
  }
  renderSidebar(gid);
  subscribe(gid);
  paintDetail();
}

async function loadGroupData(gid) {
  const [g, m, e] = await Promise.all([
    sb.from("groups").select("*").eq("id", gid).maybeSingle(),
    sb.from("group_members").select("*").eq("group_id", gid).order("created_at"),
    sb.from("expenses").select("*,expense_splits(*)").eq("group_id", gid).order("created_at"),
  ]);
  detail.group = g.data || null;
  const all = m.data || [];
  detail.members = all.filter((x) => x.status !== "pending");
  detail.pending = all.filter((x) => x.status === "pending");
  detail.isOwner = all.some((x) => x.user_id === session?.user?.id && x.role === "owner");
  detail.expenses = e.data || [];
}

function subscribe(gid) {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("live-" + gid)
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `group_id=eq.${gid}` }, () => refreshDetail(gid))
    .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" }, () => refreshDetail(gid))
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${gid}` }, () => refreshDetail(gid))
    .subscribe();
}
async function refreshDetail(gid) {
  if (detail.gid !== gid) return;
  await loadGroupData(gid);
  paintDetail();
}

/* ---------- Balance math ---------- */
function computeBalances() {
  const b = Object.fromEntries(detail.members.map((m) => [m.id, 0]));
  detail.expenses.forEach((e) => {
    b[e.paid_by_member_id] = (b[e.paid_by_member_id] || 0) + Number(e.amount);
    (e.expense_splits || []).forEach((s) => (b[s.member_id] = (b[s.member_id] || 0) - Number(s.amount)));
  });
  return b;
}
function spendByMember() {
  // how much each member PAID on real expenses (settlements excluded from charts)
  const paid = Object.fromEntries(detail.members.map((m) => [m.id, 0]));
  detail.expenses
    .filter((e) => e.kind !== "settlement")
    .forEach((e) => (paid[e.paid_by_member_id] = (paid[e.paid_by_member_id] || 0) + Number(e.amount)));
  return paid;
}
function settleUp(b) {
  let owe = Object.entries(b).filter(([, n]) => n < -0.005).map(([id, n]) => ({ id, n: -n })),
    get = Object.entries(b).filter(([, n]) => n > 0.005).map(([id, n]) => ({ id, n })),
    out = [], i = 0, j = 0;
  while (i < owe.length && j < get.length) {
    const n = Math.min(owe[i].n, get[j].n);
    out.push({ from: owe[i].id, to: get[j].id, n });
    owe[i].n -= n; get[j].n -= n;
    if (owe[i].n < 0.005) i++;
    if (get[j].n < 0.005) j++;
  }
  return out;
}
const nm = (id) => esc(detail.members.find((m) => m.id === id)?.display_name || "Unknown");

/* ---------- Painters ---------- */
function paintDetail() {
  destroyCharts();
  const g = detail.group;
  const realExpenses = detail.expenses.filter((e) => e.kind !== "settlement");
  const total = realExpenses.reduce((a, e) => a + Number(e.amount), 0);
  el("view").innerHTML = `
    <div class="page-head">
      <div>
        <p class="crumb"><a href="#/dashboard">← Dashboard</a></p>
        <h1>${esc(g.name)} <small class="online">● live</small></h1>
      </div>
      <div class="head-actions">
        ${detail.isOwner ? `<button class="btn-ghost" id="deleteGroup">Delete group</button>` : ""}
        <button class="btn-primary" id="addExpense">+ Add expense</button>
      </div>
    </div>
    <div class="summary">
      <div class="sum-card"><small>Total spent</small><strong>${money(total)}</strong></div>
      <div class="sum-card"><small>Members</small><strong>${detail.members.length}</strong></div>
      <div class="sum-card"><small>Expenses</small><strong>${realExpenses.length}</strong></div>
    </div>
    <div class="tabs">
      <button class="tab" data-tab="overview">Overview</button>
      <button class="tab" data-tab="expenses">Expenses</button>
      <button class="tab" data-tab="members">Members${detail.pending.length ? ` <span class="badge warn">${detail.pending.length}</span>` : ""}</button>
    </div>
    <div id="tabBody"></div>`;
  el("addExpense").onclick = openAddExpense;
  const delBtn = el("deleteGroup");
  if (delBtn) delBtn.onclick = () => deleteGroup(detail.gid, g.name);
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === detail.tab);
    t.onclick = () => {
      detail.tab = t.dataset.tab;
      paintTab();
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === detail.tab));
    };
  });
  paintTab();
}

function paintTab() {
  destroyCharts();
  const body = el("tabBody");
  if (detail.tab === "overview") { body.innerHTML = tabOverview(); drawGroupChart(); }
  else if (detail.tab === "expenses") body.innerHTML = tabExpenses();
  else body.innerHTML = tabMembers();
  wireTabActions();
}

function tabOverview() {
  const b = computeBalances();
  const ds = settleUp(b);
  const paid = spendByMember();
  const total = Object.values(paid).reduce((a, n) => a + n, 0);
  const paidRows = detail.members
    .map((m) => ({ m, v: paid[m.id] || 0 }))
    .filter((x) => x.v > 0)
    .sort((a, z) => z.v - a.v);
  return `<div class="two-col">
    <section class="panel">
      <div class="panel-title"><div><h2>Who paid what</h2><p>Share of total ${money(total)}</p></div></div>
      ${
        total > 0
          ? `<div class="chart-wrap"><canvas id="groupChart"></canvas></div>
             <div class="chart-legend">${paidRows
               .map((x, i) => `<div class="legend-item"><span class="sw" style="background:${colorFor(i)}"></span>${esc(x.m.display_name)}<span class="amt">${money(x.v)} <span class="pct">${((x.v / total) * 100).toFixed(0)}%</span></span></div>`)
               .join("")}</div>`
          : '<div class="empty">No expenses yet.</div>'
      }
    </section>
    <section class="panel">
      <div class="panel-title"><div><h2>Settle up</h2><p>Fewest payments to clear balances</p></div></div>
      ${
        ds.length
          ? ds.map((d) => `<div class="row"><div class="grow"><b>${nm(d.from)} → ${nm(d.to)}</b><span>Suggested payment</span></div><strong class="negative">${money(d.n)}</strong><button class="btn-primary sm" data-settle="${d.from}|${d.to}|${d.n.toFixed(2)}">Settle</button></div>`).join("")
          : '<div class="empty">Everything is settled 🎉</div>'
      }
      <div class="panel-title" style="margin-top:18px"><div><h2>Balances</h2><p>Net per member</p></div></div>
      ${detail.members
        .map((m) => `<div class="row"><span class="avatar">${esc(initials(m.display_name))}</span><div class="grow"><b>${esc(m.display_name)}</b><span>${(b[m.id] || 0) >= 0 ? "is owed" : "owes"}</span></div><strong class="${(b[m.id] || 0) >= 0 ? "positive" : "negative"}">${money(Math.abs(b[m.id] || 0))}</strong></div>`)
        .join("")}
    </section>
  </div>`;
}

function drawGroupChart() {
  const paid = spendByMember();
  const rows = detail.members.map((m) => ({ m, v: paid[m.id] || 0 })).filter((x) => x.v > 0).sort((a, z) => z.v - a.v);
  const ctx = el("groupChart");
  if (!ctx || !rows.length) return;
  charts.group = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: rows.map((x) => x.m.display_name),
      datasets: [{ data: rows.map((x) => x.v), backgroundColor: rows.map((_, i) => colorFor(i)), borderColor: "#121928", borderWidth: 3 }],
    },
    options: { plugins: { legend: { display: false } }, cutout: "62%", maintainAspectRatio: false },
  });
}

function tabExpenses() {
  return `<section class="panel">
    <div class="panel-title">
      <div><h2>All expenses</h2><p>Newest first</p></div>
      <button class="btn-ghost sm" id="csv">Download CSV</button>
    </div>
    ${
      detail.expenses.length
        ? [...detail.expenses].reverse().map((e) => {
            const total = Number(e.amount);
            if (e.kind === "settlement") {
              const to = (e.expense_splits || [])[0];
              return `<div class="row"><span class="avatar" style="background:#1f4a3a;color:#7ee7b6">✓</span><div class="grow"><b>Payment <span class="badge">settled</span></b><span>${esc(e.expense_date)} · ${nm(e.paid_by_member_id)} paid ${to ? nm(to.member_id) : "someone"}</span></div><strong class="positive">${money(total)}</strong><button class="delete" data-del="${e.id}">Delete</button></div>`;
            }
            const splits = (e.expense_splits || [])
              .map((s) => `${nm(s.member_id)} ${total > 0 ? ((Number(s.amount) / total) * 100).toFixed(0) : 0}%`)
              .join(" · ");
            const rurl = receiptUrl(e.receipt_path);
            const thumb = rurl
              ? `<img class="receipt-thumb" src="${esc(rurl)}" alt="receipt" data-receipt="${esc(rurl)}" title="View receipt">`
              : "";
            return `<div class="row"><span class="avatar">£</span><div class="grow"><b>${esc(e.description)}</b><span>${esc(e.expense_date)} · paid by ${nm(e.paid_by_member_id)}${splits ? " · " + splits : ""}</span></div>${thumb}<strong>${money(total)}</strong><button class="delete" data-del="${e.id}">Delete</button></div>`;
          }).join("")
        : '<div class="empty">No expenses yet. Add your first one.</div>'
    }
  </section>`;
}

function tabMembers() {
  const b = computeBalances();
  const isOwner = detail.isOwner;
  const pendingPanel = detail.pending.length
    ? `<section class="panel" style="margin-bottom:15px">
        <div class="panel-title"><div><h2>Pending requests <span class="badge warn">${detail.pending.length}</span></h2>
        <p>${isOwner ? "Approve to give access to this group" : "Waiting for the group owner to approve"}</p></div></div>
        ${detail.pending.map((m) => `<div class="row">
          <span class="avatar pending-av">${esc(initials(m.display_name))}</span>
          <div class="grow"><b>${esc(m.display_name)} <span class="badge warn">pending</span></b><span>${esc(m.email || "")}</span></div>
          ${isOwner ? `<button class="btn-primary sm" data-approve="${m.id}">Approve</button><button class="btn-ghost sm" data-reject="${m.id}">Reject</button>` : ""}
        </div>`).join("")}
      </section>`
    : "";
  const membersPanel = `<section class="panel">
    <div class="panel-title"><div><h2>Members</h2><p>${isOwner ? "You are the owner — you approve new members" : "People in this group"}</p></div>
    <button class="btn-ghost sm" id="addMember">+ Invite member</button></div>
    ${detail.members.length
      ? detail.members.map((m) => `<div class="row">
          <span class="avatar">${esc(initials(m.display_name))}</span>
          <div class="grow"><b>${esc(m.display_name)} ${m.role === "owner" ? '<span class="badge">owner</span>' : ""}</b><span>${esc(m.email || "Member")}</span></div>
          <strong class="${(b[m.id] || 0) >= 0 ? "positive" : "negative"}">${money(Math.abs(b[m.id] || 0))}</strong>
          ${isOwner && m.role !== "owner" ? `<button class="delete" data-remove="${m.id}">Remove</button>` : ""}
        </div>`).join("")
      : '<div class="empty">No members yet</div>'}
  </section>`;
  return pendingPanel + membersPanel;
}

function wireTabActions() {
  const csv = el("csv");
  if (csv) csv.onclick = downloadCsv;
  const addMember = el("addMember");
  if (addMember) addMember.onclick = openAddMember;

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this record?")) return;
      const { error } = await sb.from("expenses").delete().eq("id", btn.dataset.del);
      if (error) toast(error.message, "error"); else toast("Deleted.");
    };
  });
  document.querySelectorAll("[data-receipt]").forEach((img) => {
    img.onclick = () => openLightbox(img.dataset.receipt);
  });
  document.querySelectorAll("[data-settle]").forEach((btn) => {
    btn.onclick = () => {
      const [from, to, amt] = btn.dataset.settle.split("|");
      openSettle(from, to, Number(amt));
    };
  });
  document.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const { error } = await sb.rpc("approve_group_member", { p_member_id: btn.dataset.approve });
      if (error) { toast(error.message, "error"); btn.disabled = false; }
      else { toast("Member approved."); await refreshDetail(detail.gid); }
    };
  });
  document.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Reject this request?")) return;
      btn.disabled = true;
      const { error } = await sb.rpc("remove_group_member", { p_member_id: btn.dataset.reject });
      if (error) { toast(error.message, "error"); btn.disabled = false; }
      else { toast("Request rejected."); await refreshDetail(detail.gid); }
    };
  });
  document.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Remove this member?")) return;
      const { error } = await sb.rpc("remove_group_member", { p_member_id: btn.dataset.remove });
      if (error) toast(error.message, "error"); else { toast("Member removed."); await refreshDetail(detail.gid); }
    };
  });
}

/* ---------- Detail actions ---------- */
function openAddMember() {
  modal(
    "Invite a registered user",
    '<label>Email<input name="email" type="email" required placeholder="friend@example.com"></label><p class="muted">They must have an account first. New invites join as <b>pending</b> until the group owner approves them.</p>',
    async (f) => {
      const { error } = await sb.rpc("add_group_member_by_email", { p_group_id: detail.gid, p_email: f.get("email").trim() });
      if (error) { toast(error.message, "error"); return false; }
      toast("Invite sent — awaiting owner approval.");
      await refreshDetail(detail.gid);
    },
  );
}

/* ---------- Settle up: record a payment that clears a balance ---------- */
function openSettle(fromId, toId, suggested) {
  const fromName = nm(fromId);
  const toName = nm(toId);
  modal(
    "Record a payment",
    `<p class="muted"><b>${fromName}</b> pays <b>${toName}</b> to settle up. Record the amount already paid.</p>
     <label>Amount (£)<input name="amount" type="number" min="0.01" step="0.01" value="${suggested.toFixed(2)}" required></label>`,
    async (f) => {
      const amount = Number(f.get("amount"));
      if (!(amount > 0)) { toast("Enter an amount greater than zero.", "error"); return false; }
      return recordSettlement(fromId, toId, amount);
    },
  );
}

// A settlement is stored as an expense paid by the debtor (from) with a single
// split assigned to the creditor (to). That offsets the balance: the payer's
// net goes up by `amount`, the receiver's net goes down by `amount`.
async function recordSettlement(fromId, toId, amount) {
  const fromName = detail.members.find((m) => m.id === fromId)?.display_name || "Someone";
  const toName = detail.members.find((m) => m.id === toId)?.display_name || "someone";
  const { data, error } = await sb
    .from("expenses")
    .insert({
      group_id: detail.gid,
      description: `${fromName} paid ${toName}`,
      amount,
      paid_by_member_id: fromId,
      created_by: session.user.id,
      kind: "settlement",
    })
    .select("id")
    .single();
  if (error) { toast(error.message, "error"); return false; }
  const r = await sb
    .from("expense_splits")
    .insert([{ expense_id: data.id, member_id: toId, amount }]);
  if (r.error) {
    await sb.from("expenses").delete().eq("id", data.id);
    toast(r.error.message, "error");
    return false;
  }
  toast("Payment recorded.");
  await refreshDetail(detail.gid);
}

/* ---------- Add expense with split modes ---------- */
function openAddExpense() {
  if (!detail.members.length) return toast("Add members to this group first.", "error");
  const ms = detail.members;
  el("modalTitle").textContent = "Add expense";
  el("fields").innerHTML = `
    <label>Description<input name="desc" id="xDesc" required placeholder="Dinner"></label>
    <label>Amount (£)<input name="amount" id="xAmount" type="number" min="0.01" step="0.01" required></label>
    <label>Receipt / bill image (optional)<input type="file" id="xReceipt" accept="image/*"></label>
    <div id="xReceiptPreview"></div>
    <label>Paid by<select name="payer" id="xPayer">${ms.map((m) => `<option value="${m.id}">${esc(m.display_name)}</option>`).join("")}</select></label>
    <label>Split method</label>
    <div class="seg" id="xMode">
      <button type="button" data-mode="equal" class="active">Equally</button>
      <button type="button" data-mode="percent">By %</button>
      <button type="button" data-mode="exact">Exact £</button>
    </div>
    <div class="split-list" id="xSplits"></div>
    <div class="split-total" id="xTotal"></div>`;

  let mode = "equal";
  const state = Object.fromEntries(ms.map((m) => [m.id, { on: true, val: 0 }]));

  const amountEl = () => Number(el("xAmount").value) || 0;

  function renderSplits() {
    const amt = amountEl();
    const on = ms.filter((m) => state[m.id].on);
    el("xSplits").innerHTML = ms
      .map((m) => {
        const s = state[m.id];
        let right = "";
        if (mode === "equal") {
          const each = on.length ? amt / on.length : 0;
          right = `<span class="nm-amt muted">${s.on ? money(each) : "—"}</span>`;
        } else if (mode === "percent") {
          right = `<input type="number" min="0" max="100" step="0.01" class="xval" data-id="${m.id}" value="${s.val || ""}" ${s.on ? "" : "disabled"} placeholder="0"> <span class="muted">%</span>`;
        } else {
          right = `<input type="number" min="0" step="0.01" class="xval" data-id="${m.id}" value="${s.val || ""}" ${s.on ? "" : "disabled"} placeholder="0.00">`;
        }
        return `<div class="split-row">
          <input type="checkbox" class="chk" data-chk="${m.id}" ${s.on ? "checked" : ""}>
          <span class="nm">${esc(m.display_name)}</span>
          ${right}
        </div>`;
      })
      .join("");

    el("xSplits").querySelectorAll("[data-chk]").forEach((c) => {
      c.onchange = () => { state[c.dataset.chk].on = c.checked; renderSplits(); };
    });
    el("xSplits").querySelectorAll(".xval").forEach((inp) => {
      inp.oninput = () => { state[inp.dataset.id].val = Number(inp.value) || 0; updateTotal(); };
    });
    updateTotal();
  }

  function updateTotal() {
    const amt = amountEl();
    const on = ms.filter((m) => state[m.id].on);
    const t = el("xTotal");
    if (mode === "equal") {
      t.className = "split-total ok";
      t.textContent = on.length ? `Split equally: ${money(amt / on.length)} each` : "Select at least one member";
    } else if (mode === "percent") {
      const sum = on.reduce((a, m) => a + (state[m.id].val || 0), 0);
      const ok = Math.abs(sum - 100) < 0.01;
      t.className = "split-total " + (ok ? "ok" : "bad");
      t.textContent = `Percentages total ${sum.toFixed(2)}% ${ok ? "✓" : "(must be 100%)"}`;
    } else {
      const sum = on.reduce((a, m) => a + (state[m.id].val || 0), 0);
      const ok = Math.abs(sum - amt) < 0.01 && amt > 0;
      t.className = "split-total " + (ok ? "ok" : "bad");
      t.textContent = `Entered ${money(sum)} of ${money(amt)} ${ok ? "✓" : "(must match amount)"}`;
    }
  }

  el("xMode").querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      el("xMode").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderSplits();
    };
  });
  el("xAmount").oninput = renderSplits;
  renderSplits();

  el("xReceipt").onchange = () => {
    const f = el("xReceipt").files?.[0];
    const prev = el("xReceiptPreview");
    if (f) prev.innerHTML = `<img class="receipt-preview" src="${URL.createObjectURL(f)}" alt="receipt preview">`;
    else prev.innerHTML = "";
  };

  el("modal").showModal();
  el("form").onsubmit = async (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    const save = el("save");
    save.disabled = true;
    try {
      const ok = await submitExpense(mode, state);
      if (ok !== false) el("modal").close();
    } finally {
      save.disabled = false;
    }
  };
}

async function submitExpense(mode, state) {
  const ms = detail.members;
  const desc = el("xDesc").value.trim();
  const amount = Number(el("xAmount").value);
  const payer = el("xPayer").value;
  const on = ms.filter((m) => state[m.id].on);
  if (!desc) { toast("Enter a description.", "error"); return false; }
  if (!(amount > 0)) { toast("Enter an amount greater than zero.", "error"); return false; }
  if (!on.length) { toast("Select at least one member.", "error"); return false; }

  let splits = [];
  if (mode === "equal") {
    const each = Math.floor((amount * 100) / on.length) / 100;
    splits = on.map((m, i) => ({
      member_id: m.id,
      amount: i === on.length - 1 ? Math.round((amount - each * (on.length - 1)) * 100) / 100 : each,
    }));
  } else if (mode === "percent") {
    const sum = on.reduce((a, m) => a + (state[m.id].val || 0), 0);
    if (Math.abs(sum - 100) > 0.01) { toast("Percentages must add up to 100%.", "error"); return false; }
    let acc = 0;
    splits = on.map((m, i) => {
      let amt = Math.round(((state[m.id].val / 100) * amount) * 100) / 100;
      if (i === on.length - 1) amt = Math.round((amount - acc) * 100) / 100;
      acc += amt;
      return { member_id: m.id, amount: amt };
    });
  } else {
    const sum = on.reduce((a, m) => a + (state[m.id].val || 0), 0);
    if (Math.abs(sum - amount) > 0.01) { toast("Exact amounts must add up to the total.", "error"); return false; }
    splits = on.map((m) => ({ member_id: m.id, amount: Math.round((state[m.id].val || 0) * 100) / 100 }));
  }

  const receiptFile = el("xReceipt")?.files?.[0] || null;
  if (receiptFile && !receiptFile.type.startsWith("image/")) {
    toast("Receipt must be an image file.", "error");
    return false;
  }
  if (receiptFile && receiptFile.size > 5 * 1024 * 1024) {
    toast("Receipt image must be under 5 MB.", "error");
    return false;
  }

  const { data, error } = await sb
    .from("expenses")
    .insert({ group_id: detail.gid, description: desc, amount, paid_by_member_id: payer, created_by: session.user.id })
    .select("id")
    .single();
  if (error) { toast(error.message, "error"); return false; }
  const r = await sb.from("expense_splits").insert(splits.map((x) => ({ ...x, expense_id: data.id })));
  if (r.error) {
    await sb.from("expenses").delete().eq("id", data.id);
    toast(r.error.message, "error");
    return false;
  }

  // Optional receipt upload. If it fails, the expense still saves (receipt is best-effort).
  if (receiptFile) {
    const ext = (receiptFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${detail.gid}/${data.id}.${ext}`;
    const up = await sb.storage.from("receipts").upload(path, receiptFile, {
      upsert: true,
      contentType: receiptFile.type,
    });
    if (up.error) {
      toast("Expense saved, but the receipt failed to upload: " + up.error.message, "error");
    } else {
      await sb.from("expenses").update({ receipt_path: path }).eq("id", data.id);
    }
  }

  toast("Expense added.");
  await refreshDetail(detail.gid);
}

// Resolve a storage path to a public URL for display.
function receiptUrl(path) {
  if (!path) return null;
  return sb.storage.from("receipts").getPublicUrl(path).data.publicUrl;
}

// Full-screen image viewer for a receipt.
function openLightbox(url) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `<img src="${esc(url)}" alt="receipt"><button class="lightbox-close" aria-label="Close">×</button>`;
  const close = () => box.remove();
  box.onclick = (e) => { if (e.target === box || e.target.classList.contains("lightbox-close")) close(); };
  document.body.appendChild(box);
}

function downloadCsv() {
  const rows = [
    ["Date", "Description", "Amount", "Paid by"],
    ...detail.expenses.map((e) => [e.expense_date, e.description, e.amount, detail.members.find((m) => m.id === e.paid_by_member_id)?.display_name || ""]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${detail.group?.name || "expenses"}.csv`;
  a.click();
}

/* =========================================================================
   MODAL (generic)
   ========================================================================= */
function modal(title, html, onSave) {
  el("modalTitle").textContent = title;
  el("fields").innerHTML = html;
  el("modal").showModal();
  el("form").onsubmit = async (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    const save = el("save");
    save.disabled = true;
    try {
      const ok = await onSave(new FormData(e.target));
      if (ok !== false) el("modal").close();
    } finally {
      save.disabled = false;
    }
  };
}

boot();
