# Ativar login com Google

O botão aparece em Entrar e Criar conta. A integração usa Supabase Auth com PKCE no servidor. Clientes novos completam localização e telefone; prestadores completam o perfil e aguardam aprovação. Contas existentes confirmam a senha Contact Me uma vez para vincular o Google, preservando perfil e conversas. O administrador continua usando seu login administrativo.

## Configuração necessária

1. No [Google Cloud Console](https://console.cloud.google.com/auth/clients), configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**. Se o aplicativo estiver em teste, adicione os e-mails de teste no público permitido.
2. Nas URIs de redirecionamento autorizadas do cliente Google, adicione exatamente:
   `https://vxpnktbycfmpqivnnfph.supabase.co/auth/v1/callback`
3. No [Supabase — Authentication / Sign In / Providers](https://supabase.com/dashboard/project/vxpnktbycfmpqivnnfph/auth/providers), habilite Google e salve o **Client ID** e **Client Secret** desse cliente OAuth. São credenciais do Google, diferentes das chaves do Supabase. Mantenha a verificação de e-mail habilitada.
4. Em [Authentication / URL Configuration](https://supabase.com/dashboard/project/vxpnktbycfmpqivnnfph/auth/url-configuration), configure Site URL como `http://localhost:3000` e adicione à lista Redirect URLs:
   `http://localhost:3000/api/auth/google/callback`
5. No `.env` do servidor, mantenha `APP_URL=http://localhost:3000`, `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` preenchidos. A chave secreta do Supabase não participa do fluxo OAuth. Reinicie com `npm start` e confira `npm run google:status`.

Para publicar, substitua localhost pelo domínio HTTPS real no `APP_URL`, no Site URL e na lista Redirect URLs. O callback cadastrado no Google continua sendo o domínio do Supabase. Não use curingas em produção.

## Verificação

No PowerShell, entre primeiro na pasta da aplicação (há duas pastas com o mesmo nome):

```powershell
cd "C:\Users\pichau\Downloads\contact-me-marketplace\contact-me-marketplace"
npm run google:status
```

Para iniciar o servidor, execute `npm start` nessa mesma pasta. Se ele já estiver rodando, mantenha-o aberto e use outro terminal para consultar o status. O erro `Missing script` ocorre ao executar esses comandos na pasta externa, cujo `package.json` não contém os scripts da aplicação.

Quando `googleHabilitado` retornar `true`, abra Entrar, clique **Entrar com Google**, escolha uma conta e complete o cadastro. Saia e entre novamente para confirmar que o perfil foi preservado. Teste também a recusa do consentimento e a vinculação de uma conta já cadastrada com senha.

`npm test` cobre PKCE, retorno sem cookie, repetição do callback, cadastro sem senha, e-mail não adulterável, preservação do papel, vínculo com senha e bloqueio de acesso administrativo pelo fluxo público. Os testes simulam o provedor; a validação real depende da configuração acima. `TEST_BROWSER=1` também executa a verificação visual e de interação, quando Playwright e Chrome estão disponíveis.

Transações e provas temporárias expiram em 10 minutos, ficam em memória e usam cookies HttpOnly. A aplicação deve rodar em uma única instância, como o driver de dados atual; reiniciar o servidor exige reiniciar qualquer login em andamento. Tokens Google/Supabase não são gravados no navegador nem na base. A sessão do Contact Me mantém o mecanismo já usado pelo app.

Referência: [documentação oficial do Supabase para Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
