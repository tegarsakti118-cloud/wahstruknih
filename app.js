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

    // 1. Jika kiriman berupa TEKS langsung
    const sharedText = urlParams.get('text') || urlParams.get('title') || '';
    if (sharedText) {
      parseTeksEwallet(sharedText);
    }

    // 2. Jika kiriman berupa GAMBAR / POST dari e-wallet
    if (urlParams.get('shared') === 'true' && 'caches' in window) {
      const cache = await caches.open('wahstruk-share');
      
      // Cek apakah ada kiriman teks
      const cachedText = await cache.match('shared-text');
      if (cachedText) {
        const text = await cachedText.text();
        parseTeksEwallet(text);
        await cache.delete('shared-text');
      }

      // Cek apakah ada kiriman GAMBAR FOTO
      const cachedImage = await cache.match('shared-image');
      if (cachedImage) {
        const imageBlob = await cachedImage.blob();
        await scanGambarBukti(imageBlob);
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

// ==================== MESIN OCR PEMINDAI GAMBAR BUKTI ====================
async function scanGambarBukti(imageBlob) {
  const loading = document.getElementById('loadingOcr');
  const statusText = document.getElementById('ocrStatusText');
  if (loading) loading.classList.remove('hidden');

  try {
    if (typeof Tesseract === 'undefined') {
      alert("Sedang memuat library pembaca gambar, pastikan ada internet.");
      return;
    }

    statusText.innerText = "🔍 Membaca tulisan di foto bukti transfer...";
    
    // Scan menggunakan Tesseract OCR
    const result = await Tesseract.recognize(imageBlob, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          statusText.innerText = `🔍 Membaca foto: ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const teksHasil = result.data.text;
    console.log("Teks hasil scan:", teksHasil);
    parseTeksEwallet(teksHasil);
  } catch (err) {
    alert("Gagal membaca gambar secara otomatis: " + err.message);
  } finally {
    if (loading) loading.classList.add('hidden');
    renderStruk();
  }
}

// ==================== FUNGSI PARSER SAKTI BUKTI E-WALLET (FIXED) ====================
function parseTeksEwallet(text) {
  if (!text) return;

  // JIKA TIPE TOKEN LISTRIK
  if (/PLN|TOKEN|METER/i.test(text)) {
    document.getElementById('tipeStruk').value = 'token';
    gantiTipeStruk();
    
    const tokenMatch = text.match(/(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/);
    if (tokenMatch) {
      document.getElementById('pln_token').value = tokenMatch[1].replace(/-/g, ' ');
    }
    const nominalMatch = text.match(/(?:Total|Nominal|Rp)[\s.:]*([\d\.,]+)/i) || text.match(/(\d{1,3}(?:[.,]\d{3})+)/);
    if (nominalMatch) {
      document.getElementById('pln_total').value = parseInt(nominalMatch[1].replace(/[\.,]/g, ''));
    }
    return;
  }

  // JIKA TIPE TRANSFER BANK / E-WALLET
  document.getElementById('tipeStruk').value = 'transfer';
  gantiTipeStruk();

  // 1. Deteksi Bank Tujuan
  if (/BCA/i.test(text)) document.getElementById('trf_bank').value = "BCA";
  else if (/BRI|BRIMO/i.test(text)) document.getElementById('trf_bank').value = "BRI";
  else if (/MANDIRI|LIVIN/i.test(text)) document.getElementById('trf_bank').value = "MANDIRI";
  else if (/BNI/i.test(text)) document.getElementById('trf_bank').value = "BNI";
  else if (/SEABANK/i.test(text)) document.getElementById('trf_bank').value = "SEABANK";
  else if (/JAGO/i.test(text)) document.getElementById('trf_bank').value = "BANK JAGO";
  else if (/DANA/i.test(text)) document.getElementById('trf_bank').value = "DANA";
  else if (/SHOPEE/i.test(text)) document.getElementById('trf_bank').value = "SHOPEEPAY";
  else if (/GOPAY/i.test(text)) document.getElementById('trf_bank').value = "GOPAY";
  else if (/OVO/i.test(text)) document.getElementById('trf_bank').value = "OVO";

  // 2. Deteksi Nominal Transfer (Cari nominal angka di atas Rp 1.000)
  const nominalMatch = text.match(/(?:Nominal|Jumlah|Total|Sebesar|Rp)[\s.:]*Rp?\s*([\d\.,]+)/i) || text.match(/Rp\s*([\d\.,]+)/i);
  if (nominalMatch) {
    const bersih = nominalMatch[1].replace(/[\.,]/g, '');
    if (parseInt(bersih) >= 1000) {
      document.getElementById('trf_nominal').value = parseInt(bersih);
    }
  }

  // 3. Deteksi Kode Referensi (WAJIB mengandung angka, bukan cuma kata 'Transfer')
  let kodeRef = "";
  const refMatch = text.match(/(?:No\.?\s*Ref(?:erensi)?|Reff|ID\s*Transaksi|No\.\s*Transaksi|Order\s*ID)[\s.:]*([A-Za-z0-9]{8,25})/i);
  if (refMatch) {
    const candidate = refMatch[1].trim();
    // Validasi: harus mengandung angka dan bukan kata generic
    if (/\d/.test(candidate) && !/^(TRANSFER|BERHASIL|SUKSES|TRANSAKSI)$/i.test(candidate)) {
      kodeRef = candidate;
    }
  }

  // 4. Deteksi No. Rekening Tujuan (Harus beda dengan No. Referensi)
  let noRek = "";
  const rekMatch = text.match(/(?:Rekening\s*Tujuan|No\.?\s*Rekening|No\.?\s*Tujuan|Ke\s*Rekening|Rekening|No\.?\s*Hp|Nomor)[\s.:]*([0-9]{8,20})/i);
  if (rekMatch) {
    noRek = rekMatch[1].trim();
  }

  // Jika kode referensi belum dapat tapi ada nomor 10-18 digit
  const semuaAngka = text.match(/\b\d{10,20}\b/g) || [];
  if (semuaAngka.length > 0) {
    if (!kodeRef && semuaAngka[0] !== noRek) {
      kodeRef = semuaAngka[0];
    } else if (!noRek && semuaAngka[0] !== kodeRef) {
      noRek = semuaAngka[0];
    }
  }

  if (kodeRef) document.getElementById('trf_ref').value = kodeRef;
  if (noRek) document.getElementById('trf_rek').value = noRek;

  // 5. Deteksi Nama Penerima (Filter kata 'UANG', 'KIRIM', dll)
  const penerimaMatch = text.match(/(?:Penerima|Ke\s*Rekening|Atas\s*Nama|a\.n\.?|Nama)[\s.:]*([A-Za-z\s.'’]{3,35})(?:\n|\r|Bank|Rp|$)/i);
  if (penerimaMatch) {
    let namaBersih = penerimaMatch[1].trim();
    // Buang kata-kata sampah
    namaBersih = namaBersih.replace(/^(KIRIM\s*UANG|UANG\s*MASUK|TRANSFER|KE|A\.N\.?|AN|DANA|BCA|BRI|MANDIRI|BERHASIL)\s*/gi, '').trim();
    namaBersih = namaBersih.replace(/\s*(BCA|BRI|MANDIRI|BNI|DANA|BERHASIL)$/gi, '').trim();
    
    // Jangan izinkan cuma kata 'UANG' atau 'UANGAN'
    if (namaBersih.length > 2 && !/^(UANG|UANGAN|DANA|TRANSFER)$/i.test(namaBersih)) {
      document.getElementById('trf_penerima').value = namaBersih.toUpperCase();
    }
  }
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
    const bank = document.getElementById('trf_bank').value || "BRI";
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