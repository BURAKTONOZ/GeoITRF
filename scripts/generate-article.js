const { GoogleGenAI, Type } = require('@google/genai');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

// 1. Ortam Değişkenleri ve Private Key Formatlama Kontrolü
if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.GEMINI_API_KEY) {
  console.error("❌ HATA: GitHub Secrets (FIREBASE_PRIVATE_KEY veya GEMINI_API_KEY) eksik!");
  process.exit(1);
}

const formattedPrivateKey = process.env.FIREBASE_PRIVATE_KEY
  .replace(/^"|"$/g, '')
  .replace(/^'|'$/g, '')
  .replace(/\\n/g, '\n');

// 2. Modüler Firebase Admin Başlatma
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: formattedPrivateKey,
    })
  });
}

const db = getFirestore();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// XML Özel Karakter Temizleyici (Sitemap.xml kırılmalarını %100 önler)
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// ZIRHLI JSON PARSER (Bad control character in string literal hatasını %100 çözer)
// ============================================================================
function safeParseGeminiJson(rawText) {
  let text = String(rawText || '').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  // 1. Deneme: Doğrudan parse et
  try {
    return JSON.parse(text);
  } catch (err1) {
    // 2. Deneme: String (tırnak) içindeki kaçırılmamış Enter (\n), Tab (\t) ve kontrol karakterlerini temizle
    let sanitized = '';
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const code = text.charCodeAt(i);

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          sanitized += ch;
        } else if (ch === '\\') {
          isEscaped = true;
          sanitized += ch;
        } else if (ch === '"') {
          inString = false;
          sanitized += ch;
        } else if (code < 32) {
          // JSON string içinde yasak olan ham kontrol karakterlerini güvenli hale getir
          if (ch === '\n' || ch === '\r') {
            sanitized += ' ';
          } else if (ch === '\t') {
            sanitized += ' ';
          }
        } else {
          sanitized += ch;
        }
      } else {
        if (ch === '"') {
          inString = true;
        }
        sanitized += ch;
      }
    }

    return JSON.parse(sanitized);
  }
}

// ============================================================================
// SİTEMAP.XML VE ROBOTS.TXT ÜRETİCİ FONKSİYON
// ============================================================================
async function buildSitemapAndRobots() {
  const updatedSnap = await db.collection('azimut_articles').get();
  const allArticles = [];
  updatedSnap.forEach(doc => {
    const d = doc.data();
    allArticles.push({
      id: doc.id,
      slug: d.slug || doc.id,
      title: d.title || 'AZİMUT Pro Mühendislik Rehberi',
      image: d.image || 'https://buraktonoz.com/azimut/logo.jpeg',
      timestamp: Number(d.timestamp) || Date.now()
    });
  });

  allArticles.sort((a, b) => b.timestamp - a.timestamp);

  const nowIso = new Date().toISOString();
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  sitemap += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

  // 1. Ana Uygulama Terminali
  sitemap += `  <url>\n`;
  sitemap += `    <loc>https://buraktonoz.com/azimut/</loc>\n`;
  sitemap += `    <lastmod>${nowIso}</lastmod>\n`;
  sitemap += `    <changefreq>daily</changefreq>\n`;
  sitemap += `    <priority>1.0</priority>\n`;
  sitemap += `    <image:image>\n`;
  sitemap += `      <image:loc>https://buraktonoz.com/azimut/logo.jpeg</image:loc>\n`;
  sitemap += `      <image:title>AZİMUT Pro TKGM Parsel Sorgulama ve Jeodezik Aplikasyon Terminali</image:title>\n`;
  sitemap += `    </image:image>\n`;
  sitemap += `  </url>\n`;

  // 2. Tanıtım ve Mühendislik Blog Portalı
  sitemap += `  <url>\n`;
  sitemap += `    <loc>https://buraktonoz.com/azimut/tanitim.html</loc>\n`;
  sitemap += `    <lastmod>${nowIso}</lastmod>\n`;
  sitemap += `    <changefreq>hourly</changefreq>\n`;
  sitemap += `    <priority>1.0</priority>\n`;
  sitemap += `    <image:image>\n`;
  sitemap += `      <image:loc>https://buraktonoz.com/azimut/ek2.png</image:loc>\n`;
  sitemap += `      <image:title>TKGM Tüm Parselleri Görme ve MAKS Sınır Çizimi</image:title>\n`;
  sitemap += `    </image:image>\n`;
  sitemap += `  </url>\n`;

  // 3. Tüm Dinamik Makale URL'leri
  for (const art of allArticles) {
    const safeSlug = encodeURIComponent(art.slug);
    const artUrl = `https://buraktonoz.com/azimut/tanitim.html?makale=${safeSlug}`;
    const isoDate = new Date(art.timestamp).toISOString();
    const fullImgUrl = art.image.startsWith('http')
      ? art.image
      : `https://buraktonoz.com/azimut/${art.image.replace(/^\.\//, '')}`;

    sitemap += `  <url>\n`;
    sitemap += `    <loc>${escapeXml(artUrl)}</loc>\n`;
    sitemap += `    <lastmod>${isoDate}</lastmod>\n`;
    sitemap += `    <changefreq>weekly</changefreq>\n`;
    sitemap += `    <priority>0.85</priority>\n`;
    sitemap += `    <image:image>\n`;
    sitemap += `      <image:loc>${escapeXml(fullImgUrl)}</image:loc>\n`;
    sitemap += `      <image:title>${escapeXml(art.title)}</image:title>\n`;
    sitemap += `    </image:image>\n`;
    sitemap += `  </url>\n`;
  }

  sitemap += `</urlset>\n`;
  fs.writeFileSync('sitemap.xml', sitemap, 'utf8');

  const robotsTxt = [
    "User-agent: *",
    "Allow: /",
    "",
    "Sitemap: https://buraktonoz.com/azimut/sitemap.xml"
  ].join('\n');
  fs.writeFileSync('robots.txt', robotsTxt, 'utf8');

  console.log(`🗺️ Sitemap.xml ve robots.txt başarıyla güncellendi! (Toplam URL: ${allArticles.length + 2})`);
}

// ============================================================================
// GERÇEK HD STOK FOTOĞRAF HAVUZU (UNSPLASH CDN - %100 ÇALIŞIR, LİMİTSİZDİR)
// ============================================================================
const REAL_STOCK_PHOTOS = {
  surveying: [
    "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1541888946425-d09bb18086f6?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1000&q=80"
  ],
  construction: [
    "https://images.unsplash.com/photo-1541888946425-d09bb18086f6?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1508450859948-4e04fabaa4ea?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1578575437130-527eed3abbec?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1513828583688-c52646db42da?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1565008447742-97f6f38c985c?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&w=1000&q=80"
  ],
  land: [
    "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=1000&q=80"
  ],
  forestry: [
    "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1425913397330-cf8af2ff40a1?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=80"
  ],
  energy: [
    "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1559302504-64aae6ca6b6d?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1532601224476-15c79f2f7a51?auto=format&fit=crop&w=1000&q=80"
  ],
  cad_gis: [
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1000&q=80",
    "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1000&q=80"
  ]
};

// ============================================================================
// BÖLÜM 1: YÜKSEK ARAMA HACİMLİ TKGM, MAKS VE JEODEZİ KONU HAVUZU (330 ADET)
// ============================================================================
const STATIC_TOPICS = [
  "TKGM parsel sorgulama ekranında tek tek parsel bakmak yerine tüm kadastro parsellerini tek haritada canlı görme yöntemi",
  "Ada ve parsel numarası girerek parselin köşe koordinatlarını (ITRF96 / ED50) çıkarma ve cep telefonuyla arazide sınır taşı bulma",
  "TKGM parsel sorgu verilerini NetCAD (.NCN) ve AutoCAD (.DXF) formatına dönüştürüp projeye aktarma rehberi",
  "MAKS (Mekânsal Adres Kayıt Sistemi) üzerinden mahalle idari sınırlarını ve cadde/sokak haritasını canlı görüntüleme",
  "Tarla ve arsa sınırlarını telefon GPS'i ile bulma: Kayıp parsel kazıklarını pusulalı aplikasyonla (Stakeout) tespit etme",
  "TKGM kadastro paftası ile uydu görüntüsünü üst üste bindirerek komşu parsel tecavüzü (sınır ihlali) kontrolü yapma",
  "İl, İlçe, Mahalle, Ada, Parsel bilgileriyle arazide internet çekmeden parsel köşelerine sesli aplikasyon yapma",
  "MAKS numarataj verileri ile TKGM kadastro parsellerini aynı harita ekranında çakıştırarak bina ve adres tespiti",
  "Parsel sorgulama sonrasında arsanın köşe noktalarını mevcut şantiye projesine ekleyip anında saha aplikasyonu yapma",
  "TKGM parsel sınırlarını KML, GeoJSON ve Excel (CSV) koordinat listesi olarak telefona indirme teknikleri",
  "Mahalle sınırı nereden geçiyor? MAKS verileriyle kırsal ve kentsel mahalle sınır poligonlarını haritada çizdirme",
  "Emlakçılar ve arsa yatırımcıları için tüm köy/mahalle parsellerini tek ekranda görerek kelepir arazi analizi yapma",
  "Tapu parsel sorgulama ve haritada arsa yeri bulma: Cep telefonunu LİHKAB öncesi ön kontrol terminaline dönüştürme",
  "Belediye numarataj ve imar ekipleri için MAKS cadde, sokak ve dış kapı verilerini sahada mobil haritada açma",
  "TKGM parsel köşe koordinatlarını ITRF96 (3 derece TM) sisteminde okuma ve A4 PDF Koordinat Raporu üretme",
  "Orman sınırı ve 2B parsel sorgulama: Kadastro parsellerinin orman ve mera sınırlarıyla komşuluğunu haritada görme",
  "Hisseli tarlalarda TKGM parsel sınırını haritaya çizdirip paydaşlar arası fiili kullanım alanını (dönüm/m²) bölme",
  "Kamulaştırma ve enerji nakil hattı projelerinde güzergahın hangi TKGM parsellerinden geçtiğini tek ekranda görme",
  "TKGM WMS katmanı nedir? Mobil tarayıcıda tüm Türkiye kadastro parsellerini kesintisiz ve hızlı açma",
  "Parsel cephe uzunluğu ve net metrekare (m²) hesabı: Harita üzerinde çizdirilen parselin kenar uzunluklarını ölçme",
  "MAKS (Mekânsal Adres Kayıt Sistemi) nedir? Harita mühendisliği ve belediyecilikte saha kullanımı",
  "Yolu olmayan tarlalarda komşu TKGM parsellerini tek ekranda inceleyerek en kısa geçit hakkı güzergahını bulma",
  "Güneş Enerjisi Santrali (GES) arazi seçiminde TKGM parsellerini toplu görüntüleme ve güney bakı/eğim analizi",
  "Şantiye sahasında hafriyat ve tel çit çekimi öncesi TKGM parsel köşelerini projeye aktarıp kazık çakma",
  "Mahkeme keşfi ve fen bilirkişisi incelemesi öncesi avukat ve malikler için TKGM parsel ve MAKS sınır etüdü",
  "TKGM parsel sorgulama alternatifleri: Neden tekil parsel sorgusu yerine toplu kadastro katmanı kullanılmalı?",
  "Köy yerleşik alanı ve civarı sınırlarının MAKS ve TKGM parsel katmanları üzerinde sahada kontrol edilmesi",
  "İmar planı (18. Madde) uygulaması gören bölgelerde eski kadastral parsel ile yeni imar parselini sahada bulma",
  "Cep telefonuyla parsel köşe noktası aplikasyonu yaparken RMS (Hassas Epok Ortalaması) ile hata payını düşürme",
  "AZİMUT Pro ile TKGM parsel sorgulama, MAKS sınır çizimi ve NetCAD/AutoCAD veri aktarımında tam saha rehberi",
  "Harita mühendisliğinde ITRF96 ve ED50 koordinat dönüşümlerinde DOM (Dilim Orta Meridyeni) seçimi",
  "3 derecelik Gauss-Krüger (TM) ile 6 derecelik UTM projeksiyon sistemleri arasındaki farklar ve saha uygulamaları",
  "TUREF (Türkiye Ulusal Referans Çerçevesi) nedir ve mobil GPS ölçümlerinde nasıl kullanılır?",
  "WGS84 coğrafi (Enlem-Boylam) koordinatlarını ITRF96 Sağa ve Yukarı (Y, X) değerlerine dönüştürme",
  "Eski ED50 kadastro paftalarındaki koordinatları güncel ITRF96 sistemine hatasız çevirme yöntemleri",
  "Dilim orta meridyeni (DOM 27, 30, 33, 36, 39, 42, 45) geçiş bölgelerinde koordinat kayması nasıl önlenir?",
  "Haritacılıkta Sağa (Y) ve Yukarı (X) değerlerinin matematiksel kartezyen sistemden farkı",
  "Elipsoidal yükseklik ile ortometrik (deniz seviyesi) yükseklik arasındaki fark ve jeoid ondülasyonu",
  "TG-20 (Türkiye Jeoidi) modeli nedir ve sahada kot (yükseklik) ölçümlerini nasıl etkiler?",
  "Koordinat dönüşümlerinde 7 parametreli Helmert dönüşümü ile afin dönüşümü arasındaki farklar",
  "Harita projeksiyonlarında uzunluk ve alan deformasyonları: Ölçek faktörü (Scale Factor) hesabı",
  "Yüksek rakımlı şantiyelerde projeksiyon düzlemi ile arazi yüzeyi arasındaki mesafe farkı düzeltmesi",
  "Derece-Dakika-Saniye (DMS) formatındaki koordinatları Ondalık Dereceye (Decimal Degrees) çevirme",
  "Kuzey coğrafi yönü, manyetik kuzey ve harita (grid) kuzeyi arasındaki sapma açısı (deklinasyon)",
  "Semt (Azimut) açısı nedir? İki nokta bilinen koordinatlardan semt açısı ve mesafe (1. Temel Ödev) hesabı",
  "Jeodezide 2. Temel Ödev: Bilinen bir noktadan semt açısı ve mesafe ile yeni nokta koordinatı üretme",
  "ITRF96 (2005.0 epok) ile güncel epok koordinatları arasındaki tektonik hız farkları ve düzeltmesi",
  "Mobil cihazlarda GNSS yonga setlerinin (GPS, GLONASS, Galileo, BeiDou) konum doğruluğuna etkisi",
  "Arazide Multipath (Çoklu Yansıma) etkisi nedir? Bina dibi ve orman altında GPS hatasını azaltma yolları",
  "Hassas Epok Ortalaması (Epoch Averaging) nedir? Cep telefonuyla sabit noktada RMS hatasını düşürme",
  "Karesel Ortalama Hata (RMS) nedir ve saha ölçümlerinde doğruluk kriteri olarak nasıl okunur?",
  "HDOP, VDOP ve PDOP (Hassasiyet Zayıflama Faktörleri) uydu geometrisini ve saha ölçümünü nasıl etkiler?",
  "TUSAGA-Aktif (CORS-TR) sistemi nedir ve mobil jeodezik el terminalleriyle entegrasyon mantığı",
  "NTRIP protokolü ve RTCM düzeltme verileriyle santimetre hassasiyetinde konum belirleme",
  "Yersel ölçüm (Total Station) ile uydu bazlı (GNSS) ölçümlerin koordinat uyuşumsuzluğu nasıl çözülür?",
  "Lokal (mevzii) koordinat sisteminde üretilmiş eski projelerin ülke ağına (ITRF96) entegrasyonu",
  "Poligon noktası nedir? Kayıp nirengi ve poligon taşlarını arazide röper krokisiyle bulma",
  "Nivelman ağı ve RS (Röper Seviye) noktalarının sahada tespiti ve kot kontrolü",
  "Harita ölçekleri (1/1000, 1/5000, 1/25000) ve pafta bölümleme (indeks) sisteminin saha karşılığı",
  "1/1000 ölçekli uygulama imar planı paftalarının koordinat özet cetvellerini arazide okuma",
  "Haritacılıkta Grad (Gon) ve Derece açı birimleri arasındaki dönüşüm ve aplikasyon hesapları",
  "Kutup koordinatlarıyla (açı ve mesafe) alınan detay noktalarının dik koordinatlara (Y, X) çevrilmesi",
  "Arazide görünmeyen noktalara dolaylı aplikasyon: İleriden ve geriden kestirme yöntemleri",
  "Yan nokta hesabı (Dik ayak ve dik boy) ile güzergah üzerindeki yapıların koordinatlandırılması",
  "Daire eğrisi (kurp) elemanları ve yol eksen noktalarının sahada koordinatla aplikasyonu",
  "Klotoid (geçiş eğrisi) nedir ve karayolu projelerinde koordinat hesabı nasıl yapılır?",
  "Alan hesabı yöntemleri: Gauss alan formülü ile parsel köşe koordinatlarından net metrekare bulma",
  "Harita üzerinde ölçülen yatay alan ile eğimli arazi yüzeyi alanı arasındaki fark",
  "Sınır düzeltmesi ve parsel bölmelerinde (ifraz) belirli bir alana göre yeni köşe koordinatı üretme",
  "GPS sinyallerinde atmosferik gecikmeler (İyonosfer ve Troposfer) ve sabah/öğle ölçüm farkları",
  "Akıllı telefonlarda çift frekanslı (L1 + L5) GNSS alıcılarının haritacılıkta yarattığı devrim",
  "Manyetik pusula kalibrasyonu: Sahada yüksek gerilim hattı veya demir çit yanında yön bulma",
  "Telefon ivmeölçer ve jiroskop sensörlerinin saha aplikasyonunda (Stakeout) pusulaya etkisi",
  "Çevrimdışı (Offline) harita önbellekleme: İnternetin çekmediği dağlık alanlarda uydu haritası kullanımı",
  "Jeodezik datum nedir? Elipsoid yüzeyinin dünyaya konumlandırılma mantığı",
  "Bessel 1841, Hayford (Uluslararası 1924) ve GRS80 elipsoidlerinin Türkiye haritacılığındaki yeri",
  "Koordinat listelerindeki Y ve X sütunlarının Excel'den aktarılırken ters çevrilmesi hatası ve çözümü",
  "Sahte Doğu (False Easting - 500.000 m) değeri nedir ve Y koordinatlarının başında neden 3, 4, 5 yazar?",
  "Kuzey yarımkürede X (Yukarı) koordinatlarının ekvatora olan gerçek mesafeyi gösterme prensibi",
  "Mobil el terminalleriyle saha ön etüdü yapmanın şantiye zaman ve maliyet yönetimine katkısı",
  "Saha aplikasyonu (Stakeout) nedir? Cep telefonuyla adım adım nokta aplikasyonu rehberi",
  "İnşaat şantiyelerinde temel kazısı öncesi bina köşe kazıklarının (aplikasyon) çakılması",
  "Hafriyat ve kazı sınırlarının (şev üstü ve şev altı) arazide kireç ve kazıkla işaretlenmesi",
  "Bina aks (kolon) noktalarının sahada kontrolü ve temel aplikasyon krokisi okuma",
  "İstinat duvarı projelerinde duvar eksen ve kırık noktalarının araziye aplike edilmesi",
  "Çelik konstrüksiyon ve prefabrik fabrika inşaatlarında ankraj (bulon) noktalarının saha kontrolü",
  "Yol inşaatlarında eksen kazığı, şev kazığı ve kamulaştırma sınırı kazıklarının aplikasyonu",
  "Köprü, viyadük ve menfez (sanat yapıları) ayak koordinatlarının derede ve yamaçta tespiti",
  "Altyapı projelerinde yağmursuyu ve kanalizasyon muayene bacası (rögar) yerlerinin aplikasyonu",
  "İçmesuyu isale hattı boru güzergahı kırık noktalarının ve vantuz/tahliye odalarının sahada bulunması",
  "Doğalgaz boru hattı projelerinde güzergah şeridi ve vana odası noktalarının araziye taşınması",
  "Zemin etüdü (jeoteknik) projelerinde sondaj kuyusu koordinatlarının sahada doğru yere aplike edilmesi",
  "Jeofizik (sismik ve elektrik özdirenç) ölçüm serim hatlarının arazide koordinatlı olarak belirlenmesi",
  "Şantiye sahasında geçici tesislerin (şantiye binası, beton santrali, stok alanı) vaziyet planından aplikasyonu",
  "Peyzaj mimarlığı projelerinde ağaç dikim noktaları, yürüyüş yolları ve süs havuzlarının aplikasyonu",
  "Spor kompleksi, futbol sahası ve atletizm pisti köşe/merkez koordinatlarının araziye uygulanması",
  "Baraj ve gölet projelerinde kret ekseni ve su altında kalacak maksimum su kotu sınırının işaretlenmesi",
  "Sulama kanalı ve kanalet projelerinde güzergah aplikasyonu ve parsel hidrant yerlerinin tespiti",
  "Taşkın koruma ve dere ıslah projelerinde sedde ve tahkimat sınırlarının arazide belirlenmesi",
  "Maden ve taş ocağı sahalarında ruhsat sınırı köşe noktalarının (İR/İŞ) arazide bulunması ve emniyet şeridi",
  "Maden sahalarında patlatma deliklerinin (patern) koordinatlı olarak sahada işaretlenmesi",
  "Katı atık düzenli depolama tesislerinde lot sınırlarının ve membran kaplama alanlarının aplikasyonu",
  "Liman, iskele ve kıyı yapılarında kazık koordinatlarının ve kıyı kenar çizgisinin sahada takibi",
  "Havalimanı pist, taksi yolu ve apron inşaatlarında aydınlatma (AGL) noktalarının hassas kontrolü",
  "Demiryolu ve hızlı tren projelerinde hat ekseni ve katener direği temellerinin saha aplikasyonu",
  "Tünel inşaatlarında portal (giriş-çıkış) noktalarının ve yaklaşım kazılarının üstten aplikasyonu",
  "Aplikasyon sırasında pusula yönlendirmesi ile kartezyen (Delta Y / Delta X) yönlendirme arasındaki fark",
  "Sesli ve titreşimli yakınlık radarı ile ekrana bakmadan arazide hedef noktaya sıfırlama tekniği",
  "Sık çalılık ve engebeli arazide hedef noktayı kaybetmeden engellerin etrafından dolaşarak aplikasyon",
  "Gece vardiyasında veya sisli şantiye ortamında mobil ekran radarıyla güvenli nokta bulma",
  "Aplike edilen noktanın sağlamlaştırılması: Röper çivisi, beton kazık ve boya ile işaretleme standartları",
  "Aplikasyon sonrası yapılan imalatın kontrolü: As-built (yapıldı) alımı ile proje koordinatlarını kıyaslama",
  "Şantiyede harita ekibi gelmeden önce saha mühendisinin hızlı ön kontrol (pre-check) yapma yöntemleri",
  "Taşeron hakedişlerinde yapılan imalatın (parke, bordür, kazı alanı) sahada koordinatla hızlıca ölçülmesi",
  "Tel çit, bahçe duvarı ve jiletli tel çekimi öncesi sınır kırık noktalarının hatasız işaretlenmesi",
  "Sera kurulum projelerinde sera köşe ayaklarının ve havalandırma akslarının araziye aplikasyonu",
  "Rüzgar ölçüm direği (Met-Mast) kurulum noktalarının yüksek tepelerde koordinatla tespiti",
  "Baz istasyonu (GSM kulesi) kiralama ve kurulum sahalarında parsel içi montaj noktasının aplikasyonu",
  "Reklam totemi ve otoyol kenarı dev pano ayaklarının karayolu kamulaştırma sınırı dışına aplikasyonu",
  "Arkeolojik kazı alanlarında açma (grid) karelerinin arazide koordinatlı olarak iplerle kurulması",
  "Mezarlık alanlarının planlanması ve ada/parsel köşe noktalarının sahada düzenli aplikasyonu",
  "Organize Sanayi Bölgeleri (OSB) sanayi parsellerinde fabrika çekme mesafelerinin sahada kontrolü",
  "Şantiye içi hafriyat döküm sahalarının sınırlarının belirlenmesi ve kaçak dökümün önlenmesi",
  "Yıkım (dekonstrüksiyon) projelerinde yıkılacak ve korunacak yapı sınırlarının sahada netleştirilmesi",
  "Kentsel dönüşüm alanlarında riskli yapıların koordinatlı tespiti ve saha envanteri oluşturma",
  "Heyelan ve şev stabilitesi projelerinde inklinometre kuyularının ve fore kazık akslarının aplikasyonu",
  "Zemin iyileştirme (Jet-grout ve derin karıştırma) kolonlarının şantiyede hızlı sıra kontrolü",
  "Sahil tahkimatı ve dalgakıran projelerinde anroşman (taş dolgu) sınırlarının kıyıdan takibi",
  "Boru hattı yatay sondaj (HDD) geçişlerinde giriş ve çıkış noktalarının arazide karşılıklı tespiti",
  "Saha aplikasyonunda yapılan en yaygın 10 mühendislik hatası ve bunlardan korunma yolları",
  "TKGM (Tapu ve Kadastro Genel Müdürlüğü) parsel sorgulama verileriyle arazide sınır tespiti nasıl yapılır?",
  "Yeni satın alınan arsa, tarla veya bahçenin sınır köşelerini cep telefonuyla arazide bulma rehberi",
  "Hisseli tarlalarda fiili kullanım (rızai taksim) sınırlarının uydu haritası üzerinde ölçülmesi ve paylaşımı",
  "Tapuda yazan yüzölçümü ile arazideki gerçek alan neden bazen farklı çıkar? Tecviz (hata sınırı) nedir?",
  "Kadastro paftası ile uydu görüntüsü arasındaki kayıklıklar (sayısallaştırma hataları) nasıl anlaşılır?",
  "2B (Orman vasfını yitirmiş) arazilerin sınırlarını ve kullanım alanlarını sahada telefonla görme",
  "İmar barışı ve yapı kayıt belgesi alınan binaların parsel sınırları içinde kalıp kalmadığının kontrolü",
  "Tecavüzlü yapı nedir? Komşu parsele taşan duvar, çit veya binanın sahada ön tespiti",
  "Köy yerleşik alanı sınırları ve tarla vasfındaki arazilerde yola terk/çekme mesafesi kontrolü",
  "Yolu olmayan (çıkmaz) parsellerde geçit hakkı (irtifak hakkı) güzergahının arazide belirlenmesi",
  "Kamulaştırma (istimlak) sınırlarının parselin neresinden geçtiğini arazide canlı olarak görme",
  "İfraz (ayırma) ve tevhid (birleştirme) projelerinde yeni oluşan parsel köşelerinin sahada ön incelemesi",
  "İmar uygulaması (18. Madde) sonrası değişen arsa sınırlarının eski tarla sınırlarıyla karşılaştırılması",
  "LİHKAB (Lisanslı Harita Kadastro Büroları) resmi aplikasyon işlemi öncesi maliklerin saha hazırlığı",
  "Aplikasyon krokisi nedir? Üzerindeki Y, X koordinatları ve cephe uzunlukları arazide nasıl okunur?",
  "Emlakçılar ve gayrimenkul danışmanları için müşteriye yanlış arsa göstermeyi önleyen mobil harita teknikleri",
  "Gayrimenkul değerleme (ekspertiz) uzmanları için sahada ada/parsel doğrulaması ve konum raporu hazırlama",
  "Tarım arazisi kiralama ve satışlarında ekili alanın net dekar/dönüm hesabını sahada yürüyerek yapma",
  "Zeytinlik, cevizlik ve meyve bahçesi kurulumunda parsel sınırlarından bırakılması gereken yasal mesafeler",
  "Mera, yaylak ve kışlak sınırlarının tarım arazileriyle olan komşuluk ilişkisi ve sınır taşları",
  "Hazine arazileri ve milli emlak satış/ecrimisil sahalarının sınırlarını arazide telefonla gezme",
  "Sit alanları (Arkeolojik ve Doğal Sit) sınırlarının parsel ile çakışmasının harita üzerinde incelenmesi",
  "Kıyı kenar çizgisi nedir? Deniz ve göl kenarındaki arsaların yapılaşma sınırının sahada görülmesi",
  "Akarsu ve dere yatağına komşu parsellerde DSİ taşkın sınırı ve kadastral sınır kontrolü",
  "Kadastroda sabit sınır ve değişken sınır kavramları: Taş duvar, yol ve dere sınırlarının hukuki durumu",
  "Kayıp sınır taşlarını veya çürümüş ahşap kazıkları eski koordinatlarından yeniden bulma",
  "Tapu senedindeki ada, parsel ve pafta bilgilerini kullanarak harita üzerinde nokta atışı konum bulma",
  "E-Devlet ve WebTapu üzerinden alınan parsel bilgilerinin saha aplikasyon programlarında kullanımı",
  "TKGM JSON ve KML formatındaki parsel verilerini indirip çevrimdışı arazide sınır gezme",
  "Çok hisseli miras kalan köy arazilerinde sınır anlaşmazlıklarını önlemek için dijital kroki hazırlama",
  "Sanayi ve depolama imarlı arsalarda tır yanaşma ve parsel cephe genişliğinin sahada ölçülmesi",
  "Bağ evi, tiny house veya bungalov koymadan önce arsanın eğim ve sınır köşelerini kontrol etme",
  "Hobi bahçesi projelerinde ana parselin içindeki özel kullanım alanlarının eşit parsellenmesi ve aplikasyonu",
  "Belediye numarataj ve adres tespiti çalışmalarında bina giriş koordinatlarının kadastro parseliyle eşleştirilmesi",
  "Köy sınırları ve mahalle idari sınırlarının dağlık ve kırsal arazide harita üzerinden takibi",
  "Tarım ve Orman Bakanlığı ÇKS (Çiftçi Kayıt Sistemi) parsel beyanlarında ekim alanı sınırlarının kontrolü",
  "Toplulaştırma (Arazi Toplulaştırması) yapılan köylerde yeni teslim edilen tarlaların sınırlarını bulma",
  "Eski tapulardaki 'hududu: doğusu yol, batısı dere' tariflerinin modern koordinat sistemindeki karşılığı",
  "Komşu parsel malikiyle birlikte sahada sınır gezisi yaparken anlık GPS konum paylaşımı",
  "Gayrimenkul yatırımcılarının imar planı lejantlarını ve kadastro parsellerini uydu görüntüsüyle çakıştırması",
  "Mahkeme keşiflerinde (fen bilirkişisi incelemesi öncesi) avukat ve tarafların araziyi önceden etüt etmesi",
  "Elbirliği mülkiyetinden paylı mülkiyete geçişte kroki bazlı kullanım alanlarının sahada işaretlenmesi",
  "Yabancı yatırımcılara veya şehir dışındaki alıcılara arsanın sınırlarını gösteren fotoğraflı PDF rapor sunumu",
  "Kadastro yenileme (22-a) çalışmaları nedir? Yenileme sırasında mülk sahiplerinin sınırlarını kontrol etmesi",
  "Orman kadastrosu ile genel kadastro sınırlarının çakıştığı (mükerrer) alanların sahada incelenmesi",
  "Tapuda cins değişikliği (tarladan arsaya veya binalı arsaya geçiş) öncesi yapı koordinatlarının kontrolü",
  "Kat mülkiyeti ve vaziyet planındaki ortak alan (otopark, bahçe) sınırlarının site içinde belirlenmesi",
  "Arsa alırken dolandırılmamak için harita üzerinde dikkat edilmesi gereken 5 kritik konum kontrolü",
  "Büyükşehir belediyeleri imar sorgulama ekranlarındaki koordinatların sahada telefonla bulunması",
  "Parsel köşe koordinatlarını bilmeyen vatandaşların uydu haritasından köşe yakalama (snap) yöntemiyle sınır bulması",
  "Orman mühendisliğinde ORÜS (Orman Sınır) taşlarının koordinatla dağlık arazide bulunması",
  "Orman kadastrosu 2/B ve 6831 sayılı kanun kapsamındaki sınır kırık noktalarının sahada aplikasyonu",
  "Ağaçlandırma ve erozyon kontrolü projelerinde teraslama ve fidan dikim aralıklarının aplikasyonu",
  "Orman içi yol (yangın emniyet yolu ve üretim yolu) güzergah etüdü ve eğim/koordinat alımı",
  "Orman işletme şefliklerinde bölme ve bölmecik sınırlarının sahada mobil haritayla takibi",
  "Dikili ağaç damgalama ve envanter çalışmalarında deneme alanlarının (örnek alan) koordinatlı tespiti",
  "Orman yangını sonrası yanan alan sınırlarının (poligon) yürüyerek GPS ile ölçülmesi ve hektar hesabı",
  "Orman izin ve irtifak dosyalarında (maden, enerji, turizm tahsisi) izin sınırı kazıklarının aplikasyonu",
  "Mesire yerleri ve tabiat parkı planlamasında günübirlik kullanım alanı sınırlarının sahada işaretlenmesi",
  "Yaban hayatı geliştirme sahalarında fotokapan ve gözlem noktalarının koordinatlı olarak kayıt altına alınması",
  "Ziraat mühendisliğinde hassas tarım uygulamaları: Toprak numunesi alma noktalarının GPS ile koordinatlandırılması",
  "Damlama ve yağmurlama sulama projelerinde ana boru hattı ve parsel vana noktalarının aplikasyonu",
  "Meyve bahçesi (modern telli terbiye sistemleri) tesisinde sıra başı direklerinin milimetrik hizalanması",
  "Tarla içi drenaj kanalları ve tesviye (lazerli toprak tesviyesi) öncesi arazi kot ve sınır etüdü",
  "Çayır ve mera ıslah projelerinde otlatma parsellerinin (paddock) elektrikli çit sınırlarının aplikasyonu",
  "Biyolojik mücadele ve zararlı takibinde feromon tuzağı noktalarının harita üzerinde işaretlenmesi ve takibi",
  "Tarımsal arazi değerlemesinde parselin eğim, bakı ve yola cephe durumunun saha haritasıyla analizi",
  "Çevre mühendisliğinde su, toprak ve hava kalitesi izleme istasyonlarının koordinatlı envanteri",
  "Atıksu arıtma tesisi deşarj noktalarının ve alıcı ortam numune yerlerinin GPS ile sabitlenmesi",
  "ÇED (Çevresel Etki Değerlendirmesi) raporları için proje etki alanı sınırlarının sahada gezilerek doğrulanması",
  "Jeoloji ve hidrojeoloji mühendisliğinde su arama ve derin kuyu sondaj noktalarının sahada aplikasyonu",
  "Jeotermal kaynak arama ruhsat sahalarında kuyu lokasyonlarının ve koruma alanlarının belirlenmesi",
  "Fay hattı (diri fay) haritalarındaki kırık hatlarının arazi üzerinde incelenmesi ve yapılaşma mesafesi kontrolü",
  "Heyelan, kaya düşmesi ve çığ tehlike bölgelerinin sınırlarının arazide koordinatlı olarak haritalanması",
  "Su kaynakları (kaptaj, pınar, memba) noktalarının dağlık arazide koordinatlandırılması ve isale etüdü",
  "Akarsu havza yönetimi ve sel kapanı (tersip bendi) yerlerinin vadilerde koordinatla tespiti",
  "Balık çiftlikleri (su ürünleri yetiştiriciliği) karasal tesis ve deniz kafes koordinatlarının kontrolü",
  "Arıcılık (gezginci arıcılık) konaklama noktalarının orman ve mera haritaları üzerinde planlanması",
  "Tıbbi ve aromatik bitki (lavanta, kekik, salep) toplama ve ekim alanlarının koordinatlı takibi",
  "Doğa yürüyüşü (trekking), dağcılık ve arama-kurtarma (AFAD/UMKE) operasyonlarında UTM koordinat okuma",
  "Milli parklar ve korunan alanlarda yürüyüş rotalarının (iz) GPS ile kaydedilmesi ve tabela aplikasyonu",
  "Toprak koruma projelerinde taş kordon ve canlı çit hatlarının eğime paralel aplikasyonu",
  "Kavakçılık ve endüstriyel ağaçlandırma sahalarında karelaj (grid) yöntemiyle fidan yeri belirleme",
  "Orman depoları (tomruk ve emval istif alanları) sınırlarının ve ulaşım yollarının koordinatlandırılması",
  "Mera ıslahında hayvan içmesuyu sıvat (çeşme) yerlerinin ve gölgeliklerin koordinatla aplikasyonu",
  "Tarımsal arazi toplulaştırma projelerinde yeni tarla içi yolların ve tahliye kanallarının saha kontrolü",
  "Bağcılıkta (üzüm bağları) güneye bakı ve sıra yönü açısının pusula ve GPS ile araziye uygulanması",
  "Zeytinlik alanlarda ağaç başı koordinat envanteri (CBS tabanlı ağaç kayıt sistemi) oluşturma",
  "Jeolojik saha haritalamasında tabaka doğrultu ve eğim (strike and dip) ölçüm noktalarının GPS kaydı",
  "Maden arama (mostra ve yarma) noktalarının saha haritasına işlenmesi ve numune lokasyon takibi",
  "Kıyı erozyonu ve plaj değişimlerinin farklı tarihlerdeki GPS kıyı çizgisi ölçümleriyle izlenmesi",
  "Sulak alanlar ve sazlık bölgelerde tampon koruma bölgesi sınırlarının arazide tespiti",
  "Rüzgar erozyonu sahalarında rüzgar kıran (ağaç perdesi) şeritlerinin hakim rüzgar yönüne dik aplikasyonu",
  "Organik tarım sertifikasyonu için komşu konvansiyonel tarlalardan bırakılacak izolasyon mesafesi kontrolü",
  "Tohumluk üretim parsellerinde yabancı tozlaşmayı önlemek için tarlalar arası mesafe (izolasyon) ölçümü",
  "Kırsal kalkınma (TKDK / IPARD) hibe projelerinde yatırım yapılacak parselin koordinat doğrulaması",
  "Hayvancılık tesisleri (ahır, ağıl, kümes) kurulumunda yerleşim yerlerine olan yasal mesafe ölçümü",
  "Su ürünleri avlak sahaları ve göl içi yasak bölge sınırlarının koordinatlarla kontrolü",
  "Ekoturizm ve glamping (çadır kamp) alanlarında ünitelerin doğaya zarar vermeden koordinatla yerleştirilmesi",
  "Orman yangın gözetleme kuleleri ve su toplama çukurlarının (havuz) stratejik konum tespiti",
  "Güneş Enerjisi Santrali (GES) projelerinde panel sehpalarının (konstrüksiyon) sahada aplikasyonu",
  "GES yatırımlarında marjinal tarım arazisi sınırlarının ve güney bakı yönünün sahada haritayla tespiti",
  "GES şantiyelerinde inverter odaları, trafo merkezi ve kablo kanalı güzergahlarının araziye işaretlenmesi",
  "Enerji Nakil Hattı (ENH) projelerinde direk merkez noktalarının (some ve durdurucu direkler) aplikasyonu",
  "Yüksek gerilim (YG) ve orta gerilim (OG) hatlarında kamulaştırma (emniyet) şeridi genişliğinin sahada kontrolü",
  "Elektrik dağıtım şebekelerinde aydınlatma direkleri ve saha dağıtım panolarının (box) koordinatlı alımı",
  "Yeraltı enerji kablosu güzergahlarının kazı öncesi aplikasyonu ve kapatılmadan önce as-built kaydı",
  "Rüzgar Enerjisi Santrali (RES) projelerinde türbin temel merkezlerinin ve vinç platform alanlarının aplikasyonu",
  "RES şantiyelerinde geniş kanat taşıma yollarının kurp yarıçaplarının ve yol genişliklerinin saha kontrolü",
  "Hidroelektrik Santral (HES) projelerinde regülatör yeri, iletim kanalı ve cebri boru ekseni aplikasyonu",
  "Biyokütle ve biyogaz enerji tesislerinde hammadde depolama ve tesis sınırlarının vaziyet planından uygulanması",
  "Fiber optik iletişim hatlarında güzergah etüdü, ek odası (menhol) noktalarının aplikasyonu ve CBS kaydı",
  "Telekomünikasyon altyapısında abone bağlantı noktalarının ve saha dolaplarının koordinatlı envanteri",
  "Elektrik direklerinde açı (some) sapmalarının pusula ve koordinat yardımıyla sahada kontrol edilmesi",
  "Tarımsal sulama GES projelerinde güneş panelleri ile su kuyusu arasındaki kablo mesafesinin haritadan ölçümü",
  "Katodik koruma tesislerinde anot yatağı ve ölçü kutusu noktalarının boru hattı boyunca aplikasyonu",
  "Şehir içi trafo köşklerinin imar planındaki ayrılmış (trafo alanı) parsellerine tam oturtulması",
  "Otoyol ve cadde aydınlatma projelerinde direkler arası eşit mesafe (30m - 40m) aplikasyonu",
  "Enerji projelerinde orman geçiş izin sınırlarının ve kesilecek koridor genişliğinin sahada işaretlenmesi",
  "Kaçak yapılaşmanın yüksek gerilim hatları altına (yaklaşma mesafesi içine) girip girmediğinin saha tespiti",
  "GES sahalarında tel çit sınırları ile panel dizileri arasındaki yangın ve bakım yolu mesafesinin aplikasyonu",
  "GES projelerinde topografik eğim nedeniyle oluşan gölgelenme mesafelerinin (pitch distance) sahada kontrolü",
  "Dağıtım şirketleri (EDAŞ) direk dikim projelerinde istimlak sınırına ve parsel köşelerine uyum kontrolü",
  "ENH direk ayaklarının (A, B, C, D ayakları) diyagonal ve kenar mesafelerinin sahada koordinatla kontrolü",
  "Rüzgar türbini (RES) kanat süpürme alanı ve parsel sınırları dışına taşma (emniyet alanı) kontrolü",
  "Jeotermal enerji santrali (JES) buhar isale hatlarının ve re-enjeksiyon kuyularının saha aplikasyonu",
  "Elektrikli araç (EV) hızlı şarj istasyonu kurulumlarında otopark içi konumlandırma ve kablo güzergahı etüdü",
  "Fabrika çatısı ve arazi tipi GES projelerinde trafo bağlantı noktasına olan kuş uçuşu ve gerçek hat mesafesi",
  "Enerji nakil hatlarında tel çekimi öncesi direkler arası açıklık (menzil) mesafesinin GPS ile doğrulanması",
  "Köy ve yayla şebekelerinde arıza tespiti için direk numaralarının koordinatlı harita üzerinden bulunması",
  "Sokak aydınlatma armatürlerinin CBS (Coğrafi Bilgi Sistemi) envanteri için sahada tek tek koordinatlandırılması",
  "Doğalgaz bölge regülatörleri (RMS-A ve RMS-B) istasyon alanlarının ve koruma çitlerinin aplikasyonu",
  "Akaryakıt ve LPG istasyonu kurulumlarında tank sahası ve kanopi ayaklarının yola/komşuya çekme mesafesi",
  "Radyolink ve mikrodalga haberleşme kuleleri arasında birbirini görme (Line of Sight) ve azimut açısı hesabı",
  "Enerji depolama tesisleri (EDT / Batarya sahaları) konteyner yerleşim planlarının araziye aplikasyonu",
  "Yüksek gerilim pilon (kafes) direklerinin temel kazılarında eksen kaçıklığının koordinatla önlenmesi",
  "Demiryolu sinyalizasyon ve elektrifikasyon projelerinde kablo menhollerinin hat boyu aplikasyonu",
  "Güneş tarlalarında (GES) drenaj kanalları ve çevre güvenlik kameraları (CCTV) direk yerlerinin tespiti",
  "Yeraltı elektrik ve fiber hatlarında kazı hasarlarını önlemek için eski as-built koordinatlarını sahada bulma",
  "Tarımsal sulama kooperatiflerinde elektrik panoları ve sayaç noktalarının harita üzerinde kayıt altına alınması",
  "Havalimanı radar ve seyrüsefer (VOR/ILS) anten kulelerinin hassas koordinat ve yön aplikasyonu",
  "Meteoroloji gözlem istasyonları (OMGİ) sensör sahasının koordinatlı kurulumu ve engel kontrolü",
  "Paratoner (yıldırımdan korunma) direklerinin tesis içindeki koruma yarıçaplarının harita üzerinde analizi",
  "Denizaltı kablo ve boru hattı projelerinde karaya çıkış (landfall) ve menhol noktalarının kıyı aplikasyonu",
  "Sanayi tesislerinde fabrika içi altyapı (elektrik, su, doğalgaz, veri) galerilerinin koordinatlı haritalanması",
  "Enerji yatırımlarında ön lisans ve lisans başvuruları için santral sahası köşe koordinatlarının doğrulanması",
  "GES sahalarında yıkama suyu deposu ve bekçi kulübesi yerlerinin vaziyet planına göre aplikasyonu",
  "Elektrik proje müellifleri için saha etüdünde (rölöve) mevcut direklerin hızlıca koordinatlandırılması",
  "ENH güzergahlarında ağaç kesim (koridor açma) sınırlarının orman memurlarıyla birlikte sahada tespiti",
  "Akıllı şehir uygulamalarında Wi-Fi noktaları, kamera direkleri ve sensörlerin koordinatlı saha montajı",
  "NetCAD (.NCN) nokta dosyaları cep telefonunda nasıl açılır ve arazide aplikasyon için nasıl kullanılır?",
  "AutoCAD (.DXF) çizim dosyalarındaki nokta ve poligonları mobil harita ekranına aktarma rehberi",
  "Google Earth (.KML ve .KMZ) dosyalarını arazide canlı GPS konumuyla üst üste bindirerek gezme",
  "GeoJSON formatı nedir? Web tabanlı CBS projelerini mobil saha terminallerinde görüntüleme",
  "Excel (.CSV ve .TXT) formatındaki binlerce koordinat noktasını tek tıkla haritaya yükleme teknikleri",
  "Arazide ölçülen noktaları ofisteki NetCAD ve AutoCAD yazılımlarına hatasız aktarma (Dışa Aktar)",
  "Sahada yapılan ölçümlerden anında A4 boyutunda resmi PDF Koordinat ve Aplikasyon Raporu üretme",
  "WhatsApp veya e-posta ile gelen konum/koordinat mesajlarını doğrudan harita aplikasyonuna dönüştürme",
  "QR Kod ile şantiyede iki mühendis arasında internet olmadan proje ve koordinat dosyası paylaşımı",
  "Bulut tabanlı (Cloud) proje senkronizasyonu: Arazide alınan noktanın aynı anda merkez ofiste görünmesi",
  "Kurumsal harita ve inşaat firmalarında saha ekiplerinin görev ve nokta takibini tek merkezden yönetme",
  "CAD programlarında farklı katmanlarda (Layer) bulunan verilerin sahada filtrelenerek kullanılması",
  "Koordinat dosyalarında Türkçe karakter ve ondalık ayırıcı (nokta/virgül) hatalarının pratik çözümü",
  "Harita üzerinde mesafe cetveli ve poligon alan ölçümü araçlarıyla sahada anlık metraj çıkarma",
  "Uydu haritası altlıkları: Google Hybrid, Esri World Imagery ve OpenStreetMap katmanlarının saha farkları",
  "Mobil tarayıcı (PWA) tabanlı jeodezik yazılımların uygulama marketi gerektirmeden her cihazda çalışma avantajı",
  "Saha fotoğraflarının koordinatlı ve tarih damgalı olarak teknik raporlara entegre edilmesi",
  "Büyük ölçekli altyapı projelerinde binlerce nokta arasından ada/isim aramasıyla hedef noktayı bulma",
  "Geleneksel el GPS cihazları (Garmin, Magellan vb.) ile modern akıllı telefon tabanlı terminallerin karşılaştırması",
  "AZİMUT Pro Jeodezik El Terminali ile saha mühendisliğinde dijital dönüşüm ve hız kazanımı",
  "QGIS ve ArcGIS masaüstü CBS yazılımlarında üretilen katmanların mobil sahaya taşınması",
  "Shapefile (.SHP) verilerini KML veya GeoJSON formatına dönüştürerek cep telefonunda görüntüleme",
  "İmar planı paftalarını (Raster/TIF) vektör verilere dönüştürüp sahada parsel üzerinde kontrol etme",
  "NetCAD'de hazırlanan aplikasyon özet cetvellerini kağıt çıktısına gerek kalmadan telefonda kullanma",
  "AutoCAD Civil 3D yol ve altyapı projelerindeki kazık listelerini (.CSV) doğrudan saha terminaline atma",
  "Saha ölçümlerinde nokta adlandırma (P1, P2, K1, S1) ve kodlama standartlarının ofis çizimine etkisi",
  "Poligon ve sınır noktalarını birleştirerek sahada kapalı alan (poligon) oluşturma ve çevre uzunluğu hesabı",
  "Farklı projeksiyonlardaki iki ayrı CAD dosyasını aynı harita ekranında doğru konumda birleştirme",
  "Harita mühendislik bürolarında müşteri bilgilendirmesi için canlı konum ve PDF rapor paylaşım iş akışı",
  "Belediye ve kamu kurumlarında saha denetim tutanaklarına koordinatlı harita ekran görüntüsü ekleme",
  "İnşaat hakediş dosyalarında yapılan imalatın koordinat özet tablosu ve harita krokisiyle belgelenmesi",
  "Arazide kaybolan veya silinen proje dosyalarını bulut yedekleme (Cloud Backup) üzerinden geri yükleme",
  "Çoklu proje yönetimi: Aynı gün içinde 5 farklı şantiyenin koordinat klasörlerini birbirine karıştırmadan yönetme",
  "Nokta listelerinde toplu silme, düzenleme ve koordinat filtreleme işlemlerinin sahada pratik kullanımı",
  "Harita ekranında gece modu (karanlık tema) ve yüksek kontrastlı ikonların güneş altında okunabilirliği",
  "Telefon bataryasını koruyarak tam gün saha ölçümü yapabilmek için GPS ve ekran optimizasyonu ipuçları",
  "Harici Bluetooth GNSS (RTK) alıcılarını cep telefonuna bağlayarak mobil tarayıcıda milimetrik çalışmak",
  "Saha mühendisleri için kağıtsız şantiye (Paperless Construction) vizyonu ve dijital aplikasyon araçları",
  "Koordinat dönüşüm API'leri ve web tabanlı jeodezik hesap motorlarının matematiksel güvenilirliği",
  "Türkiye'de harita, inşaat, orman ve enerji sektörlerinde mobil CBS kullanımının geleceği"
];

// ============================================================================
// BÖLÜM 2: 200 ADET DİNAMİK SEKTÖREL MATRİS KONUSU (20 Meslek x 10 Operasyon)
// ============================================================================
const ROLES = [
  "Harita ve Kadastro Mühendisleri",
  "İnşaat Mühendisleri ve Şantiye Şefleri",
  "Orman Mühendisleri ve Muhafaza Memurları",
  "Elektrik Mühendisleri ve GES Yatırımcıları",
  "Mimarlar ve Peyzaj Mimarları",
  "Şehir ve Bölge Plancıları",
  "Ziraat Mühendisleri ve Büyük Çiftçiler",
  "Jeoloji ve Jeofizik Mühendisleri",
  "Maden Mühendisleri ve Ocak Yöneticileri",
  "Çevre Mühendisleri ve ÇED Uzmanları",
  "Gayrimenkul Değerleme (Ekspertiz) Uzmanları",
  "Profesyonel Arsa ve Arazi Emlakçıları",
  "Belediye Fen İşleri ve İmar Müdürlüğü Ekipleri",
  "Belediye Numarataj ve Adres Tespiti Personeli",
  "Karayolları, DSİ ve Altyapı Kontrol Mühendisleri",
  "LİHKAB ve Serbest Harita Bürosu Teknikerleri",
  "CBS (Coğrafi Bilgi Sistemleri) Uzmanları",
  "Telekomünikasyon ve Fiber Altyapı Ekipleri",
  "Arsa, Tarla ve Bahçe Satın Alan Yatırımcılar",
  "Arkeologlar ve Saha Araştırma Ekipleri"
];

const OPERATIONS = [
  "için cep telefonuyla ITRF96 ve ED50 koordinat dönüşümü ve sahada nokta bulma",
  "için TKGM kadastro parsellerinin tamamını tek ekranda canlı görüntüleme ve köşe aplikasyonu",
  "için MAKS (Mekânsal Adres Kayıt Sistemi) ile mahalle sınırı, cadde ve sokak verilerini haritada çizdirme",
  "için sesli ve pusulalı Stakeout (Canlı Aplikasyon) radarıyla arazide parsel taşına sıfırlama",
  "için NetCAD (.NCN), AutoCAD (.DXF), KML ve Excel koordinat dosyalarını sahada telefonda açma",
  "için arazide Hassas Epok Ortalaması (RMS) alarak GPS ölçüm doğruluğunu maksimuma çıkarma",
  "için sahada yürüyerek veya parsel seçerek anlık alan (m² / dekar) ve mesafe metrajı hesaplama",
  "için arazi ve parsel çalışmalarını tek tıkla resmi A4 PDF Koordinat Raporuna dönüştürme",
  "için dilim orta meridyeni (DOM) hatalarını önleyerek doğru projeksiyonda saha ölçümü yapma",
  "için internetin zayıf olduğu kırsal sahalarda mobil el terminaliyle kesintisiz koordinat aplikasyonu"
];

const DYNAMIC_TOPICS = [];
for (const role of ROLES) {
  for (const op of OPERATIONS) {
    DYNAMIC_TOPICS.push(`${role} ${op}`);
  }
}

const TOPIC_POOL = [...STATIC_TOPICS, ...DYNAMIC_TOPICS];

function getStockPhotoForTheme(theme, usedImagesSet) {
  const pool = REAL_STOCK_PHOTOS[theme] || REAL_STOCK_PHOTOS.surveying;
  const unused = pool.filter(url => !usedImagesSet.has(url));
  if (unused.length > 0) {
    return unused[Math.floor(Math.random() * unused.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Gemini 503 (yoğunluk) gibi geçici hatalara karşı tekrar deneme + yedek model
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function generateWithRetry(params) {
  const MAX_ATTEMPTS = 6;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const model = attempt <= 3 ? params.model : 'gemini-2.5-flash-lite';
    try {
      console.log(`🤖 Deneme ${attempt}/${MAX_ATTEMPTS} (${model})...`);
      return await ai.models.generateContent({ ...params, model });
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ Deneme ${attempt} başarısız: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 10000);
    }
  }
  throw lastErr;
}

async function runAutoBlogger() {
  try {
    console.log(`📚 Toplam SEO Konu Havuzu Kapasitesi: ${TOPIC_POOL.length} benzersiz konu.`);

    // ÖNCE MEVCUT MAKALELERLE SİTEMAP'İ HEMEN OLUŞTUR (Garantiye al)
    await buildSitemapAndRobots();

    const allArticlesSnap = await db.collection('azimut_articles').get();
    const usedTopics = new Set();
    const usedImages = new Set();
    allArticlesSnap.forEach(doc => {
      const data = doc.data();
      if (data.sourceTopic) usedTopics.add(data.sourceTopic);
      if (data.image) usedImages.add(data.image);
    });

    let availableTopics = TOPIC_POOL.filter(t => !usedTopics.has(t));
    if (availableTopics.length === 0) {
      console.log("♻️ Tüm konular tamamlandı! Havuz sıfırlanıyor...");
      availableTopics = TOPIC_POOL;
    }

    const selectedTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];
    console.log(`🎯 Seçilen Konu (${availableTopics.length} kalan içinden):`, selectedTopic);

    const inlineAppScreen = `ek${Math.floor(Math.random() * 7) + 1}.png`;

    const prompt = `Sen 20 yıllık kıdemli bir Harita, Kadastro ve CBS Mühendisisin. Aynı zamanda AZİMUT Pro (https://buraktonoz.com/azimut/) jeodezik mobil el terminalinin baş teknik yazarısın.

GÖREVİN: Sadece aşağıda verilen "SEÇİLEN KONU" üzerine Google aramalarında 1. sıraya ve "Featured Snippet" (0. Sıra Özet Kutusu) alanına çıkacak, son derece kapsamlı (en az 850-1100 kelime), teknik açıdan doyurucu, akıcı ve tamamen özgün bir Türkçe SEO makalesi yazmak.

SEÇİLEN KONU: "${selectedTopic}"

YAZIM VE TEKNİK SEO KURALLARI:
1. Başlık (title): Seçilen konuyu tam yansıtan, içinde aranma hacmi yüksek anahtar kelimeler geçen (Örn: TKGM Parsel Sorgulama, ITRF96, Aplikasyon, MAKS vb.), tıklanma oranı (CTR) yüksek ve özgün bir başlık olsun.
2. İçerik Yapısı (content): 
   - Giriş paragrafından (<p>) hemen sonra Google Featured Snippet için şu HTML özet kutusunu konuya uyarlayarak ekle (tek satır HTML olarak):
     <div style="background:rgba(0,229,255,0.08);border-left:4px solid #00e5ff;padding:16px;border-radius:8px;margin:20px 0;"><b>📌 Hızlı Mühendislik Özeti:</b> [Buraya konunun 2-3 cümlelik en net teknik çözüm özetini yaz]</div>
   - En az 4 adet <h2> alt başlığı ve gerekli yerlerde <h3> alt başlıkları kullan.
   - Madde işaretli listeler (<ul><li>), numaralı adımlar (<ol><li>) ve önemli terimlerde kalın (<b>) etiketler kullan.
   - Makalenin uygun bir bölümünde AZİMUT Pro'nun şu benzersiz üstünlüklerinden (konuyla bağlantılı olarak) mutlaka bahset:
     * TKGM'nin kendi sitesinde bile sadece tek tek parsel sorgulanabilirken, <a href="https://buraktonoz.com/azimut/">AZİMUT Pro</a> ile harita ekranındaki <b>tüm TKGM kadastro parsellerinin aynı anda toplu ve canlı</b> görülebildiği,
     * İstediğiniz yerin Ada/Parsel bilgisini girerek harita üzerinde çizdirilebildiği, köşe koordinatlarının tek tuşla mevcut projeye aktarılıp sesli/pusulalı <b>nokta aplikasyonu (Stakeout)</b> yapılabildiği,
     * <b>MAKS (Mekânsal Adres Kayıt Sistemi)</b> verileri üzerinden mahalle idari sınırları, cadde ve sokakların sorgulanıp haritada çizdirilebildiği ve <a href="https://buraktonoz.com/azimut/tanitim.html">AZİMUT Pro Tanıtım ve Rehber Portalı</a> üzerinden tüm detaylara ulaşılabildiği.
   - Makalenin ortasında şu HTML görsel kutusunu ekle:
     <figure style="margin:24px 0;text-align:center;"><img src="${inlineAppScreen}" alt="${selectedTopic} - AZİMUT Pro TKGM ve Aplikasyon Ekranı" loading="lazy" style="max-width:100%;border-radius:12px;border:1px solid rgba(56,189,248,0.3);box-shadow:0 10px 30px rgba(0,0,0,0.4);"><figcaption style="font-size:13px;color:#94a3b8;margin-top:8px;">Şekil: AZİMUT Pro Jeodezik El Terminali - Canlı TKGM Parsel, MAKS ve Saha Aplikasyon Ekranı</figcaption></figure>
   - Makalenin en sonuna <h2>Konuyla İlgili Sıkça Sorulan Sorular</h2> başlığı aç ve konuyla ilgili Google'da en çok aratılan 3 soruyu (<h3>Soru?</h3><p>Cevap...</p> formatında) yanıtla.
3. Kategori (category): Sadece şu 4 değerden en uygun olan BİRİNİ seç: "Kadastro & TKGM", "Saha Aplikasyonu", "Jeodezi & Projeksiyon", "CAD & Yazılım".
4. Görsel Teması (imageTheme): Makalenin kapak fotoğrafı için sadece şu 6 anahtardan en uygun olan BİRİNİ seç: "surveying", "construction", "land", "forestry", "energy", "cad_gis".`;

    const response = await generateWithRetry({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.75,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            category: { type: Type.STRING },
            imageTheme: { type: Type.STRING },
            summary: { type: Type.STRING },
            keywords: { type: Type.STRING },
            content: { type: Type.STRING }
          },
          required: ["title", "category", "imageTheme", "summary", "keywords", "content"]
        }
      }
    });

    const articleData = safeParseGeminiJson(response.text);

    const baseSlug = articleData.title
      .toLowerCase()
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 75);

    const uniqueSuffix = Date.now().toString(36).slice(-4);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const wordCount = articleData.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    const readMins = Math.max(3, Math.ceil(wordCount / 180));

    const theme = articleData.imageTheme || "surveying";
    const coverPhotoUrl = getStockPhotoForTheme(theme, usedImages);

    const newArticle = {
      id: slug,
      slug: slug,
      sourceTopic: selectedTopic,
      title: articleData.title,
      category: articleData.category || "Kadastro & TKGM",
      image: coverPhotoUrl,
      date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
      readTime: `${readMins} dk okuma`,
      author: "Burak Tonoz",
      authorEmail: "buraktonoz@gmail.com",
      summary: articleData.summary,
      keywords: articleData.keywords,
      content: articleData.content,
      timestamp: Date.now()
    };

    await db.collection('azimut_articles').doc(slug).set(newArticle);
    console.log(`✅ SEO Makalesi Kaydedildi: [${newArticle.category}] ${newArticle.title}`);

    // Yeni makale eklendikten sonra Sitemap.xml'i tekrar güncelle
    await buildSitemapAndRobots();

  } catch (error) {
    console.error("❌ Hata oluştu:", error);
    process.exit(1);
  }
}

runAutoBlogger();