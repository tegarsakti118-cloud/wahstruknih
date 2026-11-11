// Registrasi PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

let printerCharacteristic = null;

const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb'
];

const defaultPengirimList = [
  { id: 1, nama: "TEGXX DISXX SAKXXXXXX", bank: "SEABANK", rek: "90xxx5044xxx", isDefault: false },
  { id: 2, nama: "TEGXXX DISXX SAKXXXXXX", bank: "BRI", rek: "5655 XXXX XXXX 539", isDefault: true }
];

window.addEventListener('DOMContentLoaded', async () => {
  try {
    muatPengaturanTersimpan();
    inisialisasiPengirim();

    const urlParams = new URLSearchParams(window.location.search);

    // 1. Tangkap Share Teks Langsung
    const sharedText = urlParams.get('text') || urlParams.get('title') || '';
    if (sharedText) {
      eksekusiParserLengkap(sharedText);
    }

    // 2. Tangkap Share Gambar / POST dari e-wallet
    if (urlParams.get('shared') === 'true' && 'caches' in window) {
      const cache = await caches.open('wahstruk-share');
      
      const cachedText = await cache.match('shared-text');
      if (cachedText) {
        const text = await cachedText.text();
        eksekusiParserLengkap(text);
        await cache.delete('shared-text');
      }

      const cachedImage = await cache.match('shared-image');
      if (cachedImage) {
        const imageBlob = await cachedImage.blob();
        await scanGambarDenganFilter(imageBlob);
        await cache.delete('shared-image');
      }
    }
  } catch (err) {
    console.error("Gagal inisialisasi:", err);
  } finally {
    renderStruk();
    renderRiwayat();
  }
});

// ==================== PRE-PROCESSING GAMBAR (BINAIRZATION & KONTRAS TINGGI) ====================
async function filterGambarHitamPutih(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Ubah gambar jadi abu-abu + kontras super tajam agar teks terbaca 100%
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2];
        const v = (0.2126*r + 0.7152*g + 0.0722*b >= 165) ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v;
      }
      ctx.putImageData(imgData, 0, 0);
      canvas.toBlob(resolve, 'image/png');
    };
    img.src = URL.createObjectURL(blob);
  });
}

// ==================== MESIN OCR SCAN DENGAN FILTER ====================
async function scanGambarDenganFilter(imageBlob) {
  const loading = document.getElementById('loadingOcr');
  const statusText = document.getElementById('ocrStatusText');
  if (loading) loading.classList.remove('hidden');

  try {
    statusText.innerText = "⚡ Mempertajam kontras gambar...";
    const gambarTajam = await filterGambarHitamPutih(imageBlob);

    statusText.innerText = "🔍 Membaca data rekening & nama...";
    const result = await Tesseract.recognize(gambarTajam, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          statusText.innerText = `🔍 Membaca struk: ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const teksHasil = result.data.text;
    console.log("TEKS ASLI HASIL SCAN:\n", teksHasil);
    
    // Tampilkan kotak teks bantu koreksi cepat jika ada yang salah tangkap
    tampilkanBantuanTeks(teksHasil);
    eksekusiParserLengkap(teksHasil);
  } catch (err) {
    alert("Gagal membaca gambar secara otomatis: " + err.message);
  } finally {
    if (loading) loading.classList.add('hidden');
    renderStruk();
  }
}

// ==================== KOTAK BANTUAN TEKS KLIK 1 KALI LANGSUNG MASUK FORM ====================
function tampilkanBantuanTeks(rawText) {
  const box = document.getElementById('boxDebugOcr');
  const list = document.getElementById('listBarisOcr');
  if (!box || !list) return;

  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  list.innerHTML = '';
  
  lines.forEach(line => {
    const item = document.createElement('div');
    item.className = "flex justify-between items-center py-1 border-b border-gray-100 hover:bg-amber-100/50 px-1 rounded cursor-pointer";
    item.innerHTML = `
      <span class="truncate flex-1 font-semibold">${line}</span>
      <div class="flex gap-1 ml-2">
        <button type="button" onclick="isiManual('penerima', '${line.replace(/'/g, "\\'")}')" class="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">Nama</button>
        <button type="button" onclick="isiManual('rek', '${line.replace(/'/g, "\\'")}')" class="bg-emerald-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">Rek</button>
      </div>
    `;
    list.appendChild(item);
  });

  box.classList.remove('hidden');
}

function isiManual(target, teks) {
  if (target === 'penerima') {
    const bersih = teks.replace(/[^a-zA-Z\s.'’]/g, '').trim().toUpperCase();
    document.getElementById('trf_penerima').value = bersih;
  } else if (target === 'rek') {
    const angka = teks.replace(/[^0-9]/g, '').trim();
    if (angka) document.getElementById('trf_rek').value = angka;
  }
  renderStruk();
}

// ==================== PARSER LOGIKA CERDAS SEMUA BANK ====================
function eksekusiParserLengkap(rawText) {
  if (!rawText) return;

  const cleanText = rawText.replace(/\r/g, '');
  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // --- CEK TOKEN PLN ---
  if (/PLN|TOKEN|METER/i.test(cleanText)) {
    document.getElementById('tipeStruk').value = 'token';
    gantiTipeStruk();
    
    const tokenMatch = cleanText.match(/(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/);
    if (tokenMatch) {
      document.getElementById('pln_token').value = tokenMatch[1].replace(/-/g, ' ');
    }
    const nominalMatch = cleanText.match(/(?:Total|Nominal|Rp)[\s.:]*([\d\.,]+)/i) || cleanText.match(/(\d{1,3}(?:[.,]\d{3})+)/);
    if (nominalMatch) {
      document.getElementById('pln_total').value = parseInt(nominalMatch[1].replace(/[\.,]/g, ''));
    }
    return;
  }

  // --- TIPE TRANSFER BANK ---
  document.getElementById('tipeStruk').value = 'transfer';
  gantiTipeStruk();

  let bankTujuan = "";
  let rekTujuan = "";
  let namaPenerima = "";
  let nominalTrf = 0;
  let kodeRef = "";

  // 1. CARI NOMINAL
  const nominalMatch = cleanText.match(/(?:Nominal|Jumlah\s*Transfer|Total|Sebesar|Rp)[\s.:]*Rp?\s*([\d\.,]+)/i) || cleanText.match(/Rp\s*([\d\.,]+)/i);
  if (nominalMatch) {
    const bersih = nominalMatch[1].replace(/[\.,]/g, '');
    if (parseInt(bersih) >= 1000) nominalTrf = parseInt(bersih);
  }

  // 2. CARI KODE REFERENSI (Harus angka panjang atau kombinasi angka)
  const refMatch = cleanText.match(/(?:No\.?\s*Reff?|Referensi|ID\s*Transaksi|No\.\s*Transaksi|Order\s*ID)[\s.:]*([A-Za-z0-9]{8,25})/i);
  if (refMatch) {
    const cand = refMatch[1].trim();
    if (/\d/.test(cand) && !/^(TRANSFER|BERHASIL|SUKSES|TRANSAKSI)$/i.test(cand)) {
      kodeRef = cand;
    }
  }

  // 3. PARSING BARIS PER BARIS (BRIMO, SEABANK, DANA, BCA)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Deteksi Bank Tujuan
    if (!bankTujuan) {
      if (/SEABANK/i.test(line)) bankTujuan = "SEABANK";
      else if (/BCA/i.test(line) && !/DARI\s*BCA/i.test(line)) bankTujuan = "BCA";
      else if (/BRI|BRIMO/i.test(line) && !/DARI\s*BRI/i.test(line)) bankTujuan = "BRI";
      else if (/MANDIRI|LIVIN/i.test(line)) bankTujuan = "MANDIRI";
      else if (/BNI/i.test(line)) bankTujuan = "BNI";
      else if (/JAGO/i.test(line)) bankTujuan = "BANK JAGO";
      else if (/DANA/i.test(line) && !/SALDO\s*DANA/i.test(line)) bankTujuan = "DANA";
      else if (/SHOPEE/i.test(line)) bankTujuan = "SHOPEEPAY";
      else if (/GOPAY/i.test(line)) bankTujuan = "GOPAY";
      else if (/OVO/i.test(line)) bankTujuan = "OVO";
    }

    // Deteksi Blok "Tujuan" atau "Penerima" di BRIMO / SEABANK
    if (/^(Tujuan|Penerima|Ke\s*Rekening|Transfer\s*ke)$/i.test(line) || /^(Tujuan\s*:|Penerima\s*:)/i.test(line)) {
      // Ambil baris berikutnya yang berupa huruf (Nama)
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const nextLine = lines[j];
        if (!namaPenerima && /[A-Za-z]{3,}/.test(nextLine) && !/Nominal|Rp|Sumber|Total|Rekening|Bank|Ref/i.test(nextLine)) {
          namaPenerima = nextLine;
          continue;
        }
        // Ambil baris yang ada angka 9-20 digit (Nomor Rekening)
        const rek = nextLine.match(/(\d{9,20})/);
        if (rek && !rekTujuan && rek[1] !== kodeRef) {
          rekTujuan = rek[1];
        }
      }
    }
  }

  // 4. JIKA FORMAT SEJAJAR (BCA / MANDIRI: "NAMA : BUDI", "REK : 12345")
  if (!namaPenerima) {
    const bcaNama = cleanText.match(/(?:Nama|Penerima|Atas\s*Nama|a\.n\.?)[\s.:]*([A-Za-z\s.'’]{3,35})/i);
    if (bcaNama && !/DANA|SALDO|BANK|NOMINAL|TOTAL|KIRIM/i.test(bcaNama[1])) {
      namaPenerima = bcaNama[1];
    }
  }

  // 5. CARI DERETAN ANGKA REKENING JIKA BELUM DAPAT
  const semuaAngka = cleanText.match(/\b\d{9,20}\b/g) || [];
  if (!kodeRef && semuaAngka.length > 0) {
    kodeRef = semuaAngka[0]; // Angka pertama biasanya ID Transaksi / Ref
  }
  if (!rekTujuan && semuaAngka.length > 0) {
    for (const n of semuaAngka) {
      if (n !== kodeRef && n !== nominalTrf.toString()) {
        rekTujuan = n;
        break;
      }
    }
  }

  // 6. BERSIHKAN NAMA PENERIMA DARI KATA-KATA SAMPAH
  if (namaPenerima) {
    namaPenerima = namaPenerima.replace(/^(KIRIM\s*UANG|UANG\s*MASUK|TRANSFER|KE|A\.N\.?|AN|DANA|BCA|BRI|MANDIRI|BERHASIL|TUJUAN)\s*/gi, '').trim();
    namaPenerima = namaPenerima.replace(/\s*(BCA|BRI|MANDIRI|BNI|DANA|BERHASIL|SUKSES)$/gi, '').trim();
  }

  // MASUKKAN KE FORM INPUT HTML
  if (bankTujuan) document.getElementById('trf_bank').value = bankTujuan;
  if (rekTujuan) document.getElementById('trf_rek').value = rekTujuan;
  if (namaPenerima && namaPenerima.length > 2) document.getElementById('trf_penerima').value = namaPenerima.toUpperCase();
  if (nominalTrf > 0) document.getElementById('trf_nominal').value = nominalTrf;
  if (kodeRef) document.getElementById('trf_ref').value = kodeRef;
}

// ==================== NAVIGASI BOTTOM BAR ====================
function pindahTab(namaTab) {
  document.getElementById('tab-cetak').classList.add('hidden');
  document.getElementById('tab-riwayat').classList.add('hidden');
  document.getElementById('tab-setelan').classList.add('hidden');

  ['cetak', 'riwayat', 'setelan'].forEach(tab => {
    const navBtn = document.getElementById(`nav-${tab}`);
    navBtn.className = "flex flex-col items-center gap-0.5 text-slate-400 hover:text-slate-600 px-4 py-1 rounded-xl transition-all";
  });

  document.getElementById(`tab-${namaTab}`).classList.remove('hidden');
  document.getElementById(`nav-${namaTab}`).className = "flex flex-col items-center gap-0.5 text-blue-600 font-bold px-4 py-1 rounded-xl transition-all";

  if (namaTab === 'riwayat') renderRiwayat();
}

// ==================== PENGATURAN TOKO ====================
function muatPengaturanTersimpan() {
  if (localStorage.getItem('ws_nama')) document.getElementById('namaToko').value = localStorage.getItem('ws_nama');
  if (localStorage.getItem('ws_cs')) document.getElementById('csNumber').value = localStorage.getItem('ws_cs');
  if (localStorage.getItem('ws_tid')) document.getElementById('tidCode').value = localStorage.getItem('ws_tid');
  if (localStorage.getItem('ws_admin')) document.getElementById('trf_admin').value = localStorage.getItem('ws_admin');
  
  if (localStorage.getItem('ws_fitur_pengirim') !== null) {
    const aktif = localStorage.getItem('ws_fitur_pengirim') === 'true';
    document.getElementById('togglePengirim').checked = aktif;
    toggleContainerPengirim(aktif);
  }
}

function simpanPengaturan() {
  localStorage.setItem('ws_nama', document.getElementById('namaToko').value);
  localStorage.setItem('ws_cs', document.getElementById('csNumber').value);
  localStorage.setItem('ws_tid', document.getElementById('tidCode').value);
  localStorage.setItem('ws_admin', document.getElementById('trf_admin').value);
  renderStruk();
}

function setAdminCepat(nominal) {
  document.getElementById('trf_admin').value = nominal;
  simpanPengaturan();
}

// ==================== SISTEM DAFTAR PENGIRIM ====================
function getDaftarPengirim() {
  const data = localStorage.getItem('ws_daftar_pengirim');
  return data ? JSON.parse(data) : defaultPengirimList;
}

function saveDaftarPengirim(list) {
  localStorage.setItem('ws_daftar_pengirim', JSON.stringify(list));
  inisialisasiPengirim();
  renderStruk();
}

function inisialisasiPengirim() {
  const list = getDaftarPengirim();
  const container = document.getElementById('listPengirim');
  const selectAktif = document.getElementById('selectPengirimAktif');
  
  container.innerHTML = '';
  selectAktif.innerHTML = '';

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl border flex items-center justify-between transition-all ${item.isDefault ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-slate-200 bg-slate-50/60'}`;
    card.innerHTML = `
      <div class="flex items-center gap-2.5 cursor-pointer flex-1" onclick="jadikanDefault(${item.id})">
        <input type="radio" name="radioPengirim" ${item.isDefault ? 'checked' : ''} class="w-4 h-4 text-blue-600 focus:ring-0">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-extrabold text-slate-800 text-[11px]">${item.nama}</span>
            ${item.isDefault ? '<span class="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md tracking-wider">DEFAULT</span>' : ''}
          </div>
          <div class="text-[10px] text-slate-400 font-mono font-medium">${item.bank} - ${item.rek}</div>
        </div>
      </div>
      <button onclick="hapusPengirim(${item.id})" class="text-slate-300 hover:text-rose-500 p-1 text-sm font-bold transition-colors">✕</button>
    `;
    container.appendChild(card);

    const option = document.createElement('option');
    option.value = item.id;
    option.innerText = `${item.bank} - ${item.nama} (${item.rek})`;
    if (item.isDefault) option.selected = true;
    selectAktif.appendChild(option);
  });
}

function toggleFiturPengirim() {
  const aktif = document.getElementById('togglePengirim').checked;
  localStorage.setItem('ws_fitur_pengirim', aktif);
  toggleContainerPengirim(aktif);
  renderStruk();
}

function toggleContainerPengirim(aktif) {
  const container = document.getElementById('selectPengirimAktif').parentElement;
  if (aktif) container.classList.remove('hidden');
  else container.classList.add('hidden');
}

function jadikanDefault(id) {
  const list = getDaftarPengirim().map(item => ({ ...item, isDefault: item.id === id }));
  saveDaftarPengirim(list);
}

function hapusPengirim(id) {
  const list = getDaftarPengirim().filter(item => item.id !== id);
  saveDaftarPengirim(list);
}

function bukaModalPengirim() {
  document.getElementById('modalPengirim').classList.remove('hidden');
}

function tutupModalPengirim() {
  document.getElementById('modalPengirim').classList.add('hidden');
}

function simpanPengirimBaru() {
  const nama = document.getElementById('new_nama').value.trim();
  const bank = document.getElementById('new_bank').value.trim().toUpperCase();
  const rek = document.getElementById('new_rek').value.trim();

  if (!nama || !bank || !rek) {
    alert("Harap isi semua kolom!");
    return;
  }

  const list = getDaftarPengirim();
  list.push({ id: Date.now(), nama, bank, rek, isDefault: list.length === 0 });
  saveDaftarPengirim(list);

  document.getElementById('new_nama').value = '';
  document.getElementById('new_bank').value = '';
  document.getElementById('new_rek').value = '';
  tutupModalPengirim();
}

// ==================== LOGO HANDLER ====================
function prosesUploadLogo(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 200;
      const scaleSize = MAX_WIDTH / img.width;
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scaleSize;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      localStorage.setItem('ws_logo', canvas.toDataURL('image/png'));
      renderStruk();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function hapusLogo() {
  localStorage.removeItem('ws_logo');
  document.getElementById('inputLogo').value = "";
  renderStruk();
}

function gantiTipeStruk() {
  const tipe = document.getElementById('tipeStruk').value;
  if (tipe === 'transfer') {
    document.getElementById('formTransfer').classList.remove('hidden');
    document.getElementById('formToken').classList.add('hidden');
  } else {
    document.getElementById('formTransfer').classList.add('hidden');
    document.getElementById('formToken').classList.remove('hidden');
  }
  renderStruk();
}

function getWaktuSekarang() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const ii = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return { tgl: `${yyyy}-${mm}-${dd}`, jam: `${hh}:${ii}:${ss}`, lengkap: `${yyyy}-${mm}-${dd} ${hh}:${ii}:${ss}` };
}

// ==================== RENDER STRUK THERMAL ====================
function renderStruk() {
  const strukElement = document.getElementById('strukPreview');
  if (!strukElement) return;

  const tipe = document.getElementById('tipeStruk').value;
  const toko = document.getElementById('namaToko') ? document.getElementById('namaToko').value : "WAHSTRUKNIH";
  const cs = document.getElementById('csNumber') ? document.getElementById('csNumber').value : "0857-8024-3664";
  const tid = document.getElementById('tidCode') ? document.getElementById('tidCode').value : "AD4ECF";
  const logo = localStorage.getItem('ws_logo');
  const waktu = getWaktuSekarang();
  let html = '';

  if (logo) {
    html += `<div class="flex justify-center mb-1"><img src="${logo}" class="max-h-12 object-contain filter grayscale contrast-200"></div>`;
  } else {
    html += `<div class="text-center font-bold text-xl mb-1">⚡</div>`;
  }
  html += `<div class="text-center font-bold text-xs tracking-widest mb-2">${toko}</div>`;

  if (tipe === 'transfer') {
    const bank = document.getElementById('trf_bank').value || "-";
    const rek = document.getElementById('trf_rek').value || "-";
    const penerima = document.getElementById('trf_penerima').value || "-";
    const nominal = parseInt(document.getElementById('trf_nominal').value) || 0;
    const admin = parseInt(document.getElementById('trf_admin').value) || 0;
    const ref = document.getElementById('trf_ref').value || "-";
    const total = nominal + admin;

    const fiturPengirimAktif = document.getElementById('togglePengirim') ? document.getElementById('togglePengirim').checked : true;
    const listPengirim = getDaftarPengirim();
    const selectVal = document.getElementById('selectPengirimAktif') ? document.getElementById('selectPengirimAktif').value : null;
    const pengirimAktif = listPengirim.find(p => p.id == selectVal) || listPengirim[0] || { nama: "KONTER", bank: "BANK", rek: "xxxx" };

    html += `
      <div class="my-1 text-center">================================</div>
      <div class="flex justify-between"><span>TANGGAL</span><span>${waktu.tgl}</span></div>
      <div class="flex justify-between"><span>WAKTU</span><span>${waktu.jam}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold">KODE REFERENSI</div>
      <div class="text-center mb-1 font-mono">${ref}</div>
    `;

    if (fiturPengirimAktif) {
      html += `
        <div class="my-1 text-center">--------------------------------</div>
        <div class="text-center font-bold mb-1">DATA PENGIRIM</div>
        <div class="flex justify-between"><span>NAMA</span><span>${pengirimAktif.nama}</span></div>
        <div class="flex justify-between"><span>BANK</span><span>${pengirimAktif.bank}</span></div>
        <div class="flex justify-between"><span>NO REKENING</span><span class="font-mono">${pengirimAktif.rek}</span></div>
      `;
    }

    html += `
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold mb-1">DATA PENERIMA</div>
      <div class="flex justify-between"><span>BANK TUJUAN</span><span>${bank}</span></div>
      <div class="flex justify-between"><span>NO REKENING</span><span class="font-mono">${rek}</span></div>
      <div class="flex justify-between"><span>PENERIMA</span><span class="font-bold text-right">${penerima}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between"><span>NOMINAL</span><span>RP ${nominal.toLocaleString('id-ID')}</span></div>
      <div class="flex justify-between"><span>ADMIN</span><span>RP ${admin.toLocaleString('id-ID')}</span></div>
      <div class="my-1 text-center">================================</div>
      <div class="flex justify-between font-bold text-xs"><span>TOTAL</span><span>RP ${total.toLocaleString('id-ID')}</span></div>
      <div class="my-1 text-center">================================</div>
    `;
  } else {
    const token = document.getElementById('pln_token').value || "-";
    const nama = document.getElementById('pln_nama').value || "-";
    const meter = document.getElementById('pln_meter').value || "-";
    const kwh = document.getElementById('pln_kwh').value || "-";
    const total = parseInt(document.getElementById('pln_total').value) || 0;

    const tokenParts = token.split(' ');
    const baris1 = tokenParts.slice(0, 3).join(' ') || token.substring(0, 14);
    const baris2 = tokenParts.slice(3).join(' ') || token.substring(14);

    html += `
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold">TOKEN LISTRIK PRABAYAR</div>
      <div class="text-center text-[10px]">${waktu.lengkap}</div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold text-sm tracking-wider my-2 font-mono">
        <div>${baris1}</div>
        <div>${baris2}</div>
      </div>
      <div class="text-center text-[10px] mb-2 font-bold">MASUKKAN 20 ANGKA DI METERAN</div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between"><span>NO METER :</span><span class="font-mono">${meter}</span></div>
      <div class="flex justify-between"><span>NAMA     :</span><span class="font-bold">${nama}</span></div>
      <div class="flex justify-between"><span>KWH      :</span><span>${kwh}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between font-bold"><span>TOTAL</span><span>RP ${total.toLocaleString('id-ID')}</span></div>
      <div class="flex justify-between text-[10px]"><span>REF:</span><span class="font-mono">${Math.floor(100000000 + Math.random() * 900000000)}</span></div>
    `;
  }

  // FOOTER SUDAH RAPI & TIDAK ANEH
  html += `
    <div class="text-center mt-3 font-bold">** TRANSAKSI BERHASIL **</div>
    <div class="text-center text-[10px]">TERIMA KASIH ATAS</div>
    <div class="text-center text-[10px] font-bold">KEPERCAYAAN ANDA</div>
    <div class="my-1 text-center">--------------------------------</div>
    <div class="text-center text-[10px]">CS / BANTUAN:</div>
    <div class="text-center text-[11px] font-bold font-mono">${cs}</div>
    <div class="text-center text-[10px] mt-1">SIMPAN STRUK INI SEBAGAI BUKTI SAH</div>
    <div class="text-center text-[10px] mt-0.5 font-mono">TID: ${tid}</div>
  `;

  strukElement.innerHTML = html;
}

// ==================== SISTEM RIWAYAT TRANSAKSI ====================
function getRiwayat() {
  const data = localStorage.getItem('ws_riwayat');
  return data ? JSON.parse(data) : [];
}

function simpanKeRiwayat(item) {
  const list = getRiwayat();
  list.unshift(item);
  if (list.length > 50) list.pop();
  localStorage.setItem('ws_riwayat', JSON.stringify(list));
}

function renderRiwayat() {
  const container = document.getElementById('containerListRiwayat');
  const summaryTrx = document.getElementById('summaryJumlahTrx');
  const summaryNominal = document.getElementById('summaryTotalNominal');
  if (!container) return;

  const list = getRiwayat();
  summaryTrx.innerText = `${list.length} Transaksi`;

  let totalUang = 0;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="bg-white p-8 rounded-2xl border border-slate-200/80 text-center text-slate-400 text-xs">
        <span class="text-2xl block mb-1">📭</span>
        Belum ada riwayat transaksi yang dicetak.
      </div>
    `;
    summaryNominal.innerText = "Rp 0";
    return;
  }

  container.innerHTML = '';
  list.forEach(item => {
    totalUang += item.total;
    const card = document.createElement('div');
    card.className = "bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm space-y-2";
    
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="text-[9px] font-black px-2 py-0.5 rounded-md ${item.tipe === 'transfer' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'} uppercase tracking-wider">
          ${item.tipe}
        </span>
        <span class="text-[10px] text-slate-400 font-mono font-medium">${item.waktu}</span>
      </div>
      <div class="flex justify-between items-center">
        <div>
          <div class="font-bold text-slate-800 text-xs">${item.judul}</div>
          <div class="text-[10px] text-slate-400 font-mono">Ref: ${item.ref}</div>
        </div>
        <div class="text-right">
          <div class="font-black text-slate-900 text-xs">Rp ${item.total.toLocaleString('id-ID')}</div>
          <div class="text-[9px] text-emerald-600 font-bold">+Admin Rp ${item.admin.toLocaleString('id-ID')}</div>
        </div>
      </div>
      <div class="pt-2 border-t border-slate-100 flex justify-end gap-2">
        <button onclick="hapusSatuRiwayat(${item.id})" class="text-[10px] text-rose-500 font-bold px-2 py-1 hover:bg-rose-50 rounded-lg">Hapus</button>
        <button onclick="muatUlangStruk(${item.id})" class="text-[10px] bg-slate-900 active:scale-95 text-white font-bold px-3 py-1 rounded-lg shadow-sm">Cetak Ulang</button>
      </div>
    `;
    container.appendChild(card);
  });

  summaryNominal.innerText = `Rp ${totalUang.toLocaleString('id-ID')}`;
}

function hapusSatuRiwayat(id) {
  let list = getRiwayat().filter(item => item.id !== id);
  localStorage.setItem('ws_riwayat', JSON.stringify(list));
  renderRiwayat();
}

function hapusSemuaRiwayat() {
  if (confirm("Hapus semua catatan riwayat transaksi?")) {
    localStorage.removeItem('ws_riwayat');
    renderRiwayat();
  }
}

function muatUlangStruk(id) {
  const item = getRiwayat().find(r => r.id === id);
  if (!item) return;

  document.getElementById('tipeStruk').value = item.tipe;
  gantiTipeStruk();

  if (item.tipe === 'transfer') {
    document.getElementById('trf_bank').value = item.data.bank;
    document.getElementById('trf_rek').value = item.data.rek;
    document.getElementById('trf_penerima').value = item.data.penerima;
    document.getElementById('trf_nominal').value = item.data.nominal;
    document.getElementById('trf_admin').value = item.admin;
    document.getElementById('trf_ref').value = item.ref;
  } else {
    document.getElementById('pln_token').value = item.data.token;
    document.getElementById('pln_nama').value = item.data.nama;
    document.getElementById('pln_meter').value = item.data.meter;
    document.getElementById('pln_kwh').value = item.data.kwh;
    document.getElementById('pln_total').value = item.total;
  }

  pindahTab('cetak');
  renderStruk();
}

// ==================== KONEKSI BLUETOOTH & PRINT ====================
async function hubungkanPrinter() {
  try {
    document.getElementById('statusPrinter').innerText = "Mencari Printer...";
    document.getElementById('dotPrinter').className = "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES
    });

    const server = await device.gatt.connect();
    let service = null;
    for (const uuid of BLE_SERVICES) {
      try {
        service = await server.getPrimaryService(uuid);
        if (service) break;
      } catch (e) {}
    }

    if (!service) throw new Error("Service printer tidak ditemukan");

    const characteristics = await service.getCharacteristics();
    printerCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

    if (printerCharacteristic) {
      document.getElementById('statusPrinter').innerText = device.name || 'Printer Terhubung';
      document.getElementById('dotPrinter').className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
    }
  } catch (err) {
    alert("Gagal konek Bluetooth: " + err.message);
    document.getElementById('statusPrinter').innerText = "Belum Konek Printer";
    document.getElementById('dotPrinter').className = "w-2.5 h-2.5 rounded-full bg-rose-500";
  }
}

function formatBaris(kiri, kanan, lebar = 32) {
  const sisaSpasi = lebar - (kiri.length + kanan.length);
  if (sisaSpasi < 1) return kiri + " " + kanan + "\n";
  return kiri + " ".repeat(sisaSpasi) + kanan + "\n";
}

function rataTengah(teks, lebar = 32) {
  const spasi = Math.max(0, Math.floor((lebar - teks.length) / 2));
  return " ".repeat(spasi) + teks + "\n";
}

// CETAK STRUK LANGSUNG KE BLUETOOTH
async function cetakLangsung() {
  if (!printerCharacteristic) {
    alert("Hubungkan printer Bluetooth dulu lewat tombol 'Sambung'!");
    return;
  }

  const tipe = document.getElementById('tipeStruk').value;
  const toko = document.getElementById('namaToko') ? document.getElementById('namaToko').value : "WAHSTRUKNIH";
  const cs = document.getElementById('csNumber') ? document.getElementById('csNumber').value : "0857-8024-3664";
  const tid = document.getElementById('tidCode') ? document.getElementById('tidCode').value : "AD4ECF";
  const waktu = getWaktuSekarang();

  const ESC = "\x1B";
  const GS = "\x1D";
  let printData = ESC + "@";
  printData += rataTengah(toko);

  if (tipe === 'transfer') {
    const bank = document.getElementById('trf_bank').value;
    const rek = document.getElementById('trf_rek').value;
    const penerima = document.getElementById('trf_penerima').value;
    const nominal = parseInt(document.getElementById('trf_nominal').value) || 0;
    const admin = parseInt(document.getElementById('trf_admin').value) || 0;
    const ref = document.getElementById('trf_ref').value;
    const total = nominal + admin;

    const fiturPengirimAktif = document.getElementById('togglePengirim') ? document.getElementById('togglePengirim').checked : true;
    const listPengirim = getDaftarPengirim();
    const selectVal = document.getElementById('selectPengirimAktif').value;
    const pengirimAktif = listPengirim.find(p => p.id == selectVal) || listPengirim[0] || { nama: "-", bank: "-", rek: "-" };

    printData += rataTengah("================================");
    printData += formatBaris("TANGGAL", waktu.tgl);
    printData += formatBaris("WAKTU", waktu.jam);
    printData += rataTengah("--------------------------------");
    printData += rataTengah("KODE REFERENSI");
    printData += rataTengah(ref);

    if (fiturPengirimAktif) {
      printData += rataTengah("--------------------------------");
      printData += rataTengah("DATA PENGIRIM");
      printData += formatBaris("NAMA", pengirimAktif.nama);
      printData += formatBaris("BANK", pengirimAktif.bank);
      printData += formatBaris("NO REKENING", pengirimAktif.rek);
    }

    printData += rataTengah("--------------------------------");
    printData += rataTengah("DATA PENERIMA");
    printData += formatBaris("BANK TUJUAN", bank);
    printData += formatBaris("NO REKENING", rek);
    printData += formatBaris("PENERIMA", penerima);
    printData += rataTengah("--------------------------------");
    printData += formatBaris("NOMINAL", `RP ${nominal.toLocaleString('id-ID')}`);
    printData += formatBaris("ADMIN", `RP ${admin.toLocaleString('id-ID')}`);
    printData += rataTengah("================================");
    printData += formatBaris("TOTAL", `RP ${total.toLocaleString('id-ID')}`);
    printData += rataTengah("================================");

    simpanKeRiwayat({
      id: Date.now(),
      tipe: 'transfer',
      judul: `${bank} - ${penerima}`,
      waktu: waktu.lengkap,
      nominal: nominal,
      admin: admin,
      total: total,
      ref: ref,
      data: { bank, rek, penerima, nominal }
    });

  } else {
    const token = document.getElementById('pln_token').value;
    const nama = document.getElementById('pln_nama').value;
    const meter = document.getElementById('pln_meter').value;
    const kwh = document.getElementById('pln_kwh').value;
    const total = parseInt(document.getElementById('pln_total').value) || 0;

    const tokenParts = token.split(' ');
    const baris1 = tokenParts.slice(0, 3).join(' ') || token.substring(0, 14);
    const baris2 = tokenParts.slice(3).join(' ') || token.substring(14);

    printData += rataTengah("--------------------------------");
    printData += rataTengah("TOKEN LISTRIK PRABAYAR");
    printData += rataTengah(waktu.lengkap);
    printData += rataTengah("--------------------------------\n");

    printData += GS + "!" + "\x11";
    printData += rataTengah(baris1, 16);
    printData += rataTengah(baris2, 16);
    printData += GS + "!" + "\x00";

    printData += "\n" + rataTengah("MASUKKAN 20 ANGKA DI METERAN");
    printData += rataTengah("--------------------------------");
    printData += formatBaris("NO METER :", meter);
    printData += formatBaris("NAMA     :", nama);
    printData += formatBaris("KWH      :", kwh);
    printData += rataTengah("--------------------------------");
    printData += formatBaris("TOTAL", `RP ${total.toLocaleString('id-ID')}`);
    printData += formatBaris("REF:", "1451014994");

    simpanKeRiwayat({
      id: Date.now(),
      tipe: 'token',
      judul: `PLN - ${nama} (${meter})`,
      waktu: waktu.lengkap,
      nominal: total,
      admin: 0,
      total: total,
      ref: "1451014994",
      data: { token, nama, meter, kwh }
    });
  }

  printData += rataTengah("--------------------------------");
  printData += rataTengah("** TRANSAKSI BERHASIL **");
  printData += rataTengah("TERIMA KASIH ATAS");
  printData += rataTengah("KEPERCAYAAN ANDA");
  printData += rataTengah("--------------------------------");
  printData += rataTengah(`CS / BANTUAN: ${cs}`);
  printData += rataTengah("SIMPAN STRUK INI SEBAGAI");
  printData += rataTengah("BUKTI TRANSAKSI YANG SAH");
  printData += rataTengah(`TID: ${tid}`);
  printData += "\n\n\n";

  await kirimBytesKePrinter(printData);
}

async function kirimBytesKePrinter(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const CHUNK_SIZE = 50;

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    await printerCharacteristic.writeValue(chunk);
    await new Promise(r => setTimeout(r, 20));
  }
}