/* ===========================================================
   Página pública de vendas — assinar.html
   Cliente clica no link, escolhe o plano, cria a conta e cai
   direto no checkout do Mercado Pago.
   =========================================================== */
const BACKEND_URL = "https://agendapro-backend-1n92.onrender.com";
let planoSelecionado = null;

const PLANO_NOMES = { basico: "Básico — R$ 99/mês", pro: "Pro — R$ 179/mês" };

function abrirCadastro(plano){
  planoSelecionado = plano;
  document.getElementById("planoEscolhidoTexto").textContent = `Plano escolhido: ${PLANO_NOMES[plano]}`;
  document.getElementById("viewPlanos").classList.add("hidden");
  document.getElementById("viewCadastro").classList.remove("hidden");
}

function voltarPlanos(){
  document.getElementById("viewCadastro").classList.add("hidden");
  document.getElementById("viewPlanos").classList.remove("hidden");
  document.getElementById("cadastroMsg").textContent = "";
}

document.getElementById("cadastroForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msg = document.getElementById("cadastroMsg");
  const btn = document.getElementById("btnConfirmarAssinatura");
  const nomeOficina = document.getElementById("novaOficinaNome").value.trim();
  const segmento = document.getElementById("novoSegmento").value;
  const email = document.getElementById("novoEmail").value.trim();
  const senha = document.getElementById("novaSenha").value;

  btn.disabled = true;
  msg.textContent = "Criando sua conta...";

  try{
    const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({ email, password: senha });
    if(signUpError){ msg.textContent = "Erro ao criar conta: " + signUpError.message; btn.disabled = false; return; }

    let session = signUpData.session;
    if(!session){
      const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
      if(signInError){ msg.textContent = "Conta criada, mas houve um erro ao entrar: " + signInError.message; btn.disabled = false; return; }
      session = signInData.session;
    }

    msg.textContent = "Configurando sua oficina...";
    const slug = (nomeOficina.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "oficina") + "-" + Math.random().toString(36).slice(2,6);
    const { data: oficina, error: ofError } = await supabaseClient.from("oficinas")
      .insert({ owner_id: session.user.id, slug, name: nomeOficina || "Minha Oficina", segmento, subscription_plan: planoSelecionado })
      .select().single();
    if(ofError){ msg.textContent = "Erro ao configurar a oficina: " + ofError.message; btn.disabled = false; return; }

    msg.textContent = "Abrindo o pagamento...";
    const resp = await fetch(`${BACKEND_URL}/api/oficina/assinatura/criar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oficina_id: oficina.id, email, plano: planoSelecionado })
    });
    const data = await resp.json();
    if(data.link){ window.location.href = data.link; }
    else { msg.textContent = "Conta criada! Mas houve um erro ao abrir o pagamento — entre em " + window.location.origin + "/login.html e assine pela aba Configurações."; btn.disabled = false; }
  }catch(err){
    msg.textContent = "Erro de conexão. Tente novamente em instantes.";
    btn.disabled = false;
  }
});
