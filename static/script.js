/* =====================================================
   GLOBAL STATE
===================================================== */
let html5QrCode = null;
let alertsShown = false;
let myStatusChart = null;
let myTypeChart = null;
let isLoginMode = true;

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

/* =====================================================
   RECOVERED: NOTIFICATION SYSTEM (Using Toasts)
===================================================== */
async function checkNotifications() {
    try {
        const response = await fetch('/api/notifications');
        const alerts = await response.json();

        if (alerts && alerts.length > 0) {
            alerts.forEach(a => {
                // Determine toast type based on urgency
                const type = a.type === 'urgent' ? 'error' : 'info';
                showFlash(`Asset #${a.id}: ${a.msg}`, type);
            });
        }
    } catch (error) {
        console.error("Notification Error:", error);
    }
}

/* =====================================================
   FIXED: FLASH SYSTEM
===================================================== */
function showFlash(message, type = 'success') {
    const container = document.getElementById('flash-container');
    if (!container) return; // Exit if container doesn't exist

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <span>${type === 'error' ? '🛑' : type === 'info' ? 'ℹ️' : '✅'}</span>
            <span>${message}</span>
        </div>
        <button onclick="this.parentElement.remove()" style="background:none; border:none; color:white; cursor:pointer; font-size:1.2rem; margin-left:15px;">&times;</button>
    `;

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

function showSection(id) {
  if (id !== "barcode-scan" && html5QrCode?.isScanning) {
    stopScanner();
  }

  document.querySelectorAll("main > section").forEach(sec => {
    sec.classList.add("hidden");
    sec.style.display = "none";
  });

  const target = document.getElementById(id);
  if (target) {
    target.classList.remove("hidden");
    target.style.display = "block";
  }

  if (id === "dashboard") loadDashboard();
  if (id === "certificates") loadInventory();
  if (id === "renewals") loadRenewals();
  if (id === "profile") showOnePageProfile();
}

/* =====================================================
   AUTHENTICATION
===================================================== */
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
            
            const addLink = document.getElementById('admin-add-link');
            if (u !== 'admin') {
                if(addLink) addLink.style.display = 'none';
            } else {
                if(addLink) addLink.style.display = 'block';
            }
            
            showSection("dashboard");
            checkNotifications();
        } else {
            showFlash("Account created! Please login.", "success");
            toggleAuth();
        }
    } else { 
        const err = await res.json();
        showFlash(err.message, "error");
    }
}

function toggleAuth() {
    isLoginMode = !isLoginMode;
    document.getElementById("auth-title").innerText = isLoginMode ? "Login" : "Register";
    document.getElementById("auth-btn").innerText = isLoginMode ? "Login" : "Register";
}

async function logout() {
  await fetch('/api/logout'); 
  location.reload();          
}

async function adminCreateUser() {
    const u = document.getElementById("admin-new-client-user").value.trim();
    const p = document.getElementById("admin-new-client-pass").value.trim();

    if (!u || !p) {
        alert("Please provide both a username and a password.");
        return;
    }

    try {
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
        });
        const result = await response.json();
        if (response.ok) {
            showFlash("New client account ready!", "success");
            document.getElementById("admin-new-client-user").value = "";
            document.getElementById("admin-new-client-pass").value = "";
        } else {
            showFlash(err.message, "error");
        }
    } catch (err) {
        showFlash("Server Connection Failed", "error");
    }
}

/* =====================================================
   DATA LOADING FUNCTIONS
===================================================== */
async function loadDashboard() {
  try {
    const response = await fetch("/api/dashboard_stats");
    const stats = await response.json();
    document.getElementById("stat-total").innerText = stats.total;
    document.getElementById("stat-valid").innerText = stats.valid;
    document.getElementById("stat-soon").innerText = stats.soon;
    document.getElementById("stat-expired").innerText = stats.expired;
  } catch (err) {
    console.error("Dashboard load failed", err);
  }
}

async function loadInventory() {
  try {
      const res = await fetch("/api/certificates");
      const certs = await res.json();
      const grid = document.getElementById("cert-display-grid");
      
      if (!grid) return;
      if (certs.length === 0) {
          grid.innerHTML = "<p class='text-muted'>No certificates found. Add your first inspection!</p>";
          return;
      }

      grid.innerHTML = certs.map(c => {
          const statusClass = c.status === 'Expired' ? 'bg-danger' : 'bg-success';
          const safetyText = c.status === 'Expired' ? 'Expired' : 'Verified';

          return `
          <div class="card" style="padding: 15px; border-top: 4px solid ${c.status === 'Expired' ? '#dc3545' : '#28a745'};">
              <div style="display:flex; justify-content: space-between; align-items: flex-start;">
                  <div>
                      <small class="text-muted">ID: ${c.id}</small><br>
                      <span class="badge" style="background: #e7f1ff; color: #007bff; font-size: 0.6rem; padding: 2px 5px; border: 1px solid #007bff; border-radius: 4px; display: inline-block; margin-top: 5px;">
                          ${c.renewal_status || 'Not Started'}
                      </span>
                  </div>
                  <span class="badge ${statusClass}" style="font-size: 0.7rem;">${safetyText}</span>
              </div>
              <h3 style="margin: 10px 0;">${c.type}</h3>
              <p class="small">Site: ${c.site || 'N/A'}</p>
              <div style="text-align:center; margin: 15px 0;">
                  <img src="/generate_qr/${c.id}" width="100" style="border: 1px solid #eee; padding: 5px;">
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <a href="/static/pdfs/${c.pdf}" target="_blank" class="btn-small" style="text-align:center; text-decoration:none; background: #007bff; color:white; ${!c.pdf ? 'pointer-events: none; opacity: 0.5;' : ''}">View PDF</a>
                  <button onclick="deleteCertificate('${c.id}')" class="btn-small" style="background: #dc3545; color:white; border:none;">Delete</button>
              </div>
          </div>`;
      }).join("");
  } catch (err) {
      console.error("Failed to load inventory:", err);
  }
}

/* =====================================================
   RETEST / RENEWAL REQUEST
===================================================== */
async function requestRetest(assetId) {
    if (!confirm(`Send a re-test request to RR Solutions for Asset ID: ${assetId}?`)) return;

    try {
        const response = await fetch(`/api/request_retest/${assetId}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showFlash("Renewal request sent to RR Solutions", "info");
            // Refresh the views to show the updated "Renewal Requested" badge
            loadRenewals();
            loadInventory();
        } else {
            showFlash("Renewal request Dailed", "danger");
        }
    } catch (err) {
        console.error("Retest request failed:", err);
        showFlash("Server connection failed. Please try again later.", "danger");
    }
}

async function loadRenewals() {
  const grid = document.querySelector("#renewals .grid");
  if (!grid) return;
  grid.innerHTML = "<p>Loading alerts...</p>";

  try {
      const response = await fetch("/api/renewals");
      const renewals = await response.json();
      grid.innerHTML = ""; 
      if (renewals.length === 0) {
          grid.innerHTML = "<p class='text-muted'>No upcoming renewals found.</p>";
          return;
      }
      renewals.forEach(cert => {
          let color = cert.days_left < 0 ? "#dc3545" : "#ffc107";
          let statusText = cert.days_left < 0 ? `⚠️ EXPIRED (${Math.abs(cert.days_left)} days ago)` : `Expires in ${cert.days_left} days`;
          grid.innerHTML += `
              <div class="card" style="border-left: 6px solid ${color}; padding: 15px; margin-bottom: 15px; background: white;">
                  <h3>${cert.type}</h3>
                  <small>ID: ${cert.id}</small>
                  <p style="margin: 10px 0; color: ${color}; font-weight: bold;">${statusText}</p>
                  <button onclick="requestRetest('${cert.id}')" style="width: 100%; background: #333; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer;">Request Re-test</button>
              </div>`;
      });
  } catch (err) { console.error("Renewals failed", err); }
}

async function uploadCertificate(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append("name", document.getElementById("name").value);
    fd.append("id", document.getElementById("new-id").value);
    fd.append("type", document.getElementById("new-equipment").value);
    fd.append("site", document.getElementById("new-site").value);
    fd.append("date", document.getElementById("new-date").value);
    fd.append("expiry_date", document.getElementById("new-expiry").value);
    fd.append("pdf_file", document.getElementById("new-pdf").files[0]);

    const res = await fetch("/api/add_certificate", { method: "POST", body: fd });
    if (res.ok) { showFlash("Certificate saved and synced!", "success"); showSection("certificates"); }
    else { showFlash("Error Saving The Certificate!", "danger"); }
}

async function syncData() {
    const res = await fetch('/api/admin/sync_data');
    if (res.ok) showFlash("Cloud database synced successfully", "success");
}

/* =====================================================
   INIT / SESSION CHECK
===================================================== */
window.onload = async () => {
  try {
      const response = await fetch('/api/check_session');
      const result = await response.json();
      
      if (response.ok) {
          document.getElementById("login-page").classList.add("hidden");
          document.getElementById("app").classList.remove("hidden");
          const addLink = document.getElementById('admin-add-link');
          if (result.user !== 'admin') {
              if(addLink) addLink.style.display = 'none';
          } else {
              if(addLink) addLink.style.display = 'block';
          }
          showSection("dashboard");
          checkNotifications(); 
      }
  } catch (err) { console.error("Session check failed", err); }
};

/* Keep your existing Scanner, Search, Profile, and Chart functions below here */