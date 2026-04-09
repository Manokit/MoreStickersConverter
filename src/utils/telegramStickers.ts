import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import {Readable} from 'stream';
import {spawn} from 'child_process';
import {Telegram} from 'telegraf';
import {StickerPack, Sticker as McSticker} from './mcStickerPack.js';
import {Sticker, StickerSet} from 'telegraf/types';

const DATA_DIR = path.join(path.resolve(process.env.DATA_DIR!), 'telegram');
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5');
const MC_STICKER_PACK_ID_PREFIX = 'MoreStickers:Telegram:Pack';
const MC_STICKER_ID_PREFIX = 'MoreStickers:Telegram:Sticker';
const EXTERNAL_URL = process.env.EXTERNAL_URL!;
const STICKER_PACK_FILE_EXTENSION = '.stickerpack';

function toMcStickerPackId(stickerSetName: string) {
  return `${MC_STICKER_PACK_ID_PREFIX}:${stickerSetName}`;
}

function toMcStickerId(stickerId: string, stickerPackName: string) {
  return `${MC_STICKER_ID_PREFIX}:${stickerPackName}:${stickerId}`;
}

function generateExternalUrl(
  stickerPackName: string,
  stickerId: string,
  fileExtension: string,
) {
  return `${EXTERNAL_URL}/sticker/telegram/${stickerPackName}/${stickerId}.${fileExtension}`;
}

export function generateStickerPackDownloadUrl(stickerPackName: string) {
  return `${EXTERNAL_URL}/stickerpack/telegram/${stickerPackName}`;
}

function getStickerFileExtension(filePath?: string) {
  return path
    .extname(filePath ?? '')
    .replace(/^\./, '')
    .toLowerCase();
}

function getOutputFileExtension(sticker: Sticker, originalExtension: string) {
  if (sticker.is_video) {
    return 'gif';
  }

  return originalExtension;
}

async function runFfmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    ffmpeg.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', error => {
      reject(error);
    });

    ffmpeg.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg exited with code ${code}: ${stderr.trim().slice(-2000)}`,
        ),
      );
    });
  });
}

async function convertVideoStickerToGif(inputPath: string, outputPath: string) {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    '[0:v]fps=15,scale=160:160:force_original_aspect_ratio=decrease:flags=lanczos,pad=160:160:(ow-iw)/2:(oh-ih)/2:color=0x00000000,split[s0][s1];[s0]palettegen=stats_mode=single:reserve_transparent=1[p];[s1][p]paletteuse=new=1:alpha_threshold=10',
    '-loop',
    '0',
    outputPath,
  ]);
}

export function generateStickerPackDirPath(stickerSetName: string) {
  return path.join(DATA_DIR, stickerSetName);
}

export function generateStickerPackFilePath(stickerSetName: string) {
  return path.join(DATA_DIR, `${stickerSetName}${STICKER_PACK_FILE_EXTENSION}`);
}

async function isStickerPackDownloaded(stickerSetName: string) {
  try {
    await Promise.all([
      fsp.access(generateStickerPackDirPath(stickerSetName)),
      fsp.access(generateStickerPackFilePath(stickerSetName)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function downloadSticker(
  queue: Sticker[],
  telegram: Telegram,
  stickerSet: StickerSet,
) {
  if (queue.length === 0) return;
  const sticker = queue.shift()!;
  const stickerFile = await telegram.getFile(sticker.file_id);
  const sourceFileType = getStickerFileExtension(stickerFile.file_path);
  if (!sourceFileType) {
    throw new Error(
      `Could not determine file extension for sticker ${sticker.file_unique_id}`,
    );
  }
  const outputFileType = getOutputFileExtension(sticker, sourceFileType);
  const stickerPackDirPath = generateStickerPackDirPath(stickerSet.name);
  const sourceStickerFilePath = path.join(
    stickerPackDirPath,
    stickerFile.file_unique_id + '.' + sourceFileType,
  );
  const outputStickerFilePath = path.join(
    stickerPackDirPath,
    stickerFile.file_unique_id + '.' + outputFileType,
  );

  const fileLink = await telegram.getFileLink(stickerFile.file_id);
  const fileStream = fs.createWriteStream(sourceStickerFilePath);
  let retries = 5;
  let response: Response | null = null;
  let lastError: unknown;
  while (retries-- > 0) {
    try {
      response = await fetch(fileLink);
      if (!response.ok) {
        throw new Error(
          `Failed to download sticker ${sticker.file_unique_id}: ${response.status} ${response.statusText}`,
        );
      }
      break;
    } catch (error) {
      lastError = error;
      console.error(error);
      if (retries === 0) {
        throw lastError;
      }
    }
  }
  if (!response?.body) {
    throw new Error(
      `Sticker download returned no body for ${sticker.file_unique_id}`,
    );
  }
  const stream = Readable.fromWeb(response.body);
  stream.pipe(fileStream);
  await new Promise(resolve => fileStream.on('finish', resolve));
  if (sticker.is_video) {
    await convertVideoStickerToGif(
      sourceStickerFilePath,
      outputStickerFilePath,
    );
    await fsp.rm(sourceStickerFilePath, {force: true});
  }
  await downloadSticker(queue, telegram, stickerSet);
}

async function downloadStickerPack(telegram: Telegram, stickerSet: StickerSet) {
  const stickerSetDir = generateStickerPackDirPath(stickerSet.name);
  await fsp.mkdir(stickerSetDir, {recursive: true});
  const queue = stickerSet.stickers.slice();

  const downloadPromises = Array.from({length: CONCURRENCY}, () =>
    downloadSticker(queue, telegram, stickerSet),
  );
  await Promise.all(downloadPromises);

  const mcStickerPack = await toMcStickerPack(telegram, stickerSet);
  const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
  await fsp.writeFile(mcStickerPackPath, JSON.stringify(mcStickerPack));
}

async function toMcStickerPack(
  telegram: Telegram,
  stickerSet: StickerSet,
): Promise<StickerPack> {
  const stickerPs = stickerSet.stickers.map(async sticker => {
    const stickerFile = await telegram.getFile(sticker.file_id);
    const sourceFileType = getStickerFileExtension(stickerFile.file_path);
    if (!sourceFileType) {
      throw new Error(
        `Could not determine file extension for sticker ${sticker.file_unique_id}`,
      );
    }
    const outputFileType = getOutputFileExtension(sticker, sourceFileType);
    return {
      id: toMcStickerId(sticker.file_unique_id, stickerSet.name),
      image: generateExternalUrl(
        stickerSet.name,
        sticker.file_unique_id,
        outputFileType,
      ),
      title: sticker.emoji ?? sticker.file_unique_id,
      stickerPackId: toMcStickerPackId(stickerSet.name),
      filename: stickerFile.file_unique_id + '.' + outputFileType,
      isAnimated: sticker.is_animated || sticker.is_video,
    } as McSticker;
  });
  const stickers = await Promise.all(stickerPs);
  return {
    id: toMcStickerPackId(stickerSet.name),
    title: stickerSet.title,
    logo: stickers[0],
    stickers,
  } as StickerPack;
}

export {
  isStickerPackDownloaded,
  downloadStickerPack,
  toMcStickerPack,
  DATA_DIR,
};
