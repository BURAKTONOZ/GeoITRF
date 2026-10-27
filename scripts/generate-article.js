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

async function runAutoBlogger() {
    try {
        console.log("🤖 Gemini API ile hedef kitleye özel makale üretimi başlıyor...");

        // Yapay zekaya her seferinde farklı bir sektör seçmesi için havuz veriyoruz
        const prompt = `Sen 20 yıllık kıdemli bir mühendissin ve AZİMUT Pro (buraktonoz.com/azimut) jeodezik uygulamasının teknik yazarısın. 
        Aşağıdaki hedef kitlelerden ve konulardan RASTGELE BİRİNİ seç ve Google'da 1 numaraya çıkacak, SEO uyumlu, H2/H3 başlıkları içeren, güncel ve son derece faydalı bir makale yaz:
        
        Hedef Kitleler ve Konu Fikirleri:
        1. Harita/Geomatik Mühendisleri (Konu: ITRF96, ED50 dönüşümleri, DOM hassasiyeti, NetCAD NCN aktarımı)
        2. Orman Mühendisleri (Konu: Orman kadastrosu, ORÜS noktaları bulma, dağlık alanda aplikasyon)
        3. Elektrik Mühendisleri & GES (Konu: Güneş Enerjisi Santrali (GES) panel aplikasyonu, ENH direk yeri tespiti)
        4. Topoğraflar ve Saha Teknikerleri (Konu: KML dosyalarını sahada açma, telefondan stakeout radarı kullanımı)
        5. Arsa/Tarla Sahipleri & Vatandaşlar (Konu: "Aldığım arsanın sınırlarını tapu kadastro verisiyle telefondan nasıl bulurum?", TKGM parsel sorgulama)

        Kural 1: Seçtiğin kitleye uygun teknik veya anlaşılır bir dil kullan.
        Kural 2: İçerikte mutlaka AZİMUT Pro'nun bu sorunu telefondan ücretsiz ve kolayca nasıl çözdüğünü anlat.
        Kural 3: Her makale bir öncekinden tamamen farklı, özgün ve ilgi çekici bir başlığa sahip olsun.
        
        Cevabı SADECE saf JSON formatında ver:
        {
          "title": "İlgi Çekici Makale Başlığı",
          "category": "Jeodezi & Projeksiyon VEYA Saha Aplikasyonu VEYA Kadastro & TKGM VEYA CAD & Yazılım",
          "summary": "150 karakterlik çarpıcı SEO özeti",
          "keywords": "anahtar, kelimeler, virgülle, ayrılmış",
          "content": "<p>Giriş paragrafı...</p><h2>1. Başlık</h2><p>İçerik...</p>"
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
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

        await db.collection('azimut_articles').doc(slug).set(newArticle);
        console.log(`✅ Makale başarıyla Firebase'e kaydedildi: ${articleData.title}`);

    } catch (error) {
        console.error("❌ Makale üretilirken hata oluştu:", error);
        process.exit(1);
    }
}

runAutoBlogger();
