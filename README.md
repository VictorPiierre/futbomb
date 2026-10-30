# 🎲 Jogatina

Site de jogos de palavras multiplayer em tempo real, para jogar com os amigos pelo link da sala.

## Jogos

### 💣 Pavio Curto (2 a 4 jogadores)
Uma letra é sorteada e a bomba passa de mão em mão: na sua vez, digite uma palavra do tema
que comece com a letra antes que ela exploda. Cada um tem 2 vidas; o último que sobrar vence.

### 🛑 Stop (2 a 10 jogadores)
Uma letra é sorteada e todos preenchem as categorias ao mesmo tempo. Quem completar tudo
aperta **STOP** e a rodada acaba para todos. Na correção, as respostas que estão no dicionário
entram como ✅ e as desconhecidas como ❓; a maioria dos outros jogadores pode virar qualquer uma.
Resposta única vale 10, repetida vale 5. Vence quem somar mais pontos nas rodadas.

**Temas / categorias:** 🦁 Animais · 🧸 Objetos · 🍎 Comidas e frutas · 🎨 Cores · 🌎 Países · ⭐ Famosos ·
💼 Profissões · 🙋 Nomes · 🏙️ Cidades · 🏷️ Marcas · 🎮 Jogos e brincadeiras · 🎬 Filmes ·
📺 Séries, novelas e desenhos · 🏅 Esportes · 🫀 Partes do corpo · ⚽ Jogadores · 🛡️ Clubes ·
🤬 Xingamentos (adulto) · 🎲 Surpresa (Pavio Curto: o tema muda a cada volta).

- Front-end: React + Vite + TypeScript + Tailwind CSS
- Back-end: Node.js + Express + Socket.IO (cronômetro, turnos, votação e validação **no servidor**)
- Banco de palavras: `data/<tema>.json` (curado) + `data/extra/<tema>.json` (importado de bases públicas)

## Rodar localmente

Requisitos: Node.js 20 ou mais novo.

```bash
npm install
```

**Modo desenvolvimento** (recarrega ao salvar):

```bash
npm run dev
```

Abra http://localhost:5173. O servidor do jogo roda na porta 3000 e o Vite faz o proxy.

**Modo produção** (um único servidor servindo tudo):

```bash
npm run build
npm start
```

Abra http://localhost:3000.

### Testar o multiplayer no mesmo computador

Cada **aba** é um jogador diferente. Crie a sala em uma aba, copie o link de convite
(`http://localhost:3000/s/ABCD`) e abra em outra aba ou outro navegador.

Há também um teste automático que conecta 3 clientes reais ao servidor:

```bash
npm run smoke
```

E o teste do Stop:

```bash
npm run smoke:stop
```

(com o servidor rodando em outro terminal via `npm start`).

> O projeto começou como "FutBomb"; o repositório e os links (`futbomb.vercel.app`) mantêm esse nome.

## Jogar com amigos em outras redes

O jogo precisa de um servidor acessível pela internet. Opções:

1. **Mesma rede Wi‑Fi**: rode `npm run build && npm start` e passe o endereço
   `http://SEU-IP-LOCAL:3000` (veja o IP com `ipconfig`). Libere a porta 3000 no firewall se pedir.
2. **Túnel rápido (sem hospedar)**: com o jogo rodando, use
   `npx cloudflared tunnel --url http://localhost:3000` (ou ngrok) e compartilhe o link gerado.
3. **Hospedagem permanente**: veja abaixo.

## Deploy

O servidor usa WebSockets e guarda as salas em memória, então ele precisa de uma
hospedagem Node.js que fique **sempre ligada** (Render, Railway, Fly.io, VPS…).
A Vercel não mantém conexões WebSocket em funções serverless, por isso nela fica só o front-end.

### Opção A — tudo no Render (mais simples)

1. Suba esta pasta para um repositório no GitHub.
2. No Render, "New → Blueprint" e escolha o repositório (o arquivo `render.yaml` já configura tudo).
3. Pronto: o link do Render já é o jogo completo.

> No plano gratuito o Render "dorme" após inatividade; a primeira visita pode levar ~1 minuto.

### Opção B — front-end na Vercel + servidor no Render

1. Faça a Opção A para ter o servidor no ar (ex.: `https://futbomb.onrender.com`).
2. Na Vercel, importe o mesmo repositório (o `vercel.json` já define build e rotas).
3. Em *Settings → Environment Variables*, crie `VITE_SERVER_URL` com a URL do servidor
   (ex.: `https://futbomb.onrender.com`) e faça um novo deploy.

Os links de convite usarão o domínio da Vercel (`https://seu-app.vercel.app/s/ABCD`).

Variável do servidor: `PORT` (padrão 3000).

## Banco de palavras

São duas camadas por tema:

- **`data/<tema>.json`** — banco principal, curado à mão. É o que decide quais letras podem ser sorteadas.
- **`data/extra/<tema>.json`** — listas grandes só para *reconhecer* respostas (≈75 mil entradas):
  - nomes do Censo/IBGE (via brasil.io) que pelo menos 200 pessoas têm (~25 mil); nomes compostos valem se cada parte for conhecida;
  - todos os municípios do IBGE + cidades do mundo (Wikidata);
  - famosos, filmes, séries, jogos, marcas, jogadores e clubes (Wikidata, CC0);
  - animais, comidas, objetos, profissões, partes do corpo, cores e esportes (Wiktionary via kaikki.org),
    só palavras de uso real (aparecem em legendas pt-BR) e sem sentidos arcaicos ou raros.

Para atualizar as listas extra:

```bash
npm run fetch:wikidata
```

```bash
npm run build:extra -- <pasta com nomes.csv.gz, municipios.json e kaikki-pt.jsonl>
```

(os links de download de cada arquivo estão no topo de `scripts/build-extra.ts`).


Cada tema tem seu arquivo em `data/`: `players`, `clubs`, `animals`, `objects`, `foods`,
`colors`, `countries`, `famous`, `professions`, `names`, `cities`, `brands`, `games`,
`movies`, `shows`, `sports`, `body` e `insults` (`.json`). Em filmes, séries e jogos o artigo
inicial é opcional ("Rei Leão" = "O Rei Leão"). Formato:

```json
{ "name": "Lionel Messi", "aliases": ["Messi", "Leo Messi", "La Pulga"] }
```

A validação ignora maiúsculas, acentos e pontuação, aceita apelidos cadastrados,
tolera um pequeno erro de digitação em nomes longos ("halland" → Erling Haaland) e,
para clubes, ignora prefixos como "FC", "EC", "SC" ("Flamengo FC" → Flamengo).
Nos temas de palavras comuns (animais, objetos, comidas, cores, profissões) também aceita plural
e feminino ("gatas" → Gato, "leões" → Leão, "professora" → Professor).
Nomes já usados na partida são recusados.

Para criar um tema novo: adicione-o em `THEMES` (`shared/types.ts`) e crie `data/<id>.json`.

### Importar novos nomes

CSV (`nome,apelidos`, com apelidos separados por `|`) ou JSON:

```bash
npm run import -- jogadores meus-jogadores.csv
npm run import -- clubes meus-clubes.json
npm run import -- animais meus-animais.csv
```

Veja `data/exemplo-importacao.csv`. Nomes repetidos são mesclados (os apelidos novos são somados).
Use `--substituir` para trocar o banco inteiro. Reinicie o servidor depois de importar.

Palavras que os jogadores tentaram e não estavam no banco ficam listadas em `/api/recusadas`
(ex.: https://futbomb.onrender.com/api/recusadas) — use para descobrir o que falta cadastrar.
A lista é zerada quando o servidor reinicia.

## Regras implementadas

- Sala com código de 4 letras e link `/s/CODIGO`; anfitrião escolhe tema (ou Surpresa), tempo (5–30 s) e máximo de jogadores (2–4).
- Todos começam com 2 vidas; tempo esgotado = explosão e perda de vida; 0 vidas = eliminado (vira espectador).
- Quem começa é sorteado (nunca o mesmo da partida anterior); a cada volta, quem abre é o próximo da roda.
- A mesma letra vale por uma volta inteira; o sorteio prioriza as letras que estão há mais tempo sem sair (inclusive entre partidas e temas).
- Letras difíceis (K, W, X, Y, Z, Q, U) só saem quando há nomes suficientes disponíveis.
- Resposta errada: aviso e nova tentativa dentro do tempo restante.
- Quem entra durante a partida assiste e joga a próxima; quem atualiza a página volta para o mesmo lugar;
  quem cai por mais de 45 s é eliminado para não travar o jogo; se o anfitrião sair, outro assume.
- Tela de vitória com classificação e "Jogar novamente" (reinicia vidas e respostas, mantém a sala).

## Estrutura

```
client/          front-end React (index.html, src/)
server/          servidor Express + Socket.IO (index.ts, room.ts = regras, names.ts = validação)
shared/          tipos e normalização compartilhados
data/            banco de jogadores e clubes
scripts/         importador de nomes e teste de fumaça
```
