/**
 * Central Auth UI Controller
 * 
 * Serves HTML pages for login and register with WowDash-style UI.
 * These pages handle authentication and redirect back to the calling panel.
 * 
 * Routes:
 * - GET /auth/login  - Login page
 * - GET /auth/register - Register page
 */

const path = require("path");

// Allowed ports for returnTo validation (security against open redirect)
const ALLOWED_PORTS = [3100, 3101, 3102, 3103, 3104, 3105, 3106];

/**
 * Validate returnTo URL to prevent open redirect attacks
 */
function isValidReturnTo(returnTo: string): boolean {
  if (!returnTo) return false;
  
  try {
    const url = new URL(returnTo);
    
    // Only allow localhost with specific ports
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const port = parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80);
      return ALLOWED_PORTS.includes(port);
    }
    
    // Block all external domains
    return false;
  } catch {
    return false;
  }
}

/**
 * Get panel name from returnTo URL
 */
function getPanelFromReturnTo(returnTo: string): string {
  try {
    const url = new URL(returnTo);
    const port = parseInt(url.port, 10) || 80;
    
    const portToPanel: Record<number, string> = {
      3100: "Mother",
      3101: "Shop",
      3102: "Clinic",
      3103: "Admin",
      3104: "Owner",
      3105: "Producer",
      3106: "Country",
    };
    
    return portToPanel[port] || "BPA";
  } catch {
    return "BPA";
  }
}

/**
 * Generate the login page HTML
 */
function getLoginPageHtml(app: string, returnTo: string, error?: string): string {
  const panelName = app ? app.charAt(0).toUpperCase() + app.slice(1) : getPanelFromReturnTo(returnTo);
  const safeReturnTo = isValidReturnTo(returnTo) ? returnTo : "";
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - ${panelName} | BPA</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
  <style>
    :root {
      --primary-600: #487fff;
      --primary-50: #e8f0ff;
      --neutral-50: #f8f9fa;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8f9fa;
    }
    .auth {
      min-height: 100vh;
    }
    .auth-left {
      background: linear-gradient(135deg, #487fff 0%, #6366f1 100%);
      width: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .auth-left img {
      max-width: 80%;
      max-height: 60vh;
      object-fit: contain;
    }
    .auth-right {
      width: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
    }
    @media (max-width: 992px) {
      .auth-left { display: none !important; }
      .auth-right { width: 100%; }
    }
    .form-control {
      height: 56px;
      background: var(--neutral-50);
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      padding-left: 48px;
    }
    .form-control:focus {
      border-color: var(--primary-600);
      box-shadow: 0 0 0 3px rgba(72, 127, 255, 0.1);
    }
    .icon-field {
      position: relative;
    }
    .icon-field .icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #6b7280;
      font-size: 20px;
    }
    .btn-primary-600 {
      background: var(--primary-600);
      border: none;
      border-radius: 12px;
      height: 52px;
      font-weight: 600;
    }
    .btn-primary-600:hover {
      background: #3b6de0;
    }
    .max-w-464-px {
      max-width: 464px;
    }
    .radius-12 {
      border-radius: 12px;
    }
    .text-primary-600 {
      color: var(--primary-600) !important;
    }
    .auth-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: var(--primary-50);
      color: var(--primary-600);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <section class="auth d-flex flex-wrap">
    <div class="auth-left d-lg-flex d-none">
      <img src="https://wowdash.flavor33labs.com/demo/wowdash/html/assets/images/auth/auth-img.png" alt="Auth">
    </div>
    
    <div class="auth-right">
      <div class="max-w-464-px mx-auto w-100">
        <div class="text-center mb-4">
          <h2 class="fw-bold mb-2" style="color: var(--primary-600);">BPA</h2>
          <h4 class="mb-2">${panelName} Sign In</h4>
          <p class="text-secondary">Sign in with your email or phone number</p>
        </div>
        
        ${error ? `<div class="alert alert-danger py-12 px-16 radius-12 mb-3">${error}</div>` : ""}
        
        <form id="loginForm">
          <input type="hidden" name="app" value="${app || ""}">
          <input type="hidden" name="returnTo" value="${safeReturnTo}">
          
          <div class="icon-field mb-3">
            <span class="icon"><i class="ri-user-line"></i></span>
            <input 
              type="text" 
              class="form-control" 
              id="identifier" 
              name="identifier" 
              placeholder="Email or Phone Number"
              autocomplete="username"
              required
            >
          </div>
          <div id="identifierType" class="mb-2" style="display: none;">
            <span class="auth-badge">
              <i class="ri-mail-line" id="typeIcon"></i>
              <span id="typeText">Email</span>
            </span>
          </div>
          
          <div class="icon-field mb-4">
            <span class="icon"><i class="ri-lock-password-line"></i></span>
            <input 
              type="password" 
              class="form-control" 
              id="password" 
              name="password" 
              placeholder="Password"
              autocomplete="current-password"
              required
            >
          </div>
          
          <div id="errorMsg" class="alert alert-danger mb-3" style="display: none;"></div>
          
          <button type="submit" class="btn btn-primary-600 w-100" id="submitBtn">
            Sign In
          </button>
          
          <div class="text-center mt-4">
            <p class="text-secondary mb-2">
              Don't have an account? 
              <a href="/auth/register?app=${app || ""}&returnTo=${encodeURIComponent(safeReturnTo)}" class="text-primary-600 fw-semibold">
                Register
              </a>
            </p>
            ${safeReturnTo ? `<p class="text-muted small">After login, you'll be redirected to: <code>${safeReturnTo}</code></p>` : ""}
          </div>
        </form>
      </div>
    </div>
  </section>
  
  <script>
    const form = document.getElementById('loginForm');
    const identifierInput = document.getElementById('identifier');
    const identifierType = document.getElementById('identifierType');
    const typeIcon = document.getElementById('typeIcon');
    const typeText = document.getElementById('typeText');
    const errorMsg = document.getElementById('errorMsg');
    const submitBtn = document.getElementById('submitBtn');
    
    // Detect auth type (email or phone)
    identifierInput.addEventListener('input', function() {
      const value = this.value.trim();
      if (!value) {
        identifierType.style.display = 'none';
        return;
      }
      
      const isEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
      const isPhone = /^[+]?[0-9\\s-]{7,}$/.test(value.replace(/\\s+/g, ''));
      
      if (isEmail) {
        identifierType.style.display = 'block';
        typeIcon.className = 'ri-mail-line';
        typeText.textContent = 'Email';
      } else if (isPhone) {
        identifierType.style.display = 'block';
        typeIcon.className = 'ri-phone-line';
        typeText.textContent = 'Phone';
      } else {
        identifierType.style.display = 'none';
      }
    });
    
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const identifier = identifierInput.value.trim();
      const password = document.getElementById('password').value;
      const returnTo = form.querySelector('input[name="returnTo"]').value;
      
      if (!identifier || !password) {
        errorMsg.textContent = 'Please fill in all fields';
        errorMsg.style.display = 'block';
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in...';
      errorMsg.style.display = 'none';
      
      try {
        // Detect if email or phone
        const isEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(identifier);
        const payload = isEmail 
          ? { email: identifier, password }
          : { phone: identifier.replace(/\\D/g, ''), password };
        
        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Login failed');
        }
        
        // Redirect to returnTo URL
        if (returnTo) {
          window.location.href = returnTo;
        } else {
          window.location.href = '/';
        }
      } catch (err) {
        errorMsg.textContent = err.message || 'Login failed. Please try again.';
        errorMsg.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Generate the register page HTML
 */
function getRegisterPageHtml(app: string, returnTo: string, error?: string): string {
  const panelName = app ? app.charAt(0).toUpperCase() + app.slice(1) : getPanelFromReturnTo(returnTo);
  const safeReturnTo = isValidReturnTo(returnTo) ? returnTo : "";
  const isOwner = app === "owner";
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register - ${panelName} | BPA</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
  <style>
    :root {
      --primary-600: #487fff;
      --primary-50: #e8f0ff;
      --neutral-50: #f8f9fa;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8f9fa;
    }
    .auth {
      min-height: 100vh;
    }
    .auth-left {
      background: linear-gradient(135deg, #487fff 0%, #6366f1 100%);
      width: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .auth-left img {
      max-width: 80%;
      max-height: 60vh;
      object-fit: contain;
    }
    .auth-right {
      width: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
    }
    @media (max-width: 992px) {
      .auth-left { display: none !important; }
      .auth-right { width: 100%; }
    }
    .form-control {
      height: 56px;
      background: var(--neutral-50);
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      padding-left: 48px;
    }
    .form-control:focus {
      border-color: var(--primary-600);
      box-shadow: 0 0 0 3px rgba(72, 127, 255, 0.1);
    }
    .icon-field {
      position: relative;
    }
    .icon-field .icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #6b7280;
      font-size: 20px;
    }
    .btn-primary-600 {
      background: var(--primary-600);
      border: none;
      border-radius: 12px;
      height: 52px;
      font-weight: 600;
    }
    .btn-primary-600:hover {
      background: #3b6de0;
    }
    .max-w-464-px {
      max-width: 464px;
    }
    .radius-12 {
      border-radius: 12px;
    }
    .text-primary-600 {
      color: var(--primary-600) !important;
    }
    .auth-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: var(--primary-50);
      color: var(--primary-600);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <section class="auth d-flex flex-wrap">
    <div class="auth-left d-lg-flex d-none">
      <img src="https://wowdash.flavor33labs.com/demo/wowdash/html/assets/images/auth/auth-img.png" alt="Auth">
    </div>
    
    <div class="auth-right">
      <div class="max-w-464-px mx-auto w-100">
        <div class="text-center mb-4">
          <h2 class="fw-bold mb-2" style="color: var(--primary-600);">BPA</h2>
          <h4 class="mb-2">${panelName} Registration</h4>
          <p class="text-secondary">Create a new account to get started</p>
        </div>
        
        ${error ? `<div class="alert alert-danger py-12 px-16 radius-12 mb-3">${error}</div>` : ""}
        
        <form id="registerForm">
          <input type="hidden" name="app" value="${app || ""}">
          <input type="hidden" name="returnTo" value="${safeReturnTo}">
          <input type="hidden" name="isOwner" value="${isOwner ? "true" : "false"}">
          
          <div class="icon-field mb-3">
            <span class="icon"><i class="ri-user-line"></i></span>
            <input 
              type="text" 
              class="form-control" 
              id="identifier" 
              name="identifier" 
              placeholder="Email or Phone Number"
              autocomplete="username"
              required
            >
          </div>
          <div id="identifierType" class="mb-2" style="display: none;">
            <span class="auth-badge">
              <i class="ri-mail-line" id="typeIcon"></i>
              <span id="typeText">Email</span>
            </span>
          </div>
          
          <div class="icon-field mb-3">
            <span class="icon"><i class="ri-user-3-line"></i></span>
            <input 
              type="text" 
              class="form-control" 
              id="name" 
              name="name" 
              placeholder="Full Name (Optional)"
              autocomplete="name"
            >
          </div>
          
          <div class="icon-field mb-3">
            <span class="icon"><i class="ri-lock-password-line"></i></span>
            <input 
              type="password" 
              class="form-control" 
              id="password" 
              name="password" 
              placeholder="Password (min 4 characters)"
              autocomplete="new-password"
              minlength="4"
              required
            >
          </div>
          
          <div class="icon-field mb-4">
            <span class="icon"><i class="ri-lock-password-line"></i></span>
            <input 
              type="password" 
              class="form-control" 
              id="confirmPassword" 
              name="confirmPassword" 
              placeholder="Confirm Password"
              autocomplete="new-password"
              required
            >
          </div>
          
          <div id="errorMsg" class="alert alert-danger mb-3" style="display: none;"></div>
          
          <button type="submit" class="btn btn-primary-600 w-100" id="submitBtn">
            Create Account
          </button>
          
          <div class="text-center mt-4">
            <p class="text-secondary mb-2">
              Already have an account? 
              <a href="/auth/login?app=${app || ""}&returnTo=${encodeURIComponent(safeReturnTo)}" class="text-primary-600 fw-semibold">
                Sign In
              </a>
            </p>
            ${safeReturnTo ? `<p class="text-muted small">After registration, you'll be redirected to: <code>${safeReturnTo}</code></p>` : ""}
          </div>
        </form>
      </div>
    </div>
  </section>
  
  <script>
    const form = document.getElementById('registerForm');
    const identifierInput = document.getElementById('identifier');
    const identifierType = document.getElementById('identifierType');
    const typeIcon = document.getElementById('typeIcon');
    const typeText = document.getElementById('typeText');
    const errorMsg = document.getElementById('errorMsg');
    const submitBtn = document.getElementById('submitBtn');
    
    // Detect auth type (email or phone)
    identifierInput.addEventListener('input', function() {
      const value = this.value.trim();
      if (!value) {
        identifierType.style.display = 'none';
        return;
      }
      
      const isEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
      const isPhone = /^[+]?[0-9\\s-]{7,}$/.test(value.replace(/\\s+/g, ''));
      
      if (isEmail) {
        identifierType.style.display = 'block';
        typeIcon.className = 'ri-mail-line';
        typeText.textContent = 'Email';
      } else if (isPhone) {
        identifierType.style.display = 'block';
        typeIcon.className = 'ri-phone-line';
        typeText.textContent = 'Phone';
      } else {
        identifierType.style.display = 'none';
      }
    });
    
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const identifier = identifierInput.value.trim();
      const name = document.getElementById('name').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const returnTo = form.querySelector('input[name="returnTo"]').value;
      const isOwner = form.querySelector('input[name="isOwner"]').value === 'true';
      
      if (!identifier || !password) {
        errorMsg.textContent = 'Please fill in required fields';
        errorMsg.style.display = 'block';
        return;
      }
      
      if (password.length < 4) {
        errorMsg.textContent = 'Password must be at least 4 characters';
        errorMsg.style.display = 'block';
        return;
      }
      
      if (password !== confirmPassword) {
        errorMsg.textContent = 'Passwords do not match';
        errorMsg.style.display = 'block';
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating account...';
      errorMsg.style.display = 'none';
      
      try {
        // Detect if email or phone
        const isEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(identifier);
        const payload = {
          password,
          ...(isEmail ? { email: identifier } : { phone: identifier.replace(/\\D/g, '') }),
          ...(name ? { name } : {}),
          isOwner: isOwner
        };
        
        const response = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Registration failed');
        }
        
        // Redirect to returnTo URL (login page with success message)
        const loginUrl = '/auth/login?app=${app || ""}&returnTo=' + encodeURIComponent(returnTo) + '&registered=1';
        window.location.href = loginUrl;
      } catch (err) {
        errorMsg.textContent = err.message || 'Registration failed. Please try again.';
        errorMsg.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * GET /auth/login
 * Render login page
 */
exports.loginPage = async (req: any, res: any) => {
  const app = String(req.query?.app || "").trim();
  const returnTo = String(req.query?.returnTo || "").trim();
  const registered = req.query?.registered === "1";
  
  const error = registered ? undefined : undefined;
  const html = getLoginPageHtml(app, returnTo, error);
  
  // Add success message if just registered
  const finalHtml = registered 
    ? html.replace(
        '<form id="loginForm">',
        '<div class="alert alert-success py-12 px-16 radius-12 mb-3">Registration successful! Please sign in.</div><form id="loginForm">'
      )
    : html;
  
  res.setHeader("Content-Type", "text/html");
  return res.send(finalHtml);
};

/**
 * GET /auth/register
 * Render register page
 */
exports.registerPage = async (req: any, res: any) => {
  const app = String(req.query?.app || "").trim();
  const returnTo = String(req.query?.returnTo || "").trim();
  
  const html = getRegisterPageHtml(app, returnTo);
  
  res.setHeader("Content-Type", "text/html");
  return res.send(html);
};

export {};
