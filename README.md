# CONECTAcamp — site e painel de inscrições

Site do acampamento jovem da CONECTA (1ª edição, 2027) com **inscrições online**, **vagas ao vivo**
e **painel do organizador**. Não precisa instalar nada além do Node 20+.

## Como rodar
```bash
node server.js
```
Abra:
- **Site:** http://localhost:3002
- **Painel do organizador:** http://localhost:3002/admin/

Para usar outra porta: `PORT=3000 node server.js` (no PowerShell: `$env:PORT=3000; node server.js`).

### Senha do painel
Na primeira vez o servidor gera uma senha e a salva em **`data/admin-password.txt`**.
Para usar a sua própria, defina `ADMIN_PASSWORD` antes de iniciar (tem prioridade sobre o arquivo).
Troque por uma senha forte antes de publicar.

## O que o painel faz
- **Resumo:** vagas ocupadas, inscrições, pagas, a receber (em R$), menores de 18 e canceladas.
- **Lista** com busca (nome, WhatsApp, igreja, protocolo), filtro por situação (pendente, parcial, paga, cancelada) e ordenação.
- **Detalhes** de cada inscrição: participantes, alergias, menores (e se a autorização assinada já chegou), consentimentos.
- **Pagamentos, em 3 passos coloridos:** (1) forma de pagamento escolhida, (2) pagamentos recebidos, (3) registrar. A situação muda sozinha entre pendente, parcial e paga.
  - **Pix e cartão de crédito:** um **único** pagamento, no valor total (o campo vem travado).
  - **Crediário:** **várias parcelas**, até quitar (não deixa passar do valor).
  - Sem forma escolhida não registra pagamento. A pessoa escolhe no formulário do site; você pode trocar no painel (trocar para Pix/cartão só é possível se o pagamento já cobre o total).
- **Editar dados**, anotações internas, **cancelar/reativar** (cancelar libera a vaga) e **excluir definitivamente** (só para pedidos de exclusão de dados).
- **Cobrar/lembrar ou confirmar** por WhatsApp, com a mensagem já escrita.
- **Nova inscrição** pelo painel (para quem se inscreveu por WhatsApp ou pessoalmente).
- **Validar voucher** (chegada ao acampamento): busca por código/QR, CPF, protocolo ou nome, mostra se está **liberado**, com **pagamento pendente**, **cancelado** ou se **já entrou**, e registra a entrada (com horário). Veja a seção "Voucher" abaixo.
- **Exportar CSV** (abre no Excel) e **Lista de presença** para imprimir, sempre em **ordem alfabética** pelo nome do participante (ignora acento e maiúscula/minúscula).
- **Configurações:** número de vagas, valor, faixa de idade, se pré-cadastros ocupam vaga, e abrir/fechar as inscrições.

## Minha inscrição e voucher (um por pessoa)

> **Atualização:** depois da consulta a tela mostra **só o voucher** (sem protocolo, valores nem forma de pagamento), com os botões de salvar imagem, imprimir e consultar outra inscrição.
>
> **Entrada pelo celular (destacar o voucher):** em **Configurações** do painel há a chave "Entrada pelo celular liberada". Ligue só no dia. Com ela ligada, quem está **confirmado** arrasta a parte do QR do voucher (para baixo no celular, para o lado no computador) e a presença é registrada na hora; o voucher passa a mostrar "Entrada confirmada" com um relógio correndo (para a equipe ver que não é foto da tela). Quem não pagou tudo, ou está cancelado, não consegue destacar e deve procurar a organização. O QR e o "Validar voucher" do painel continuam funcionando, e o painel mostra "(pelo celular)" nessas entradas e permite desfazer.
No site, o botão **Minha inscrição** (menu, topo e rodapé; também aparece depois de se inscrever) pede o **CPF** ou o **código** e mostra:
- **Pré-cadastro** (ainda sem pagamento), **pré-cadastro com pagamento parcial** (crediário), **confirmado** (pago por inteiro) ou **cancelada**.
- Um **voucher por participante**, com nome, idade, igreja, CPF mascarado, protocolo e código (`CCV-XXXX-XXXX`). O **QR Code só aparece quando a inscrição está confirmada**; antes disso o voucher mostra "Pré-cadastro". Dá para **salvar como imagem** ou imprimir.
- Aceita: CPF (com ou sem pontos), **protocolo** da inscrição (`CC-XXXXXX`, mostra todos os vouchers dela) ou **código do voucher** (mostra só aquela pessoa).

**Validação no dia:** o QR leva a `/admin/?v=CÓDIGO`. Quem da organização escaneia com a câmera do celular (já logado no painel) cai direto na pessoa, com a faixa colorida de situação, e toca em **Registrar entrada**. O status é lido do servidor na hora: se o pagamento for removido ou a inscrição cancelada, o voucher deixa de valer. A entrada fica gravada (quem já entrou aparece como "já registrada"), pode ser desfeita, e a Lista de presença impressa marca ✔ com o horário. Quem não pagou tudo só entra se a organização confirmar "Liberar mesmo assim".
No painel, **Validar voucher** também aceita digitar/ditar o código ou o nome, e leitor de código de barras USB. O botão **"Ler QR com a câmera"** aparece sempre e funciona no computador (webcam) e no celular: usa o leitor do próprio navegador quando existe e, senão, a biblioteca **jsQR** (`admin/vendor/jsqr.js`, licença Apache-2.0 em `admin/vendor/jsqr-LICENSE.txt`), carregada só na primeira vez. A câmera só abre em endereço seguro (`https://` ou `localhost`); em outro endereço o painel avisa e dá para usar a câmera nativa do celular ou digitar o código.

**CPF:** é obrigatório no formulário do site (validado pelos dígitos) e opcional em cadastros feitos pelo painel. Um CPF só pode ter **uma inscrição ativa**. Cadastros antigos (feitos antes do voucher) ganharam código automaticamente e ficam **sem CPF** até alguém incluir em "Editar dados"; enquanto isso são consultados pelo protocolo.
**Privacidade:** a consulta pública nunca mostra telefone, alergias nem o CPF inteiro, e só aceita CPF/protocolo/código (não busca por nome). Erros de digitação são limitados (6 tentativas erradas a cada 10 minutos por conexão) para ninguém conseguir adivinhar dados de terceiros. O CPF fica gravado em `data/` (dado pessoal: LGPD).

## Vagas ao vivo
O número de vagas no topo, no voucher, nas faixas e na seção de inscrição vem do servidor e cai conforme as inscrições entram.
Quando chega a zero, o site mostra **ESGOTADO** e o formulário some; o servidor também recusa novas inscrições.
Por padrão, **pré-cadastros já ocupam vaga** (para não vender mais do que existe); cancele os que não pagarem para liberar.
Se o servidor não estiver rodando, o site abre normalmente no modo antigo (só WhatsApp, vagas fixas de `js/content.js`).

## Onde ficam os dados
Em **`data/`** (não é servida pelo site):
- `registrations.json` — todas as inscrições; `settings.json` — configurações;
- `backups/` — cópia automática a cada 6 h (guarda as 30 últimas);
- `secret.key` e `admin-password.txt` — segredo da sessão e senha do painel. **Não compartilhe.**

Faça backup da pasta `data/` e **não a publique**. Ela contém dados pessoais, inclusive de menores (LGPD).

## Banco no Supabase (preparado, ainda NÃO conectado)
O arquivo [`supabase/schema.sql`](supabase/schema.sql) já tem o banco pronto: tabelas, segurança por linha (RLS),
vagas ao vivo, inscrição pelo site, e as funções do painel. Ele existe só aqui na pasta; **nada foi criado no Supabase**.
Foi testado em um Postgres local (45 verificações: quem pode ver o quê, limite de vagas, erros, cancelar/reativar, anti-abuso).

Quando você criar o projeto:
1. Supabase > SQL Editor > cole o `schema.sql` inteiro e rode.
2. Authentication > Users > Add user, com o e-mail do organizador (marque "Auto confirm user").
3. Authentication > Sign In / Providers: desative "Allow new users to sign up".
4. Me passe a **URL do projeto** e a **chave pública** (`sb_publishable_...`) para ligar o site e o painel a esse banco.

**Atenção:** o `schema.sql` ainda **não** tem CPF, voucher por pessoa nem registro de entrada (isso foi feito só no servidor local). Antes de ligar ao Supabase é preciso atualizar o schema com `cpf`, `voucher`, `checkin` em `participants` e as funções de consulta e de entrada.

Enquanto isso, o site e o painel continuam usando o servidor local (`node server.js`) com os dados em `data/`.

## Segurança (resumo)
- Painel e API do painel só respondem com login (cookie `HttpOnly`, `SameSite=Strict`, expira em 12 h); limite de tentativas de senha.
- Inscrições têm limite por IP, campo-isca anti-robô e validação no servidor (idade, vagas, consentimentos).
- O servidor só entrega as pastas `css/`, `js/`, `img/` e `admin/`; `data/`, `server.js` etc. ficam bloqueados.
- Por padrão escuta só em `127.0.0.1`. Para expor na rede/internet use um HTTPS na frente (proxy) e defina `HOST=0.0.0.0` e, se houver proxy, `TRUST_PROXY=1`.

## Publicar
O painel precisa de um servidor Node com disco persistente (Netlify estático **não** serve para isso).
Qualquer VPS, Render, Railway ou Fly.io com volume para a pasta `data/` funciona: comando de início `node server.js`,
variável `ADMIN_PASSWORD` definida e HTTPS ligado.

## Editar o conteúdo
Tudo que muda de uma edição para outra está em **`js/content.js`**: data, local, link do mapa, WhatsApp, Instagram,
programação etc. Valor, vagas e faixa de idade são controlados pelo painel (Configurações); os de `content.js` valem só sem servidor.

- `bind.heroDate` — data grande no cartão do início (ex.: `'15 a 18 de julho'`).
- `eventStart` — liga a contagem regressiva (formato `2027-07-15T19:00:00-03:00`).
- `program` — quando preenchido, o cartão "Aguarde!" vira um carrossel com um cartão por dia.

## Identidade (resumo)
Seções frias (azul) alternando com quentes (laranja), separadas por branco gelo e preto.
| Token | Cor |
|---|---|
| Preto profundo | `#090B12` |
| Azul noite | `#172554` |
| Azul elétrico | `#2563EB` |
| Laranja (quente) | `#FF6A1F` |
| Branco gelo | `#F5F5F5` |

Fontes: Anton (títulos) e Archivo (texto), como no site de referência. A logo da CONECTA (`img/logo-conecta.png`)
aparece no topo e no rodapé. O símbolo de "dois pontos ligados" do menu é uma recriação do exemplo do manual.
