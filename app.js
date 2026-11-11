// Registrasi PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

let printerCharacteristic = null;
let currentTema = 'standard';
let dataAktifStruk = {
  tipe: 'transfer',
  toko: 'SakaPay',
  waktuTgl: '2026-11-01',
  waktuJam: '11:11:00',
  ref: '2026110110121410010100166584909647116',
  bankTujuan: 'SEABANK',
  rekTujuan: '4538',
  namaPenerima: 'TEGAR DISTA SAKTIAWAN',
  nominal: 200000,
  admin: 3000,
  // PLN Token
  tokenNumber: '4949-2577-3479-4880-0611',
  plnNama: 'SRI DEWI',
  plnMeter: '50201220816',
  plnKwh: '30.10 KWH',
  plnTotal: 25000,
  plnRef: '1462747568'
};

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
  muatPengaturan();
  inisialisasiPengirim();
  renderRiwayatSemua();

  // Tangkap Share Gambar / Teks dari Android
  const urlParams = new URLSearchParams(window.location.search);
  const sharedText = urlParams.get('text') || urlParams.get('title') || '';
  if (sharedText) {
    parseOcrTextMaster(sharedText);
    bukaPreview();
  }

  if (urlParams.get('shared') === 'true' && 'caches' in window) {
    const cache = await caches.open('wahstruk-share');
    const cachedImage = await cache.match('shared-image');
    if (cachedImage) {
      const blob = await cachedImage.blob();
      await scanGambarOcr(blob);
      await cache.delete('shared-image');
      bukaPreview();
    }
  }
});

// ==================== NAVIGASI TAB (BERANDA, PRINTER, SETELAN) ====================
function pindahTab(tab) {
  ['beranda', 'printer', 'setelan', 'aktivitas', 'preview'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });

  const target = document.getElementById(`view-${tab}`);
  if (target) target.classList.remove('hidden');

  ['beranda', 'printer', 'setelan'].forEach(nav => {
    const btn = document.getElementById(`nav-${nav}`);
    if (btn) btn.className = "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 transition-all";
  });

  const activeBtn = document.getElementById(`nav-${tab}`);
  if (activeBtn) activeBtn.className = "flex flex-col items-center gap-1 text-blue-600 font-bold transition-all";

  if (tab === 'aktivitas') renderRiwayatSemua();
}

function kembaliKeBeranda() {
  pindahTab('beranda');
}

function bukaPreview() {
  pindahTab('preview');
  renderStruk();
}

// ==================== PROSES OCR GAMBAR ====================
async function bacaGambarManual(event, tipe) {
  const file = event.target.files[0];
  if (!file) return;
  dataAktifStruk.tipe = tipe;
  await scanGambarOcr(file);
  bukaPreview();
}

async function scanGambarOcr(imageBlob) {
  try {
    const result = await Tesseract.recognize(imageBlob, 'eng', { logger: () => {} });
    parseOcrTextMaster(result.data.text);
  } catch (err) {
    alert("Gagal membaca bukti: " + err.message);
  }
}

// ==================== PARSER MASTER TEPAT SASARAN ====================
function parseOcrTextMaster(rawText) {
  if (!rawText) return;
  const oneLine = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');

  // 1. FORMAT TOKEN LISTRIK
  if (/STRUK\s*TOKEN|TOKEN\s*LISTRIK|ID\s*PLN|JUMLAH\s*DAYA|TARIF\s*DAYA/i.test(oneLine)) {
    dataAktifStruk.tipe = 'token';
    const tkn = oneLine.match(/(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/);
    if (tkn) dataAktifStruk.tokenNumber = tkn[1].replace(/-/g, ' ');

    const idpln = oneLine.match(/(?:ID\s*PLN|No\.?\s*Meter|ID\s*Pel)[\s.:]*([0-9]{10,13})/i);
    if (idpln) dataAktifStruk.plnMeter = idpln[1];

    const nama = oneLine.match(/NAMA[\s.:]+([A-Za-z\s.'’]{3,30}?)(?:\s+TARIF|\s+DAYA|\s+JUMLAH|\s+HARGA|\s+TOTAL)/i);
    if (nama) dataAktifStruk.plnNama = nama[1].trim().toUpperCase();

    const kwh = oneLine.match(/(?:JUMLAH\s*DAYA|JUMLAH\s*KWH|KWH)[\s.:]*([0-9.,]+\s*KWH)/i);
    if (kwh) dataAktifStruk.plnKwh = kwh[1].toUpperCase();

    const hrg = oneLine.match(/(?:HARGA|TOTAL)[\s.:]*Rp?\s*([\d.,]+)/i);
    if (hrg) dataAktifStruk.plnTotal = parseInt(hrg[1].replace(/[^0-9]/g, ''));

    const trx = oneLine.match(/ID\s*TRX[\s.:]*([0-9]{8,16})/i);
    if (trx) dataAktifStruk.plnRef = trx[1];
    return;
  }

  // 2. FORMAT TRANSFER (DANA, SEABANK, QITA BRI)
  dataAktifStruk.tipe = 'transfer';

  // Nominal
  const nom = oneLine.match(/Rp\s*([\d.,]+)/i);
  if (nom) dataAktifStruk.nominal = parseInt(nom[1].replace(/[^0-9]/g, ''));

  // A. Format DANA
  if (/DANA|Send\s*Money|Receiver\s*Detail/i.test(oneLine)) {
    const danaSum = oneLine.match(/(?:Send\s*Money|Kirim\s*Uang).*?(?:to|ke)\s+([A-Za-z\s.'’]+?)(?:\s*[-–]\s*)(SEABANK|BRI|BCA|MANDIRI|BNI|[A-Za-z]+)\s*(?:[•*.\s\d]*(\d{4}))/i);
    if (danaSum) {
      dataAktifStruk.namaPenerima = danaSum[1].trim().toUpperCase();
      dataAktifStruk.bankTujuan = danaSum[2].trim().toUpperCase();
      dataAktifStruk.rekTujuan = danaSum[3];
    }

    const txId = oneLine.match(/(?:Transaction\s*ID|Merchant\s*Order\s*ID)[\s:]*([0-9\s]{20,45})/i);
    if (txId) dataAktifStruk.ref = txId[1].replace(/\s/g, '');
  }

  // B. Format Qita BRI
  else if (/Qita|Transfer\s*Bank\s*BRI/i.test(oneLine) || (oneLine.includes("BANK BRI") && oneLine.includes("Referensi"))) {
    dataAktifStruk.bankTujuan = "BRI";
    const refBri = oneLine.match(/No\.?\s*Referensi[\s:]*([0-9]{10,16})/i) || oneLine.match(/\b\d{12}\b/);
    if (refBri) dataAktifStruk.ref = refBri[1] || refBri[0];

    const briAcc = oneLine.match(/([A-Za-z\s.'’]{3,30})\s+BANK\s*BRI\s*[-–]\s*([0-9\s]{12,25})/i);
    if (briAcc && !briAcc[2].includes('*')) {
      dataAktifStruk.namaPenerima = briAcc[1].trim().toUpperCase();
      dataAktifStruk.rekTujuan = briAcc[2].replace(/\s/g, '');
    }
  }

  // C. Format SeaBank
  else if (/SeaBank|Pembayaran\s*Diterima|Hasil\s*Transfer/i.test(oneLine)) {
    const seaKe = oneLine.match(/Ke\s+([A-Za-z\s.'’]{3,30})\s+([A-Z]{3,10})[\s:]+([0-9]{9,20})/i);
    if (seaKe) {
      dataAktifStruk.namaPenerima = seaKe[1].trim().toUpperCase();
      dataAktifStruk.bankTujuan = seaKe[2].toUpperCase();
      dataAktifStruk.rekTujuan = seaKe[3].trim();
    }
    const seaRef = oneLine.match(/No\.?\s*Transaksi[\s:]*([0-9\s]{15,30})/i);
    if (seaRef) dataAktifStruk.ref = seaRef[1].replace(/\s/g, '');
  }
}

// ==================== RENDER PREVIEW STRUK THERMAL ====================
function renderStruk() {
  const container = document.getElementById('strukPrintArea');
  if (!container) return;

  const toko = dataAktifStruk.toko || "SakaPay";
  const logo = localStorage.getItem('ws_logo');
  const pengirimAktif = getPengirimAktif();
  const waktu = getWaktuSekarang();
  let html = '';

  // HEADER LOGO
  if (logo) {
    html += `<div class="flex justify-center mb-1"><img src="${logo}" class="max-h-12 object-contain filter grayscale contrast-200"></div>`;
  } else {
    html += `<div class="text-center font-bold text-xl mb-1">⚡</div>`;
  }
  html += `<div class="text-center font-bold text-xs tracking-widest mb-2 uppercase">${toko}</div>`;

  if (dataAktifStruk.tipe === 'transfer') {
    const total = dataAktifStruk.nominal + dataAktifStruk.admin;

    html += `
      <div class="my-1 text-center">================================</div>
      <div class="flex justify-between"><span>TANGGAL</span><span>${dataAktifStruk.waktuTgl || waktu.tgl}</span></div>
      <div class="flex justify-between"><span>WAKTU</span><span>${dataAktifStruk.waktuJam || waktu.jam}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold">KODE REFERENSI</div>
      <div class="text-center mb-1 font-mono break-all text-[10px]">${dataAktifStruk.ref}</div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold mb-1">DATA PENGIRIM</div>
      <div class="flex justify-between"><span>NAMA</span><span>${pengirimAktif.nama}</span></div>
      <div class="flex justify-between"><span>BANK</span><span>${pengirimAktif.bank}</span></div>
      <div class="flex justify-between"><span>NO REKENING</span><span class="font-mono">${pengirimAktif.rek}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold mb-1">DATA PENERIMA</div>
      <div class="flex justify-between"><span>BANK TUJUAN</span><span>${dataAktifStruk.bankTujuan}</span></div>
      <div class="flex justify-between"><span>NO REKENING</span><span class="font-mono">${dataAktifStruk.rekTujuan}</span></div>
      <div class="flex justify-between"><span>PENERIMA</span><span class="font-bold text-right">${dataAktifStruk.namaPenerima}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between"><span>NOMINAL</span><span>RP ${dataAktifStruk.nominal.toLocaleString('id-ID')}</span></div>
      <div class="flex justify-between"><span>ADMIN</span><span>RP ${dataAktifStruk.admin.toLocaleString('id-ID')}</span></div>
      <div class="my-1 text-center">================================</div>
      <div class="flex justify-between font-bold text-xs"><span>TOTAL</span><span>RP ${total.toLocaleString('id-ID')}</span></div>
      <div class="my-1 text-center">================================</div>
    `;
  } else {
    // Struk Token PLN
    const tokenParts = dataAktifStruk.tokenNumber.split(' ');
    const b1 = tokenParts.slice(0, 3).join(' ') || dataAktifStruk.tokenNumber.substring(0, 14);
    const b2 = tokenParts.slice(3).join(' ') || dataAktifStruk.tokenNumber.substring(14);

    html += `
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold">TOKEN LISTRIK PRABAYAR</div>
      <div class="text-center text-[10px]">${waktu.lengkap}</div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="text-center font-bold text-sm tracking-wider my-2 font-mono">
        <div>${b1}</div>
        <div>${b2}</div>
      </div>
      <div class="text-center text-[10px] mb-2 font-bold">MASUKKAN 20 ANGKA DI METERAN</div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between"><span>NO METER :</span><span class="font-mono">${dataAktifStruk.plnMeter}</span></div>
      <div class="flex justify-between"><span>NAMA     :</span><span class="font-bold">${dataAktifStruk.plnNama}</span></div>
      <div class="flex justify-between"><span>KWH      :</span><span>${dataAktifStruk.plnKwh}</span></div>
      <div class="my-1 text-center">--------------------------------</div>
      <div class="flex justify-between font-bold"><span>TOTAL</span><span>RP ${dataAktifStruk.plnTotal.toLocaleString('id-ID')}</span></div>
      <div class="flex justify-between text-[10px]"><span>REF:</span><span class="font-mono">${dataAktifStruk.plnRef}</span></div>
    `;
  }

  // FOOTER RESMI
  const cs = localStorage.getItem('ws_cs') || "0857-8024-3664";
  html += `
    <div class="text-center mt-3 font-bold">** TRANSAKSI BERHASIL **</div>
    <div class="text-center text-[10px]">TERIMA KASIH ATAS</div>
    <div class="text-center text-[10px] font-bold">KEPERCAYAAN ANDA</div>
    <div class="my-1 text-center">--------------------------------</div>
    <div class="text-center text-[10px]">CS / BANTUAN:</div>
    <div class="text-center text-[11px] font-bold font-mono">${cs}</div>
    <div class="text-center text-[10px] mt-1">SIMPAN STRUK INI SEBAGAI BUKTI SAH</div>
  `;

  container.innerHTML = html;
}

// ==================== MODAL EDIT DATA LENGKAP ====================
function bukaModalEditLengkap() {
  document.getElementById('edit_namaToko').value = dataAktifStruk.toko || "SakaPay";
  document.getElementById('edit_waktu').value = `${dataAktifStruk.waktuTgl} ${dataAktifStruk.waktuJam}`;
  document.getElementById('edit_penerima').value = dataAktifStruk.namaPenerima;
  document.getElementById('edit_bank').value = dataAktifStruk.bankTujuan;
  document.getElementById('edit_rek').value = dataAktifStruk.rekTujuan;
  document.getElementById('edit_ref').value = dataAktifStruk.ref;
  document.getElementById('edit_nominal').value = dataAktifStruk.nominal;
  document.getElementById('edit_admin').value = dataAktifStruk.admin;

  // Isi dropdown pengirim
  const select = document.getElementById('edit_selectPengirim');
  select.innerHTML = '';
  getDaftarPengirim().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.innerText = `${p.nama} (${p.bank})`;
    if (p.isDefault) opt.selected = true;
    select.appendChild(opt);
  });

  document.getElementById('modalEditLengkap').classList.remove('hidden');
}

function tutupModalEditLengkap() {
  document.getElementById('modalEditLengkap').classList.add('hidden');
}

function simpanEditLengkap() {
  dataAktifStruk.toko = document.getElementById('edit_namaToko').value;
  const w = document.getElementById('edit_waktu').value.split(' ');
  dataAktifStruk.waktuTgl = w[0] || '2026-11-01';
  dataAktifStruk.waktuJam = w[1] || '11:11:00';
  dataAktifStruk.namaPenerima = document.getElementById('edit_penerima').value.toUpperCase();
  dataAktifStruk.bankTujuan = document.getElementById('edit_bank').value.toUpperCase();
  dataAktifStruk.rekTujuan = document.getElementById('edit_rek').value;
  dataAktifStruk.ref = document.getElementById('edit_ref').value;
  dataAktifStruk.nominal = parseInt(document.getElementById('edit_nominal').value) || 0;
  dataAktifStruk.admin = parseInt(document.getElementById('edit_admin').value) || 0;

  tutupModalEditLengkap();
  renderStruk();
}

function bukaFormManualKosong(tipe) {
  dataAktifStruk.tipe = tipe;
  bukaModalEditLengkap();
}

// ==================== PENGIRIM & SETELAN ====================
function getDaftarPengirim() {
  const d = localStorage.getItem('ws_daftar_pengirim');
  return d ? JSON.parse(d) : defaultPengirimList;
}

function getPengirimAktif() {
  const list = getDaftarPengirim();
  return list.find(p => p.isDefault) || list[0] || { nama: "KONTER", bank: "BANK", rek: "xxxx" };
}

function inisialisasiPengirim() {
  const list = getDaftarPengirim();
  const c = document.getElementById('listPengirim');
  if (!c) return;
  c.innerHTML = '';

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = `p-3 rounded-2xl border flex items-center justify-between ${item.isDefault ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200'}`;
    div.innerHTML = `
      <div class="flex items-center gap-2.5 cursor-pointer flex-1" onclick="jadikanDefault(${item.id})">
        <input type="radio" name="rPengirim" ${item.isDefault ? 'checked' : ''} class="w-4 h-4 text-blue-600">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-extrabold text-xs">${item.nama}</span>
            ${item.isDefault ? '<span class="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded">DEFAULT</span>' : ''}
          </div>
          <div class="text-[10px] text-slate-400 font-mono">${item.bank} - ${item.rek}</div>
        </div>
      </div>
      <button onclick="hapusPengirim(${item.id})" class="text-slate-300 hover:text-rose-500 p-1 font-bold">✕</button>
    `;
    c.appendChild(div);
  });
}

function jadikanDefault(id) {
  const list = getDaftarPengirim().map(p => ({ ...p, isDefault: p.id === id }));
  localStorage.setItem('ws_daftar_pengirim', JSON.stringify(list));
  inisialisasiPengirim();
  renderStruk();
}

function hapusPengirim(id) {
  const list = getDaftarPengirim().filter(p => p.id !== id);
  localStorage.setItem('ws_daftar_pengirim', JSON.stringify(list));
  inisialisasiPengirim();
}

function bukaModalPengirim() { document.getElementById('modalPengirim').classList.remove('hidden'); }
function tutupModalPengirim() { document.getElementById('modalPengirim').classList.add('hidden'); }

function simpanPengirimBaru() {
  const nama = document.getElementById('new_nama').value.trim();
  const bank = document.getElementById('new_bank').value.trim().toUpperCase();
  const rek = document.getElementById('new_rek').value.trim();
  if (!nama || !bank || !rek) return alert("Isi semua data!");

  const list = getDaftarPengirim();
  list.push({ id: Date.now(), nama, bank, rek, isDefault: list.length === 0 });
  localStorage.setItem('ws_daftar_pengirim', JSON.stringify(list));
  inisialisasiPengirim();
  tutupModalPengirim();
}

function muatPengaturan() {
  if (localStorage.getItem('ws_nama')) document.getElementById('namaToko').value = localStorage.getItem('ws_nama');
  if (localStorage.getItem('ws_admin')) document.getElementById('adminFee').value = localStorage.getItem('ws_admin');
  if (localStorage.getItem('ws_cs')) document.getElementById('csNumber').value = localStorage.getItem('ws_cs');
  if (localStorage.getItem('ws_logo')) {
    document.getElementById('previewLogoBox').innerHTML = `<img src="${localStorage.getItem('ws_logo')}" class="max-h-12 object-contain filter grayscale">`;
  }
}

function simpanPengaturan() {
  localStorage.setItem('ws_nama', document.getElementById('namaToko').value);
  localStorage.setItem('ws_admin', document.getElementById('adminFee').value);
  localStorage.setItem('ws_cs', document.getElementById('csNumber').value);
  dataAktifStruk.toko = document.getElementById('namaToko').value;
  renderStruk();
}

function simpanPengaturanSukses() {
  simpanPengaturan();
  alert("Pengaturan Berhasil Disimpan!");
  kembaliKeBeranda();
}

function prosesUploadLogo(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem('ws_logo', e.target.result);
    document.getElementById('previewLogoBox').innerHTML = `<img src="${e.target.result}" class="max-h-12 object-contain filter grayscale">`;
    renderStruk();
  };
  reader.readAsDataURL(file);
}

function hapusLogo() {
  localStorage.removeItem('ws_logo');
  document.getElementById('previewLogoBox').innerHTML = '<span class="text-3xl">⚡</span>';
  renderStruk();
}

function gantiTemaStruk(tema) {
  currentTema = tema;
  ['standard', 'minimalis', 'modern'].forEach(t => {
    const btn = document.getElementById(`btnTema${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.className = t === tema ? "bg-blue-600 text-white px-3.5 py-1.5 rounded-full shadow-sm" : "bg-white border text-slate-600 px-3.5 py-1.5 rounded-full shadow-sm";
  });
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

// ==================== RIWAYAT TRANSAKSI (AKTIVITAS) ====================
function getRiwayat() {
  const d = localStorage.getItem('ws_riwayat');
  return d ? JSON.parse(d) : [];
}

function simpanKeRiwayat(item) {
  const list = getRiwayat();
  list.unshift(item);
  if (list.length > 50) list.pop();
  localStorage.setItem('ws_riwayat', JSON.stringify(list));
  renderRiwayatSemua();
}

function renderRiwayatSemua() {
  const list = getRiwayat();
  const cBeranda = document.getElementById('listRiwayatBeranda');
  const cLengkap = document.getElementById('containerAktivitasLengkap');

  if (cBeranda) {
    cBeranda.innerHTML = '';
    list.slice(0, 3).forEach(item => {
      const card = document.createElement('div');
      card.className = "bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between";
      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-blue-600 text-sm">
            ${item.judul.charAt(0)}
          </div>
          <div>
            <div class="font-extrabold text-xs text-slate-900">${item.judul}</div>
            <div class="text-[10px] text-slate-400 font-mono">${item.waktu}</div>
          </div>
        </div>
      `;
      cBeranda.appendChild(card);
    });
  }

  if (cLengkap) {
    cLengkap.innerHTML = '';
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = "bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between";
      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-sm">
            ${item.judul.charAt(0)}
          </div>
          <div>
            <div class="font-extrabold text-xs text-slate-900">${item.judul}</div>
            <div class="text-[10px] text-slate-400 font-mono">${item.waktu} • <span class="text-emerald-600 font-bold">Rp ${item.total.toLocaleString('id-ID')}</span></div>
          </div>
        </div>
        <button onclick="hapusSatuRiwayat(${item.id})" class="text-slate-300 hover:text-rose-500 p-2 text-sm">🗑️</button>
      `;
      cLengkap.appendChild(card);
    });
  }
}

function hapusSatuRiwayat(id) {
  const list = getRiwayat().filter(r => r.id !== id);
  localStorage.setItem('ws_riwayat', JSON.stringify(list));
  renderRiwayatSemua();
}

function hapusSemuaRiwayat() {
  if (confirm("Hapus semua catatan riwayat?")) {
    localStorage.removeItem('ws_riwayat');
    renderRiwayatSemua();
  }
}

// ==================== KONEKSI BLUETOOTH PRINTER ====================
async function hubungkanPrinter() {
  try {
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

    const characteristics = await service.getCharacteristics();
    printerCharacteristic = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

    if (printerCharacteristic) {
      document.getElementById('namaPrinterKonek').innerText = device.name || 'Printer Terhubung';
      document.getElementById('indikatorPrinterStatus').innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span class="text-emerald-600">Terhubung</span>';
      document.getElementById('btnCetakAksi').innerHTML = '<span>🖨️</span><span>CETAK STRUK</span>';
      document.getElementById('btnCetakAksi').className = "flex-1 h-12 bg-slate-900 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-lg";
      alert("Printer Berhasil Terkoneksi!");
    }
  } catch (err) {
    alert("Koneksi Bluetooth: " + err.message);
  }
}

// ==================== CETAK STRUK LANGSUNG ====================
async function cetakLangsung() {
  if (!printerCharacteristic) {
    hubungkanPrinter();
    return;
  }

  const waktu = getWaktuSekarang();
  const pengirimAktif = getPengirimAktif();
  const cs = localStorage.getItem('ws_cs') || "0857-8024-3664";
  const ESC = "\x1B";
  const GS = "\x1D";
  let printData = ESC + "@";

  printData += rataTengah(dataAktifStruk.toko || "SakaPay");

  if (dataAktifStruk.tipe === 'transfer') {
    const total = dataAktifStruk.nominal + dataAktifStruk.admin;
    printData += rataTengah("================================");
    printData += formatBaris("TANGGAL", dataAktifStruk.waktuTgl || waktu.tgl);
    printData += formatBaris("WAKTU", dataAktifStruk.waktuJam || waktu.jam);
    printData += rataTengah("--------------------------------");
    printData += rataTengah("KODE REFERENSI");
    printData += rataTengah(dataAktifStruk.ref);
    printData += rataTengah("--------------------------------");
    printData += rataTengah("DATA PENGIRIM");
    printData += formatBaris("NAMA", pengirimAktif.nama);
    printData += formatBaris("BANK", pengirimAktif.bank);
    printData += formatBaris("NO REKENING", pengirimAktif.rek);
    printData += rataTengah("--------------------------------");
    printData += rataTengah("DATA PENERIMA");
    printData += formatBaris("BANK TUJUAN", dataAktifStruk.bankTujuan);
    printData += formatBaris("NO REKENING", dataAktifStruk.rekTujuan);
    printData += formatBaris("PENERIMA", dataAktifStruk.namaPenerima);
    printData += rataTengah("--------------------------------");
    printData += formatBaris("NOMINAL", `RP ${dataAktifStruk.nominal.toLocaleString('id-ID')}`);
    printData += formatBaris("ADMIN", `RP ${dataAktifStruk.admin.toLocaleString('id-ID')}`);
    printData += rataTengah("================================");
    printData += formatBaris("TOTAL", `RP ${total.toLocaleString('id-ID')}`);
    printData += rataTengah("================================");

    simpanKeRiwayat({
      id: Date.now(),
      judul: dataAktifStruk.namaPenerima,
      waktu: `${dataAktifStruk.waktuTgl} ${dataAktifStruk.waktuJam}`,
      total: total
    });
  } else {
    // Cetak Token PLN
    const tokenParts = dataAktifStruk.tokenNumber.split(' ');
    const b1 = tokenParts.slice(0, 3).join(' ') || dataAktifStruk.tokenNumber.substring(0, 14);
    const b2 = tokenParts.slice(3).join(' ') || dataAktifStruk.tokenNumber.substring(14);

    printData += rataTengah("--------------------------------");
    printData += rataTengah("TOKEN LISTRIK PRABAYAR");
    printData += rataTengah(waktu.lengkap);
    printData += rataTengah("--------------------------------\n");
    printData += GS + "!" + "\x11";
    printData += rataTengah(b1, 16);
    printData += rataTengah(b2, 16);
    printData += GS + "!" + "\x00";
    printData += "\n" + rataTengah("MASUKKAN 20 ANGKA DI METERAN");
    printData += rataTengah("--------------------------------");
    printData += formatBaris("NO METER :", dataAktifStruk.plnMeter);
    printData += formatBaris("NAMA     :", dataAktifStruk.plnNama);
    printData += formatBaris("KWH      :", dataAktifStruk.plnKwh);
    printData += rataTengah("--------------------------------");
    printData += formatBaris("TOTAL", `RP ${dataAktifStruk.plnTotal.toLocaleString('id-ID')}`);
    printData += formatBaris("REF:", dataAktifStruk.plnRef);

    simpanKeRiwayat({
      id: Date.now(),
      judul: dataAktifStruk.plnNama,
      waktu: waktu.lengkap,
      total: dataAktifStruk.plnTotal
    });
  }

  printData += rataTengah("--------------------------------");
  printData += rataTengah("** TRANSAKSI BERHASIL **");
  printData += rataTengah("TERIMA KASIH ATAS");
  printData += rataTengah("KEPERCAYAAN ANDA");
  printData += rataTengah("--------------------------------");
  printData += rataTengah(`CS / BANTUAN: ${cs}`);
  printData += rataTengah("SIMPAN STRUK INI SEBAGAI BUKTI SAH");
  printData += "\n\n\n";

  const encoder = new TextEncoder();
  const bytes = encoder.encode(printData);
  for (let i = 0; i < bytes.length; i += 50) {
    await printerCharacteristic.writeValue(bytes.slice(i, i + 50));
    await new Promise(r => setTimeout(r, 20));
  }
}

function bagikanStruk() {
  if (navigator.share) {
    navigator.share({
      title: 'Struk Transaksi',
      text: `Bukti Transaksi ${dataAktifStruk.toko}\nTotal: Rp ${(dataAktifStruk.nominal + dataAktifStruk.admin).toLocaleString('id-ID')}\nRef: ${dataAktifStruk.ref}`
    });
  } else {
    alert("Fitur bagikan siap digunakan!");
  }
}

function formatBaris(kiri, kanan, lebar = 32) {
  const sisa = lebar - (kiri.length + kanan.length);
  if (sisa < 1) return kiri + " " + kanan + "\n";
  return kiri + " ".repeat(sisa) + kanan + "\n";
}

function rataTengah(teks, lebar = 32) {
  const spasi = Math.max(0, Math.floor((lebar - teks.length) / 2));
  return " ".repeat(spasi) + teks + "\n";
}