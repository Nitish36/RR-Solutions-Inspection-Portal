/* =====================================================
   GLOBAL STATE
===================================================== */
let html5QrCode = null;
let alertsShown = false;
let myStatusChart = null;
let myTypeChart = null;

/* =====================================================
   UI & NAVIGATION
===================================================== */
const mobileMenu = document.getElementById("mobile-menu");
const navMenu = document.getElementById("nav-menu");

if (mobileMenu) {
  mobileMenu.addEventListener("click", () => {
    mobileMenu.classList.toggle("active");
    navMenu.classList.toggle("active");
  });
}

document.querySelectorAll("nav a").forEach(link => {
  link.addEventListener("click", () => {
    mobileMenu?.classList.remove("active");
    navMenu?.classList.remove("active");
  });
});

function showSection(id) {
  // Stop scanner if leaving scan page
  if (id !== "barcode-scan" && html5QrCode?.isScanning) {
    stopScanner();
  }

  // Hide every section
  document.querySelectorAll("main > section").forEach(sec => {
    sec.classList.add("hidden");
    sec.style.display = "none";
  });

  // Show the specific one
  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("hidden");
    target.style.display = "block";
  }

  // Trigger data loading based on section ID
  if (id === "dashboard") loadDashboard(); loadInventory();
  if (id === "certificates") loadCertificates();
  if (id === "renewals") loadRenewals();
  if (id === "profile") showOnePageProfile(); // This loads charts
}

/* =====================================================
   AUTHENTICATION
===================================================== */
async function login() {
  const username = document.getElementById("username")?.value;
  const password = document.getElementById("password")?.value;

  if (!username || !password) {
    alert("Please enter login credentials");
    return;
  }

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const result = await response.json();

  if (response.ok) {
    document.getElementById("login-page").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    showSection("dashboard");
    
    // NEW: Trigger notifications after successful login
    checkNotifications();
  } else {
    alert(result.message);
  }
}

async function logout() {
  await fetch('/api/logout'); // Clear cookie on server
  location.reload();          // Refresh page to reset UI
}

/* =====================================================
   DASHBOARD & STATS
===================================================== */
async function loadDashboard() {
  try {
    const response = await fetch("/api/dashboard_stats");
    const stats = await response.json();

    const values = document.querySelectorAll(".stat-card .value");
    if (values.length >= 4) {
      values[0].textContent = stats.total;
      values[1].textContent = stats.valid;
      values[2].textContent = stats.expiring_soon;
      values[3].textContent = stats.expired;
    }
  } catch (err) {
    console.error("Dashboard load failed", err);
  }
}

/* =====================================================
   CERTIFICATE MANAGEMENT
===================================================== */
async function submitNewCertificate(event) {
  event.preventDefault(); 

  const payload = {
      id: document.getElementById('new-id').value,
      form_type: document.getElementById('new-form-type').value,
      type: document.getElementById('new-equipment').value,
      site: document.getElementById('new-site').value,
      date: document.getElementById('new-date').value,
      expiry_date: document.getElementById('new-expiry').value
  };

  try {
      const response = await fetch('/api/add_certificate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.status === 'success') {
          alert("Record added successfully!");
          document.getElementById('add-cert-form').reset();
          showSection('certificates'); 
      } else {
          alert("Error: " + result.message);
      }
  } catch (error) {
      alert("Server connection failed.");
  }
}

async function loadCertificates() {
  const response = await fetch("/api/certificates");
  const certs = await response.json();
  const grid = document.getElementById("cert-display-grid");

  if(!grid) return;
  grid.innerHTML = "";

  certs.forEach(cert => {
    grid.innerHTML += `
      <div class="card" data-form="${cert.form_type || 'Others'}">
        <small>ID: ${cert.id}</small>
        <h3>${cert.type}</h3>
        <p>Site: ${cert.site || 'N/A'}</p>
        <p>Status: <strong>${cert.status}</strong></p>
        <div style="display:flex;gap:10px;flex-wrap:wrap; margin-top:10px;">
          <button onclick="requestRetest('${cert.id}')" class="btn-success">Retest</button>
          <button onclick="deleteCertificate('${cert.id}')" class="btn-danger">Delete</button>
        </div>
      </div>`;
  });
}

async function deleteCertificate(id) {
  if (!confirm("Delete this record?")) return;
  await fetch(`/api/delete_certificate/${id}`, { method: "DELETE" });
  loadCertificates();
}

/* =====================================================
   RENEWALS & ALERTS
===================================================== */
async function loadRenewals() {
  const response = await fetch("/api/renewals");
  const renewals = await response.json();
  const grid = document.querySelector("#renewals .grid");

  if(!grid) return;
  grid.innerHTML = "";

  renewals.forEach(cert => {
    const color = cert.days_left < 0 ? "#dc3545" : "#ffc107";
    grid.innerHTML += `
      <div class="card" style="border-left:5px solid ${color}">
        <h3>${cert.type}</h3>
        <p>ID: ${cert.id}</p>
        <strong style="color:${color}">
          ${cert.days_left < 0 ? "EXPIRED" : `Expires in ${cert.days_left} days`}
        </strong>
        <br><br>
        <button onclick="requestRetest('${cert.id}')">Request Renewal</button>
      </div>`;
  });
}

/* =====================================================
   ONE PAGE PROFILE & CHARTS
===================================================== */
async function showOnePageProfile() {
  try {
      const response = await fetch('/api/profile_summary');
      const data = await response.json();

      document.getElementById('profile-customer').innerText = data.customer_name;
      document.getElementById('profile-site').innerText = "Location: " + data.site_location;
      document.getElementById('profile-rate').innerText = data.compliance_rate + "%";
      document.getElementById('profile-total').innerText = data.total_assets;
      document.getElementById('profile-valid').innerText = data.valid;
      document.getElementById('profile-expired').innerText = data.expired;

      const container = document.getElementById('type-breakdown');
      container.innerHTML = ''; 
      for (const [type, count] of Object.entries(data.equipment_breakdown)) {
          container.innerHTML += `<span class="badge" style="background:#eee; padding:5px 10px; border-radius:20px; margin-right:5px;">${type}: ${count}</span>`;
      }
      
      // Render the graphs
      renderCharts();
  } catch (error) {
      console.error("Error loading profile:", error);
  }
}

async function renderCharts() {
    const response = await fetch('/api/chart_data');
    const data = await response.json();

    const ctxStatus = document.getElementById('statusChart').getContext('2d');
    if (myStatusChart) myStatusChart.destroy();
    myStatusChart = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: data.status_labels,
            datasets: [{ data: data.status_values, backgroundColor: ['#28a745', '#dc3545'] }]
        },
        options: { responsive: true }
    });

    const ctxType = document.getElementById('typeChart').getContext('2d');
    if (myTypeChart) myTypeChart.destroy();
    myTypeChart = new Chart(ctxType, {
        type: 'bar',
        data: {
            labels: data.type_labels,
            datasets: [{ label: 'Quantity', data: data.type_values, backgroundColor: '#ffcc00' }]
        },
        options: { responsive: true }
    });
}

/* =====================================================
   NOTIFICATIONS
===================================================== */
async function checkNotifications() {
    if (alertsShown) return;

    try {
        const response = await fetch('/api/notifications');
        const alerts = await response.json();

        if (alerts.length > 0) {
            const modal = document.getElementById('notification-modal');
            const body = document.getElementById('modal-body');
            const header = document.getElementById('modal-header');

            const hasUrgent = alerts.some(a => a.type === 'urgent');
            header.style.backgroundColor = hasUrgent ? '#dc3545' : '#ffc107';

            body.innerHTML = alerts.map(a => `
              <div style="border-left: 5px solid ${a.type === 'urgent' ? '#dc3545' : '#ffc107'}; padding: 10px; margin-bottom: 10px; background: #fff5f5; display: flex; justify-content: space-between; align-items: center;">
                  <div><strong>Asset #${a.id}:</strong><br>${a.msg}</div>
                  <button onclick="requestRetest('${a.id}')" style="background: #28a745; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer;">Request</button>
              </div>
          `).join('');

            modal.style.display = 'flex';
            alertsShown = true;
        }
    } catch (error) {
        console.error("Notification Error:", error);
    }
}

function closeModal() {
    document.getElementById('notification-modal').style.display = 'none';
}

async function requestRetest(certId) {
  if (!confirm(`Send re-test request for Asset #${certId}?`)) return;
  const response = await fetch(`/api/request_retest/${certId}`, { method: 'POST' });
  const result = await response.json();
  if (result.status === 'success') alert("Request sent to RR Solutions!");
}

/* =====================================================
   SEARCH & FILTERS
===================================================== */
function filterByForm(type) {
  const cards = document.querySelectorAll('#cert-display-grid .card');
  cards.forEach(card => {
      const form = card.getAttribute('data-form');
      card.style.display = (type === 'ALL' || form === type) ? '' : 'none';
  });
}

function searchDownloads() {
  let filter = document.getElementById('download-search').value.toUpperCase();
  let tr = document.getElementById('download-table').getElementsByTagName('tr');

  for (let i = 1; i < tr.length; i++) {
      let txtValue = tr[i].textContent || tr[i].innerText;
      tr[i].style.display = (txtValue.toUpperCase().indexOf(filter) > -1) ? "" : "none";
  }
}

/* =====================================================
   SCANNER
===================================================== */
async function startScanner() {
  html5QrCode = new Html5Qrcode("reader");
  try {
    await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        stopScanner();
        // If it's a URL (from our QR), go to it
        if(text.includes('verify')) window.location.href = text;
        else alert("Scanned ID: " + text);
    });
  } catch (err) { alert("Camera Error"); }
}

async function stopScanner() {
  if (html5QrCode) { await html5QrCode.stop(); }
}

/*Login*/
let isLoginMode = true;

function toggleAuth() {
    isLoginMode = !isLoginMode;
    document.getElementById("auth-title").innerText = isLoginMode ? "Login" : "Register";
    document.getElementById("auth-btn").innerText = isLoginMode ? "Login" : "Register";
}

async function handleAuth() {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    const endpoint = isLoginMode ? "/api/login" : "/api/register";

    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
    });

    if (res.ok) {
        if (isLoginMode) {
            document.getElementById("login-page").classList.add("hidden");
            document.getElementById("app").classList.remove("hidden");
            showSection("dashboard");
        } else {
            alert("Registered! Now Login.");
            toggleAuth();
        }
    } else { alert("Error in Auth"); }
}

function showSection(id) {
    document.querySelectorAll("main section").forEach(s => s.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
    if (id === "dashboard") loadStats();
    if (id === "certificates") loadInventory();
}

async function loadStats() {
    const res = await fetch("/api/dashboard_stats");
    const data = await res.json();
    document.getElementById("stat-total").innerText = data.total;
    document.getElementById("stat-expired").innerText = data.expired;
}

async function uploadCertificate(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append("id", document.getElementById("new-id").value);
    fd.append("type", document.getElementById("new-equipment").value);
    fd.append("site", document.getElementById("new-site").value);
    fd.append("date", document.getElementById("new-date").value);
    fd.append("expiry_date", document.getElementById("new-expiry").value);
    fd.append("pdf_file", document.getElementById("new-pdf").files[0]);

    const res = await fetch("/api/add_certificate", { method: "POST", body: fd });
    if (res.ok) { alert("Saved!"); showSection("certificates"); }
}

async function loadInventory() {
  try {
      const res = await fetch("/api/certificates");
      const certs = await res.json();
      const grid = document.getElementById("cert-display-grid");
      
      if (certs.length === 0) {
          grid.innerHTML = "<p class='text-muted'>No certificates found. Add your first inspection!</p>";
          return;
      }

      grid.innerHTML = certs.map(c => `
          <div class="card" style="padding: 15px; border-top: 4px solid #28a745;">
              <div style="display:flex; justify-content: space-between;">
                  <small class="text-muted">ID: ${c.id}</small>
                  <span class="badge ${c.status === 'Valid' ? 'bg-success' : 'bg-danger'}" style="font-size: 0.7rem;">${c.status}</span>
              </div>
              <h3 style="margin: 10px 0;">${c.type}</h3>
              <p class="small">Site: ${c.site || 'N/A'}</p>
              
              <div style="text-align:center; margin: 15px 0;">
                  <img src="/generate_qr/${c.id}" width="100" style="border: 1px solid #eee; padding: 5px;">
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <!-- View PDF Button: only works if a PDF was uploaded -->
                  <a href="/static/pdfs/${c.pdf}" target="_blank" class="btn-small" style="text-align:center; text-decoration:none; background: #007bff; color:white; ${!c.pdf ? 'pointer-events: none; opacity: 0.5;' : ''}">
                      View PDF
                  </a>
                  <button onclick="deleteCertificate('${c.id}')" class="btn-small" style="background: #dc3545; color:white; border:none;">
                      Delete
                  </button>
              </div>
          </div>
      `).join("");
  } catch (err) {
      console.error("Failed to load inventory:", err);
  }
}
/* =====================================================
   Admin View
===================================================== */

async function syncData() {
    const res = await fetch('/api/admin/sync_data');
    if (res.ok) {
        alert("Google Sheet updated! Refresh the Looker report to see new data.");
    }
}

/* =====================================================
   Search By ID
===================================================== */

async function performInventorySearch() {
  const query = document.getElementById('inventory-search-input').value.trim();
  if (!query) {
      alert("Please enter an Asset ID to search.");
      return;
  }

  const grid = document.getElementById("cert-display-grid");
  grid.innerHTML = "<p>Searching...</p>";

  try {
      const response = await fetch(`/api/search_asset/${query}`);
      const result = await response.json();

      if (result.status === "success") {
          const c = result.data;
          // Display only the found asset
          grid.innerHTML = `
              <div class="card" style="border: 2px solid #007bff; position: relative; padding:15px;">
                  <span style="position: absolute; top: 10px; right: 10px; background: #007bff; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem;">Match Found</span>
                  <small class="text-muted">ID: ${c.id}</small>
                  <h3 style="margin: 10px 0;">${c.type}</h3>
                  <p class="small">Site: ${c.site || 'N/A'}</p>
                  <div style="text-align:center; margin: 15px 0;">
                      <img src="/generate_qr/${c.id}" width="100" style="border: 1px solid #eee; padding: 5px;">
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                      <a href="/static/pdfs/${c.pdf}" target="_blank" class="btn-small" style="text-align:center; text-decoration:none; background: #007bff; color:white; ${!c.pdf ? 'pointer-events: none; opacity: 0.5;' : ''}">
                          View PDF
                      </a>
                      <button onclick="deleteCertificate('${c.id}')" class="btn-small" style="background: #dc3545; color:white; border:none;">
                          Delete
                      </button>
                  </div>
              </div>
          `;
      } else {
          grid.innerHTML = `
              <div style="text-align: center; width: 100%; padding: 40px;">
                  <h3 class="text-danger">Asset Not Found</h3>
                  <p>The ID "${query}" does not exist in your private inventory.</p>
                  <button onclick="loadInventory()" class="btn-small" style="background: #333; color: white; border: none; cursor:pointer;">Show All Assets</button>
              </div>`;
      }
  } catch (err) {
      console.error("Search Error:", err);
      grid.innerHTML = "<p class='text-danger'>Search failed. Please try again later.</p>";
  }
}

/* =====================================================
   INIT
===================================================== */
window.onload = async () => {
  try {
      const response = await fetch('/api/check_session');
      
      if (response.ok) {
          // Server says we are already logged in!
          document.getElementById("login-page").classList.add("hidden");
          document.getElementById("app").classList.remove("hidden");
          showSection("dashboard");
          checkNotifications(); // Check for alerts immediately
      } else {
          // No session found, show login page
          document.getElementById("login-page").classList.remove("hidden");
          document.getElementById("app").classList.add("hidden");
      }
  } catch (err) {
      console.error("Session check failed", err);
  }
};