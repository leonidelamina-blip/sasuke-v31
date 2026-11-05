# 🩸 SASUKE V31 — GOD EDITION
Bot WhatsApp modular em **Node.js ≥ 20** (ES Modules) + **Baileys**. 96 comandos (109 contando variantes).

## Instalar
```bash
npm install
cp .env.example .env        # preenche o que precisares (ver tabela abaixo)
npm start
```
**Programas do sistema** (fora do npm):
| Programa | Para quê | Instalar (Ubuntu/Debian) | Termux |
|---|---|---|---|
| `ffmpeg` | `.fig` de vídeo, `.attp` | `sudo apt install ffmpeg` | `pkg install ffmpeg` |
| `tesseract` | OCR de comprovativos | `sudo apt install tesseract-ocr tesseract-ocr-por` | `pkg install tesseract` |

Sem eles o bot arranca na mesma; só essas funções respondem "indisponível".

## Código de pareamento
1. `npm start` → o terminal pergunta o número do bot (ou usa `BOT_NUMBER`).
2. Aparece `XXXX-XXXX`. No WhatsApp do bot: **Aparelhos ligados → Ligar com número de telefone**.
3. A sessão fica em `sessao/` (nunca a partilhes nem a ponhas no GitHub).

## Termux
```bash
pkg update && pkg install nodejs-lts git ffmpeg tesseract
git clone <teu-repo> SASUKE-V31 && cd SASUKE-V31 && npm install && npm start
```
## VPS (Ubuntu)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs git ffmpeg tesseract-ocr tesseract-ocr-por
npm install && sudo npm i -g pm2
npm start                       # 1ª vez: pareia, depois Ctrl+C
pm2 start index.js --name sasuke && pm2 save && pm2 startup
```
## GitHub
```bash
git init && git add . && git commit -m "SASUKE V31" && git branch -M main
git remote add origin <url> && git push -u origin main
```
`.gitignore` exclui `sessao/`, `.env`, `temp/` e a fotografia do fundador.

## Variáveis de ambiente
| Variável | Descrição |
|---|---|
| `BOT_NUMBER` | Número do bot (se vazio, o terminal pergunta) |
| `OWNER_NUMBER` | Fundador (nível 1). Por omissão `258852223969` |
| `PREFIX` | Prefixo (por omissão `.`) |
| `ALLOWED_COUNTRY_CODES` | Indicativos aceites no `.antiestrangeiros` |
| `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` | `.ia` — endpoint **completo** compatível com *chat completions* |
| `AI_IMAGE_URL`, `AI_IMAGE_MODEL` | `.ia-fig` — formato OpenAI *images* (`b64_json`) |
| `GOOGLE_API_KEY`, `GOOGLE_CX` | `.google-search` (Custom Search JSON API) |
| `PAYMENT_WEBHOOK_PORT` | Liga o webhook de pagamentos (0 = desligado) |

## Integrações externas
Open-Meteo (`.tempo`, sem chave) · ViaCEP (`.cep`, sem chave) · is.gd (`.link`, sem chave) ·
Google Custom Search (`.google-search`) · API de IA à tua escolha (`.ia`, `.ia-fig`).
Sem as chaves, os comandos respondem com um erro claro a dizer o que falta.

## Pagamentos: como funciona (importante)
**Uma imagem/SMS NUNCA aprova um pagamento.** O OCR/leitura só extrai referência, valor e data.
A aprovação automática exige confirmação **independente**, registada pelo dono:
1. `.regpagamento REF | valor | data` (do teu próprio extracto/telemóvel), ou
2. webhook `POST /pagamento` com cabeçalho `x-token` (ex.: app de reencaminhamento de SMS no telemóvel do dono). Define o token com `.token`/`.settoken` (só o hash é guardado).

Fluxo: cliente `.compra` → paga → envia comprovativo **no privado** (`.comprovativo` com imagem, ou `.verificarsms ID texto`) →
referência bate com o registo e o valor é igual → **APROVADO**; sem registo → **EM ANÁLISE** (manual: `.aprovar`/`.rejeitar`);
referência já usada → **bloqueado** e o dono é avisado. Quando o dono regista o pagamento depois, as encomendas em análise com essa referência são aprovadas sozinhas.
Nunca se guarda o texto do SMS, PINs ou códigos — só referência/valor/data.
A "entrega" dos megas é sempre manual (o bot não tem API de operadora): `APROVADO` = pago.

## Pressupostos (a especificação não detalhava — confirma se estão certos)
- **Picos** = segunda tabela de preços (`.addpic`/`.delpic`; `.picospv` envia no privado). **`.setrestanas`** = nota de stock mostrada em `.megas`.
- **`.limpar`** = apaga a mensagem respondida. **`.link`** = encurta URL; **`.gerar-link`** = link `wa.me`.
- **`.auto-remover`** = remove à 3ª infracção (anti-link/anti-concorrência) em 24h. **`.f.auto on 22:00 06:00`** = fecha/abre o grupo (hora de Maputo).
- **`.bot`** = painel; `.bot off` pausa o bot para todos menos o fundador. **`.dia-gratis`** mostra se o modo grátis está activo.
- `.anticoncorrencia` apaga mensagens com termos que **tu** defines (`add`/`del`); `.antiestrangeiros` só remove quando o número real é conhecido.
- `.hd` = ampliação 2× com nitidez (não é IA generativa; a legenda diz isso).
- Alugueres expirados mudam de estado e avisam; **não desligam sessões** de ninguém.

## Permissões
1 Fundador · 2 Bot · 3 Administrador · 4 Membro. O fundador só é reconhecido pelo número real resolvido pelo WhatsApp (incluindo contas LID). Nomes e texto nunca contam.

## Estrutura
`index.js` (ligação, eventos, moderação) · `config.js` · `plugins/` (style, security, database, utils, net, economy, orders, payments, rentals, scheduler, media, ai, baileys) · `commands/` (general, owner, group, admin, nano, commerce, rentals, media, utility, ai, automation) · `database/*.json` · `assets/owner/` (foto do fundador) · `tests/` · `scripts/smoke.mjs`.

## Testes — relatório
`npm test` → **52 testes, todos passam** (sem WhatsApp): estilo, base de dados (persistência, escritas concorrentes, ficheiro corrompido → cópia de segurança), permissões/LID, moderação, anti-SSRF, calculadora, dinheiro/datas, extracção de comprovativos, **OCR real com tesseract**, regras de pagamento (sem registo→análise, referência reutilizada→bloqueio, valor incompatível, aprovação única), encomendas, economia, alugueres (expiração/avisos), agendador persistente, `.f.auto`, webhook HTTP real, IA contra servidor simulado, **conversões reais sharp/ffmpeg** com limpeza de temporários, e todos os comandos da especificação.
- **Stress (`tests/fuzz.test.js`)**: cada um dos 96 comandos × 26 entradas hostis (vazio, lixo, 5000 caracteres, emojis, `../../etc/passwd`, `<script>`, números gigantes, negativos…), como fundador **e** como membro, com media vazia/corrompida/gigante e com o WhatsApp a **recusar** operações: nenhum rebenta, todos respondem, nenhum mostra `undefined`/`NaN`.
- **Operações de grupo**: o bot lê o resultado real do WhatsApp (403/404/409) em vez de anunciar sucesso falso.

`npm run smoke` → **21/21**: `index.js` completo com Baileys simulado — pareamento (número normalizado), reconexão após erro 515 sem códigos duplicados, reacções, permissões, fundador via LID, compra→imagem→OCR→análise→registo→aprovação, nano, auto-responder, sticker, anti-link, strikes, `.bot off`, boas-vindas.

**Não testado** (sem WhatsApp/rede no ambiente de desenvolvimento): pareamento e reconexão **reais**; download real de media; foto de perfil real; APIs externas reais (Open-Meteo, ViaCEP, is.gd, Google; a IA só contra servidor simulado); OCR/SMS com **comprovativos reais M-Pesa/e-Mola** (a extracção é heurística). Só um teste no WhatsApp real garante 100%: testa estes pontos primeiro e envia-me qualquer erro.
