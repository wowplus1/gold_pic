

const firebaseConfig = {
  apiKey: "AIzaSyCh9L9XKdIoomEGR7AdTY5SVXAI3KjrGok",
  authDomain: "jewelry-loss-tracker.firebaseapp.com",
  projectId: "jewelry-loss-tracker",
  storageBucket: "jewelry-loss-tracker.firebasestorage.app",
  messagingSenderId: "243248159640",
  appId: "1:243248159640:web:e77e77be5519844cf529ed"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- Configuration ---
// 배포 후 발급받은 Google Apps Script Web App URL을 여기에 입력하세요.
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwzaY7QcFyuAlxnlfe-NBPveBgGjbjJrg9xHde7AwdFuwoKzrHM8n-T0PkIVbKkfy5B/exec";

let ledgerData = [];
let isFullyLoaded = false;
let currentCompressedImageBase64 = null;

const loadData = async () => {
  // 1. Show cached data immediately to eliminate loading wait time
  const cachedData = localStorage.getItem('jewelryLedgerData');
  if (cachedData) {
    try {
      ledgerData = JSON.parse(cachedData);
      renderMainData();
    } catch(e) {
      console.error('Failed to parse cached data', e);
    }
  }

  // 2. Fetch fresh initial data from Firestore
  try {
    const querySnapshot = await db.collection("ledger").orderBy("id", "desc").get();
    const serverData = [];
    querySnapshot.forEach((doc) => {
      serverData.push(doc.data());
    });
    
    // 파이어베이스가 처음이라 비어있고, 로컬에 기존 데이터가 남아있다면 모두 업로드(마이그레이션)
    if (serverData.length === 0 && ledgerData.length > 0) {
      console.log("Migrating existing data to Firestore...");
      for (const item of ledgerData) {
        await db.collection("ledger").doc(String(item.id)).set(item);
      }
    } else {
      ledgerData = serverData;
    }
    
    isFullyLoaded = true;
    localStorage.setItem('jewelryLedgerData', JSON.stringify(ledgerData));
    
    renderMainData();
    if (document.getElementById('view-stats').style.display === 'block') {
      updateStatsView();
    } else {
      updateKPIs(); 
    }
  } catch (error) {
    console.error('Failed to load from Firestore.', error);
    if (!ledgerData || ledgerData.length === 0) {
      ledgerData = [];
      renderMainData();
    }
  }
};

const syncAction = async (action, dataItem) => {
  try {
    // 1. Save locally instantly for fast UX
    localStorage.setItem('jewelryLedgerData', JSON.stringify(ledgerData));
    
    // 2. Background sync to Firestore
    if (action === 'add' || action === 'update') {
      await db.collection("ledger").doc(String(dataItem.id)).set(dataItem);
    } else if (action === 'delete') {
      await db.collection("ledger").doc(String(dataItem.id)).delete();
    }
  } catch (error) {
    console.error(`Failed to sync action: ${action}`, error);
  }
};


let editingId = null;

// DOM Elements
const form = document.getElementById('loss-form');
const ledgerBody = document.getElementById('ledger-body');

// Input fields
const inputStartDate = document.getElementById('startDate');
const inputEndDate = document.getElementById('endDate');
const inputName = document.getElementById('designName');
const inputGoldType = document.getElementById('goldType');
const inputExpected = document.getElementById('expectedWeight');
const inputInitial = document.getElementById('initialWeight');
const inputCasting = document.getElementById('castingWeight');
const inputCrafting = document.getElementById('craftingWeight');
const inputFinal = document.getElementById('polishingWeight');

// Preview elements
const previewLoss = document.getElementById('preview-loss');
const previewHeri = document.getElementById('preview-heri');

// Image upload elements
const inputProductImage = document.getElementById('productImage');
const previewImageWrapper = document.getElementById('productImagePreviewWrapper');
const previewImage = document.getElementById('productImagePreview');

// OCR elements
const ocrInput = document.getElementById('ocrInput');
const ocrLoading = document.getElementById('ocrLoading');
let currentOcrTargetId = null;

// View and Pagination State
let mainPage = 1;
const mainPageSize = 20;

let statsPage = 1;
let statsPageSize = 20;

let filterStartDate = '';
let filterEndDate = '';
let filterDateType = 'startDate';
let filterGoldTypeStats = '';

// View Toggles
const viewMain = document.getElementById('view-main');
const viewStats = document.getElementById('view-stats');
const navToggleButton = document.getElementById('nav-toggle-view');
const navToggleText = document.getElementById('nav-toggle-text');

navToggleButton.addEventListener('click', () => {
  if (viewMain.style.display === 'none') {
    // Switch to Main View
    viewStats.style.display = 'none';
    viewMain.style.display = 'block';
    navToggleText.textContent = '통계 페이지';
    renderMainData();
  } else {
    // Switch to Stats View
    viewMain.style.display = 'none';
    viewStats.style.display = 'block';
    navToggleText.textContent = '메인으로 돌아가기';
    updateStatsView();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
// Format helpers
const formatNum = (num) => Number(num).toFixed(2);
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr).split('T')[0].substring(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Google Drive Image URL Fixer
const getDriveImageUrl = (url) => {
  if (!url) return '';
  // 구글 드라이브 보안 정책으로 인해 uc?export=view가 막히는 현상을 우회 (thumbnail API 사용)
  const match = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800`;
  }
  return url;
};

const getTodayLocal = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNowLocal = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// Calculate Loss and Heri
const calculateMetrics = (initial, final) => {
  if (!initial || !final || initial <= 0) return { loss: 0, heri: 0 };
  const loss = initial - final;
  const heri = (loss / initial) * 100;
  return { loss, heri };
};

let currentSortCol = null;
let currentSortOrder = 'desc';

const getSortedData = (dataArray) => {
  if (!currentSortCol) return dataArray;
  
  return [...dataArray].sort((a, b) => {
    let valA = a[currentSortCol];
    let valB = b[currentSortCol];
    
    if (currentSortCol === 'loss' || currentSortCol === 'heri') {
      valA = calculateMetrics(a.initialWeight, a.final)[currentSortCol];
      valB = calculateMetrics(b.initialWeight, b.final)[currentSortCol];
    }
    
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';
    
    if (valA < valB) return currentSortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return currentSortOrder === 'asc' ? 1 : -1;
    return 0;
  });
};

// Event Listeners for real-time preview
const updatePreview = () => {
  const initial = parseFloat(inputInitial.value);
  const final = parseFloat(inputFinal.value);
  
  if (initial && final) {
    const { loss, heri } = calculateMetrics(initial, final);
    previewLoss.textContent = `${formatNum(loss)} g`;
    previewHeri.textContent = `${formatNum(heri)}%`;
    
    if (heri > 5) {
      previewHeri.style.color = 'var(--danger-text)';
      previewLoss.style.color = 'var(--danger-text)';
    } else {
      previewHeri.style.color = '#1D4ED8';
      previewLoss.style.color = '#1D4ED8';
    }
  } else {
    previewLoss.textContent = '0.00 g';
    previewHeri.textContent = '0.00%';
    previewHeri.style.color = '#1D4ED8';
    previewLoss.style.color = '#1D4ED8';
  }
};

['input', 'change'].forEach(evt => {
  inputInitial.addEventListener(evt, updatePreview);
  inputFinal.addEventListener(evt, updatePreview);
});

// 빈칸으로 둘 경우 자동으로 0으로 채워주는 로직 (사용자 편의성 향상)
['expectedWeight', 'initialWeight', 'castingWeight', 'craftingWeight', 'polishingWeight'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('blur', () => {
      if (el.value.trim() === '') {
        el.value = '0';
        updatePreview();
      }
    });
  }
});

// --- Image Compression & Preview Logic ---
inputProductImage.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    previewImageWrapper.style.display = 'none';
    currentCompressedImageBase64 = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas for compression
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Compress to 70% quality JPEG
      currentCompressedImageBase64 = canvas.toDataURL('image/jpeg', 0.7);
      
      // Show preview
      previewImage.src = currentCompressedImageBase64;
      previewImageWrapper.style.display = 'block';
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});




// Add or Update entry
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const btn = form.querySelector('.btn-primary');
  const originalText = btn.innerHTML;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 업로드 중...`;
  btn.disabled = true;


  if (editingId) {
    const index = ledgerData.findIndex(item => item.id === editingId);
    if (index !== -1) {
      let finalImageUrl = ledgerData[index].imageUrl; // keep old if not updated
      
      // If a new image is selected, upload it
      if (currentCompressedImageBase64) {
        if (GAS_WEBAPP_URL === "YOUR_GAS_WEBAPP_URL_HERE") {
          console.warn("GAS Web App URL is not set. Skipping image upload.");
        } else {
          try {
            const response = await fetch(GAS_WEBAPP_URL, {
              method: 'POST',
              body: JSON.stringify({
                action: 'uploadImage',
                imageBase64: currentCompressedImageBase64,
                name: inputName.value
              })
            });
            const result = await response.json();
            if (result.success && result.url) {
              finalImageUrl = result.url;
            } else {
              alert("사진 저장 오류 (서버): " + (result.error || "알 수 없는 오류"));
            }
          } catch (err) {
            console.error("Image upload failed", err);
            alert("사진 저장 통신 오류: " + err.message);
          }
        }
      }

      ledgerData[index] = {
        ...ledgerData[index],
        startDate: inputStartDate.value,
        endDate: inputEndDate.value,
        name: inputName.value,
        goldType: inputGoldType.value,
        expectedWeight: parseFloat(inputExpected.value),
        initialWeight: parseFloat(inputInitial.value),
        casting: parseFloat(inputCasting.value),
        crafting: parseFloat(inputCrafting.value),
        final: parseFloat(inputFinal.value),
        imageUrl: finalImageUrl
      };
      syncAction('update', ledgerData[index]);
    }
    editingId = null;
    
    // Reset button
    const btn = form.querySelector('.btn-primary');
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Add to Ledger`;
  } else {
    let newImageUrl = null;
    if (currentCompressedImageBase64) {
      if (GAS_WEBAPP_URL === "YOUR_GAS_WEBAPP_URL_HERE") {
        console.warn("GAS Web App URL is not set. Skipping image upload.");
      } else {
        try {
          const response = await fetch(GAS_WEBAPP_URL, {
            method: 'POST',
            body: JSON.stringify({
              action: 'uploadImage',
              imageBase64: currentCompressedImageBase64,
              name: inputName.value
            })
          });
          const result = await response.json();
          if (result.success && result.url) {
            newImageUrl = result.url;
          } else {
            alert("사진 저장 오류 (서버): " + (result.error || "알 수 없는 오류"));
          }
        } catch (err) {
          console.error("Image upload failed", err);
          alert("사진 저장 통신 오류: " + err.message);
        }
      }
    }

    const newItem = {
      id: Date.now(),
      startDate: inputStartDate.value,
      endDate: inputEndDate.value,
      name: inputName.value,
      goldType: inputGoldType.value,
      expectedWeight: parseFloat(inputExpected.value),
      initialWeight: parseFloat(inputInitial.value),
      casting: parseFloat(inputCasting.value),
      crafting: parseFloat(inputCrafting.value),
      final: parseFloat(inputFinal.value),
      timestamp: getNowLocal(),
      imageUrl: newImageUrl
    };
    
      ledgerData.unshift(newItem);
      syncAction('add', newItem);
    }
    
    resetFormLocation();
  const cancelBtn = form.querySelector('.btn-cancel');
  if (cancelBtn) cancelBtn.remove();
  
  renderMainData();
  
  // Reset form and photo
  form.reset();
  inputStartDate.value = getTodayLocal();
  inputProductImage.value = '';
  previewImageWrapper.style.display = 'none';
  currentCompressedImageBase64 = null;
  updatePreview();
  
  // Provide visual feedback
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/></svg> 완료!`;
  btn.style.backgroundColor = '#16A34A'; // Green
  
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.style.backgroundColor = '';
    btn.disabled = false;
  }, 2000);
});

// --- Form Location Management ---
function resetFormLocation() {
  const formSection = document.querySelector('.form-section');
  if (!formSection) return;
  const originalContainer = document.getElementById('view-main');
  const tableSection = document.querySelector('.table-section');
  
  if (formSection.parentNode !== originalContainer) {
    formSection.classList.remove('inline-edit-mode');
    formSection.style.margin = '';
    formSection.style.boxShadow = '';
    formSection.style.border = '';
    
    const h2 = formSection.querySelector('.panel-header h2');
    if (h2) h2.textContent = '새 디자인 공정 입력';
    const p = formSection.querySelector('.panel-header p');
    if (p) p.textContent = '각 단계별 중량을 입력하면 예상 해리율이 자동 계산됩니다.';
    
    originalContainer.insertBefore(formSection, tableSection);
  }
  
  const editRow = document.getElementById('edit-form-row');
  if (editRow) editRow.remove();
}

function cancelEdit() {
  editingId = null;
  form.reset();
  inputStartDate.value = getTodayLocal();
  inputProductImage.value = '';
  previewImageWrapper.style.display = 'none';
  currentCompressedImageBase64 = null;
  updatePreview();
  
  const btn = form.querySelector('.btn-primary');
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Add to Ledger`;
  
  const cancelBtn = form.querySelector('.btn-cancel');
  if (cancelBtn) cancelBtn.remove();
  
  resetFormLocation();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Edit entry
const editEntry = (id) => {
  const item = ledgerData.find(item => item.id === id);
  if (!item) return;
  
  // 만약 통계 화면에서 수정 버튼을 눌렀다면 메인 입력 화면으로 강제 이동
  if (viewStats.style.display === 'block') {
    viewStats.style.display = 'none';
    viewMain.style.display = 'block';
    document.getElementById('nav-toggle-text').textContent = '통계 페이지';
    renderMainData(); // 메인 화면 테이블 최신화
  }
  
  resetFormLocation();
  
  editingId = id;
  inputStartDate.value = formatDate(item.startDate);
  inputEndDate.value = formatDate(item.endDate);
  inputName.value = item.name;
  inputGoldType.value = item.goldType;
  inputExpected.value = item.expectedWeight;
  inputInitial.value = item.initialWeight;
  inputCasting.value = item.casting;
  inputCrafting.value = item.crafting;
  inputFinal.value = item.final;
  
  if (item.imageUrl) {
    previewImage.src = getDriveImageUrl(item.imageUrl);
    previewImageWrapper.style.display = 'block';
    currentCompressedImageBase64 = null; // Don't re-upload unless changed
  } else {
    previewImageWrapper.style.display = 'none';
    currentCompressedImageBase64 = null;
  }
  
  updatePreview();
  
  // Update button
  const btn = form.querySelector('.btn-primary');
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-save"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Update Ledger`;
  
  let cancelBtn = form.querySelector('.btn-cancel');
  if (!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary btn-cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.onclick = cancelEdit;
    btn.parentNode.insertBefore(cancelBtn, btn);
  }
  
  const formSection = document.querySelector('.form-section');
  const targetRow = document.querySelector(`#ledger-body tr[data-id="${id}"]`);
  
  if (formSection && targetRow) {
    const editRow = document.createElement('tr');
    editRow.id = 'edit-form-row';
    const editCell = document.createElement('td');
    editCell.colSpan = 10;
    editCell.style.padding = '0';
    editCell.style.backgroundColor = 'var(--bg-color)';
    
    formSection.classList.add('inline-edit-mode');
    formSection.style.margin = '1rem';
    formSection.style.boxShadow = 'var(--shadow-md)';
    formSection.style.border = '2px solid var(--primary-color)';
    const h2 = formSection.querySelector('.panel-header h2');
    if (h2) h2.textContent = '데이터 수정 중...';
    const p = formSection.querySelector('.panel-header p');
    if (p) p.textContent = '아래 내용을 수정 후 Update Ledger를 클릭하세요.';
    
    editCell.appendChild(formSection);
    editRow.appendChild(editCell);
    targetRow.after(editRow);
    
    const headerOffset = 80;
    const elementPosition = formSection.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.scrollY - headerOffset;
    
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// Delete entry
const deleteEntry = (id) => {
  if (editingId === id) cancelEdit();
  if(confirm('이 데이터를 삭제하시겠습니까?')) {
    ledgerData = ledgerData.filter(item => item.id !== id);
    syncAction('delete', { id });
    renderMainData();
    if(viewStats.style.display === 'block') updateStatsView();
  }
};

// --- Pagination & Rendering Helpers ---
const renderPagination = (totalItems, pageSize, currentPage, container, onPageChange) => {
  container.innerHTML = '';
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return;
  
  const createBtn = (text, page, disabled, active) => {
    const btn = document.createElement('button');
    btn.className = `page-btn ${active ? 'active' : ''}`;
    btn.textContent = text;
    btn.disabled = disabled;
    if (!disabled && !active) {
      btn.addEventListener('click', () => onPageChange(page));
    }
    return btn;
  };

  container.appendChild(createBtn('<', currentPage - 1, currentPage === 1, false));
  
  for (let i = 1; i <= totalPages; i++) {
    container.appendChild(createBtn(i, i, false, i === currentPage));
  }
  
  container.appendChild(createBtn('>', currentPage + 1, currentPage === totalPages, false));
};

const renderTableGeneric = (dataArray, tbody, currentPage, pageSize, paginationContainer, onPageChange) => {
  if (typeof resetFormLocation === 'function') resetFormLocation();
  tbody.innerHTML = '';
  
  if (dataArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">데이터가 없습니다.</td></tr>`;
    paginationContainer.innerHTML = '';
    return;
  }
  
  const startIdx = (currentPage - 1) * pageSize;
  const pageData = dataArray.slice(startIdx, startIdx + pageSize);
  
  pageData.forEach(item => {
    const { loss, heri } = calculateMetrics(item.initialWeight, item.final);
    const isHighLoss = heri > 5.0;
    
    const tr = document.createElement('tr');
    tr.dataset.id = item.id;
    if (isHighLoss) tr.className = 'high-loss';
    
    tr.innerHTML = `
      <td>
        ${item.imageUrl 
          ? `<img src="${getDriveImageUrl(item.imageUrl)}" alt="상품" style="width: 48px; height: 48px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color);">`
          : `<div style="width: 48px; height: 48px; border-radius: 6px; background-color: #F1F5F9; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            </div>`
        }
      </td>
      <td>
        <div style="font-weight: 500; color: var(--text-primary);">${item.name}</div>
      </td>
      <td>
        <div style="font-size: 0.75rem; color: var(--text-muted);">등록: ${formatDate(item.startDate)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${item.endDate ? '완료: ' + formatDate(item.endDate) : '-'}</div>
      </td>
      <td>
        <span class="badge" style="background-color: #F8FAFC; color: var(--text-secondary); border: 1px solid var(--border-color);">${item.goldType}</span>
      </td>
      <td class="num-col">
        <div style="color: var(--text-secondary); font-size: 0.75rem;">예상: ${formatNum(item.expectedWeight)}</div>
        <div style="font-weight: 500;">초기: ${formatNum(item.initialWeight)}</div>
      </td>
      <td class="num-col">${formatNum(item.casting)}</td>
      <td class="num-col">${formatNum(item.crafting)}</td>
      <td class="num-col">${formatNum(item.final)}</td>
      <td class="num-col highlight-col">${formatNum(loss)}</td>
      <td class="num-col highlight-col">
        ${isHighLoss ? 
          `<span class="badge badge-danger">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ${formatNum(heri)}%
          </span>` : 
          `<span class="badge badge-success">${formatNum(heri)}%</span>`
        }
      </td>
      <td style="display: flex; gap: 0.5rem; align-items: center; border-bottom: none; height: 100%;">
        <button class="edit-btn" onclick="editEntry(${item.id})" title="수정">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        </button>
        <button class="delete-btn" onclick="deleteEntry(${item.id})" title="삭제">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        </button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
  
  renderPagination(dataArray.length, pageSize, currentPage, paginationContainer, onPageChange);
};

// Render Main View Data
const renderMainData = () => {
  const sortedData = getSortedData(ledgerData);
  renderTableGeneric(
    sortedData,
    document.getElementById('ledger-body'),
    mainPage,
    mainPageSize,
    document.getElementById('main-pagination'),
    (page) => { mainPage = page; renderMainData(); }
  );
  updateKPIs(); // Main KPIs (all data)
};

// Update KPIs for given dataset and element prefix
const updateKPIsHelper = (data, prefix) => {
  const stats = {
    '순금': { designs: 0, initial: 0, final: 0 },
    '18K': { designs: 0, initial: 0, final: 0 },
    '14K': { designs: 0, initial: 0, final: 0 }
  };
  
  data.forEach(item => {
    if (stats[item.goldType]) {
      stats[item.goldType].designs++;
      stats[item.goldType].initial += item.initialWeight;
      stats[item.goldType].final += item.final;
    }
  });

  const renderStats = (type, suffix) => {
    const s = stats[type];
    const metric = calculateMetrics(s.initial, s.final);
    
    const dsgnEl = document.getElementById(`${prefix}-dsgn-${suffix}`);
    const initEl = document.getElementById(`${prefix}-init-${suffix}`);
    const lossEl = document.getElementById(`${prefix}-loss-${suffix}`);
    const heriEl = document.getElementById(`${prefix}-heri-${suffix}`);

    if (dsgnEl) dsgnEl.textContent = s.designs;
    if (initEl) initEl.textContent = formatNum(s.initial);
    if (lossEl) lossEl.textContent = formatNum(metric.loss);
    if (heriEl) heriEl.textContent = `${formatNum(metric.heri)}%`;
  };

  renderStats('순금', '순금');
  renderStats('18K', '18k');
  renderStats('14K', '14k');
};

const updateKPIs = () => updateKPIsHelper(ledgerData, 'stat');

// CSV Download
document.getElementById('download-csv').addEventListener('click', () => {
  if (ledgerData.length === 0) return alert('다운로드할 데이터가 없습니다.');
  
  let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // UTF-8 BOM for Korean support
  csvContent += "디자인 이름,등록일,완료일,금 재질,예상 중량(g),초기 중량(g),주물(g),세공(g),최종 광택(g),총 손실(g),해리율(%)\n";
  
  ledgerData.forEach(item => {
    const { loss, heri } = calculateMetrics(item.initialWeight, item.final);
    const row = [
      `"${item.name}"`,
      `"${formatDate(item.startDate)}"`,
      `"${formatDate(item.endDate)}"`,
      `"${item.goldType}"`,
      item.expectedWeight,
      item.initialWeight,
      item.casting,
      item.crafting,
      item.final,
      formatNum(loss),
      formatNum(heri)
    ].join(",");
    csvContent += row + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `jewelry_loss_data_${getTodayLocal()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// CSV Download for Stats
document.getElementById('download-csv-stats').addEventListener('click', () => {
  const filteredData = getFilteredStatsData();
  if (filteredData.length === 0) return alert('다운로드할 데이터가 없습니다.');
  
  let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
  csvContent += "디자인 이름,등록일,완료일,금 재질,예상 중량(g),초기 중량(g),주물(g),세공(g),최종 광택(g),총 손실(g),해리율(%)\n";
  
  filteredData.forEach(item => {
    const { loss, heri } = calculateMetrics(item.initialWeight, item.final);
    const row = [
      `"${item.name}"`,
      `"${formatDate(item.startDate)}"`,
      `"${formatDate(item.endDate)}"`,
      `"${item.goldType}"`,
      item.expectedWeight,
      item.initialWeight,
      item.casting,
      item.crafting,
      item.final,
      formatNum(loss),
      formatNum(heri)
    ].join(",");
    csvContent += row + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `jewelry_loss_stats_${getTodayLocal()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Stats View Logic
const getFilteredStatsData = () => {
  return ledgerData.filter(item => {
    if (filterGoldTypeStats && item.goldType !== filterGoldTypeStats) return false;

    const targetDate = item[filterDateType];
    
    // If the target date (startDate or endDate) is not set, exclude it from search if dates are provided
    // If no dates are provided, we just want to ensure it has the target date type defined
    if (!targetDate) return false;
    
    const targetDateStr = formatDate(targetDate);
    
    if (filterStartDate && targetDateStr < filterStartDate) return false;
    if (filterEndDate && targetDateStr > filterEndDate) return false;
    
    return true;
  });
};

const updateStatsView = () => {
  const filteredData = getFilteredStatsData();
  
  updateKPIsHelper(filteredData, 'stats');
  
  const sortedData = getSortedData(filteredData);
  renderTableGeneric(
    sortedData,
    document.getElementById('stats-ledger-body'),
    statsPage,
    statsPageSize,
    document.getElementById('stats-pagination'),
    (page) => { statsPage = page; updateStatsView(); }
  );
};

document.getElementById('btn-search-stats').addEventListener('click', () => {
  filterDateType = document.getElementById('filter-date-type').value;
  filterStartDate = document.getElementById('filter-start-date').value;
  filterEndDate = document.getElementById('filter-end-date').value;
  const goldTypeEl = document.getElementById('filter-gold-type');
  filterGoldTypeStats = goldTypeEl ? goldTypeEl.value : '';
  statsPage = 1;
  updateStatsView();
});

document.getElementById('stats-page-size').addEventListener('change', (e) => {
  statsPageSize = parseInt(e.target.value, 10);
  statsPage = 1;
  updateStatsView();
});

// Sorting Listeners
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (currentSortCol === col) {
      currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortCol = col;
      currentSortOrder = 'desc';
    }
    
    document.querySelectorAll('th.sortable .sort-icon').forEach(icon => icon.textContent = '');
    document.querySelectorAll(`th.sortable[data-sort="${col}"] .sort-icon`).forEach(icon => {
      icon.textContent = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
    });
    
    if (viewStats.style.display === 'block') {
      updateStatsView();
    } else {
      renderMainData();
    }
  });
});

// Make globals available
window.deleteEntry = deleteEntry;
window.editEntry = editEntry;

// Initial Render
inputStartDate.value = getTodayLocal();

// Initiate Load
loadData();
