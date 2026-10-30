# AYTAR Map Lab

AYTAR'dan tamamen bağımsız MapLibre GL deneme alanı. AYTAR'ın canlı deposuna, Supabase projesine veya dağıtımına dokunmaz.

## Hedef

- AYTAR'da kullanılan MapLibre + OpenFreeMap Liberty harita stilini bağımsız olarak denemek
- İstanbul merkezli aynı kamera yaklaşımını kullanmak
- Vektör stilinde bina katmanı bulunursa 3D ekstrüzyon ve neon kontur katmanlarını çalışma anında eklemek
- 2D / 3D kamera geçişini test etmek

## Çalıştırma

Node.js 20.19+ veya 22.12+:

```powershell
npm install
npm run dev
```

Tarayıcı: http://localhost:5173

Üretim derlemesi:

```powershell
npm run build
```

## Notlar

İlk prototip, OpenFreeMap Liberty stilindeki bina vektör katmanını çalışma anında bulur. Katman bulunamazsa harita yine açılır ve durum alanında uyarı gösterir. Bina kaynağı doğrulandıktan sonra katman filtresi, yükseklik alanları ve neon yoğunluğu ayarlanacaktır.

Bu proje AYTAR'ın kaynak dosyalarını değiştirmez.
