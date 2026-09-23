function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}

const card = document.getElementById("orcamentoCard");
const params = new URLSearchParams(window.location.search);
const ordemId = params.get("id");

function renderMensagem(titulo, texto){
  card.innerHTML = `<h1>${titulo}</h1><p class="hint">${texto}</p>`;
}

async function iniciar(){
  if(!ordemId){ renderMensagem("Link inválido", "Este link de orçamento não é válido."); return; }

  const { data, error } = await supabaseClient.rpc("get_orcamento_publico", { p_id: ordemId }).maybeSingle();
  if(error || !data){ renderMensagem("Orçamento não encontrado", "Verifique se o link está correto."); return; }

  if(data.oficina_cor){
    document.documentElement.style.setProperty("--lime", data.oficina_cor);
    document.documentElement.style.setProperty("--lime-ink", contrastInk(data.oficina_cor));
  }

  if(data.status !== "orcamento"){
    const mapa = { aprovado: "Você já aprovou este orçamento.", em_servico: "Você já aprovou este orçamento.", pronto: "Você já aprovou este orçamento.", entregue: "Este serviço já foi entregue.", cancelado: "Este orçamento foi recusado." };
    renderMensagem("Orçamento já respondido", mapa[data.status] || "Este orçamento não está mais disponível para aprovação.");
    return;
  }

  card.innerHTML = `
    ${data.oficina_logo ? `<img src="${data.oficina_logo}" alt="${data.oficina_nome}" style="max-height:48px;margin-bottom:10px;">` : ""}
    <h1>${data.oficina_nome || "Orçamento"}</h1>
    <p class="hint">Olá! Segue o orçamento do seu veículo (${data.veiculo_modelo || data.veiculo_tipo})${data.veiculo_placa ? " — placa " + data.veiculo_placa : ""}.</p>
    <div class="card" style="margin:16px 0;">
      <span class="card-label">Valor do orçamento</span>
      <span class="card-value">${brl(data.valor_orcamento)}</span>
    </div>
    <div class="auth-form">
      <button id="btnAprovar" class="btn-primary">✔ Aprovar orçamento</button>
      <button id="btnRecusar" class="btn-danger">✕ Não aprovar</button>
    </div>
    <p id="respMsg" class="hint"></p>
  `;

  document.getElementById("btnAprovar").addEventListener("click", ()=>responder(true));
  document.getElementById("btnRecusar").addEventListener("click", ()=>responder(false));
}

async function responder(aprovado){
  document.getElementById("btnAprovar").disabled = true;
  document.getElementById("btnRecusar").disabled = true;
  const { data, error } = await supabaseClient.rpc("responder_orcamento", { p_id: ordemId, p_aprovado: aprovado });
  if(error || !data){
    document.getElementById("respMsg").textContent = "Não foi possível registrar sua resposta. Tente novamente ou entre em contato com a oficina.";
    document.getElementById("btnAprovar").disabled = false;
    document.getElementById("btnRecusar").disabled = false;
    return;
  }
  renderMensagem(
    aprovado ? "Orçamento aprovado!" : "Orçamento recusado",
    aprovado ? "A oficina foi avisada e vai dar sequência ao serviço." : "A oficina foi avisada da sua decisão."
  );
}

iniciar();
