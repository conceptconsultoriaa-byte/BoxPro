const msgEl = document.getElementById("authMsg");

(async function redirectIfLogged() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) window.location.href = "index.html";
})();

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  msgEl.textContent = "Entrando...";
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if (error) { msgEl.textContent = "Erro ao entrar: " + error.message; return; }
  window.location.href = "index.html";
});

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  msgEl.textContent = "Criando conta...";
  const email = document.getElementById("signupEmail").value.trim();
  const senha = document.getElementById("signupSenha").value;
  const { data, error } = await supabaseClient.auth.signUp({ email, password: senha });
  if (error) { msgEl.textContent = "Erro ao criar conta: " + error.message; return; }
  if (data.session) {
    window.location.href = "index.html";
  } else {
    msgEl.textContent = "Conta criada! Verifique seu e-mail para confirmar antes de entrar (ou desative a confirmação de e-mail nas configurações do Supabase).";
  }
});
