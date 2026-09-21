// ============================================================
//  Seed — popula o app com dados de demonstração.
//  Roda com:  npm run seed
//  ATENÇÃO: apaga o conteúdo atual de data/.
// ============================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { config } = require('../src/config');
const db = require('../src/db');
const auth = require('../src/auth');
const geo = require('../src/geo');
const { recalcularReputacao } = require('../src/dominio');
const { gerarFotos, limparFotosDemo } = require('./fotos-demo');

const SENHA_PADRAO = 'senha123';

// Quantas imagens de portfólio cada prestador do seed recebe.
const FOTOS_POR_PRESTADOR = { aprovado: 4, pendente: 2 };

// [nome, email, categoria, cidade, raioKm, preço, unidade, descrição, status]
const PRESTADORES = [
  ['Carlos Silva', 'carlos@exemplo.com', 'pintura', 'São Paulo', 25, 90, 'hora',
   'Pintor há 14 anos, especializado em acabamento fino, textura e massa corrida. Trabalho com proteção total do ambiente e entrego limpo. Orçamento sem compromisso e garantia de 1 ano no serviço.', 'aprovado'],
  ['Marcos Oliveira', 'marcos@exemplo.com', 'eletrica', 'São Paulo', 30, 140, 'hora',
   'Eletricista com registro no CREA. Faço instalação de quadros, troca de fiação, aterramento, chuveiros e laudos elétricos. Atendimento de emergência 24h na Zona Sul e centro.', 'aprovado'],
  ['Julia Mendes', 'julia@exemplo.com', 'informatica', 'Campinas', 40, 180, 'servico',
   'Técnica em informática. Formatação, upgrade de SSD e memória, limpeza interna, recuperação de arquivos e configuração de rede. Atendo em domicílio e explico tudo o que estou fazendo.', 'aprovado'],
  ['Rafael Costa', 'rafael@exemplo.com', 'reforma', 'Guarulhos', 35, 320, 'diaria',
   'Pedreiro e azulejista. Reforma de banheiro completo, assentamento de porcelanato, contrapiso e pequenas alvenarias. Trabalho com equipe própria e cumpro prazo combinado.', 'aprovado'],
  ['Patricia Lima', 'patricia@exemplo.com', 'limpeza', 'São Paulo', 20, 190, 'diaria',
   'Diarista com 8 anos de experiência e referências verificáveis. Limpeza pesada, pós-obra e organização de armários. Levo meus próprios produtos se preferir.', 'aprovado'],
  ['Bruno Santos', 'bruno@exemplo.com', 'fotografia', 'Santo André', 60, 1500, 'servico',
   'Fotógrafo de eventos: casamento, aniversário, formatura e ensaio externo. Entrego as fotos tratadas em até 15 dias, em galeria online e alta resolução, com direito a impressão.', 'aprovado'],
  ['Ana Paula Reis', 'anapaula@exemplo.com', 'beleza', 'São Paulo', 15, 120, 'servico',
   'Cabeleireira e maquiadora a domicílio. Corte, coloração, escova e make para eventos. Levo toda a estrutura e monto o espaço na sua casa, sem sujeira e sem bagunça.', 'aprovado'],
  ['Diego Ferreira', 'diego@exemplo.com', 'ar-condicionado', 'Osasco', 45, 250, 'servico',
   'Instalação, higienização e recarga de gás em split e janela. Atendo residência e comércio, com nota fiscal e garantia de 90 dias em todo serviço executado.', 'aprovado'],
  ['Sandra Nunes', 'sandra@exemplo.com', 'aulas', 'Campinas', 30, 85, 'hora',
   'Professora de matemática e física para ensino médio e pré-vestibular. Aula presencial ou online, material próprio e acompanhamento do desempenho por bimestre.', 'aprovado'],
  ['Roberto Almeida', 'roberto@exemplo.com', 'jardinagem', 'São Bernardo do Campo', 25, 160, 'diaria',
   'Jardineiro e paisagista. Poda de árvores, corte de grama, plantio, adubação e manutenção mensal de jardins. Levo o entulho embora, sem custo adicional.', 'aprovado'],
  // Estes dois ficam PENDENTES de propósito: é a fila que aparece no /admin.html
  ['Fernanda Rocha', 'fernanda@exemplo.com', 'costura', 'São Paulo', 20, 70, 'servico',
   'Costureira com ateliê próprio. Ajustes em geral, barra, reforma de roupas, vestidos sob medida e conserto de zíper. Prazo médio de 3 dias para ajustes simples.', 'pendente'],
  ['Tiago Barros', 'tiago@exemplo.com', 'hidraulica', 'Rio de Janeiro', 30, 130, 'hora',
   'Encanador. Caça-vazamento sem quebra-quebra, desentupimento, troca de registros, instalação de caixa d\'água e reparo de infiltração. Atendo emergência na Zona Norte.', 'pendente'],
];

// [nome, email, cidade]
const CLIENTES = [
  ['Ana Pereira', 'ana@exemplo.com', 'São Paulo'],
  ['Lucas Martins', 'lucas@exemplo.com', 'Campinas'],
  ['Mariana Souza', 'mariana@exemplo.com', 'Guarulhos'],
];

// [emailCliente, emailPrestador, status, descrição, nota, comentário]
const HISTORICO = [
  ['ana@exemplo.com', 'carlos@exemplo.com', 'concluida',
   'Pintar sala e dois quartos, cerca de 80 m². Paredes com algumas rachaduras pequenas.',
   5, 'Chegou no horário combinado, protegeu todos os móveis e o acabamento ficou impecável. Terminou meio dia antes do prazo. Já contratei de novo para a área externa.'],
  ['ana@exemplo.com', 'patricia@exemplo.com', 'concluida',
   'Limpeza pós-obra em apartamento de 60 m² depois da pintura.',
   5, 'Deixou o apartamento impecável, tirou respingo de tinta do piso que eu achei que não ia sair. Super atenciosa e pontual.'],
  ['lucas@exemplo.com', 'julia@exemplo.com', 'concluida',
   'Notebook muito lento, queria trocar por SSD e aumentar a memória.',
   5, 'Explicou cada passo, mostrou o antes e depois do tempo de boot. O notebook parece novo. Preço justo e nota fiscal.'],
  ['lucas@exemplo.com', 'sandra@exemplo.com', 'concluida',
   'Aulas de física para meu filho que está no 3º ano, foco em vestibular.',
   4, 'Muito boa didática e o material é organizado. Só achei o horário um pouco apertado, mas o resultado nas notas apareceu rápido.'],
  ['mariana@exemplo.com', 'rafael@exemplo.com', 'concluida',
   'Reforma completa do banheiro: troca de piso, azulejo e louças.',
   4, 'Trabalho bem feito e dentro do orçamento. Atrasou dois dias por causa da entrega do porcelanato, mas avisou com antecedência.'],
  ['mariana@exemplo.com', 'diego@exemplo.com', 'concluida',
   'Instalar um split de 12.000 BTUs no quarto e higienizar o da sala.',
   5, 'Serviço limpo e rápido, levou os próprios materiais e testou tudo antes de ir embora. Recomendo demais.'],
  ['ana@exemplo.com', 'marcos@exemplo.com', 'aceita',
   'Quadro de luz antigo, disjuntor desarmando toda vez que ligo o chuveiro. Preciso de orçamento.',
   null, null],
  ['lucas@exemplo.com', 'roberto@exemplo.com', 'aberta',
   'Jardim da frente sem manutenção há uns 6 meses, grama alta e uma árvore precisando de poda.',
   null, null],
];

const MENSAGENS_EXTRA = [
  ['ana@exemplo.com', 'marcos@exemplo.com', [
    ['prestador', 'Boa tarde, Ana! Pelo que você descreveu parece sobrecarga no circuito do chuveiro. Consegue me mandar uma foto do quadro?'],
    ['cliente', 'Consigo sim! O quadro é bem antigo, acho que é da época que o prédio foi construído.'],
    ['prestador', 'Perfeito. Se for o caso eu já levo o disjuntor certo. Posso passar quinta às 9h para orçar sem custo, fica bom?'],
    ['cliente', 'Quinta às 9h está ótimo, vou estar em casa. Obrigada!'],
  ]],
];

// ── Execução ────────────────────────────────────────────────

function limpar() {
  fs.mkdirSync(config.caminhos.dados, { recursive: true });
  for (const nome of db.COLECOES) {
    fs.writeFileSync(path.join(config.caminhos.dados, `${nome}.json`), '[]', 'utf-8');
  }
  // Só apaga as imagens "demo-*"; uploads reais ficam intactos.
  limparFotosDemo(config.caminhos.uploads);
}

async function semear() {
  if (config.banco !== 'json') throw new Error('Seed bloqueado no Supabase. Use dados locais isolados e a importação inicial.');
  limpar();
  db.inicializar();

  const senhaHash = auth.gerarHashSenha(SENHA_PADRAO);
  const porEmail = new Map();

  // ── Prestadores ──
  for (const [nome, email, categoria, cidade, raioKm, preco, unidade, descricao, status] of PRESTADORES) {
    const ponto = geo.resolverPonto({ cidade });
    if (!ponto) throw new Error(`Cidade não encontrada no seed: ${cidade}`);

    const usuario = {
      id: crypto.randomUUID(),
      nome,
      email,
      telefone: `5511${String(900000000 + Math.floor(Math.random() * 99999999)).slice(0, 9)}`,
      senhaHash,
      papel: 'prestador',
      criadoEm: new Date().toISOString(),
    };
    await db.inserir('usuarios', usuario);

    const prestadorId = crypto.randomUUID();
    const prestador = {
      id: prestadorId,
      usuarioId: usuario.id,
      categoria,
      descricao,
      precoMedio: preco,
      unidadePreco: unidade,
      areaAtendimento: { rotulo: ponto.rotulo, lat: ponto.lat, lng: ponto.lng, raioKm },
      fotos: gerarFotos(
        config.caminhos.uploads,
        categoria,
        prestadorId,
        FOTOS_POR_PRESTADOR[status] ?? 2
      ),
      status,
      motivoRejeicao: null,
      aprovadoEm: status === 'aprovado' ? new Date().toISOString() : null,
      aprovadoPor: status === 'aprovado' ? 'Seed' : null,
      notaMedia: 0,
      totalAvaliacoes: 0,
      criadoEm: new Date().toISOString(),
    };
    await db.inserir('prestadores', prestador);
    porEmail.set(email, { usuario, prestador });
  }

  // ── Clientes ──
  for (const [nome, email, cidade] of CLIENTES) {
    const ponto = geo.resolverPonto({ cidade });
    const usuario = {
      id: crypto.randomUUID(),
      nome,
      email,
      telefone: `5511${String(980000000 + Math.floor(Math.random() * 9999999)).slice(0, 9)}`,
      senhaHash,
      papel: 'cliente',
      criadoEm: new Date().toISOString(),
    };
    await db.inserir('usuarios', usuario);

    const cliente = {
      id: crypto.randomUUID(),
      usuarioId: usuario.id,
      localizacao: { rotulo: ponto.rotulo, lat: ponto.lat, lng: ponto.lng, origem: 'cidade' },
      criadoEm: new Date().toISOString(),
    };
    await db.inserir('clientes', cliente);
    porEmail.set(email, { usuario, cliente });
  }

  // ── Solicitações, chat e avaliações ──
  const solicitacaoPorPar = new Map();

  for (const [emailCliente, emailPrestador, status, descricao, nota, comentario] of HISTORICO) {
    const cliente = porEmail.get(emailCliente);
    const prestador = porEmail.get(emailPrestador);

    const solicitacao = {
      id: crypto.randomUUID(),
      clienteUsuarioId: cliente.usuario.id,
      prestadorId: prestador.prestador.id,
      descricao,
      localizacaoCliente: cliente.cliente.localizacao,
      status,
      criadoEm: new Date().toISOString(),
      concluidaEm: status === 'concluida' ? new Date().toISOString() : null,
    };
    await db.inserir('solicitacoes', solicitacao);
    solicitacaoPorPar.set(`${emailCliente}|${emailPrestador}`, solicitacao);

    await db.inserir('mensagens', {
      id: crypto.randomUUID(),
      solicitacaoId: solicitacao.id,
      autorId: cliente.usuario.id,
      autorNome: cliente.usuario.nome,
      autorPapel: 'cliente',
      texto: descricao,
      lidaEm: new Date().toISOString(),
      criadoEm: solicitacao.criadoEm,
    });

    if (nota) {
      await db.inserir('avaliacoes', {
        id: crypto.randomUUID(),
        solicitacaoId: solicitacao.id,
        prestadorId: prestador.prestador.id,
        clienteUsuarioId: cliente.usuario.id,
        clienteNome: cliente.usuario.nome,
        nota,
        comentario,
        respostaPrestador: null,
        criadoEm: new Date().toISOString(),
      });
    }
  }

  // ── Conversa de exemplo ──
  for (const [emailCliente, emailPrestador, trocas] of MENSAGENS_EXTRA) {
    const solicitacao = solicitacaoPorPar.get(`${emailCliente}|${emailPrestador}`);
    if (!solicitacao) continue;
    const cliente = porEmail.get(emailCliente);
    const prestador = porEmail.get(emailPrestador);

    let instante = Date.now();
    for (const [papel, texto] of trocas) {
      instante += 4 * 60 * 1000;
      const autor = papel === 'cliente' ? cliente.usuario : prestador.usuario;
      await db.inserir('mensagens', {
        id: crypto.randomUUID(),
        solicitacaoId: solicitacao.id,
        autorId: autor.id,
        autorNome: autor.nome,
        autorPapel: papel,
        texto,
        lidaEm: new Date(instante).toISOString(),
        criadoEm: new Date(instante).toISOString(),
      });
    }
  }

  // ── Reputação ──
  for (const { prestador } of porEmail.values()) {
    if (prestador) await recalcularReputacao(prestador.id);
  }

  await db.drenar();

  const aprovados = db.filtrar('prestadores', (p) => p.status === 'aprovado').length;
  const pendentes = db.filtrar('prestadores', (p) => p.status === 'pendente').length;

  console.log('');
  console.log('  Dados de demonstração criados:');
  console.log(`   · ${aprovados} prestadores aprovados (aparecem na busca com o selo)`);
  console.log(`   · ${pendentes} prestadores pendentes (fila do /admin.html)`);
  console.log(`   · ${db.ler('clientes').length} clientes`);
  console.log(`   · ${db.ler('solicitacoes').length} solicitações`);
  console.log(`   · ${db.ler('avaliacoes').length} avaliações`);
  console.log('');
  console.log(`  Senha de TODAS as contas de teste: ${SENHA_PADRAO}`);
  console.log('   cliente:   ana@exemplo.com');
  console.log('   prestador: carlos@exemplo.com');
  console.log(`   admin:     ${config.admin.email} / ${config.admin.senha}`);
  console.log('');
}

semear().catch((erro) => {
  console.error('Falha ao semear:', erro);
  process.exit(1);
});
