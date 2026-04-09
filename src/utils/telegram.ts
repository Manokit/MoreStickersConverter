import {Input, Telegraf} from 'telegraf';
import {message} from 'telegraf/filters';
import {
  downloadStickerPack,
  generateStickerPackDirPath,
  generateStickerPackDownloadUrl,
  generateStickerPackFilePath,
  isStickerPackDownloaded,
} from './telegramStickers.js';
import fsp from 'fs/promises';

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN!);

bot.on(message('sticker'), async ctx => {
  const stickerPackName = ctx.message.sticker!.set_name;
  if (!stickerPackName) {
    await ctx.reply('This sticker does not belong to any sticker pack.');
    return;
  }

  const stickerSet = await ctx.telegram.getStickerSet(stickerPackName);
  const mcStickerPackPath = generateStickerPackFilePath(stickerSet.name);
  const stickerPackDownloadUrl = generateStickerPackDownloadUrl(
    stickerSet.name,
  );
  if (await isStickerPackDownloaded(stickerPackName)) {
    await ctx.reply(
      `Download URL for Equicord (.stickerpack file, then use Add from File):\n${stickerPackDownloadUrl}`,
    );
    await ctx.replyWithDocument(Input.fromLocalFile(mcStickerPackPath));
    return;
  }

  await ctx.reply('Downloading the sticker pack...');
  try {
    await downloadStickerPack(ctx.telegram, stickerSet);
  } catch (error) {
    console.error(error);
    await Promise.allSettled([
      fsp.rm(generateStickerPackDirPath(stickerSet.name), {
        recursive: true,
        force: true,
      }),
      fsp.rm(mcStickerPackPath, {force: true}),
    ]);
    await ctx.reply('StickerPack download error.');
    return;
  }

  try {
    await fsp.access(mcStickerPackPath);
  } catch {
    await ctx.reply('Error: Sticker pack download error.');
    return;
  }
  await ctx.replyWithDocument(Input.fromLocalFile(mcStickerPackPath));
  await ctx.reply(
    `Download URL (.stickerpack file, then use Add from File):\n${stickerPackDownloadUrl}`,
  );
});

export {bot};
