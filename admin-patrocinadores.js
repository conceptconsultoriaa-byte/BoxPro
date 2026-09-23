const ADMIN_EMAIL = "tadeuconcept@gmail.com";

function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }

async function boot(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ window.location.href = "login.html"; return; }
  if(session.user.email !== ADMIN_EMAIL){
    document.getElementById("accessDenied").classList.remove("hidden");
    return;
  }
  document.getElementById("adminArea").classList.remove("hidden");
  await carregarLista();
}

async function carregarLista(){
  const { data, error } = await supabaseClient.from("patrocinadores").select("*").order("created_at", { ascending: false });
  const el = document.getElementById("listaPatrocinadores");
  el.innerHTML = "";
  if(error){ el.innerHTML = `<p class="hint">Erro ao carregar: ${error.message}</p>`; return; }
  if(!data || data.length === 0){ el.innerHTML = "<p class='hint'>Nenhum patrocinador cadastrado ainda.</p>"; return; }
  data.forEach(p=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span>${p.logo_url ? `<img src="${p.logo_url}" alt="${p.nome}" style="height:32px;vertical-align:middle;margin-right:10px;">` : ""}
      <strong>${p.nome}</strong> ${p.ativo ? `<span class="status-badge status-pago">Ativo</span>` : `<span class="status-badge status-pendente">Inativo</span>`}</span>
      <span class="row-actions"></span>
    `;
    const actions = div.querySelector(".row-actions");

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn-secondary";
    toggleBtn.textContent = p.ativo ? "Desativar" : "Ativar";
    toggleBtn.addEventListener("click", async ()=>{
      await supabaseClient.from("patrocinadores").update({ ativo: !p.ativo }).eq("id", p.id);
      await carregarLista();
    });
    actions.appendChild(toggleBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-danger";
    delBtn.textContent = "Excluir";
    delBtn.addEventListener("click", async ()=>{
      if(confirm(`Excluir o patrocinador "${p.nome}"?`)){
        await supabaseClient.from("patrocinadores").delete().eq("id", p.id);
        await carregarLista();
      }
    });
    actions.appendChild(delBtn);

    el.appendChild(div);
  });
}

document.getElementById("novoPatrocinadorForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const nome = document.getElementById("pNome").value.trim();
  const linkUrl = document.getElementById("pLink").value.trim();
  const ativo = document.getElementById("pAtivo").checked;
  const file = document.getElementById("pLogo").files[0];
  if(!nome || !file){ alert("Preencha o nome e escolha uma imagem de logotipo."); return; }

  const path = `patrocinadores/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabaseClient.storage.from("logos").upload(path, file, { upsert: true });
  if(upErr){ alert("Erro ao enviar logotipo: " + upErr.message); return; }
  const { data: pub } = supabaseClient.storage.from("logos").getPublicUrl(path);

  const { error } = await supabaseClient.from("patrocinadores").insert({
    nome, logo_url: pub.publicUrl, link_url: linkUrl || null, ativo
  });
  if(error){ alert("Erro ao cadastrar patrocinador: " + error.message); return; }

  document.getElementById("novoPatrocinadorForm").reset();
  await carregarLista();
});

boot();
