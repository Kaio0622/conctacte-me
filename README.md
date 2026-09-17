# Contact Me — Marketplace de Serviços Locais

App web responsivo que conecta clientes a prestadores de serviço da própria região.
Busca por categoria e localização, ordenação por distância e avaliação, chat interno,
avaliações pós-serviço e **aprovação manual de prestadores com notificação por WhatsApp**.

Evolução do projeto `contact-me-backend`: mesma stack (Node + Express, sem build step,
sem banco externo), escopo novo.

---

## Rodando

Precisa de **Node.js 18+** (testado no 24.19).

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

| Endereço | O quê |
|---|---|
| http://localhost:3000 | App |
| http://localhost:3000/admin.html | Painel de aprovação |

### Contas de demonstração

Criadas pelo `npm run seed`. Senha de todas: `senha123`.

| Papel | Login |
|---|---|
| Cliente | `ana@exemplo.com` |
| Prestador aprovado | `carlos@exemplo.com` |
| Administrador | `admin@contactme.local` / `admin123` |

O seed cria 10 prestadores aprovados, **2 pendentes** (para você ver a fila de aprovação),
3 clientes, 8 solicitações com chat e 6 avaliações.

> As fotos de portfólio do seed são composições geradas por
> `scripts/fotos-demo.js`, não fotos reais. Elas existem para o layout aparecer como
> foi projetado. Substitua por fotos de verdade.

---

## Configuração do WhatsApp

Toda a configuração fica no `.env` (modelo comentado em `.env.example`).

```env
ADMIN_WHATSAPP=5511900000000     # ← número que recebe os avisos (E.164, só dígitos)
WHATSAPP_PROVIDER=twilio         # twilio | meta | link
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=14155238886
APP_URL=http://localhost:3000    # usado nos links de aprovação da mensagem
```

**`ADMIN_WHATSAPP` está com um número placeholder (`5511900000000`).** Troque pelo
número real antes de usar de verdade.

### Os três provedores

| `WHATSAPP_PROVIDER` | Comportamento | Precisa de credencial |
|---|---|---|
| `twilio` | Envia pela API REST do Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| `meta` | Envia pela WhatsApp Cloud API oficial | `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID` |
| `link` | Não envia nada; gera um link `wa.me` clicável no painel | Nenhuma |

Para ativar o Twilio: pegue as chaves em [console.twilio.com](https://console.twilio.com).
Para testar sem número comercial, use o sandbox (`TWILIO_WHATSAPP_FROM=14155238886`) e
mande `join <palavra-do-sandbox>` do seu celular antes do primeiro envio.

**Falha de envio nunca derruba o cadastro.** Se o Twilio recusar (sem crédito, fora da
janela de 24h, sandbox não pareado), o prestador entra na fila normalmente, a
notificação fica gravada com o motivo do erro, e o painel oferece
*Abrir no WhatsApp* (link `wa.me` pré-preenchido) e *Reenviar notificação*.

### O que chega no celular

```
*Contact Me — novo prestador aguardando aprovação*

*Nome:* Fernanda Rocha
*Categoria:* Costura
*Atendimento:* São Paulo - SP (raio de 20 km)
*Preço médio:* R$ 70,00
*Telefone:* 5511951193186
*E-mail:* fernanda@exemplo.com
*Fotos do trabalho:* 2

*Descrição:*
Costureira com ateliê próprio. Ajustes em geral, barra, reforma de roupas...

— Aprovar:
http://localhost:3000/api/admin/aprovacao-rapida?token=...

— Rejeitar:
http://localhost:3000/api/admin/aprovacao-rapida?token=...
```

Os dois links são tokens HMAC assinados, de uso único por decisão: dá para aprovar
direto do celular, sem entrar no painel. Um link já usado responde "nada a fazer" em
vez de reprocessar. Em produção, aponte `APP_URL` para o domínio real — senão o link
que chega no celular aponta para `localhost` e não abre.

---

## Como funciona o selo de "perfil verificado"

Esta é a regra central do produto, então vale ser explícito sobre onde ela é aplicada:

1. Prestador se cadastra → registro nasce com `status: "pendente"`.
2. `notificarNovoPrestador()` dispara o WhatsApp e grava a notificação em `data/notificacoes.json`.
3. **Enquanto está pendente, o perfil não existe para o público**: some da busca
   (`src/routes/busca.js` filtra `status === 'aprovado'`) e o acesso direto ao perfil
   devolve 404. Só o próprio dono e o admin conseguem ver.
4. Admin aprova — pelo painel ou pelo link do WhatsApp — e o `status` vira `"aprovado"`.
5. Só então `verificado: true` é projetado para o frontend
   (`src/dominio.js` → `projetarPrestador`), e o selo aparece.

O admin também pode **suspender** um perfil já aprovado: ele sai das buscas na hora.

O smoke test cobre cada um desses passos.

---

## Busca e match

O cliente informa categoria + localização; a localização vem do GPS do navegador
(`navigator.geolocation`) ou do nome da cidade, resolvido contra uma tabela local de
~180 municípios brasileiros em `src/geo.js`. Distância real por **Haversine** — sem
API de geocoding externa, funciona offline.

O brief pede "ordenados por distância **e** avaliação". Um `sort` em cascata não
resolve: distâncias quase nunca empatam, então a avaliação nunca pesaria. Em vez disso
o padrão é um score combinado:

```
score = 0.6 × proximidade + 0.4 × avaliação
```

- **proximidade** decai suavemente com a distância, escalada pelo raio de atendimento do prestador
- **avaliação** usa média bayesiana (`src/dominio.js` → `notaPonderada`): um prestador com
  uma única nota 5 não passa na frente de outro com 4,8 em 40 avaliações

O cliente ainda pode trocar a ordem para *Mais perto*, *Melhor avaliado* ou *Menor preço*.

Um prestador entra no resultado se o cliente estiver dentro do raio de atendimento
**dele** ou dentro do raio de busca do cliente — o que for mais generoso. Assim um
eletricista que atende 40 km não desaparece porque o cliente filtrou "até 10 km".

---

## Chat, solicitações e avaliações

Uma **solicitação** é ao mesmo tempo o pedido de orçamento, a sala do chat e o
pré-requisito da avaliação.

```
aberta ──▶ aceita ──▶ concluida ──▶ (cliente avalia)
   │          │
   │          └──▶ cancelada
   └──▶ recusada / cancelada
```

- A descrição do pedido vira automaticamente a primeira mensagem do chat.
- O chat usa **long polling** (o GET fica até 25s aguardando novidade, e o POST acorda
  os ouvintes na hora). Dá sensação de tempo real sem trazer WebSocket para o projeto.
- Quem envia vê a própria mensagem imediatamente; o polling devolve a mesma mensagem
  depois e o dedupe por id descarta a cópia.
- **Avaliação só depois de `concluida`**, uma por solicitação, nota inteira de 1 a 5.
  O prestador tem direito a uma resposta pública por avaliação.

---

## Design

Mobile-first, paleta neutra, três decisões guiando o resto:

- **A foto vem primeiro.** O cartão da busca abre com a imagem em 16:10, e o perfil
  com uma galeria deslizante. O trabalho é o que vende.
- **O selo é sempre visível.** Flutua sobre a foto no cartão e fica ao lado do nome no
  perfil, em verde — a única cor saturada do sistema, reservada para confiança.
- **Avaliação não fica em segunda tela.** Estrelas no cartão, e no perfil um bloco com
  média grande, distribuição por estrela e os comentários na sequência.

Navegação por abas fixas embaixo no celular; acima de 860px vira barra no topo e a
grade passa a 3 colunas. Tema claro e escuro pelo `prefers-color-scheme`. Campos com
`font-size: 16px` para o iOS não dar zoom ao focar.

---

## Estrutura

```
contact-me-marketplace/
├─ server.js                  bootstrap + encerramento limpo
├─ src/
│  ├─ app.js                  montagem do Express, rotas, tratamento de erro
│  ├─ config.js               .env com padrões seguros
│  ├─ db.js                   JSON com escrita atômica e fila por coleção
│  ├─ auth.js                 scrypt + tokens HMAC (sessão e links de aprovação)
│  ├─ geo.js                  ~180 municípios + Haversine
│  ├─ dominio.js              categorias, reputação, score de match, projeção pública
│  ├─ upload.js               multer com limites e erros amigáveis
│  ├─ notify/
│  │  ├─ index.js             monta a mensagem e despacha
│  │  ├─ twilio.js            adaptador Twilio
│  │  └─ meta.js              adaptador WhatsApp Cloud API
│  └─ routes/                 auth, busca, prestadores, clientes,
│                             solicitacoes, chat, avaliacoes, admin
├─ public/
│  ├─ index.html              app (SPA por hash)
│  ├─ admin.html              painel de aprovação
│  ├─ css/style.css           design system
│  └─ js/                     api, ui, telas, app
├─ scripts/
│  ├─ seed.js                 dados de demonstração
│  ├─ fotos-demo.js           gerador de PNG (codificador escrito à mão)
│  └─ smoke.js                55 verificações de ponta a ponta
├─ data/                      JSON em runtime (fora do git)
└─ uploads/                   fotos dos portfólios (fora do git)
```

Dependências: `express`, `multer`, `dotenv`. Só isso — hash de senha, tokens, geo,
geração de PNG e o envio HTTP para Twilio/Meta usam módulos nativos do Node.

---

## Testes

Com o servidor rodando em outro terminal:

```bash
npm run smoke
```

55 verificações cobrindo busca e ordenação, invisibilidade do prestador pendente,
aprovação pelo painel e pelo link do WhatsApp, suspensão, isolamento do chat entre
terceiros, e as travas de avaliação (só após conclusão, uma por solicitação, nota 1–5).

---

## Notas de produção

O que está adequado para TCC/MVP mas mereceria mudança antes de ir para produção real:

- **Persistência em JSON.** As escritas são atômicas e serializadas por coleção, o que
  evita corrupção, mas tudo fica em memória — não escala além de alguns milhares de
  registros nem roda em mais de uma instância. Trocar por SQLite é um passo curto,
  porque todo acesso a dado passa por `src/db.js`.
- **Sessão em `localStorage`.** Simples e sem CSRF, mas exposta a XSS. Cookie
  `httpOnly` + `SameSite` seria mais seguro.
- **Sem rate limiting** no login e no cadastro.
- **Fotos servidas como enviadas**, sem redimensionar. Uma foto de 4 MB vai inteira
  para o celular do cliente.
- **`APP_SECRET` e `ADMIN_SENHA`** estão com valores de desenvolvimento no `.env`.
- **Aprovação manual não escala** — é uma decisão de produto, não um bug. Quando o
  volume crescer, a fila em `/admin.html` vira o gargalo.
