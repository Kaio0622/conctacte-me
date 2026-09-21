-- Função de event trigger criada pelo Supabase; não é um endpoint do app.
-- Ajuste aplicado após a verificação dos advisors.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
