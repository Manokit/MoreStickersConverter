# MoreStickersConverter

MoreStickersConverter is a tool that converts **Telegram stickers** into **Equicord MoreStickers-compatible `.stickerpack` files**.
You can either send a sticker to the bot or download a pack directly from the built-in HTTP route.

This project includes both the Telegram bot logic and the HTTP server used to host sticker images.

---

## ✨ Features

- Receive Telegram stickers from users
- Download a sticker pack directly by pack name
- Automatically download sticker assets
- Convert stickers into `.stickerpack` format
- Host sticker images through the built-in HTTP server
- Stickerpacks reference external URLs instead of embedding images

---

## ⚙️ Environment Variables

Before running the service, configure the following environment variables:

| Variable         | Description                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BOT_TOKEN**    | Telegram bot token                                                                                                                                                      |
| **PORT**         | Port on which the built-in HTTP server will listen                                                                                                                      |
| **DATA_DIR**     | Directory where all sticker data is stored                                                                                                                              |
| **EXTERNAL_URL** | Public URL of this HTTP server. Required when running behind a reverse proxy. <br>Discord clients typically require HTTPS, otherwise a Mixed-Content warning may occur. |
| **HOST**         | Optional bind host for the HTTP server. Defaults to `::`                                                                                                                |

---

## 🐳 Recommended: Run with Docker

A `Dockerfile` is included, and **Docker Compose is recommended** because:

- It simplifies environment variable configuration
- You can bundle your reverse proxy (Nginx/Caddy/etc.)
- It makes HTTPS setup easier for clients like Discord

You can build the image locally or use the prebuilt image from `ghcr.io/lekoowo/morestickersconverter:develop`

---

## ▶️ How to Use

### Telegram bot flow

1. Send a sticker from the target pack to your Telegram bot
2. The bot downloads the sticker pack
3. The bot sends back a `.stickerpack` file

### Direct HTTP flow

1. Start the server with a valid `BOT_TOKEN`
2. Visit `GET /stickerpack/telegram/:stickerPackName`
3. Download the generated `.stickerpack` file

For example, the pack name for `https://t.me/addstickers/TIDALEUS` is `TIDALEUS`, so the direct download URL is:

```text
https://your-server.example/stickerpack/telegram/TIDALEUS
```

### Import into Equicord

1. Open Equicord `MoreStickers`
2. Go to `Add from File`
3. Select the generated `.stickerpack`
4. Keep this server online so Equicord can fetch the hosted sticker assets

---

## Notes

- Since stickerpacks rely on externally hosted images, make sure your server's external URL is reachable.
- The built-in asset server sends permissive CORS headers so Equicord can fetch sticker files cross-origin.
- If using a reverse proxy, ensure that HTTPS is properly configured to avoid client-side loading errors.
