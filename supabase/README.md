# Supabase no Contact Me

O backend Express continua responsável por autenticação e autorização. O Supabase guarda as sete coleções em tabelas `cm_*`, com registros JSONB e ordem estável. O frontend não recebe a chave secreta. Login próprio, painel administrativo e uploads locais permanecem funcionando.

## Configuração

No `.env` (ignorado pelo Git):

```dotenv
DB_DRIVER=supabase
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=SUA-CHAVE-SECRETA
```

Chave publicável e JWKS não são necessários para este backend, pois o login ainda não utiliza Supabase Auth.

`schema.sql` documenta a estrutura aplicada ao projeto remoto. Em um projeto novo, aplique esse SQL uma única vez pelo SQL Editor ou pelo gerenciamento de migrações. As tabelas têm RLS e permissões apenas para `service_role`; `anon` e `authenticated` não leem usuários, hashes de senha ou conversas. As funções usam `SECURITY INVOKER` e execução exclusiva do backend.

## Verificação e importação

1. Pare qualquer servidor do aplicativo antes da migração, evitando novos cadastros durante a cópia.
2. Execute `npm run supabase:check` para validar URL, chave e estrutura.
3. Execute `npm run supabase:import` para copiar as sete coleções de `data/` em uma única transação. O comando verifica o conteúdo importado e preserva os arquivos locais. Banco já utilizado é recusado, inclusive ao repetir o comando.
4. Configure `DB_DRIVER=supabase` e execute `npm start`. A inicialização aguarda a leitura do banco antes de abrir a porta.

`GET /api/saude` informa o driver ativo. O servidor não volta ao JSON automaticamente se o Supabase falhar.

## Limites desta integração

Esta integração preserva a arquitetura do MVP: usa **uma única instância Node** com os registros em memória. A leitura inicial vem do Supabase e cada persistência de coleção é uma transação. Revisões impedem uma segunda instância com dados antigos de sobrescrever alterações. Não use múltiplas réplicas, funções serverless ou alterações manuais nas tabelas enquanto o app estiver rodando; a instância não recebe alterações externas em tempo real.

Se uma gravação falhar ou sua resposta se perder, o backend bloqueia novos acessos aos dados com HTTP 503. Corrija a conexão e reinicie para recarregar a verdade do banco, evitando confirmações falsas e sobrescritas. As operações que abrangem mais de uma coleção mantêm o comportamento sequencial do MVP.

Fotos continuam em `uploads/`; migrar para Supabase Storage é uma etapa separada. Os arquivos JSON preservados são a cópia anterior à importação, não um espelho dos novos dados remotos. Não troque para `json` como recuperação sem exportar antes os dados atuais do Supabase.

## Testes

`npm test` executa testes do cliente Supabase com transporte simulado e o fluxo do aplicativo em JSON isolado. Nunca usa o banco remoto para o seed. `npm run seed` é bloqueado com `DB_DRIVER=supabase`.
