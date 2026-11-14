# Telegram Business AI bot

Telegram Business orqali shaxsiy akkauntingizga ulanadi va mijozlarga siz nomingizdan javob yozadi
(OpenRouter AI). Vercel'da webhook bilan ishlaydi, server kerak emas.

## Imkoniyatlar

- Matn, rasm, ovozli xabar, video/dumaloq video, PDF va fayllarni tushunadi
- Havola yoki APK/EXE/ZIP kabi xavfli fayl kelsa — ochmaydi, suhbatni egasiga uzatadi
- "Yozmoqda..." va tabiiy kechikish; ketma-ket xabarlarni bitta javobga yig'adi
- Siz chatda o'zingiz yozsangiz, bot o'sha chatda 10 daqiqa (sozlanadi) aralashmaydi
- Mijoz so'rasa, rasmlarini PDF qilib beradi
- Buyurtma / shikoyat / shoshilinch / jiddiy holatda egasiga darhol xabar va suhbatni uzatish
- Egasi uchun bot ichida tugmali menyu: hisobot, chatlar, profil, ish vaqti, sozlamalar, sinov, PDF
- Egasi botga oddiy so'z bilan buyruq bera oladi ("ish vaqtimni 9–18 qil", "Alisherga yoz: …")
- Kunlik hisobot (21:00, Toshkent vaqti) va har deploy'dan keyin "Bot yangilandi" xabari

## Tuzilma

```
api/telegram.js   Telegram webhook (POST), maxfiy sarlavha tekshiruvi
api/setup.js      Webhook + buyruqlar menyusini o'rnatadi, egasiga yangilanish xabari
api/report.js     Kunlik hisobot (Vercel Cron)
lib/bot.js        Update'larni taqsimlash, mijozlarga javob
lib/owner.js      Egasi uchun tugmalar, buyruqlar, sinov, PDF
lib/client.js     Mijoz uchun system prompt, xabarlarni yig'ish
lib/ai.js         OpenRouter chaqiruvi (JSON schema)
lib/media.js      Telegram fayllarini AI formatiga o'tkazish
lib/pdf.js        Rasmlardan PDF (pdf-lib)
lib/db.js         Supabase REST (ixtiyoriy)
lib/settings.js   Profil, ish vaqti, bayroqlar
lib/report.js     Hisobot matni
lib/telegram.js   Bot API yordamchilari, xavfli kontentni aniqlash
profile.md        Standart profil (bot shunga tayanib javob beradi)
supabase.sql      Baza jadvallari
.env.example      Barcha environment o'zgaruvchilari tavsifi bilan
```

## O'rnatish (telefondan ham bo'ladi)

1. **Supabase**: https://supabase.com → New project. Tayyor bo'lgach: SQL Editor → New query →
   `supabase.sql` dagi kodni qo'ying → Run. Project URL va Secret key'ni yozib oling (`.env.example` da qayerdan olinishi yozilgan).
2. **Vercel**: https://vercel.com → GitHub bilan kiring → Add New → Project → shu repo → Import.
   Framework Preset: *Other*, qolgan sozlamalar o'zgarmaydi.
   **Environment Variables** bo'limini oching va `.env.example` dagi kalitlarni qiymatlari bilan kiriting → Deploy.
3. **Webhook**: deploy tugagach, brauzerda `https://<loyiha-nomi>.vercel.app/api/setup` ni oching.
   `"ok": true` chiqsa — tayyor, Telegram'da "🆕 Bot yangilandi!" xabari keladi.
4. **Telegram**: Sozlamalar → Telegram Business → Chatbots → bot username'i → "javob yozish" ruxsati.
   @BotFather → Bot Settings → Business Mode yoqilgan bo'lishi kerak.

ENV qo'shgan yoki o'zgartirgandan keyin: Vercel → Deployments → oxirgisi → ⋯ → Redeploy, so'ng `/api/setup` ni yana oching.

Har safar yangi deploy'dan keyin `/api/setup` ni qayta oching (webhook yangilanadi, egasiga xabar boradi).
Bot tokenini almashtirsangiz ham — `/api/setup` ni qayta ochish kifoya.

## Lokal tekshiruv

```bash
npm install
node --env-file=.env -e "import('./lib/bot.js').then(()=>console.log('ok'))"
```
Botni lokal ishga tushirish shart emas — u faqat Vercel webhook orqali ishlaydi.
