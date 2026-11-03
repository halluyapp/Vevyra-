import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import veyraRoutes from './server/routes';

async function bootstrap() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(cors());
  app.use(express.json());

  // Mount VEYRA API endpoints
  app.use('/api/veyra', veyraRoutes);

  if (!isProd) {
    // Mount Vite middlewares for HMR and SPA serving in development
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    // In production serve dist directory
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VEYRA] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[VEYRA] API available at http://0.0.0.0:${PORT}/api/veyra/home`);
  });
}

bootstrap().catch((err) => {
  console.error('[VEYRA] Fatal server bootstrap failure:', err);
  process.exit(1);
});
