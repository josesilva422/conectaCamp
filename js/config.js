/* CONECTAcamp — conexão com o banco de dados (Supabase)
   Estes valores são PÚBLICOS por natureza: a chave "publishable" foi feita para ficar no site.
   Quem protege os dados é a segurança por linha (RLS) do supabase/schema.sql.
   NUNCA coloque aqui a chave "secret" nem a "service_role".

   Como o site escolhe de onde ler os dados (js/backend.js):
   - aberto em localhost / arquivo local  -> usa o servidor local (node server.js)
   - publicado (Netlify, domínio próprio) -> usa o Supabase abaixo
   Para forçar um dos dois no navegador:  localStorage.setItem('cc_backend', 'supabase')  ou  'local'
*/
window.CC_CONFIG = {
  supabase: {
    url: 'https://eeawljyvmltvccmqfghs.supabase.co',
    key: 'sb_publishable_OF3fasZkz9wVI12lp4CEaA_USqiu0nK',
    adminEmail: 'josegabrielpo422@gmail.com'   /* só preenche o campo de e-mail do painel */
  }
};
