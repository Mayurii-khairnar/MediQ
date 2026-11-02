const API = "";
const $ = (id) => document.getElementById(id);
let patients = [];

function toast(message) {
  const t = $("toast"); t.textContent = message; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function showResult(id, message, error=false) {
  const el = $(id); el.textContent = message; el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}
function statusClass(status) { return String(status || "").toLowerCase().replaceAll(" ", "-"); }
function badge(status) { return `<span class="badge ${statusClass(status)}">${escapeHtml(status)}</span>`; }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function initials(name) { return String(name || "?").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase(); }
async function api(path, options={}) {
  const res = await fetch(API + path, {headers: {"Content-Type":"application/json"}, ...options});
  const data = await res.json().catch(()=>({message:"Unexpected response from server"}));
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}
async function refresh() {
  try {
    const data = await api("/api/patients");
    patients = data.patients || [];
    $("connection").textContent = "Connected to C++ backend";
    renderAll();
  } catch (e) {
    $("connection").textContent = "Backend offline";
    $("connection").style.color = "#e34b5f";
  }
}
function renderAll() {
  const normal = patients.filter(p=>p.status==="Waiting");
  const emergency = patients.filter(p=>p.status==="Emergency Waiting");
  const completed = patients.filter(p=>p.status==="Completed");
  $("stat-total").textContent = patients.length;
  $("stat-normal").textContent = normal.length;
  $("stat-emergency").textContent = emergency.length;
  $("stat-completed").textContent = completed.length;
  $("normal-count").textContent = normal.length;
  $("emergency-count").textContent = emergency.length;
  $("dashboard-queues").innerHTML = [
    ...emergency.slice(0,2).map(p=>previewRow(p,"Emergency")),
    ...normal.slice(0,2).map(p=>previewRow(p,"Normal"))
  ].join("") || `<div class="empty">No patients are waiting.</div>`;
  $("emergency-list").innerHTML = queueRows(emergency);
  $("normal-list").innerHTML = queueRows(normal);
  const sorted = [...patients].sort((a,b)=>b.token-a.token);
  $("recent-table").innerHTML = sorted.slice(0,5).map(p=>`<tr><td><b>#${p.token}</b></td><td><div class="patient-cell"><span class="patient-avatar">${escapeHtml(initials(p.name))}</span><b>${escapeHtml(p.name)}</b></div></td><td>${badge(p.category==="emergency"?"Emergency":"Normal")}</td><td>${escapeHtml(p.problem)}</td><td>${badge(p.status)}</td></tr>`).join("") || emptyRow(5,"No patient records yet.");
  renderPatients();
  const done = [...patients].filter(p=>p.status==="Completed").sort((a,b)=>a.token-b.token);
  $("completed-list").innerHTML = done.map(p=>historyRow(p)).join("") || `<div class="empty">No completed consultations yet.</div>`;
  const recent = [...patients].filter(p=>p.status==="Under Consultation"||p.status==="Completed").sort((a,b)=>b.updatedOrder-a.updatedOrder || b.token-a.token);
  $("recent-list").innerHTML = recent.slice(0,8).map(p=>historyRow(p)).join("") || `<div class="empty">No consultations yet.</div>`;
}
function previewRow(p, category) { return `<div class="preview-row"><span class="patient-avatar">${escapeHtml(initials(p.name))}</span><div class="patient-meta"><b>${escapeHtml(p.name)}</b><small>Token #${p.token} · ${category}</small></div>${badge(p.status)}</div>`; }
function queueRows(list) { return list.map(p=>`<div class="patient-row"><span class="patient-avatar">${escapeHtml(initials(p.name))}</span><div class="patient-meta"><b>${escapeHtml(p.name)}</b><small>ID ${p.id} · Token #${p.token} · Age ${p.age}</small><small>${escapeHtml(p.problem)}</small></div>${badge(p.status)}</div>`).join("") || `<div class="empty">No patients in this queue.</div>`; }
function historyRow(p) { return `<div class="patient-row"><span class="patient-avatar">${escapeHtml(initials(p.name))}</span><div class="patient-meta"><b>${escapeHtml(p.name)}</b><small>ID ${p.id} · Token #${p.token}</small></div>${badge(p.status)}</div>`; }
function emptyRow(cols,msg) { return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`; }
function renderPatients() {
  const q = $("patient-search").value.trim().toLowerCase();
  const list = patients.filter(p=>String(p.id).includes(q)||p.name.toLowerCase().includes(q)||String(p.token).includes(q));
  $("patients-table").innerHTML = list.map(p=>`<tr><td><b>#${p.token}</b></td><td>${p.id}</td><td><div class="patient-cell"><span class="patient-avatar">${escapeHtml(initials(p.name))}</span><b>${escapeHtml(p.name)}</b></div></td><td>${p.age}</td><td>${badge(p.category==="emergency"?"Emergency":"Normal")}</td><td>${escapeHtml(p.problem)}</td><td>${badge(p.status)}</td><td><button class="mini-action" data-complete="${p.id}" ${p.status!=="Under Consultation"?"disabled":""}>Complete</button></td></tr>`).join("") || emptyRow(8,"No matching patient records.");
}
const titles = {dashboard:"Dashboard",register:"Register Patient",queues:"Waiting Queues",patients:"Patient Records",history:"Consultation History"};
function navigate(view) {
  document.querySelectorAll(".view").forEach(el=>el.classList.add("hidden"));
  $("view-"+view).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  $("page-title").textContent = titles[view] || "Dashboard";
  if(view==="patients") renderPatients();
}
document.querySelectorAll(".nav").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.goto)));
$("today").textContent = new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
$("patient-search").addEventListener("input",renderPatients);
$("refresh-patients").addEventListener("click",refresh);

$("register-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const payload = {id:Number($("patient-id").value),name:$("patient-name").value.trim(),age:Number($("patient-age").value),problem:$("patient-problem").value.trim(),category:$("patient-category").value};
  try {
    const result = await api("/api/register",{method:"POST",body:JSON.stringify(payload)});
    showResult("register-result",`Patient registered successfully. Token number: #${result.patient.token}. Status: ${result.patient.status}.`);
    e.target.reset(); await refresh(); toast("Patient registered");
  } catch(err) { showResult("register-result",err.message,true); }
});
async function callNext(resultId) {
  try {
    const result = await api("/api/call-next",{method:"POST",body:"{}"});
    showResult(resultId,`Now under consultation: ${result.patient.name} (ID ${result.patient.id}, token #${result.patient.token}) — ${result.patient.category} patient.`);
    await refresh(); toast("Next patient called");
  } catch(err) { showResult(resultId,err.message,true); }
}
$("call-next").addEventListener("click",()=>callNext("call-result"));
$("call-next-queue").addEventListener("click",()=>callNext("queue-call-result"));
$("complete-form").addEventListener("submit",async e=>{
  e.preventDefault();
  try { const result=await api("/api/complete",{method:"POST",body:JSON.stringify({id:Number($("complete-id").value)})}); showResult("complete-result",result.message); e.target.reset(); await refresh(); toast("Consultation completed"); }
  catch(err){showResult("complete-result",err.message,true);}
});
document.addEventListener("click",async e=>{
  const btn=e.target.closest("[data-complete]"); if(!btn||btn.disabled)return;
  try { const result=await api("/api/complete",{method:"POST",body:JSON.stringify({id:Number(btn.dataset.complete)})}); toast(result.message); await refresh(); }
  catch(err){toast(err.message);}
});
refresh();
setInterval(refresh,5000);
