import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requireUser } from './middleware/auth.js';
import callRoutes from './routes/callRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import publicCallRoutes from './routes/publicCallRoutes.js';
import { attachVoiceBridge } from './websocket/voiceBridge.js';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin === env.FRONTEND_ORIGIN) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.resolve('frontend')));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'callmate-ai', mode: env.DATA_MODE, liveCallsEnabled: env.ENABLE_LIVE_CALLS === 'true' }));
app.get('/call/:id', (_req, res) => res.sendFile(path.resolve('frontend/call.html')));
app.use('/api/public/calls', publicCallRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/api/calls', requireUser, callRoutes);
app.use('/api/assistant', requireUser, assistantRoutes);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error.' });
});
const server = http.createServer(app);
attachVoiceBridge(server);
server.listen(env.PORT, '0.0.0.0', () => console.log(`CallMate API listening on http://localhost:${env.PORT}`));
