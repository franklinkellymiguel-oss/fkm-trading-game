// ui/nuvem.js — conta, partidas, sugestões, ranking e carregamento protegido do FKM Trading Game (Supabase).
// Plano aprovado em 22/11/2026. Sem configuração (window.FKM_CONFIG sem url/chave), o módulo fica inativo e os jogos
// usam só o armazenamento do navegador, como nos links do claude.ai.
// A camada "api" é a única que fala com o Supabase; nos testes ela é trocada por uma falsa (FKMNuvem.criar({ api })).
(function () {
  "use strict";
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ---------------- validação do cadastro (também usada na página de entrada) ----------------
  function validarCadastro(d) {
    const nome = String(d.nome || "").trim().replace(/\s+/g, " "), apelido = String(d.apelido || "").trim(), email = String(d.email || "").trim().toLowerCase();
    if (nome.split(" ").length < 2 || nome.length < 5) return "Informe o nome completo (nome e sobrenome).";
    if (apelido.length < 3 || apelido.length > 20 || !/^[\p{L}\p{N} ._-]+$/u.test(apelido)) return "Apelido do ranking: de 3 a 20 letras, números, espaço, ponto, hífen ou sublinhado.";
    if (!EMAIL.test(email)) return "Informe um e-mail válido.";
    if (String(d.senha || "").length < 8) return "A senha precisa de pelo menos 8 caracteres.";
    if (d.senha !== d.senha2) return "As duas senhas não conferem.";
    if (!d.termos) return "É preciso aceitar os Termos de Uso.";
    return null;
  }

  // ---------------- camada real: Supabase (supabase-js carregado pela página) ----------------
  function apiSupabase(cfg) {
    const sb = window.supabase.createClient(cfg.url, cfg.chave, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const erro = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
    return {
      sb,
      async sessao() { const { data } = await sb.auth.getSession(); return data.session; },
      async cadastrar(email, senha, meta, volta) { return erro(await sb.auth.signUp({ email, password: senha, options: { data: meta, emailRedirectTo: volta } })); },
      async entrar(email, senha) { return erro(await sb.auth.signInWithPassword({ email, password: senha })); },
      async sair() { await sb.auth.signOut(); },
      async recuperar(email, volta) { return erro(await sb.auth.resetPasswordForEmail(email, { redirectTo: volta })); },
      async novaSenha(senha) { return erro(await sb.auth.updateUser({ password: senha })); },
      async perfil(id) { return erro(await sb.from("perfis").select("*").eq("id", id).maybeSingle()); },
      async marcarAcesso(id) { await sb.from("perfis").update({ ultimo_acesso: new Date().toISOString() }).eq("id", id); },
      async partidas() { return erro(await sb.from("partidas").select("id,nome,papel,semente,missao,mes,meses,fase,concluida,resultado,atualizado").order("atualizado", { ascending: false })); },
      async partida(id) { return erro(await sb.from("partidas").select("estado").eq("id", id).maybeSingle()); },
      async gravarPartida(linha) { return erro(await sb.from("partidas").upsert(linha)); },
      async apagarPartida(id) { return erro(await sb.from("partidas").delete().eq("id", id)); },
      async renomearPartida(id, nome) { return erro(await sb.from("partidas").update({ nome }).eq("id", id)); },
      async sugerir(linha) { return erro(await sb.from("sugestoes").insert(linha)); },
      async ranking(semente, papel) { let q = sb.from("ranking").select("apelido,semente,papel,resultado,atualizado").order("resultado", { ascending: false }).limit(50);
        if (semente) q = q.eq("semente", semente); if (papel) q = q.eq("papel", papel); return erro(await q); },
      async rankingCenarios() { return erro(await sb.from("ranking").select("semente,papel,resultado").order("resultado", { ascending: false }).limit(5000)); },
      // administrador (as políticas RLS só liberam para perfis.admin = true)
      async adminPerfis() { return erro(await sb.from("perfis").select("*").order("criado_em", { ascending: false })); },
      async adminPartidas() { return erro(await sb.from("partidas").select("id,usuario,nome,papel,semente,missao,mes,meses,concluida,resultado,atualizado").order("atualizado", { ascending: false })); },
      async adminSugestoes() { return erro(await sb.from("sugestoes").select("*").order("criado_em", { ascending: false })); },
      async adminAtivo(id, ativo) { return erro(await sb.from("perfis").update({ ativo }).eq("id", id)); },
      async adminStatusSugestao(id, status) { return erro(await sb.from("sugestoes").update({ status }).eq("id", id)); },
      async baixar(caminho) { const r = await sb.storage.from("jogo").download(caminho); if (r.error) throw new Error("Não foi possível baixar " + caminho + ": " + r.error.message); return r.data; },
    };
  }

  // ---------------- módulo ----------------
  function criar(opc) {
    const cfg = (opc && opc.config) || window.FKM_CONFIG || {};
    const ativo = !!((opc && opc.api) || (cfg.url && cfg.chave && window.supabase));
    if (!ativo) return { ativo: false, validarCadastro };
    const api = (opc && opc.api) || apiSupabase(cfg), base = (opc && opc.base) || new URL(".", location.href).href;
    let usuario = null, perfil = null, desativado = false;
    const N = {
      ativo: true, validarCadastro, api,
      get usuario() { return usuario; }, get perfil() { return perfil; }, get desativado() { return desativado; },
      // sessão atual; carrega o perfil (nome, apelido, admin)
      async iniciar() {
        const s = await api.sessao(); usuario = s ? s.user : null; perfil = null;
        if (usuario) { perfil = await api.perfil(usuario.id);
          // conta desativada pelo administrador (ex.: e-mail inválido): desconecta
          if (perfil && perfil.ativo === false) { desativado = true; await api.sair(); usuario = null; perfil = null; return null; }
          desativado = false; api.marcarAcesso(usuario.id).catch(() => {}); }
        return usuario;
      },
      // páginas dos jogos: sem sessão, volta à entrada
      async exigirLogin() {
        const u = await N.iniciar();
        if (!u) { ((opc && opc.ir) || ((url) => location.replace(url)))(base + "index.html?volta=" + encodeURIComponent(location.pathname.split("/").pop() || "")); return false; }
        return true;
      },
      async cadastrar(d) {
        const erro = validarCadastro(d); if (erro) return { ok: false, msg: erro };
        try { const r = await api.cadastrar(d.email.trim().toLowerCase(), d.senha, { nome: d.nome.trim().replace(/\s+/g, " "), apelido: d.apelido.trim(), termos: new Date().toISOString() }, base + "index.html");
          // sem confirmação de e-mail no Supabase, o cadastro já abre a sessão
          if (r && r.session) { await N.iniciar(); return { ok: true, entrou: true, msg: "Conta criada. Bem-vindo, " + (perfil ? perfil.apelido : d.apelido.trim()) + "!" }; }
          return { ok: true, msg: "Conta criada. Enviamos um e-mail de confirmação para " + d.email.trim() + ": abra o link para ativar a conta e depois entre." }; }
        catch (e) { return { ok: false, msg: traduzir(e.message) }; }
      },
      async entrar(email, senha) {
        if (!EMAIL.test(String(email || "").trim())) return { ok: false, msg: "Informe um e-mail válido." };
        if (!senha) return { ok: false, msg: "Informe a senha." };
        try { await api.entrar(email.trim().toLowerCase(), senha); await N.iniciar();
          if (desativado) return { ok: false, msg: "Esta conta foi desativada pelo administrador (por exemplo, por e-mail inválido). Para reativar, fale com a FKM Energy Strategy." };
          return { ok: true, msg: "Bem-vindo, " + (perfil ? perfil.apelido : "") + "." }; }
        catch (e) { return { ok: false, msg: traduzir(e.message) }; }
      },
      async sair() { await api.sair(); usuario = null; perfil = null; },
      async recuperar(email) {
        if (!EMAIL.test(String(email || "").trim())) return { ok: false, msg: "Informe o e-mail da conta." };
        try { await api.recuperar(email.trim().toLowerCase(), base + "index.html?nova-senha=1"); return { ok: true, msg: "Se houver conta com esse e-mail, enviamos um link para criar nova senha." }; }
        catch (e) { return { ok: false, msg: traduzir(e.message) }; }
      },
      async novaSenha(senha) { if (String(senha || "").length < 8) return { ok: false, msg: "A senha precisa de pelo menos 8 caracteres." };
        try { await api.novaSenha(senha); return { ok: true, msg: "Senha alterada." }; } catch (e) { return { ok: false, msg: traduzir(e.message) }; } },
      // partidas na nuvem (as políticas RLS garantem que cada usuário só vê as suas)
      listarPartidas: () => api.partidas(),
      lerPartida: async (id) => { const r = await api.partida(id); return r ? r.estado : null; },
      gravarPartida: (meta, S) => api.gravarPartida({ id: meta.id, usuario: usuario.id, nome: meta.nome, papel: meta.papel, semente: meta.semente, missao: meta.missao || 0,
        mes: meta.mes, meses: meta.meses, fase: meta.fase, concluida: !!meta.concluida, resultado: meta.resultado, estado: S, atualizado: new Date(meta.atualizado || Date.now()).toISOString() }),
      apagarPartida: (id) => api.apagarPartida(id),
      renomearPartida: (id, nome) => api.renomearPartida(id, nome),
      // sugestão com o contexto do jogo no momento do envio
      async sugerir(texto, contexto) {
        const t = String(texto || "").trim(); if (t.length < 5) return { ok: false, msg: "Escreva a sugestão (pelo menos 5 caracteres)." };
        if (t.length > 4000) return { ok: false, msg: "A sugestão passou de 4.000 caracteres." };
        try { await api.sugerir({ usuario: usuario.id, jogo: (contexto && contexto.jogo) || "ENTRADA", contexto: contexto || {}, texto: t, status: "nova" }); return { ok: true, msg: "Sugestão enviada. Obrigado!" }; }
        catch (e) { return { ok: false, msg: "Não foi possível enviar: " + traduzir(e.message) }; }
      },
      ranking: (semente, papel) => api.ranking(semente, papel),
      rankingCenarios: () => api.rankingCenarios(),
      // carrega os arquivos protegidos do jogo (bucket privado), com cópia no navegador por versão
      async carregarJogo(arquivos, versao) {
        for (const a of arquivos) {
          const blob = await doCache(a, versao, () => api.baixar(a));
          await injetar(a, blob);
        }
      },
    };
    return N;
  }
  // mensagens do Supabase em português
  function traduzir(m) {
    const s = String(m || "");
    if (/invalid login credentials/i.test(s)) return "E-mail ou senha incorretos.";
    if (/email not confirmed/i.test(s)) return "E-mail ainda não confirmado. Abra o link que enviamos para o seu e-mail.";
    if (/already registered|already been registered/i.test(s)) return "Já existe uma conta com esse e-mail. Use Entrar ou Esqueci a senha.";
    if (/email rate limit/i.test(s)) return "O servidor atingiu o limite de e-mails por hora. Tente de novo daqui a uma hora; se persistir, fale com a FKM Energy Strategy.";
    if (/only request this after/i.test(s)) return "Espere um minuto antes de pedir de novo.";
    if (/rate limit|too many/i.test(s)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
    if (/password/i.test(s) && /weak|short|least/i.test(s)) return "Senha fraca: use pelo menos 8 caracteres, com letras e números.";
    if (/failed to fetch|network/i.test(s)) return "Sem conexão com o servidor. Verifique a internet.";
    return s || "Erro desconhecido.";
  }
  // cópia dos arquivos do jogo no IndexedDB do navegador, por versão (evita baixar ~15 MB a cada entrada)
  function abrirBanco() { return new Promise((ok, falha) => { const r = indexedDB.open("fkm-trading-game", 1); r.onupgradeneeded = () => r.result.createObjectStore("arquivos"); r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); }); }
  async function doCache(nome, versao, baixar) {
    let db = null; try { db = await abrirBanco(); } catch (e) { return baixar(); }
    const chave = versao + "|" + nome;
    const tem = await new Promise((ok) => { const t = db.transaction("arquivos").objectStore("arquivos").get(chave); t.onsuccess = () => ok(t.result || null); t.onerror = () => ok(null); });
    if (tem) return tem;
    const blob = await baixar();
    try { await new Promise((ok) => { const tx = db.transaction("arquivos", "readwrite"), st = tx.objectStore("arquivos");
      const req = st.openCursor(); req.onsuccess = () => { const c = req.result; if (c) { if (String(c.key).split("|")[1] === nome && c.key !== chave) c.delete(); c.continue(); } };
      st.put(blob, chave); tx.oncomplete = ok; tx.onerror = ok; }); } catch (e) { /* sem cópia local: segue */ }
    return blob;
  }
  function injetar(nome, blob) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(blob);
      if (/\.css$/.test(nome)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = url; l.onload = ok; l.onerror = () => falha(new Error("estilo " + nome)); document.head.appendChild(l); return; }
      const s = document.createElement("script"); s.src = url; s.onload = () => { URL.revokeObjectURL(url); ok(); }; s.onerror = () => falha(new Error("script " + nome)); document.body.appendChild(s);
    });
  }

  window.FKMNuvem = { criar, validarCadastro, traduzir };
})();
