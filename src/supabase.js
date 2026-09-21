// Cliente REST exclusivo do backend. Não importar em public/.
function criarCliente(opcoes, transporte = fetch) {
  const { url, chave } = opcoes;
  if (!url || !chave) throw new Error('Preencha SUPABASE_URL e SUPABASE_SECRET_KEY no .env.');
  const destino = new URL(url);
  if (destino.protocol !== 'https:' || destino.username || destino.password || destino.search || destino.hash) {
    throw new Error('SUPABASE_URL precisa ser uma URL HTTPS válida do projeto.');
  }
  if (chave.startsWith('sb_publishable_')) throw new Error('Use a chave secreta do servidor, não a chave publicável.');
  const headers = { apikey: chave, 'Content-Type': 'application/json' };
  // Compatibilidade com service_role legada. Chaves sb_secret não são JWTs.
  if (!chave.startsWith('sb_secret_')) headers.Authorization = `Bearer ${chave}`;

  async function rpc(funcao, dados = {}) {
    let resposta;
    try {
      resposta = await transporte(`${url.replace(/\/$/, '')}/rest/v1/rpc/${funcao}`, {
        method: 'POST', headers, body: JSON.stringify(dados), signal: AbortSignal.timeout(20000),
      });
    } catch {
      const erro = new Error('Não foi possível confirmar a operação no Supabase. Verifique a conexão e reinicie o servidor antes de tentar novamente.');
      erro.status = 503;
      throw erro;
    }
    const texto = await resposta.text();
    let resultado;
    try { resultado = texto ? JSON.parse(texto) : null; } catch { resultado = null; }
    if (!resposta.ok) {
      const motivos = {
        401: 'Chave do Supabase inválida.',
        403: 'A chave não tem acesso às tabelas do aplicativo.',
        404: 'Estrutura do Supabase ausente. Aplique supabase/schema.sql.',
      };
      const erro = new Error(resultado?.code === '40001'
        ? 'O banco foi alterado por outra instância ou já foi importado. Reinicie o servidor para recarregar os dados.'
        : motivos[resposta.status] || `Supabase recusou a operação (HTTP ${resposta.status}).`);
      erro.status = 503;
      throw erro;
    }
    return resultado;
  }

  return {
    lerBase: () => rpc('cm_ler_base'),
    gravar: (colecao, revisao, registros) => rpc('cm_gravar_colecao', { colecao, revisao_esperada: revisao, registros }),
    importar: (base) => rpc('cm_importar_base', { base }),
  };
}

module.exports = { criarCliente };
