import express from 'express';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { createCanvas } from 'canvas';

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors()); // Habilita CORS para todas as rotas
app.use(express.json());

let sessions = {};

// Configuração do Swagger
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp API',
      description: 'API para gerenciar sessões do WhatsApp usando whatsapp-web.js',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'http://localhost:3031',
      },
    ],
  },
  apis: ['./index.js'], // Caminho para o arquivo de documentação
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Função para iniciar uma nova sessão e armazená-la
const createNewSession = (sessionName) => {
  return new Promise((resolve, reject) => {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName }), // Salva o estado da sessão localmente
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      },
    });

    client.on('qr', (qr) => {
      sessions[sessionName] = { client, status: 'PENDING', qrCode: qr };
      resolve(qr); // Retorna o QR code para ser usado na API
    });

    client.on('ready', () => {
      sessions[sessionName].status = 'CONNECTED';
      console.log(`Session ${sessionName} connected.`);
    });

    client.on('authenticated', () => {
      sessions[sessionName].status = 'AUTHENTICATED';
      console.log(`Session ${sessionName} authenticated.`);
    });

    client.on('auth_failure', () => {
      sessions[sessionName].status = 'AUTH_FAILED';
      console.error(`Authentication failed for session ${sessionName}`);
      delete sessions[sessionName];
      reject(new Error('Authentication failed'));
    });

    client.on('disconnected', (reason) => {
      sessions[sessionName].status = 'DISCONNECTED';
      console.log(`Session ${sessionName} disconnected: ${reason}`);
      delete sessions[sessionName];
    });

    client.initialize();
  });
};

// Rota para criar uma nova sessão
/**
 * @swagger
 * /create-session:
 *   post:
 *     summary: Cria uma nova sessão do WhatsApp
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: QR code para conectar a nova sessão
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qrcode:
 *                   type: string
 *                   description: Base64 QR code image data
 *       400:
 *         description: Sessão já existe
 *       500:
 *         description: Erro ao criar sessão
 */
app.post('/create-session', async (req, res) => {
  const sessionName = req.query.sessionName;
  if (sessions[sessionName]) {
    return res.status(400).json({ error: 'Sessão já existe' });
  }

  try {
    const qrCode = await createNewSession(sessionName);
    res.json({ qrcode: qrCode });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar sessão' });
  }
});

// Rota para obter o QR code em Base64
/**
 * @swagger
 * /qrcode-base64:
 *   get:
 *     summary: Retorna o QR code em formato Base64
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Base64 QR code image data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qrcode:
 *                   type: string
 *                   description: Base64 QR code image data
 *       404:
 *         description: Sessão não encontrada
 */
app.get('/qrcode-base64', async (req, res) => {
  const sessionName = req.query.sessionName;
  const session = sessions[sessionName];
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  try {
    const qrCodeBase64 = await qrcode.toDataURL(session.qrCode);
    res.json({ qrcode: qrCodeBase64 });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar QR code em Base64' });
  }
});

// Rota para obter o QR code como imagem PNG
/**
 * @swagger
 * /qrcode-png:
 *   get:
 *     summary: Retorna o QR code como uma imagem PNG
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: QR code image in PNG format
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Sessão não encontrada
 */
app.get('/qrcode-png', async (req, res) => {
  const sessionName = req.query.sessionName;
  const session = sessions[sessionName];
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  try {
    const canvas = createCanvas(250, 250);
    await qrcode.toCanvas(canvas, session.qrCode);
    res.type('image/png');
    canvas.createPNGStream().pipe(res);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar QR code em PNG' });
  }
});

// Rota para verificar o status da sessão
/**
 * @swagger
 * /status-session:
 *   get:
 *     summary: Verifica o status de uma sessão existente
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status da sessão retornado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Status da sessão
 *       404:
 *         description: Sessão não encontrada
 */
app.get('/status-session', (req, res) => {
  const sessionName = req.query.sessionName;
  const session = sessions[sessionName];
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  res.json({ status: session.status });
});

// Rota para encerrar uma sessão
/**
 * @swagger
 * /end-session:
 *   post:
 *     summary: Encerra uma sessão do WhatsApp
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sessão encerrada com sucesso
 *       404:
 *         description: Sessão não encontrada
 */
app.post('/end-session', (req, res) => {
  const sessionName = req.query.sessionName;
  const session = sessions[sessionName];
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  session.client.destroy();
  delete sessions[sessionName];
  res.json({ status: 'Sessão encerrada com sucesso' });
});

// Rota para enviar uma mensagem
/**
 * @swagger
 * /send-message:
 *   post:
 *     summary: Envia uma mensagem usando uma sessão existente
 *     parameters:
 *       - in: query
 *         name: sessionName
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: number
 *         required: true
 *         schema:
 *           type: string
 *         description: Número de telefone no formato internacional (e.g., 5511999998888)
 *       - in: query
 *         name: message
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mensagem enviada com sucesso
 *       404:
 *         description: Sessão não encontrada ou número inválido
 *       500:
 *         description: Erro ao enviar a mensagem
 */
app.post('/send-message', async (req, res) => {
  const sessionName = req.query.sessionName;
  const number = req.query.number;
  const message = req.query.message;

  const session = sessions[sessionName];
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }

  try {
    await session.client.sendMessage(`${number}@c.us`, message);
    res.json({ status: 'Mensagem enviada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar a mensagem' });
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 3031;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
