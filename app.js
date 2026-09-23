/* ===========================================================
   BoxPro — painel do assinante (Supabase: multi-tenant real)
   Reaproveita a arquitetura do AgendaPro: login isolado, cobrança
   recorrente via Mercado Pago, marca/cor personalizada.
   =========================================================== */

const BACKEND_URL = "https://agendapro-backend-1n92.onrender.com";
const PLAN_LIMITS = {
  basico: { mecanicos: 2, relatorioCompleto: false, logoPersonalizado: false, fundoCarbono: false },
  pro:    { mecanicos: 8, relatorioCompleto: true,  logoPersonalizado: true,  fundoCarbono: true }
};
function planoAtual(){ return PLAN_LIMITS[OFICINA.subscription_plan] || PLAN_LIMITS.pro; }

const STATUS_FLOW = ["recebido","orcamento","aprovado","em_servico","pronto","entregue"];
const STATUS_LABEL = { recebido:"Recebido", orcamento:"Orçamento", aprovado:"Aprovado", em_servico:"Em Serviço", pronto:"Pronto", entregue:"Entregue", cancelado:"Cancelado" };
function proximoStatus(s){ const i = STATUS_FLOW.indexOf(s); return STATUS_FLOW[i+1] || null; }

let CURRENT_USER = null;
let OFICINA = null;
let MECANICOS = [];
let SERVICOS = [];
let ORDENS = [];

function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function formatDateBR(dateStr){ if(!dateStr) return "—"; const [y,m,d] = dateStr.split("-"); return `${d}/${m}/${y}`; }
function timeShort(t){ return t ? t.slice(0,5) : t; }

/* ---------------- AUTH / BOOTSTRAP ---------------- */
async function boot(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ window.location.href = "login.html"; return; }
  CURRENT_USER = session.user;
  await loadOrCreateOficina();
  if(isSubscriptionBlocked()){ renderSubscriptionGate(); return; }
  await loadAll();
  fillConfigForm();
  applyBrand();
  await renderSponsorBanner();
  refreshAll();

  const mpParam = new URLSearchParams(window.location.search).get("mp");
  if(mpParam){
    if(mpParam === "conectado") alert("Mercado Pago conectado com sucesso! Os pagamentos dos seus clientes já caem direto na sua conta.");
    else if(mpParam === "erro") alert("Não foi possível conectar o Mercado Pago. Tente novamente.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

document.getElementById("logoutBtn").addEventListener("click", async ()=>{
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

async function loadOrCreateOficina(){
  let { data: of } = await supabaseClient.from("oficinas").select("*").eq("owner_id", CURRENT_USER.id).maybeSingle();
  if(!of){
    const slug = "oficina-" + Math.random().toString(36).slice(2,8);
    const { data: nova, error } = await supabaseClient.from("oficinas")
      .insert({ owner_id: CURRENT_USER.id, slug, name: "Minha Oficina", segmento: "ambos" })
      .select().single();
    if(error){ alert("Erro ao criar oficina: " + error.message); return; }
    of = nova;
  }
  OFICINA = of;
}

async function loadAll(){
  const [{ data: mecs }, { data: servs }, { data: ords }] = await Promise.all([
    supabaseClient.from("mecanicos").select("*").eq("oficina_id", OFICINA.id).order("created_at"),
    supabaseClient.from("servicos").select("*").eq("oficina_id", OFICINA.id).order("created_at"),
    supabaseClient.from("ordens_servico").select("*").eq("oficina_id", OFICINA.id).order("created_at", { ascending: false })
  ]);
  MECANICOS = mecs || [];
  SERVICOS = servs || [];
  ORDENS = (ords || []).map(o => ({ ...o, horario: timeShort(o.horario) }));
}

/* ---------------- ASSINATURA (Mercado Pago) ---------------- */
function isSubscriptionBlocked(){
  if(OFICINA.subscription_status === "inadimplente" || OFICINA.subscription_status === "cancelado") return true;
  if(OFICINA.subscription_status === "trial" && !OFICINA.subscription_plan && OFICINA.trial_expires_at && new Date(OFICINA.trial_expires_at) < new Date()) return true;
  return false;
}
function trialExpirado(){
  return OFICINA.subscription_status === "trial" && !OFICINA.subscription_plan && OFICINA.trial_expires_at && new Date(OFICINA.trial_expires_at) < new Date();
}
async function iniciarAssinatura(plano){
  try{
    const resp = await fetch(`${BACKEND_URL}/api/oficina/assinatura/criar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oficina_id: OFICINA.id, email: CURRENT_USER.email, plano })
    });
    const data = await resp.json();
    if(data.link){ window.location.href = data.link; }
    else { alert("Não foi possível iniciar a assinatura: " + (data.error || "tente novamente em instantes.")); }
  }catch(err){
    alert("Erro de conexão com o servidor de pagamento. Tente novamente em instantes.");
  }
}
function renderSubscriptionGate(){
  document.querySelector(".tabs").style.display = "none";
  const titulo = trialExpirado() ? "Seu teste grátis de 30 dias acabou" : "Assinatura pendente";
  const msg = trialExpirado()
    ? "Esperamos que tenha gostado! Escolha um plano abaixo pra continuar usando o BoxPro."
    : `Sua assinatura do BoxPro está <strong>${OFICINA.subscription_status}</strong>. Escolha um plano abaixo para voltar a usar o app.`;
  document.querySelector(".content").innerHTML = `
    <h1>${titulo}</h1>
    <p class="hint">${msg}</p>
    <div class="cards">
      <div class="card"><span class="card-label">Básico — R$ 99/mês</span><button class="btn-primary" id="gateBasico" style="margin-top:10px;">Assinar Básico</button></div>
      <div class="card"><span class="card-label">Pro — R$ 179/mês</span><button class="btn-primary" id="gatePro" style="margin-top:10px;">Assinar Pro</button></div>
    </div>`;
  document.getElementById("gateBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
  document.getElementById("gatePro").addEventListener("click", ()=> iniciarAssinatura("pro"));
}

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab-btn[data-tab]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn[data-tab]").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    refreshAll();
  });
});

/* ---------------- MARCA / TEMA ---------------- */
function applyBrand(){
  const claro = OFICINA.fundo_estilo === "carbono" && planoAtual().fundoCarbono;
  document.documentElement.setAttribute("data-theme", claro ? "light" : "dark");
  document.documentElement.style.setProperty("--lime", OFICINA.brand_color || "#C6E619");
  document.documentElement.style.setProperty("--lime-ink", contrastInk(OFICINA.brand_color || "#C6E619"));
  document.getElementById("brandName").textContent = OFICINA.name || "BoxPro";
  const logoEl = document.getElementById("brandLogo");
  if(OFICINA.logo_url){ logoEl.src = OFICINA.logo_url; logoEl.classList.remove("hidden"); }
  else { logoEl.classList.add("hidden"); }
  document.body.classList.toggle("fundo-carbono", claro);
}
function renderMpStatus(){
  const statusEl = document.getElementById("mpStatusText");
  const btn = document.getElementById("mpConectarBtn");
  if(OFICINA.mp_connected){
    statusEl.textContent = "✅ Conectado — os pagamentos dos seus clientes caem direto na sua conta.";
    btn.textContent = "Reconectar";
  } else {
    statusEl.textContent = "⚠️ Não conectado — conecte para poder cobrar seus clientes.";
    btn.textContent = "Conectar Mercado Pago";
  }
  btn.href = `${BACKEND_URL}/api/mp/conectar?produto=boxpro&id=${OFICINA.id}`;
}
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}

/* ---------------- SPONSOR (patrocinador) ---------------- */
async function renderSponsorBanner(){
  const { data } = await supabaseClient.from("patrocinadores").select("*").eq("ativo", true).limit(1).maybeSingle();
  const el = document.getElementById("sponsorBanner");
  if(!data){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="sponsor-banner">
    ${data.logo_url ? `<img src="${data.logo_url}" alt="${data.nome}">` : ""}
    <span class="label">Patrocinado por</span> <a href="${data.link_url || '#'}" target="_blank" rel="noopener"><strong>${data.nome}</strong></a>
  </div>`;
}

/* ---------------- CONFIG FORM ---------------- */
const cfgForm = document.getElementById("configForm");
function fillConfigForm(){
  document.getElementById("cfgNome").value = OFICINA.name;
  document.getElementById("cfgSegmento").value = OFICINA.segmento;
  document.getElementById("cfgCor").value = OFICINA.brand_color || "#C6E619";
  document.getElementById("cfgFundo").value = OFICINA.fundo_estilo || "escuro";
  document.getElementById("cfgWhats").value = OFICINA.whatsapp || "";
  document.getElementById("cfgSlug").value = OFICINA.slug;
  renderSubStatus();
  const p = planoAtual();
  const logoInput = document.getElementById("cfgLogo");
  logoInput.disabled = !p.logoPersonalizado;
  document.getElementById("cfgLogoHint").textContent = p.logoPersonalizado ? "" : "Disponível no plano Pro.";
  const fundoSelect = document.getElementById("cfgFundo");
  fundoSelect.querySelector('option[value="carbono"]').disabled = !p.fundoCarbono;
}
function renderSubStatus(){
  const badge = document.getElementById("subStatusBadge");
  const map = { trial: "status-pendente", ativo: "status-pago", inadimplente: "status-cancelado", cancelado: "status-cancelado" };
  let texto = OFICINA.subscription_status || "trial";
  if(OFICINA.subscription_status === "trial" && !OFICINA.subscription_plan && OFICINA.trial_expires_at){
    const dias = Math.max(0, Math.ceil((new Date(OFICINA.trial_expires_at) - new Date()) / 86400000));
    texto = `trial · ${dias} dia(s) restante(s)`;
  }
  badge.textContent = texto;
  badge.className = "status-badge " + (map[OFICINA.subscription_status] || "status-pendente");
}
document.getElementById("btnAssinarBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
document.getElementById("btnAssinarPro").addEventListener("click", ()=> iniciarAssinatura("pro"));

cfgForm.addEventListener("submit", async e=>{
  e.preventDefault();
  const updates = {
    name: document.getElementById("cfgNome").value.trim() || "Minha Oficina",
    segmento: document.getElementById("cfgSegmento").value,
    brand_color: document.getElementById("cfgCor").value,
    fundo_estilo: document.getElementById("cfgFundo").value,
    whatsapp: document.getElementById("cfgWhats").value.trim(),
    slug: document.getElementById("cfgSlug").value.trim().toLowerCase()
  };
  if(updates.fundo_estilo === "carbono" && !planoAtual().fundoCarbono){
    alert("Esse tema é exclusivo do plano Pro."); return;
  }
  const file = document.getElementById("cfgLogo").files[0];
  if(file && !planoAtual().logoPersonalizado){
    alert("Logotipo personalizado é exclusivo do plano Pro."); return;
  }
  if(file){
    const path = `${OFICINA.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabaseClient.storage.from("logos").upload(path, file, { upsert: true });
    if(upErr){ alert("Erro ao enviar logo: " + upErr.message); return; }
    const { data: pub } = supabaseClient.storage.from("logos").getPublicUrl(path);
    updates.logo_url = pub.publicUrl;
  }
  const { data, error } = await supabaseClient.from("oficinas").update(updates).eq("id", OFICINA.id).select().single();
  if(error){ alert("Erro ao salvar (verifique se o link/slug já não está em uso): " + error.message); return; }
  OFICINA = data;
  applyBrand();
  alert("Configurações salvas.");
});

/* ---------------- MECÂNICOS ---------------- */
document.getElementById("mecForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const limite = planoAtual().mecanicos;
  if(MECANICOS.length >= limite){
    alert(`Seu plano atual permite até ${limite} mecânicos. Para cadastrar mais, faça upgrade em Configurações → Assinatura.`);
    return;
  }
  const nome = document.getElementById("mecNome").value.trim();
  const especialidade = document.getElementById("mecEspecialidade").value.trim();
  if(!nome) return;
  const { error } = await supabaseClient.from("mecanicos").insert({ oficina_id: OFICINA.id, nome, especialidade });
  if(error){ alert("Erro: " + error.message); return; }
  e.target.reset();
  await loadAll(); refreshAll();
});

function renderMecList(){
  const el = document.getElementById("mecList");
  const limite = planoAtual().mecanicos;
  el.innerHTML = `<p class="hint">${MECANICOS.length} de ${limite} mecânicos usados no seu plano.</p>`;
  MECANICOS.forEach(m=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<span><strong>${m.nome}</strong>${m.especialidade ? " — " + m.especialidade : ""}</span><button class="btn-danger">Remover</button>`;
    div.querySelector("button").addEventListener("click", async ()=>{
      if(!confirm(`Remover ${m.nome}?`)) return;
      await supabaseClient.from("mecanicos").delete().eq("id", m.id);
      await loadAll(); refreshAll();
    });
    el.appendChild(div);
  });
}

/* ---------------- SERVIÇOS ---------------- */
document.getElementById("servForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const nome = document.getElementById("servNome").value.trim();
  const preco_base = parseFloat(document.getElementById("servPreco").value);
  const duracao_min = parseInt(document.getElementById("servDuracao").value,10);
  if(!nome || isNaN(preco_base) || isNaN(duracao_min)) return;
  const { error } = await supabaseClient.from("servicos").insert({ oficina_id: OFICINA.id, nome, preco_base, duracao_min });
  if(error){ alert("Erro: " + error.message); return; }
  e.target.reset();
  document.getElementById("servDuracao").value = 60;
  await loadAll(); refreshAll();
});

function renderServList(){
  const el = document.getElementById("servList");
  el.innerHTML = "";
  SERVICOS.forEach(s=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<span><strong>${s.nome}</strong> — ${brl(s.preco_base)} · ${s.duracao_min} min</span><button class="btn-danger">Remover</button>`;
    div.querySelector("button").addEventListener("click", async ()=>{
      await supabaseClient.from("servicos").delete().eq("id", s.id);
      await loadAll(); refreshAll();
    });
    el.appendChild(div);
  });
}

/* ---------------- NOVA OS ---------------- */
function fillOsSelects(){
  document.getElementById("osMecanico").innerHTML = MECANICOS.map(m=>`<option value="${m.id}">${m.nome}</option>`).join("") || "<option value=''>Cadastre um mecânico</option>";
  document.getElementById("osServico").innerHTML = SERVICOS.map(s=>`<option value="${s.id}">${s.nome} — ${brl(s.preco_base)}</option>`).join("") || "<option value=''>Cadastre um serviço</option>";
}

document.getElementById("osForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const serv = SERVICOS.find(s=>s.id === document.getElementById("osServico").value);
  const payload = {
    oficina_id: OFICINA.id,
    cliente_nome: document.getElementById("osCliente").value.trim(),
    cliente_telefone: document.getElementById("osTelefone").value.trim().replace(/\D/g,""),
    veiculo_tipo: document.getElementById("osVeiculoTipo").value,
    veiculo_placa: document.getElementById("osPlaca").value.trim().toUpperCase(),
    veiculo_modelo: document.getElementById("osModelo").value.trim(),
    veiculo_ano: document.getElementById("osAno").value.trim(),
    veiculo_km: document.getElementById("osKm").value.trim(),
    mecanico_id: document.getElementById("osMecanico").value || null,
    servico_id: document.getElementById("osServico").value || null,
    data: document.getElementById("osData").value,
    horario: document.getElementById("osHorario").value,
    checkin_detalhes: document.getElementById("osCheckin").value.trim(),
    valor_orcamento: serv ? serv.preco_base : null,
    status: "recebido"
  };
  const { error } = await supabaseClient.from("ordens_servico").insert(payload);
  if(error){ alert("Erro ao abrir OS: " + error.message); return; }
  document.getElementById("osResult").innerHTML = `<div class="appointment-item"><span>Ordem de serviço aberta para <strong>${payload.cliente_nome}</strong> — ${payload.veiculo_modelo || payload.veiculo_tipo}.</span></div>`;
  document.getElementById("osForm").reset();
  document.getElementById("osHorario").value = "17:00";
  await loadAll(); refreshAll();
});

/* ---------------- KANBAN DE ORDENS ---------------- */
function renderKanban(){
  const board = document.getElementById("kanbanBoard");
  board.innerHTML = "";
  const colunas = [...STATUS_FLOW, "cancelado"];
  colunas.forEach(status=>{
    const col = document.createElement("div");
    col.className = "kanban-col";
    const itens = ORDENS.filter(o=>o.status === status);
    col.innerHTML = `<h3>${STATUS_LABEL[status]} <span>${itens.length}</span></h3>`;
    itens.forEach(o=>{
      const card = document.createElement("div");
      card.className = "kanban-card";
      const valor = o.valor_final || o.valor_orcamento;
      card.innerHTML = `
        <div class="plate">${o.veiculo_placa || o.veiculo_modelo || "Sem identificação"}</div>
        <div class="client">${o.cliente_nome} · ${formatDateBR(o.data)}</div>
        ${valor ? `<div class="value">${brl(valor)}${o.pago ? ` <span class="status-badge status-pago">✅ Pago</span>` : ""}</div>` : ""}
        <div class="move-row"></div>
      `;
      const moveRow = card.querySelector(".move-row");
      const prox = proximoStatus(status);
      if(prox){
        const btn = document.createElement("button");
        btn.className = "btn-secondary";
        btn.textContent = "Avançar →";
        btn.addEventListener("click", async (ev)=>{ ev.stopPropagation(); await avancarStatus(o, prox); });
        moveRow.appendChild(btn);
      }
      if(status !== "entregue" && status !== "cancelado"){
        const orcBtn = document.createElement("button");
        orcBtn.className = "btn-secondary";
        orcBtn.textContent = "💰 Valor";
        orcBtn.addEventListener("click", async (ev)=>{ ev.stopPropagation(); await definirValor(o); });
        moveRow.appendChild(orcBtn);
      }
      if(status === "orcamento" && o.valor_orcamento){
        const aprovBtn = document.createElement("a");
        aprovBtn.className = "btn-whats";
        aprovBtn.textContent = "📩 Enviar Orçamento";
        aprovBtn.href = "#";
        aprovBtn.addEventListener("click", async (ev)=>{ ev.preventDefault(); ev.stopPropagation(); await enviarOrcamento(o); });
        moveRow.appendChild(aprovBtn);
      }
      if(["aprovado","em_servico","pronto"].includes(status) && valor){
        const linkBtn = document.createElement("a");
        linkBtn.className = "btn-whats";
        linkBtn.textContent = "🔗 Cobrar";
        linkBtn.href = "#";
        linkBtn.addEventListener("click", async (ev)=>{ ev.preventDefault(); ev.stopPropagation(); await gerarLinkPagamento(o, valor); });
        moveRow.appendChild(linkBtn);
      }
      if(status !== "cancelado" && status !== "entregue"){
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn-danger";
        cancelBtn.textContent = "Cancelar";
        cancelBtn.addEventListener("click", async (ev)=>{ ev.stopPropagation(); if(confirm("Cancelar esta ordem de serviço?")){ await avancarStatus(o, "cancelado"); } });
        moveRow.appendChild(cancelBtn);
      }
      col.appendChild(card);
    });
    board.appendChild(col);
  });
}

async function avancarStatus(ordem, novoStatus){
  await supabaseClient.from("ordens_servico").update({ status: novoStatus }).eq("id", ordem.id);
  await loadAll(); refreshAll();
}

async function definirValor(ordem){
  const valor = prompt(`Valor do orçamento/serviço para ${ordem.cliente_nome} (R$):`, ordem.valor_orcamento || "");
  if(valor === null) return;
  const num = parseFloat(valor.replace(",","."));
  if(isNaN(num)) { alert("Valor inválido."); return; }
  await supabaseClient.from("ordens_servico").update({ valor_orcamento: num }).eq("id", ordem.id);
  await loadAll(); refreshAll();
}

async function enviarOrcamento(ordem){
  const base = window.location.href.replace(/index\.html.*$/, "").replace(/\/?$/, "/");
  const link = `${base}aprovar.html?id=${ordem.id}`;
  const msg = `Olá ${ordem.cliente_nome}! Segue o orçamento do seu veículo (${ordem.veiculo_modelo || ordem.veiculo_tipo}) na ${OFICINA.name}: ${brl(ordem.valor_orcamento)}. Aprove ou recuse aqui: ${link}`;
  window.open(`https://wa.me/55${ordem.cliente_telefone}?text=${encodeURIComponent(msg)}`, "_blank");
}

async function gerarLinkPagamento(ordem, valor){
  try{
    const resp = await fetch(`${BACKEND_URL}/api/pagamento/criar-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descricao: `${OFICINA.name} — ${ordem.veiculo_modelo || ordem.veiculo_tipo}`, valor, agendamentoId: ordem.id, produto: "boxpro", ownerId: OFICINA.id })
    });
    const data = await resp.json();
    if(data.error === "mp_nao_conectado"){ alert("Conecte sua conta do Mercado Pago em Configurações antes de cobrar seus clientes."); return; }
    if(!data.link){ alert("Erro ao gerar link de pagamento."); return; }
    const msg = `Olá ${ordem.cliente_nome}! Segue o link de pagamento do seu veículo (${ordem.veiculo_modelo || ordem.veiculo_tipo}) na ${OFICINA.name}, valor ${brl(valor)}: ${data.link}`;
    window.open(`https://wa.me/55${ordem.cliente_telefone}?text=${encodeURIComponent(msg)}`, "_blank");
    await supabaseClient.from("ordens_servico").update({ mp_link: data.link }).eq("id", ordem.id);
    await loadAll(); refreshAll();
  }catch(err){
    alert("Erro de conexão ao gerar o link de pagamento.");
  }
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  const abertas = ORDENS.filter(o=>!["entregue","cancelado"].includes(o.status));
  const prontas = ORDENS.filter(o=>o.status === "pronto");
  const aReceber = ORDENS.filter(o=>!o.pago && o.status !== "cancelado").reduce((s,o)=>s+Number(o.valor_orcamento||0),0);
  const recebido = ORDENS.filter(o=>o.pago).reduce((s,o)=>s+Number(o.valor_final||o.valor_orcamento||0),0);
  document.getElementById("statAbertas").textContent = abertas.length;
  document.getElementById("statProntas").textContent = prontas.length;
  document.getElementById("statAReceber").textContent = brl(aReceber);
  document.getElementById("statRecebido").textContent = brl(recebido);

  const badge = document.getElementById("badgeOrdens");
  badge.textContent = abertas.length;
  badge.classList.toggle("hidden", abertas.length === 0);

  const el = document.getElementById("proximasList");
  el.innerHTML = "";
  const recentes = ORDENS.slice(0, 8);
  if(recentes.length === 0){ el.innerHTML = "<p class='hint'>Nenhuma ordem de serviço ainda.</p>"; return; }
  recentes.forEach(o=>{
    const div = document.createElement("div");
    div.className = "appointment-item";
    div.innerHTML = `<span><strong>${o.cliente_nome}</strong> · ${o.veiculo_modelo || o.veiculo_tipo} ${o.veiculo_placa ? "("+o.veiculo_placa+")" : ""} <span class="status-badge status-${o.status}">${STATUS_LABEL[o.status]}</span></span>`;
    el.appendChild(div);
  });
}

/* ---------------- REFRESH ALL ---------------- */
function refreshAll(){
  renderMpStatus();
  renderMecList();
  renderServList();
  fillOsSelects();
  renderKanban();
  renderDashboard();
}

/* ---------------- INIT ---------------- */
boot();
