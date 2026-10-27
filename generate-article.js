// scripts/generate-article.js
import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';

// Firebase Admin (GitHub Actions içinde güvenli bağlantı için)
// Not: Firebase servis hesabı anahtarını da GitHub Secrets'a ekleyebiliriz
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
});
const db = admin.firestore();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runAutoBlogger() {
    try {
        console.log("🤖 Gemini API ile günlük harita mühendisliği makalesi üretiliyor...");

        const prompt = `Sen kıdemli bir Harita ve Kadastro Mühendisisin. AZİMUT Pro (buraktonoz.com/azimut) jeodezik el terminalini kullanan saha mühendisleri için Google'da 1 numaraya oynayacak, SEO uyumlu, H2 ve H3 başlıkları içeren, ITRF96, ED50, Stakeout (nokta aplikasyonu), TKGM parselleri veya NetCAD projeksiyon konularından birini ele alan profesyonel bir teknik makale yaz. 
        Cevabı sadece saf JSON formatında şu anahtarlarla ver: 
        {
          "title": "Makale Başlığı",
          "category": "Jeodezi & Projeksiyon veya Saha Aplikasyonu veya Kadastro & TKGM veya CAD & Yazılım",
          "summary": "150 karakterlik SEO özeti",
          "keywords": "anahtar, kelimeler",
          "content": "HTML etiketleri (h2, p, ul, li, b) ile biçimlendirilmiş tam makale içeriği"
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        let rawText = response.text.trim();
        // Markdown blok temizliği
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const articleData = JSON.parse(rawText);

        const slug = articleData.title
            .toLowerCase()
            .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
            .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

        const newArticle = {
            id: slug,
            slug: slug,
            title: articleData.title,
            category: articleData.category || "Jeodezi & Projeksiyon",
            image: "ek1.png",
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
            readTime: "4 dk okuma",
            author: "Burak Tonoz",
            summary: articleData.summary,
            keywords: articleData.keywords,
            content: articleData.content,
            timestamp: Date.now()
        };

        // Firebase Firestore'a kaydet
        await db.collection('azimut_articles').doc(slug).set(newArticle);
        console.log("✅ Günlük makale başarıyla Firebase veritabanına kaydedildi:", articleData.title);

    } catch (error) {
        console.error("❌ Otomatik makale üretilirken hata oluştu:", error);
        process.exit(1);
    }
}

runAutoBlogger();
