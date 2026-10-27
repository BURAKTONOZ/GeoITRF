const { GoogleGenAI } = require('@google/genai');
const admin = require('firebase-admin');

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

// YAPAY ZEKAYA BIRAKMADAN KOD İLE RASTGELE KONU SEÇİM HAVUZU (Sürekli genişletebilirsin)
const TOPIC_POOL = [
    "Elektrik mühendisleri için Güneş Enerjisi Santrali (GES) panellerinin arazide aplikasyonu.",
    "Harita mühendisleri için ITRF96 ve ED50 dönüşümlerinde DOM (Dilim Orta Meridyeni) hatasız nasıl seçilir?",
    "Arsa sahipleri için yeni alınan tarlanın sınırlarını TKGM verisiyle cep telefonundan bulma rehberi.",
    "Orman mühendisleri için dağlık arazide orman kadastrosu ve ORÜS noktalarının telefondan tespiti.",
    "Şantiye şefleri ve teknikerler için ofisteki NetCAD NCN dosyalarını sahada telefonda açıp ölçüm yapma.",
    "CBS uzmanları için KML ve GeoJSON verilerini arazide canlı olarak uydu haritası üzerine yansıtma.",
    "Gayrimenkul değerleme uzmanları ve emlakçılar için satılacak parselin yerini 100% doğrulukla bulma.",
    "Yol ve altyapı projelerinde şev kazıklarının ve güzergah kırık noktalarının telefondan aplikasyonu.",
    "Eski ED50 kadastro paftalarındaki koordinatları güncel ITRF96 sistemine cep telefonundan dönüştürme.",
    "Hassas Epok Ortalaması (RMS) nedir? Mobil cihazlarda GPS doğruluğu nasıl artırılır?"
];

async function runAutoBlogger() {
    try {
        // Kod her çalıştığında havuzdan matematiksel olarak rastgele BİR konu seçer
        const selectedTopic = TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
        console.log("🎯 Bugünün Seçilen Net Konusu:", selectedTopic);

        // Yapay zekaya kesin ve net komut
        const prompt = `Sen 20 yıllık kıdemli bir mühendissin ve AZİMUT Pro (buraktonoz.com/azimut) jeodezik uygulamasının teknik yazarısın. 
        
        GÖREVİN: Sadece aşağıda verilen KONU üzerine Google'da 1 numaraya çıkacak, SEO uyumlu, H2 ve H3 başlıkları içeren, güncel ve son derece teknik/faydalı bir makale yazmak.
        
        BUGÜNKÜ KONUN: "${selectedTopic}"

        Kurallar:
        1. Makale başka hiçbir konuya sapmasın, sadece verilen konuyu derinlemesine anlatsın.
        2. İçerikte mutlaka AZİMUT Pro'nun bu sorunu arazide, telefondan, ücretsiz ve kolayca nasıl çözdüğünü adım adım anlat.
        3. Daha önce yazdığın makalelerdeki aynı cümleleri KULLANMA. Orijinal ve yaratıcı ol.
        
        Cevabı SADECE saf JSON formatında ver. JSON formatı:
        {
          "title": "İlgi Çekici ve Özgün Makale Başlığı",
          "category": "Jeodezi & Projeksiyon VEYA Saha Aplikasyonu VEYA Kadastro & TKGM VEYA CAD & Yazılım",
          "summary": "150 karakterlik çarpıcı SEO özeti",
          "keywords": "anahtar, kelimeler, virgülle, ayrılmış",
          "content": "<p>Giriş paragrafı...</p><h2>1. Başlık</h2><p>İçerik...</p>"
        }`;

        // "temperature: 0.9" ayarı yapay zekanın yaratıcılığını ve çeşitliliğini zorlar!
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.9 
            }
        });

        let rawText = response.text.trim();
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const articleData = JSON.parse(rawText);

        const slug = articleData.title
            .toLowerCase()
            .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
            .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

        const wordCount = articleData.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
        const readMins = Math.max(2, Math.ceil(wordCount / 180));
        
        // Hata veren yapay zeka resimleri yerine senin jilet gibi 7 ekran görüntünden birini rastgele kapak yapar
        const randomRealImage = `ek${Math.floor(Math.random() * 7) + 1}.png`;

        const newArticle = {
            id: slug,
            slug: slug,
            title: articleData.title,
            category: articleData.category || "Saha Aplikasyonu",
            image: randomRealImage, 
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
            readTime: `${readMins} dk okuma`,
            author: "Azimut AI Asistanı",
            authorEmail: "buraktonoz@gmail.com",
            summary: articleData.summary,
            keywords: articleData.keywords,
            content: articleData.content,
            timestamp: Date.now()
        };

        await db.collection('azimut_articles').doc(slug).set(newArticle);
        console.log(`✅ Yepyeni Makale Başarıyla Kaydedildi: ${articleData.title}`);

    } catch (error) {
        console.error("❌ Makale üretilirken hata oluştu:", error);
        process.exit(1);
    }
}

runAutoBlogger();
