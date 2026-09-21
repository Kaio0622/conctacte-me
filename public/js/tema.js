(() => {
  const chave = 'contactme.tema';
  const sistema = window.matchMedia('(prefers-color-scheme: dark)');
  const validar = (valor) => ['claro', 'escuro', 'sistema'].includes(valor) ? valor : 'sistema';
  const ler = () => { try { return validar(localStorage.getItem(chave)); } catch { return 'sistema'; } };
  let preferencia = ler();
  function aplicar() {
    const escuro = preferencia === 'escuro' || (preferencia === 'sistema' && sistema.matches);
    document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
    document.documentElement.dataset.temaPreferencia = preferencia;
    document.documentElement.style.colorScheme = escuro ? 'dark' : 'light';
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.removeAttribute('media');
      meta.content = escuro ? '#14171d' : '#f0f1eb';
    });
    document.querySelectorAll('[data-tema-seletor]').forEach((select) => { select.value = preferencia; });
  }
  aplicar();
  sistema.addEventListener('change', aplicar);
  window.addEventListener('storage', (event) => {
    if (event.key === chave || event.key === null) { preferencia = ler(); aplicar(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tema-seletor]').forEach((select) => {
      select.addEventListener('change', () => {
        preferencia = validar(select.value);
        try { localStorage.setItem(chave, preferencia); } catch { /* funciona nesta aba */ }
        aplicar();
      });
    });
    aplicar();
  });
})();
