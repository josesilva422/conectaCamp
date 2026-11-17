// ============================================================
//  CONTEÚDO DO SITE — edite este arquivo para atualizar o portal
//  (datas, local, programação, valor, vagas, contato). Sem mexer em código.
// ============================================================
window.CONTENT = {

  // Data/hora de início (ativa a contagem regressiva). Deixe vazio até definir.
  // Exemplo: '2027-07-15T19:00:00-03:00'
  eventStart: '',

  // Textos que aparecem em vários pontos do site (data-bind="...")
  bind: {
    heroDate: 'Data a definir',   // aparece grande no cartão do início (ex.: '15 a 18 de julho')
    dates: 'Data a definir · 2027',
    datesShort: '1ª EDIÇÃO · 2027',
    placeName: 'Local a definir',
    placeCity: '',   // ex.: 'Goiânia / GO' (vazio = esconde a linha)
    placeAddress: 'O local e o endereço serão divulgados em breve.'
  },

  // Contato. whatsapp: só números, com DDI+DDD. Vazio = esconde o botão.
  contact: {
    whatsapp: '5562998521394',
    whatsappLabel: '(62) 99852-1394',
    instagram: '',   // ex.: 'https://www.instagram.com/conectacamp'
    email: ''
  },

  // Link do Google Maps. Vazio = esconde o botão "Abrir no mapa".
  mapUrl: '',

  // Fotos/vídeos do local: [{ src: 'img/local/entrada.jpg', alt: 'Entrada do local' }]
  localPhotos: [],

  // Inscrição
  prices: { full: 150 },   // valor fixo por pessoa (R$)
  ageMin: 15,              // idade mínima
  ageMax: 25,              // idade máxima
  spots: 100,              // vagas para o público geral

  // Programação. Vazio = mostra "em breve". Quando definir, use o modelo abaixo:
  program: [
    // { day: 'Qui', date: '15/07', title: 'Chegada', items: [
    //   { time: '15h–18h', name: 'Chegada e acolhimento', desc: 'Credenciamento e acomodação.' },
    //   { time: '19h', name: 'Noite de boas-vindas', desc: '' }
    // ]},
  ]
};
