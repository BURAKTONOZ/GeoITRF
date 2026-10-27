const { GoogleGenAI } = require('@google/genai');
const admin = require('firebase-admin');

// Firebase Admin Bağlantısını Kurma (GitHub Secrets üzerinden)
// Satır sonlarındaki \n kaçış karakterlerini gerçek yeni satıra çevirir
const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = admin.firestore();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runAutoBlogger() {
    try {
        console.log("🤖 Gemini API ile yapay zeka makale üretimi başlıyor...");

        // Gemini'ye verilecek mühendislik komutu (Prompt)
        const prompt = `Sen 20 yıllık kıdemli bir Harita ve Kadastro Mühendisisin. AZİMUT Pro (buraktonoz.com/azimut) jeodezik el terminalini kullanan saha mühendisleri için Google'da 1 numaraya oynayacak, SEO uyumlu, H2 ve H3 başlıkları içeren profesyonel bir teknik makale yaz.
        Konu şu 4 seçenekten birisi olsun (Rastgele seç): 1) ITRF96 ve ED50 Koordinat Dönüşümü, 2) Arazide Nokta Aplikasyonu (Stakeout), 3) TKGM Kadastro Parsel Sorgulama, 4) NetCAD NCN ve AutoCAD DXF Veri Aktarımı.
        Cevabı SADECE saf JSON formatında ver. JSON formatı şu şekilde olmalı:
        {
          "title": "Makale Başlığı",
          "category": "Jeodezi & Projeksiyon VEYA Saha Aplikasyonu VEYA Kadastro & TKGM VEYA CAD & Yazılım",
          "summary": "150 karakterlik SEO özeti",
          "keywords": "anahtar, kelimeler, virgülle, ayrılmış",
          "content": "<p>Makale girişi...</p><h2>1. Başlık</h2><p>İçerik...</p>"
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // JSON temizliği ve ayrıştırma
        let rawText = response.text.trim();
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const articleData = JSON.parse(rawText);

        // SEO uyumlu URL (Slug) oluşturma
        const slug = articleData.title
            .toLowerCase()
            .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
            .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

        // Okuma süresi hesaplama
        const wordCount = articleData.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
        const readMins = Math.max(2, Math.ceil(wordCount / 180));

        // Kapak görselini 7 resimden rastgele seçme (ek1.png - ek7.png)
        const randomImg = `ek${Math.floor(Math.random() * 7) + 1}.png`;

        const newArticle = {
            id: slug,
            slug: slug,
            title: articleData.title,
            category: articleData.category || "Saha Aplikasyonu",
            image: randomImg,
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
            readTime: `${readMins} dk okuma`,
            author: "Azimut AI Asistanı",
            authorEmail: "buraktonoz@gmail.com",
            summary: articleData.summary,
            keywords: articleData.keywords,
            content: articleData.content,
            timestamp: Date.now()
        };

        // Veritabanına kaydetme
        await db.collection('azimut_articles').doc(slug).set(newArticle);
        console.log(`✅ Makale başarıyla Firebase'e kaydedildi: ${articleData.title}`);

    } catch (error) {
        console.error("❌ Makale üretilirken kritik bir hata oluştu:", error);
        process.exit(1);
    }
}

runAutoBlogger();
