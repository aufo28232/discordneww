# VoiceCall

Site simples estilo Discord focado **apenas** em chamada de voz em grupo e compartilhamento de tela — sem chat de texto, sem contas, sem múltiplos canais. Cada link gera uma sala; quem tem o link entra na chamada.

## Stack

- **Cliente**: HTML/CSS/JS puro (sem build step, sem framework). `socket.io-client` carregado via CDN.
- **Servidor de sinalização**: Node.js + Express + Socket.io. Só troca metadados WebRTC (offer/answer/ICE candidates) entre os participantes — nunca vê ou transporta áudio/vídeo.
- **Áudio/vídeo**: WebRTC em malha (mesh) P2P — cada participante mantém uma conexão direta com todos os outros.

## Por que o servidor de sinalização não pode ir para a Vercel

A Vercel executa o backend como funções serverless de vida curta, sem suporte a conexões WebSocket persistentes — e o Socket.io depende exatamente disso. Por isso este projeto é dividido em duas partes hospedadas separadamente:

- **`client/`** → **Vercel** (arquivos estáticos, sem servidor).
- **`server/`** → **Render** (Web Service Node, processo persistente com WebSocket nativo).

Render foi escolhido por ser a opção mais simples: deploy direto a partir do repositório Git, sem CLI nem arquivos de infraestrutura adicionais, com free tier suficiente para uso entre amigos. A limitação conhecida é que o serviço grátis "dorme" após ~15 minutos sem uso e leva ~30-50s para acordar no primeiro acesso seguinte — aceitável para este caso de uso e detalhado mais abaixo.

## Estrutura do projeto

```
discord/
├── client/        # deploy: Vercel
│   ├── index.html   # tela inicial (nome + criar/entrar em sala)
│   ├── call.html    # tela da sala (pré-entrada + chamada)
│   ├── css/style.css
│   └── js/
│       ├── config.js         # URL do signaling server
│       ├── home.js           # criar/entrar em sala
│       ├── call.js           # orquestração da sala
│       ├── webrtc.js         # malha de RTCPeerConnection (offer/answer/ICE)
│       ├── media.js          # getUserMedia / getDisplayMedia
│       ├── audio-meter.js    # indicador de "quem está falando"
│       └── socket-client.js  # wrapper do socket.io-client
└── server/        # deploy: Render
    ├── index.js     # Express + Socket.io (sinalização)
    ├── rooms.js     # estado em memória das salas
    └── package.json
```

## Rodando localmente

### 1. Servidor de sinalização

```bash
cd server
npm install
cp .env.example .env   # ajuste se quiser (padrão: porta 3001, CORS liberado)
npm start
```

### 2. Cliente

O cliente não tem build step, mas usa URLs "bonitas" (`/call/<id>`) que dependem de um rewrite (ver `client/vercel.json`). Para testar isso localmente do mesmo jeito que em produção:

```bash
cd client
npx vercel dev
```

Alternativamente, para um teste rápido sem instalar a CLI da Vercel, sirva os arquivos estáticos e acesse a sala via query string:

```bash
cd client
npx serve .
# abra http://localhost:3000/call.html?room=teste123
```

Por padrão, `client/js/config.js` já aponta para `http://localhost:3001` quando rodando em `localhost`, então não precisa editar nada para testar localmente.

## Deploy em produção

### Passo 1 — Servidor de sinalização no Render

1. Suba este repositório para o GitHub (ou GitLab/Bitbucket).
2. No [Render](https://render.com), crie um **New Web Service** apontando para o repositório.
3. Configure:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Environment Variable**: `CORS_ORIGIN` = a URL que o Vercel vai te dar para o cliente (ex: `https://seu-app.vercel.app`). Pode deixar `*` inicialmente e restringir depois.
4. Deploy. Anote a URL pública gerada (ex: `https://discord-voice-signaling.onrender.com`).

### Passo 2 — Cliente na Vercel

1. Antes de subir, edite `client/js/config.js` e troque `https://SEU-APP.onrender.com` pela URL real do seu Web Service no Render (a que você anotou no passo anterior).
2. No [Vercel](https://vercel.com), importe o mesmo repositório.
3. Configure:
   - **Root Directory**: `client`
   - **Framework Preset**: "Other" (site estático, sem build command).
4. Deploy. A Vercel vai te dar a URL final do site (ex: `https://seu-app.vercel.app`).
5. Volte no Render e atualize a env var `CORS_ORIGIN` para essa URL exata, se você quiser restringir o CORS (recomendado).

Pronto: abrir a URL da Vercel, criar uma chamada e mandar o link `/call/<id>` para os amigos.

## Funcionalidades implementadas

- Criar sala (link único) e entrar por link/código.
- Escolha de nickname antes de entrar (sem login).
- Tela de pré-entrada: pede permissão de microfone e permite escolher o dispositivo antes de entrar.
- Áudio em grupo via malha WebRTC.
- Mutar/desmutar com indicação visual clara.
- Trocar de microfone em tempo real (sem recarregar), via `enumerateDevices`.
- Supressão de ruído/eco/ganho automático via constraints do `getUserMedia` (`echoCancellation`, `noiseSuppression`, `autoGainControl`). Uma melhoria futura possível é processar o áudio com **RNNoise** (compilado para WebAssembly, rodando num `AudioWorklet`) para uma supressão de ruído mais avançada — não implementado aqui, só deixado como comentário em `client/js/media.js`.
- Compartilhamento de tela com tentativa em 1080p/60fps e fallback automático para 720p/30fps, com destaque em layout para quem está compartilhando.
- Sair da chamada.
- Indicador visual de quem está falando (Web Audio API / `AnalyserNode`).
- Tratamento de erros comuns: permissão de microfone negada, ausência de dispositivo de áudio, navegador sem suporte a `getDisplayMedia`, e remoção automática de participantes que caem da chamada.

## Limitações conhecidas

- **Mesh P2P não escala bem**: cada participante abre uma conexão direta com todos os outros (O(n²) conexões). Funciona bem até ~6-8 pessoas por sala; além disso, o consumo de CPU/banda de cada participante cresce rápido. Para salas maiores seria necessário um SFU (ex: mediasoup, LiveKit), fora do escopo deste projeto.
- **Sem servidor TURN**: só há um STUN público configurado. Em redes com NAT/firewall muito restritivo (comuns em redes corporativas), a conexão P2P direta pode falhar. Um TURN server (ex: coturn, ou um serviço gerenciado) resolveria isso, mas não foi incluído para manter o projeto simples.
- **Render free tier "dorme"**: após ~15 min sem tráfego, o servidor de sinalização hiberna e o próximo acesso demora ~30-50s para acordar. Para evitar isso, use um plano pago do Render ou um serviço de "keep-alive" (ping periódico) — não incluído por padrão.
- Sem autenticação, sem chat de texto, sem gravação, sem múltiplas salas por servidor — está fora do escopo por design.
