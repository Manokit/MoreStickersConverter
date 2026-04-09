import Fastify, {FastifyReply} from 'fastify';
import path from 'path';
import {
  DATA_DIR,
  downloadStickerPack,
  generateStickerPackDirPath,
  generateStickerPackFilePath,
  isStickerPackDownloaded,
} from './telegramStickers.js';
import fsp from 'fs/promises';
import fs from 'fs';
import {bot} from './telegram.js';

interface ParamsType {
  stickerPackName: string;
  filename: string;
}

const app = Fastify();

function setCorsHeaders(reply: FastifyReply) {
  return reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Cross-Origin-Resource-Policy', 'cross-origin');
}

function getStickerContentType(fileExtension: string) {
  switch (fileExtension.toLowerCase()) {
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'webm':
      return 'video/webm';
    case 'tgs':
      return 'application/x-tgsticker';
    default:
      return 'application/octet-stream';
  }
}

async function cleanupStickerPackArtifacts(stickerPackName: string) {
  await Promise.allSettled([
    fsp.rm(generateStickerPackDirPath(stickerPackName), {
      recursive: true,
      force: true,
    }),
    fsp.rm(generateStickerPackFilePath(stickerPackName), {
      force: true,
    }),
  ]);
}

app.get('/healthz', async (_request, reply) => {
  await reply.code(200).send({ok: true});
});

app.get('/', async (_request, reply) => {
  await setCorsHeaders(reply).type('text/html; charset=utf-8')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MoreStickersConverter</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        max-width: 720px;
        margin: 0 auto;
        padding: 48px 20px;
        line-height: 1.5;
      }
      code {
        background: #f4f4f5;
        padding: 2px 6px;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <h1>MoreStickersConverter</h1>
    <p>Send a Telegram sticker to the bot, or download a sticker pack directly by pack name.</p>
    <p>Direct download format:</p>
    <p><code>/stickerpack/telegram/&lt;telegram-pack-name&gt;</code></p>
    <p>Example:</p>
    <p><a href="/stickerpack/telegram/TIDALEUS">/stickerpack/telegram/TIDALEUS</a></p>
  </body>
</html>`);
});

app.get(
  '/sticker/telegram/:stickerPackName/:filename',
  async (request, reply) => {
    const {stickerPackName, filename} = request.params as unknown as ParamsType;
    const [stickerId, fileExtension] = filename.split('.', 2);

    // Sanitize stickerPackName and stickerId
    if (!/^[a-z0-9_]+$/i.test(stickerPackName)) {
      await reply.code(400).send('Invalid sticker pack name');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/i.test(stickerId)) {
      await reply.code(400).send('Invalid sticker id');
      return;
    }

    if (!/^(?:gif|web[pm]|tgs)$/i.test(fileExtension)) {
      await reply.code(400).send('Invalid file extension');
      return;
    }

    const stickerFilePath = path.join(DATA_DIR, stickerPackName, filename);

    try {
      await fsp.access(stickerFilePath);
      const fileStream = fs.createReadStream(stickerFilePath, {
        highWaterMark: 64 * 1024,
      });
      await setCorsHeaders(reply)
        .type(getStickerContentType(fileExtension))
        .header('Cache-Control', 'public, max-age=31536000')
        .send(fileStream);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await reply.code(404).send('Sticker not found');
        return;
      }
      await reply.code(500).send('Internal server error');
    }
  },
);

app.get('/stickerpack/telegram/:stickerPackName', async (request, reply) => {
  const {stickerPackName} = request.params as unknown as Pick<
    ParamsType,
    'stickerPackName'
  >;

  if (!/^[a-z0-9_]+$/i.test(stickerPackName)) {
    await reply.code(400).send('Invalid sticker pack name');
    return;
  }

  const stickerPackPath = generateStickerPackFilePath(stickerPackName);

  try {
    if (!(await isStickerPackDownloaded(stickerPackName))) {
      const stickerSet = await bot.telegram.getStickerSet(stickerPackName);
      await downloadStickerPack(bot.telegram, stickerSet);
    }

    await fsp.access(stickerPackPath);
    const fileStream = fs.createReadStream(stickerPackPath);
    await setCorsHeaders(reply)
      .type('application/json; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${stickerPackName}.stickerpack"`,
      )
      .header('Cache-Control', 'no-store')
      .send(fileStream);
  } catch (error) {
    console.error(error);
    await cleanupStickerPackArtifacts(stickerPackName);

    if (
      error instanceof Error &&
      /STICKERSET_INVALID|STICKERSET_OWNER_ANONYMOUS/i.test(error.message)
    ) {
      await reply.code(404).send('Sticker pack not found');
      return;
    }

    await reply.code(500).send('Failed to generate sticker pack');
  }
});

export {app};
