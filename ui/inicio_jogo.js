// ui/inicio_jogo.js — abre um dos jogos (comercializador.html ou gerador.html).
// Com Supabase configurado (window.FKM_CONFIG): exige login e, no site publicado (bucket = true), baixa o motor, as telas
// e os dados do bucket privado "jogo", só para quem tem sessão. Sem configuração: carrega os arquivos locais, como antes.
(function () {
  "use strict";
  const CFG = window.FKM_CONFIG || {};
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const ARQUIVOS = ["dados/mercado.js", "dados/precos.js", "dados/mre.js", "dados/swaps.js", "motor/base.js", "motor/motor.js", "perguntas.js", "ui/jogo.js"];
  const app = document.getElementById("app");
  const aviso = (t) => { if (app) app.innerHTML = '<p class="muted">' + t + "</p>"; };
  function script(src) {
    return new Promise((ok, falha) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => falha(new Error("Não foi possível carregar " + src)); document.body.appendChild(s); });
  }
  async function iniciar() {
    if (CFG.preparo && !(CFG.url && CFG.chave)) { location.replace("index.html"); return; }   // site publicado antes do Supabase
    if (CFG.url && CFG.chave) {
      aviso("Verificando a sua conta…");
      if (!window.supabase) await script(SUPABASE_JS);
      if (!window.FKMNuvem) await script("ui/nuvem.js");
      const N = window.FKMNuvem.criar();
      if (!(await N.exigirLogin())) return;                       // sem sessão: volta à página de entrada
      window.FKM_NUVEM = N;
      if (CFG.bucket) { aviso("Carregando o jogo…"); await N.carregarJogo(["ui/estilo.css"].concat(ARQUIVOS), CFG.versao || "1"); return; }
    }
    for (const a of ARQUIVOS) await script(a);
  }
  iniciar().catch((e) => { if (app) app.innerHTML = '<div class="msg ruim">Não foi possível abrir o jogo: ' + String(e.message || e).replace(/</g, "&lt;") + ' <a href="index.html">Voltar ao início</a></div>'; });
})();
